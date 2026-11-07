import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {wheelGeometry, wheelSelection, appRings} from './policy.js';
import {color, rgb, addBlur} from './appearance.js';
import {RingMask} from './ringmask.js';

export class FavoritesWheel {
    constructor(settings) {
        this.settings = settings;
        this.actor = null;
        this.selection = null;
        this.closing = new Set();
    }
    open(x, y) {
        this.close(true);
        const monitor = Main.layoutManager.monitors.find(m => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
            ?? Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const system = Shell.AppSystem.get_default();
        const running = system.get_running().filter(app => app.get_windows().length).map(app => app.get_id()).sort();
        const favorites = this.settings.get_strv('favorites').slice(0, 12).filter(id => system.lookup_app(id));
        const groups = appRings(favorites, running, this.settings.get_boolean('dock-mode'));
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const base = this.settings.get_int('wheel-radius') * scale;
        const ringWidth = this.settings.get_int('ring-width') * scale;
        const desired = base + Math.max(0, groups.length - 1) * ringWidth;
        this.geometry = wheelGeometry([x, y], monitor, desired);
        const ratio = this.geometry.radius / desired;
        this.inner = this.settings.get_int('neutral-radius') * scale * ratio;
        const r = this.geometry.radius;
        this.origin = [x, y]; this.moved = false; this.selection = null;
        this.rings = []; this.cells = [];
        this.actor = new St.Widget({reactive: false, width: r * 2, height: r * 2,
            x: this.geometry.x - r, y: this.geometry.y - r});
        // Must be on stage before easing: Clutter skips transitions on unmapped actors.
        Main.layoutManager.addTopChrome(this.actor, {trackFullscreen: true});
        groups.forEach((ids, ringIndex) => {
            const inner = ringIndex ? (base + (ringIndex - 1) * ringWidth + 5 * scale) * ratio : this.inner;
            const outer = (base + ringIndex * ringWidth) * ratio;
            const ring = {inner, outer, ids}; this.rings.push(ring);
            const orbit = (inner + outer) / 2;
            const iconSize = Math.min(this.settings.get_int('wheel-icon-size') * scale * ratio,
                Math.PI * 2 * orbit / ids.length * 0.65, (outer - inner) * 0.65);
            ids.forEach((id, index) => {
                const group = new St.Widget({width: r * 2, height: r * 2, reactive: false});
                const disc = new St.DrawingArea({width: r * 2, height: r * 2, reactive: false});
                const cell = {id, index, ring, disc, group}; this.cells.push(cell);
                disc.connect('repaint', () => this._paint(cell)); group.add_child(disc);
                const angle = index * Math.PI * 2 / ids.length - Math.PI / 2;
                const cx = r + Math.cos(angle) * orbit, cy = r + Math.sin(angle) * orbit;
                const icon = system.lookup_app(id).create_icon_texture(iconSize);
                icon.reactive = false; icon.set_position(cx - iconSize / 2, cy - iconSize / 2); group.add_child(icon);
                if (running.includes(id)) {
                    const dot = new St.Widget({width: 4 * scale * ratio, height: 4 * scale * ratio,
                        x: cx - 2 * scale * ratio, y: cy + iconSize / 2 + 5 * scale * ratio,
                        style: `background-color: ${color(this.settings, 'accent-color')}; border-radius: 99px;`});
                    group.add_child(dot);
                }
                this.actor.add_child(group);
                if (this._animated()) {
                    group.set_pivot_point(0.5, 0.5); group.opacity = 0;
                    const start = this._collapsed();
                    group.set_scale(start, start);
                    group.ease({opacity: 255, scale_x: 1, scale_y: 1,
                        delay: Math.min(index * 14 + ringIndex * 35, 140),
                        duration: this.settings.get_int('wheel-open-duration'), mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
            });
        });
        if (this.settings.get_boolean('wheel-blur')) this._addBlur(r);
    }
    _addBlur(r) {
        // shortcut: the mask covers 4 rings / 32 sectors (ringmask.js); larger dock wheels leave the rest unblurred.
        const blur = new St.Widget({width: r * 2, height: r * 2, reactive: false, clip_to_allocation: true});
        const mask = new RingMask(r * 2, this.rings.map(ring =>
            [ring.inner + 2, ring.outer - 2, ring.ids.length, this._gap(ring)]));
        blur.add_effect(mask);
        // The layer itself never animates: each sector's blur mirrors that sector's scale and fade.
        const cells = this.cells;
        const sync = () => mask.setSectors(cells.map(({group}) => [group.scale_x, group.opacity / 255]));
        for (const {group} of cells)
            for (const property of ['notify::scale-x', 'notify::opacity']) group.connect(property, sync);
        sync();
        this.actor.insert_child_at_index(blur, 0);
        this.blurLayer = blur;
        addBlur(blur, this.settings, 'wheel-blur', [this.geometry.x - r, this.geometry.y - r]);
    }
    _gap(ring) {
        return Math.min(this.settings.get_int('sector-gap') / ring.outer, Math.PI / ring.ids.length / 2);
    }
    _paint({id, index, ring, disc}) {
        const cr = disc.get_context(), r = this.geometry.radius;
        const background = rgb(color(this.settings, 'background-color'));
        const accent = rgb(color(this.settings, 'accent-color'));
        const step = Math.PI * 2 / ring.ids.length;
        const gap = this._gap(ring);
        const start = index * step - Math.PI / 2 - step / 2 + gap;
        const end = start + step - gap * 2;
        cr.arc(r, r, ring.outer - 2, start, end);
        cr.arcNegative(r, r, ring.inner + 2, end, start); cr.closePath();
        const fill = id === this.selection ? background.map((v, c) => v * 0.68 + accent[c] * 0.32) : background;
        cr.setSourceRGBA(...fill, this.settings.get_int('wheel-opacity') / 100); cr.fillPreserve();
        cr.setSourceRGBA(1, 1, 1, 0.10); cr.setLineWidth(1); cr.stroke(); cr.$dispose();
    }
    updatePointer(x, y) {
        if (!this.actor) return;
        if (Math.hypot(x - this.origin[0], y - this.origin[1]) >= 5) this.moved = true;
        let selected = null;
        if (this.moved) for (const ring of this.rings) {
            const index = wheelSelection(x, y, {...this.geometry, radius: ring.outer}, ring.ids.length, ring.inner);
            if (index >= 0) { selected = ring.ids[index]; break; }
        }
        if (selected === this.selection) return;
        this.selection = selected;
        this.cells.forEach(cell => cell.disc.queue_repaint());
    }
    close(immediate = false) {
        this.selection = null;
        if (immediate) { for (const actor of this.closing) actor.destroy(); this.closing.clear(); }
        if (!this.actor) return;
        const actor = this.actor; this.actor = null;
        const groups = actor.get_children().filter(child => child !== this.blurLayer);
        this.blurLayer = null;
        if (immediate || !this._animated() || !groups.length) { actor.destroy(); return; }
        // Compress each sector back toward the centre, mirroring the grow-out.
        this.closing.add(actor);
        const end = this._collapsed();
        groups.forEach((group, index) => {
            group.remove_all_transitions();
            group.set_pivot_point(0.5, 0.5);
            group.ease({opacity: 0, scale_x: end, scale_y: end,
                duration: this.settings.get_int('wheel-close-duration'), mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: index === groups.length - 1
                    ? () => { if (this.closing.delete(actor)) actor.destroy(); } : undefined});
        });
    }
    _animated() { return this.settings.get_boolean('animations') && St.Settings.get().enable_animations; }
    _collapsed() { return this.settings.get_boolean('scale-animation') ? 0.35 : 1; }
    destroy() { this.close(true); }
}
