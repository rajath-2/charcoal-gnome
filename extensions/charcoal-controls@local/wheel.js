import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WHEEL_ITEMS, clampWheel, pickWheelItem, releaseSelection, themeItems} from './policy.js';

export class ControlWheel {
    constructor(settings, onSelect) {
        this.settings = settings;
        this.onSelect = onSelect;
        this.themes = [];
        this.layer = 'actions';
        this.actor = null;
        this._pressed = null;
        this._dispatched = false;
    }

    setThemes(profiles, activeId) {
        this.themes = themeItems(profiles, activeId);
        this.activeId = activeId;
        this.activeName = profiles.find(profile => profile.id === activeId)?.name ?? '';
        if (this.actor && this.layer === 'themes') this._render();
    }

    // held: opened by the shortcut, so releasing it picks the item under the pointer (the centre cancels).
    open(x, y, layer = 'actions', held = false) {
        this.close();
        this.layer = layer;
        this._held = held;
        const monitor = Main.layoutManager.monitors.find(m => x >= m.x && x < m.x + m.width &&
            y >= m.y && y < m.y + m.height) ?? Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        this.geometry = clampWheel(x, y, monitor, this.settings.get_int('radius'));
        this.actor = new St.Widget({reactive: true, can_focus: true, width: this.geometry.radius * 2,
            height: this.geometry.radius * 2, x: this.geometry.x - this.geometry.radius,
            y: this.geometry.y - this.geometry.radius});
        Main.layoutManager.addTopChrome(this.actor);
        this._render();
        // A modal grab routes clicks and keys here even over a focused app window (Wayland).
        this.actor.connect('captured-event', (_, event) => this._handleEvent(event));
        this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
    }

    _items() {
        if (this.layer === 'themes') return [['back', 'Back'], ...this.themes];
        const shown = this.settings.get_strv('wheel-items');
        return WHEEL_ITEMS.filter(([id]) => shown.includes(id));
    }

    _render() {
        this.actor.destroy_all_children();
        const items = this._items();
        const r = this.geometry.radius;
        const font = this.settings.get_int('text-size');
        const fg = this.settings.get_string('foreground-color'), bg = this.settings.get_string('background-color');
        const accent = this.settings.get_string('accent-color');
        const center = new St.Label({style: `color: ${fg}; font-size: ${font + 2}px; text-align: center;`});
        // The theme ring names the applied theme in its centre.
        if (this.layer === 'themes' && this.activeName)
            center.clutter_text.set_markup(`Themes\n<span size="small" foreground="${accent}">${GLib.markup_escape_text(this.activeName, -1)}</span>`);
        else center.text = this.layer === 'themes' ? 'Themes' : 'Controls';
        this.actor.add_child(center);
        const [, centerWidth] = center.get_preferred_width(-1);
        const [, centerHeight] = center.get_preferred_height(-1);
        center.set_position(r - centerWidth / 2, r - centerHeight / 2);
        items.forEach(([id, label], index) => {
            const angle = index * Math.PI * 2 / items.length - Math.PI / 2;
            const orbit = r * 0.69;
            // The applied theme is filled with the accent colour.
            const active = this.layer === 'themes' && id === this.activeId;
            const item = new St.Label({text: label, style: `background-color: ${active ? accent : bg}; ` +
                `color: ${active ? bg : fg}; ${active ? 'font-weight: bold; ' : ''}` +
                `font-size: ${font}px; padding: 8px; border-radius: 10px; ` +
                `border: ${this.settings.get_int('border-width')}px solid ${this.settings.get_string('border-color')}; ` +
                `box-shadow: 0 3px ${this.settings.get_int('shadow-size')}px ${this.settings.get_string('shadow-color')};`});
            item._wheelId = id;
            item._active = active;
            item._baseStyle = item.style;
            this.actor.add_child(item);
            const [, width] = item.get_preferred_width(-1);
            const [, height] = item.get_preferred_height(-1);
            item.set_position(r + Math.cos(angle) * orbit - width / 2,
                r + Math.sin(angle) * orbit - height / 2);
        });
    }

    _handleEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            if (this.layer === 'themes') this.onSelect('back');
            else this.close();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.KEY_RELEASE && this._held) {
            this._held = false;
            const [x, y] = global.get_pointer();
            const id = this._pick(x, y);
            if (id) { this._dispatched = true; this.onSelect(id); } else this.close();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.MOTION) {
            const [x, y] = event.get_coords();
            this._highlight(this._pick(x, y));
            return Clutter.EVENT_PROPAGATE;
        }
        if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.BUTTON_RELEASE)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const id = this._pick(x, y);
        if (type === Clutter.EventType.BUTTON_PRESS) {
            this._pressed = id;
            return id ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
        const selection = releaseSelection(this._pressed, id, this._dispatched);
        this._pressed = null;
        if (selection) {
            this._dispatched = true;
            this.onSelect(selection);
        } else this.close();
        return Clutter.EVENT_STOP;
    }

    _pick(x, y) {
        return pickWheelItem(x, y, this.geometry, this._items().map(item => item[0]), this.settings.get_int('neutral-radius'));
    }

    _highlight(id) {
        if (id === this._hovered) return;
        this._hovered = id;
        const accent = this.settings.get_string('accent-color');
        for (const item of this.actor.get_children())
            if (item._wheelId) item.style = item._wheelId !== id ? item._baseStyle
                : `${item._baseStyle} border-color: ${item._active ? this.settings.get_string('foreground-color') : accent};${item._active ? '' : ` color: ${accent};`}`;
    }

    close() {
        if (this._grab) Main.popModal(this._grab);
        this._grab = null;
        this.actor?.destroy(); this.actor = null;
        this._pressed = null; this._dispatched = false; this._held = false; this._hovered = null;
    }

    destroy() { this.close(); }
}
