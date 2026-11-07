import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {color, surfaceStyle} from './appearance.js';
import {previewPlacement} from './policy.js';

const MAX_WINDOWS = 6;

// Live thumbnails of one app's windows, shown beside the wheel for the hovered app.
export class WindowPreviews {
    constructor(settings) {
        this.settings = settings;
        this.actor = null;
        this.items = [];
        this.app = null;
        this.hovered = null;
    }

    // anchor: {center: [x, y], angle, radius, monitor}
    show(app, anchor) {
        this.destroy();
        const windows = app.get_windows().filter(w => !w.skip_taskbar && w.get_compositor_private()).slice(0, MAX_WINDOWS);
        if (!windows.length) return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const thumbHeight = 96 * scale, thumbWidth = 168 * scale;
        this.app = app;
        this.actor = new St.BoxLayout({reactive: false, style: `${surfaceStyle(this.settings)} padding: 8px; spacing: 8px;`});
        for (const window of windows) {
            const source = window.get_compositor_private();
            const [width, height] = source.get_size();
            const fit = Math.min(thumbWidth / Math.max(width, 1), thumbHeight / Math.max(height, 1));
            const item = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, reactive: false,
                style: 'padding: 6px; spacing: 4px; border-radius: 10px; border: 2px solid transparent;'});
            const frame = new St.Widget({width: thumbWidth, height: thumbHeight, layout_manager: new Clutter.BinLayout()});
            // Clones keep painting minimized windows, as the window switcher does.
            frame.add_child(new Clutter.Clone({source, width: width * fit, height: height * fit,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
            const title = new St.Label({text: window.get_title() ?? app.get_name(), style: 'font-size: 0.85em;',
                x_align: Clutter.ActorAlign.CENTER});
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            title.set_width(thumbWidth);
            item.add_child(frame);
            item.add_child(title);
            this.actor.add_child(item);
            this.items.push({item, window});
        }
        Main.layoutManager.addTopChrome(this.actor);
        const [, , width, height] = this.actor.get_preferred_size();
        const {x, y} = previewPlacement(anchor.center, anchor.angle, anchor.radius, [width, height], anchor.monitor);
        this.actor.set_position(x, y);
        this.bounds = {x, y, width, height};
        if (this.settings.get_boolean('animations') && St.Settings.get().enable_animations) {
            this.actor.opacity = 0;
            this.actor.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }

    // Farthest point of the panel from (x, y): how far a touchpad aim may travel to reach it.
    reachFrom(x, y) {
        if (!this.bounds) return 0;
        const {x: bx, y: by, width, height} = this.bounds;
        return Math.max(...[[bx, by], [bx + width, by], [bx, by + height], [bx + width, by + height]]
            .map(([px, py]) => Math.hypot(px - x, py - y)));
    }

    // {inside, window} for a stage point; highlights the window under it.
    hit(x, y) {
        if (!this.actor) return {inside: false, window: null};
        const {x: bx, y: by, width, height} = this.bounds;
        const inside = x >= bx && x <= bx + width && y >= by && y <= by + height;
        let window = null;
        for (const {item, window: candidate} of this.items) {
            const [ix, iy] = item.get_transformed_position();
            const [iw, ih] = item.get_transformed_size();
            if (inside && x >= ix && x <= ix + iw && y >= iy && y <= iy + ih) window = candidate;
        }
        if (window !== this.hovered) {
            this.hovered = window;
            const accent = color(this.settings, 'accent-color');
            for (const {item, window: candidate} of this.items)
                item.style = `padding: 6px; spacing: 4px; border-radius: 10px; border: 2px solid ${candidate === window ? accent : 'transparent'};`;
        }
        return {inside, window};
    }

    destroy() {
        this.actor?.destroy();
        this.actor = null;
        this.items = [];
        this.app = null;
        this.hovered = null;
        this.bounds = null;
    }
}
