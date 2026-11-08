import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {clampWheel, pickWheelItem, releaseSelection, themeItems} from './policy.js';

const ACTIONS = [
    ['lock', 'Lock'], ['note', 'Note'], ['settings', 'Settings'], ['themes', 'Themes'],
    ['suspend', 'Suspend'], ['logout', 'Log out'], ['restart', 'Restart'], ['poweroff', 'Power off'],
];

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
        if (this.actor && this.layer === 'themes') this._render();
    }

    open(x, y, layer = 'actions') {
        this.close();
        this.layer = layer;
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
        return this.layer === 'themes' ? [['back', 'Back'], ...this.themes] : ACTIONS;
    }

    _render() {
        this.actor.destroy_all_children();
        const items = this._items();
        const r = this.geometry.radius;
        const font = this.settings.get_int('text-size');
        const center = new St.Label({text: this.layer === 'themes' ? 'Themes' : 'Controls',
            style: `color: ${this.settings.get_string('foreground-color')}; font-size: ${font + 2}px;`});
        this.actor.add_child(center);
        const [, centerWidth] = center.get_preferred_width(-1);
        const [, centerHeight] = center.get_preferred_height(-1);
        center.set_position(r - centerWidth / 2, r - centerHeight / 2);
        items.forEach(([id, label], index) => {
            const angle = index * Math.PI * 2 / items.length - Math.PI / 2;
            const orbit = r * 0.69;
            const item = new St.Label({text: label, style: `background-color: ${this.settings.get_string('background-color')}; ` +
                `color: ${this.settings.get_string('foreground-color')}; ` +
                `font-size: ${font}px; padding: 8px; border-radius: 10px; ` +
                `border: ${this.settings.get_int('border-width')}px solid ${this.settings.get_string('border-color')}; ` +
                `box-shadow: 0 3px ${this.settings.get_int('shadow-size')}px ${this.settings.get_string('shadow-color')};`});
            item._wheelId = id;
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
        if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.BUTTON_RELEASE)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const id = pickWheelItem(x, y, this.geometry, this._items().map(item => item[0]),
            this.settings.get_int('neutral-radius'));
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

    close() {
        if (this._grab) Main.popModal(this._grab);
        this._grab = null;
        this.actor?.destroy(); this.actor = null;
        this._pressed = null; this._dispatched = false;
    }

    destroy() { this.close(); }
}
