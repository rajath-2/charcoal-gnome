import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {findLockActors, snapshotActors, restoreActors} from './actors.js';
import {ELEMENTS, readValues, layoutLockElements, readStyle, readElementStyle, chooseWallpaper} from './policy.js';
import {ThemeClient} from './theme-client.js';

const MAX_TEXT = 200;
const BOXES = ['user', 'prompt', 'status', 'notifications', 'text', 'image'];
// The prompt goes first: on any failure it is restored before anything else.
const ORDER = ['prompt', 'clock', 'date', 'user', 'status', 'notifications'];
const SHIFT = {start: 0, center: 0.5, end: 1};

// An existing regular local file (absolute path or file:// URI) as a percent-encoded URI, else null.
export function localFileUri(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
        const file = value.startsWith('file://') ? Gio.File.new_for_uri(value)
            : value.startsWith('/') ? Gio.File.new_for_path(value) : null;
        if (file?.query_file_type(Gio.FileQueryInfoFlags.NONE, null) !== Gio.FileType.REGULAR) return null;
        const uri = file.get_uri();
        return /^file:\/\/[^"\\\s]+$/.test(uri) ? uri : null;
    } catch (e) {
        return null;
    }
}

function elementCss(s, panel, box) {
    const css = [`font-family: "${s['font-family']}"`, `font-weight: ${s['font-weight']}`,
        `font-size: ${s['font-size']}px`, `color: ${s.color}`,
        `text-align: ${s.align === 'start' ? 'left' : s.align === 'end' ? 'right' : 'center'}`];
    if (box) {
        css.push(`background-color: ${panel}`, `border: ${s['border-width']}px solid ${s['border-color']}`,
            `border-radius: ${s['border-radius']}px`, `box-shadow: 0 0 ${s['shadow-size']}px ${s['shadow-color']}`,
            `spacing: ${s.spacing}px`, `padding: ${s.spacing}px`);
    }
    return `${css.join('; ')};`;
}

// Sum of allocations up the tree plus our own offsets on ancestors; GNOME's transient
// animation transforms are left out so they never feed back into our placement.
function layoutPosition(actor, snapshot) {
    let x = 0, y = 0;
    for (let a = actor; a; a = a.get_parent()) {
        const box = a.get_allocation_box(), state = a !== actor ? snapshot.get(a) : null;
        x += box.x1 + (state?.dx ?? 0);
        y += box.y1 + (state?.dy ?? 0);
    }
    return [x, y];
}

export default class CharcoalLockscreen extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._source = new ThemeClient('lockscreen', this._settings);
        this._unwatchTheme = this._source.connectChanged(() => this._reapply());
        this._wallpaper = null;
        this._snapshot = new Map();
        this._blocks = [];
        this._settings.connectObject('changed', (_, key) => key !== 'status' && this._reapply(), this);
        Main.screenShield.connectObject('active-changed', () => this._sync(),
            'locked-changed', () => this._sync(), 'lock-screen-shown', () => this._sync(), this);
        Main.sessionMode.connectObject('updated', () => this._sync(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._reapply(), this);
        // No keyboard handlers are installed: the password entry stays entirely GNOME's.
        this._sync();
    }

    disable() {
        if (this._idle) GLib.Source.remove(this._idle);
        this._idle = 0;
        this._detach();
        Main.screenShield.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._unwatchTheme();
        this._source.destroy();
        this._settings = this._source = this._unwatchTheme = this._snapshot = this._blocks = this._wallpaper = null;
    }

    _sync() {
        const dialog = Main.screenShield?._dialog ?? null;
        if (dialog === this._dialog) return;
        this._detach();
        if (!dialog) return;
        this._dialog = dialog;
        dialog.connectObject('destroy', () => this._forget(), this);
        // GNOME creates and destroys the auth prompt (and the user well) inside the prompt box.
        dialog._promptBox?.connectObject('child-added', () => this._reapply(),
            'child-removed', () => this._reapply(), this);
        this._reapply();
    }

    // The dialog is gone with all its actors: drop references without touching them.
    _forget() {
        for (const actor of this._snapshot.keys()) actor.disconnectObject(this);
        this._snapshot.clear();
        this._blocks = [];
        this._dialog = null;
    }

    _detach() {
        if (!this._dialog) return;
        this._dialog.disconnectObject(this);
        this._dialog._promptBox?.disconnectObject(this);
        this._restore([...this._snapshot.keys()]);
        for (const actor of this._snapshot.keys()) actor.disconnectObject(this);
        this._blocks.forEach(block => block.destroy());
        this._forget();
    }

    _reapply() {
        if (!this._dialog) return;
        // A full re-apply retries actors that failed before; allocation passes do not.
        for (const state of this._snapshot.values()) state.failed = false;
        try {
            this.applyLayout(readValues(this._source));
        } catch (e) {
            this._fail('layout', e);
        }
    }

    _track(actors) {
        for (const [actor, state] of snapshotActors(actors)) {
            if (this._snapshot.has(actor)) continue;
            this._snapshot.set(actor, state);
            actor.connectObject('destroy', () => this._snapshot.delete(actor),
                'notify::allocation', () => this._queuePlace(),
                // GNOME writes the prompt's translation (crossfade) and the notifications' visibility
                // itself: put our change back on top. Idempotent, as GLib may deliver notifies late.
                'notify::translation-x', () => this._reassert(actor, state, 'x'),
                'notify::translation-y', () => this._reassert(actor, state, 'y'),
                'notify::visible', () => {
                    // shortcut: GNOME hiding an actor we already hid emits nothing, so restore may show it; fine until it matters.
                    if (state.hidden && actor.visible) { state.visible = true; actor.visible = false; }
                }, this);
        }
    }

    _reassert(actor, state, axis) {
        const prop = `translation_${axis}`;
        if (actor[prop] === state[`t${axis}`]) return;
        this._translate(actor, state, axis, actor[prop] + state[`d${axis}`]);
    }

    // Record the value first so the notify it causes is recognised as ours.
    _translate(actor, state, axis, value) {
        state[`t${axis}`] = Math.fround(value);
        actor[`translation_${axis}`] = state[`t${axis}`];
    }

    // Updates only presentation and position; never the password text or authentication.
    applyLayout(values) {
        const actors = findLockActors();
        if (!actors || actors.dialog !== this._dialog) return;
        const style = readStyle(values.style);
        const wallpaper = chooseWallpaper(style['lock-wallpaper'], localFileUri(style['lock-wallpaper']), this._wallpaper);
        this._wallpaper = wallpaper.uri;
        if (this._settings.get_string('status') !== wallpaper.error) this._settings.set_string('status', wallpaper.error);
        this._track(actors);
        const monitors = Main.layoutManager.monitors.map(({x, y, width, height}) => ({x, y, width, height}));
        this._monitors = monitors;
        this._placements = layoutLockElements(values.elements, monitors, Main.layoutManager.primaryIndex);
        this._styles = Object.fromEntries(ELEMENTS.map(name =>
            [name, elementCss(readElementStyle(values.style, values.elementStyles, name), style['panel-color'], BOXES.includes(name))]));
        this._aligns = Object.fromEntries(ELEMENTS.map(name =>
            [name, readElementStyle(values.style, values.elementStyles, name).align]));
        for (const [actor, state] of this._snapshot) {
            if (state.failed) continue;
            this._guard(actor, () => {
                actor.style = `${state.style ?? ''} ${this._styles[state.key]}`;
                const shown = state.key === 'prompt' || this._placements[state.key]?.visible !== false;
                if (!shown && !state.hidden) { state.visible = actor.visible; state.hidden = true; actor.visible = false; }
                else if (shown && state.hidden) { state.hidden = false; actor.visible = state.visible; }
            });
        }
        this._buildBlocks(values);
        this._place();
    }

    _queuePlace() {
        if (this._idle) return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idle = 0;
            this._place();
            return GLib.SOURCE_REMOVE;
        });
    }

    _place() {
        if (!this._placements) return;
        const entries = [...this._snapshot].sort(([, a], [, b]) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
        for (const [actor, state] of entries.filter(([, s]) => !s.failed))
            this._guard(actor, () => this._move(actor, state));
    }

    _move(actor, state) {
        const target = this._placements[state.key];
        const box = actor.get_allocation_box();
        const width = box.get_width(), height = box.get_height();
        const m = target && this._monitors[target.monitor];
        let dx = 0, dy = 0;
        // An unsafe prompt (no placement, or bigger than its monitor) stays at GNOME's own position.
        if (m && width > 0 && (state.key !== 'prompt' || (width <= m.width && height <= m.height))) {
            const x = target.x + (target.width - width) * SHIFT[this._aligns[state.key]];
            const y = target.y + (target.height - height) / 2;
            const [baseX, baseY] = layoutPosition(actor, this._snapshot);
            dx = Math.round(Math.max(m.x, Math.min(m.x + m.width - width, x)) - baseX);
            dy = Math.round(Math.max(m.y, Math.min(m.y + m.height - height, y)) - baseY);
        }
        if (dx === state.dx && dy === state.dy) return;
        const [oldX, oldY] = [state.dx, state.dy];
        state.dx = dx;
        state.dy = dy;
        this._translate(actor, state, 'x', actor.translation_x + dx - oldX);
        this._translate(actor, state, 'y', actor.translation_y + dy - oldY);
    }

    _buildBlocks(values) {
        this._blocks.forEach(block => block.destroy());
        this._blocks = [];
        const dialog = this._dialog, p = this._placements;
        const add = (actor, rect, below = null) => {
            actor.set_position(rect.x, rect.y);
            actor.set_size(rect.width, rect.height);
            if (below) dialog.insert_child_above(actor, below); else dialog.add_child(actor);
            this._blocks.push(actor);
        };
        const text = [...String(values.text ?? '')].slice(0, MAX_TEXT).join('');
        if (text && p.text?.visible)
            add(new St.Label({name: 'charcoal-lock-text', text, style: this._styles.text}), p.text);
        const image = p.image?.visible ? localFileUri(values.image) : null;
        if (image) {
            add(new St.Widget({name: 'charcoal-lock-image',
                style: `${this._styles.image} background-image: url("${image}"); background-size: contain;`}), p.image);
        }
        const wallpaper = this._wallpaper;
        if (wallpaper && dialog._backgroundGroup) {
            for (const m of this._monitors) {
                add(new St.Widget({name: 'charcoal-lock-wallpaper',
                    style: `background-image: url("${wallpaper}"); background-size: cover;`}), m, dialog._backgroundGroup);
            }
        }
    }

    _guard(actor, callback) {
        try {
            callback();
        } catch (e) {
            this._fail(this._snapshot.get(actor)?.key ?? 'element', e, actor);
        }
    }

    _restore(actors) {
        const prompt = [...this._snapshot].find(([, s]) => s.key === 'prompt')?.[0];
        const order = prompt && actors.includes(prompt) ? [prompt, ...actors.filter(a => a !== prompt)] : actors;
        for (const actor of order) {
            const state = this._snapshot.get(actor);
            if (state) restoreActors(new Map([[actor, state]]));
        }
    }

    _fail(name, error, actor = null) {
        try {
            const prompt = [...this._snapshot].find(([, s]) => s.key === 'prompt')?.[0];
            const failed = [prompt, actor].filter(Boolean);
            for (const a of failed) this._snapshot.get(a).failed = true;
            this._restore(failed);
            this._settings?.set_string('status', `error: ${name}: ${error.message}`);
        } catch (e) {
            logError(e, 'charcoal-lockscreen restore');
        }
        logError(error, `charcoal-lockscreen ${name}`);
    }
}
