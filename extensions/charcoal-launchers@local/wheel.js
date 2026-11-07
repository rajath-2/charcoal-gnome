import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {wheelGeometry, wheelSelection} from './policy.js';
import {animate, color, rgb} from './appearance.js';

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
        this.apps = this.settings.get_strv('favorites').slice(0, 12)
            .map(id => Shell.AppSystem.get_default().lookup_app(id)).filter(Boolean);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.geometry = wheelGeometry([x, y], monitor, this.settings.get_int('wheel-radius') * scale);
        const {radius: r} = this.geometry;
        this.inner = Math.min(this.settings.get_int('neutral-radius') * scale, r * 0.55);
        this.origin = [x, y];
        this.moved = false;
        this.index = -1;
        this.selection = null;
        this.actor = new St.Widget({reactive: false, width: r * 2, height: r * 2,
            x: this.geometry.x - r, y: this.geometry.y - r});
        this.disc = new St.DrawingArea({width: r * 2, height: r * 2, reactive: false});
        this.disc.connect('repaint', () => this._paint());
        this.actor.add_child(this.disc);
        const orbit = (this.inner + r) / 2;
        const arcSize = this.apps.length ? Math.PI * 2 * orbit / this.apps.length * 0.7 : 48;
        const iconSize = Math.min(this.settings.get_int('wheel-icon-size') * scale, arcSize, (r - this.inner) * 0.65);
        this.apps.forEach((app, i) => {
            const angle = i * Math.PI * 2 / this.apps.length - Math.PI / 2;
            const icon = app.create_icon_texture(iconSize);
            icon.reactive = false;
            icon.set_position(r + Math.cos(angle) * orbit - iconSize / 2, r + Math.sin(angle) * orbit - iconSize / 2);
            this.actor.add_child(icon);
        });
        Main.layoutManager.addTopChrome(this.actor, {trackFullscreen: true});
        animate(this.actor, this.settings, true);
    }
    _paint() {
        const cr = this.disc.get_context();
        const r = this.geometry.radius;
        const alpha = this.settings.get_int('background-opacity') / 100;
        const background = rgb(color(this.settings, 'background-color'));
        const accent = rgb(color(this.settings, 'accent-color'));
        const count = this.apps.length;
        const step = Math.PI * 2 / Math.max(count, 1);
        const gap = Math.min(this.settings.get_int('sector-gap') / r, step / 4);
        for (let i = 0; i < count; i++) {
            const start = i * step - Math.PI / 2 - step / 2 + gap;
            const end = start + step - gap * 2;
            cr.newPath();
            cr.arc(r, r, r - 3, start, end);
            cr.arcNegative(r, r, this.inner + 2, end, start);
            cr.closePath();
            const fill = i === this.index
                ? background.map((value, channel) => value * 0.68 + accent[channel] * 0.32) : background;
            cr.setSourceRGBA(...fill, alpha);
            cr.fillPreserve();
            cr.setSourceRGBA(1, 1, 1, 0.10);
            cr.setLineWidth(1);
            cr.stroke();
        }
        cr.$dispose();
    }
    updatePointer(x, y) {
        if (!this.actor) return;
        if (Math.hypot(x - this.origin[0], y - this.origin[1]) >= 5) this.moved = true;
        const index = this.moved ? wheelSelection(x, y, this.geometry, this.apps.length, this.inner) : -1;
        if (index === this.index) return;
        this.index = index;
        this.selection = index < 0 ? null : this.apps[index].get_id();
        this.disc.queue_repaint();
    }
    close(immediate = false) {
        this.selection = null;
        if (immediate) {
            for (const actor of this.closing) actor.destroy();
            this.closing.clear();
        }
        if (!this.actor) return;
        const actor = this.actor;
        this.actor = null;
        if (immediate) actor.destroy();
        else {
            this.closing.add(actor);
            animate(actor, this.settings, false, () => { this.closing.delete(actor); actor.destroy(); });
        }
    }
    destroy() { this.close(true); }
}
