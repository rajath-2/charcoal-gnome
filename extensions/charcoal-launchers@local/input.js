import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {activateAtCursor, activateWindowAt} from './windows.js';
import {Gesture, TouchpadWheel, restoreBindings} from './policy.js';

// Journal before changing a setting, so an interrupted Shell can restore it.
class BindingOwner {
    constructor(settings) {
        this.settings = settings;
        try { this.records = JSON.parse(settings.get_string('owned-bindings')); }
        catch { this.records = []; }
        if (!Array.isArray(this.records)) this.records = [];
    }
    _save() { this.settings.set_string('owned-bindings', JSON.stringify(this.records)); }
    claim(schema, key, applied) {
        const target = new Gio.Settings({schema_id: schema});
        const original = target.get_value(key).deepUnpack();
        if (JSON.stringify(original) === JSON.stringify(applied)) return;
        if (!target.is_writable(key)) throw new Error(`${key} is locked by desktop policy`);
        this.records.push({schema, key, original, applied});
        this._save();
        if (!target.set_value(key, new GLib.Variant(target.get_value(key).get_type_string(), applied)))
            throw new Error(`Could not update ${key}`);
    }
    restore(schemaOnly = null) {
        const failed = [];
        for (const record of [...this.records].reverse()) {
            if (schemaOnly && record.schema !== schemaOnly) { failed.unshift(record); continue; }
            try {
                const {schema, key, original, applied} = record;
                const target = new Gio.Settings({schema_id: schema});
                const current = target.get_value(key).deepUnpack();
                const value = Array.isArray(original)
                    ? restoreBindings(original, applied, current)
                    : current === applied ? original : current;
                if (JSON.stringify(value) !== JSON.stringify(current) &&
                    !target.set_value(key, new GLib.Variant(target.get_value(key).get_type_string(), value)))
                    throw new Error(`Could not restore ${key}`);
            } catch (error) {
                failed.unshift(record);
                console.warn(`Charcoal Launchers: ${error.message}`);
            }
        }
        this.records = failed;
        this._save();
    }
}

export class InputController {
    constructor(settings, wheel, search) {
        this.settings = settings;
        this.wheel = wheel;
        this.search = search;
        this.gesture = new Gesture();
        this.pad = new TouchpadWheel();
        this.padTimer = 0;
        this.owner = new BindingOwner(settings);
        this.signals = [];
        this.actions = [];
        this.poll = 0;
        this.setup = 0;
        this.escapeAction = 0;
    }
    _connect(object, signal, callback) {
        this.signals.push([object, object.connect(signal, callback)]);
    }
    enable() {
        this.owner.restore();
        this.settings.set_string('status', '');
        this._connect(global.stage, 'captured-event::touchpad', (_, event) => this._touchpad(event));
        try {
            if (this.settings.get_boolean('search-enabled')) {
                const shortcuts = this.settings.get_strv('launcher-shortcut');
                const wm = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
                // Only take the known layout-switch conflict; unknown conflicts remain untouched.
                for (const key of ['switch-input-source', 'switch-input-source-backward']) {
                    const original = wm.get_strv(key);
                    const applied = original.filter(s => !shortcuts.includes(s));
                    if (original.length !== applied.length)
                        this.owner.claim('org.gnome.desktop.wm.keybindings', key, applied);
                }
            }
            if (this.settings.get_boolean('wheel-enabled'))
                this.owner.claim('org.gnome.mutter', 'overlay-key', '');
        } catch (error) {
            this.settings.set_string('status', error.message);
            this.owner.restore();
            if (this.searchBinding) Main.wm.removeKeybinding('launcher-shortcut');
            this.searchBinding = 0;
            return;
        }
        this._connect(global.display, 'accelerator-activated', (_, action) => {
            if (this.searchActions?.includes(action)) { this.cancel(); this.search.toggle(); }
            else if (action === this.escapeAction) {
                this.gesture.cancel();
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { this.cancel(); return GLib.SOURCE_REMOVE; });
            }
            else if (this.actions.includes(action)) this._press();
        });
        this._connect(global.window_manager, 'filter-keybinding', (_, binding) => {
            if (this.escapeAction && Meta.external_binding_name_for_action(this.escapeAction) === binding.get_name())
                return false;
            if (!this.actions.some(a => Meta.external_binding_name_for_action(a) === binding.get_name()))
                this.cancel();
            return false; // Observe; never suppress the desktop's shortcut.
        });
        this._connect(global.stage, 'captured-event', (_, event) => {
            if (event.type() === Clutter.EventType.KEY_PRESS &&
                ![Clutter.KEY_Super_L, Clutter.KEY_Super_R].includes(event.get_key_symbol()))
                this.cancel();
            return Clutter.EVENT_PROPAGATE;
        });
        this._connect(global.display, 'notify::focus-window', () => this.cancel());
        // Mutter applies overlay-key changes in an idle callback before these grabs.
        let attempts = 0;
        this.searchActions = [];
        this.setup = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            attempts++;
            if (attempts === 1 && this.settings.get_boolean('search-enabled')) {
                for (const shortcut of this.settings.get_strv('launcher-shortcut')) {
                    const action = global.display.grab_accelerator(shortcut, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
                    if (!action) {
                        this.settings.set_string('status', 'Search shortcut is already in use. Choose another in Preferences.');
                        this.owner.restore('org.gnome.desktop.wm.keybindings');
                        break;
                    }
                    this.searchActions.push(action);
                    Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action),
                        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP);
                }
            }
            if (!this.settings.get_boolean('wheel-enabled')) { this.setup = 0; return GLib.SOURCE_REMOVE; }
            for (const key of ['Super_L', 'Super_R']) {
                const action = global.display.grab_accelerator(key, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
                if (action !== Meta.KeyBindingAction.NONE) {
                    this.actions.push(action);
                    Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action),
                        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
                }
            }
            if (!this.actions.length && attempts < 12) return GLib.SOURCE_CONTINUE;
            this.setup = 0;
            if (!this.actions.length) {
                this.settings.set_string('status', 'Super is already claimed by another component. The wheel could not start.');
                this.owner.restore('org.gnome.mutter');
            }
            return GLib.SOURCE_REMOVE;
        });
    }
    _press() {
        if (this.pad.state !== 'idle' || this.search.isOpen || !Main.sessionMode.hasWindows || Main.sessionMode.isLocked ||
            !this.gesture.press()) return;
        const started = GLib.get_monotonic_time();
        const userTime = global.display.get_last_user_time();
        const otherModifiers = Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK |
            Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.MOD5_MASK;
        this.poll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const [x, y, mods] = global.get_pointer();
            // User timestamps change on key/button presses, not pointer motion.
            // Combined with the binding observer this catches chords inside apps
            // without grabbing their keyboard or interfering with window tiling.
            if (global.display.get_last_user_time() !== userTime || (mods & otherModifiers) ||
                Main.sessionMode.isLocked || !(Main.actionMode & (Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW))) {
                this.poll = 0;
                this.cancel();
                return GLib.SOURCE_REMOVE;
            }
            if (!(mods & Clutter.ModifierType.MOD4_MASK)) {
                if (this.gesture.state === 'open') this.wheel.updatePointer(x, y);
                const result = this.gesture.release(this.wheel.selection);
                const window = this.wheel.selectedWindow;
                this.poll = 0;
                this._closeWheel();
                if (result.type === 'tap') Main.overview.toggle();
                else if (result.type === 'launch') this._launch(result.app, [x, y], window);
                return GLib.SOURCE_REMOVE;
            }
            if (this.gesture.state === 'pending' &&
                (GLib.get_monotonic_time() - started) / 1000 >= this.settings.get_int('hold-delay')) {
                this.gesture.open();
                this.wheel.open(x, y);
                this.escapeAction = global.display.grab_accelerator('Escape', Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
                if (this.escapeAction)
                    Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this.escapeAction),
                        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
            }
            if (this.gesture.state === 'open') this.wheel.updatePointer(x, y);
            return GLib.SOURCE_CONTINUE;
        });
    }
    _launch(id, point, window = null) {
        Main.overview.hide();
        if (window) { activateWindowAt(window, point, this.settings.get_boolean('dock-mode')); return; }
        const app = Shell.AppSystem.get_default().lookup_app(id);
        if (app && this.settings.get_boolean('dock-mode')) activateAtCursor(app, point);
        else app?.activate();
    }
    // Runs before GNOME's own (bubbling) touchpad gestures, so an open wheel can keep the swipe.
    _touchpad(event) {
        const type = event.type();
        if (type !== Clutter.EventType.TOUCHPAD_HOLD && type !== Clutter.EventType.TOUCHPAD_SWIPE)
            return Clutter.EVENT_PROPAGATE;
        const wasOpen = this.pad.state === 'open';
        if (event.get_touchpad_gesture_finger_count() !== 3 && !wasOpen) return Clutter.EVENT_PROPAGATE;
        const phase = ['begin', 'update', 'end', 'cancel'][event.get_gesture_phase()];
        let action;
        if (type === Clutter.EventType.TOUCHPAD_HOLD) {
            const allowed = this.settings.get_boolean('touchpad-wheel') && this.settings.get_boolean('wheel-enabled') &&
                this.gesture.state === 'idle' && !this.search.isOpen && Main.sessionMode.hasWindows &&
                !Main.sessionMode.isLocked && (Main.actionMode & (Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW));
            action = phase !== 'begin' || allowed ? this.pad.hold(phase) : 'none';
        } else {
            // shortcut: fixed 1.5x finger-to-wheel gain; make it a preference if it feels off on some touchpads.
            const [dx, dy] = event.get_gesture_motion_delta();
            action = this.pad.swipe(phase, dx * 1.5, dy * 1.5, Math.max(0, this.wheel.reach()));
        }
        if (action === 'start-timer') {
            this.padTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.settings.get_int('hold-delay'), () => {
                this.padTimer = 0;
                if (this.pad.timer() === 'open') {
                    const [x, y] = global.get_pointer();
                    this.wheel.open(x, y);
                }
                return GLib.SOURCE_REMOVE;
            });
        } else if (action === 'stop-timer') {
            this._stopPadTimer();
        } else if (action === 'aim' && this.wheel.geometry) {
            this.wheel.updatePointer(this.wheel.geometry.x + this.pad.offset[0], this.wheel.geometry.y + this.pad.offset[1]);
        } else if (action === 'launch') {
            const id = this.wheel.selection, window = this.wheel.selectedWindow;
            this.wheel.close();
            if (id) this._launch(id, global.get_pointer().slice(0, 2), window);
        } else if (action === 'close') {
            this.wheel.close();
        }
        return wasOpen || this.pad.state === 'open' ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }
    _stopPadTimer() {
        if (this.padTimer) GLib.Source.remove(this.padTimer);
        this.padTimer = 0;
    }
    _ungrab(action) {
        if (!action) return;
        global.display.ungrab_accelerator(action);
        Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.NONE);
    }
    _closeWheel() {
        this._ungrab(this.escapeAction);
        this.escapeAction = 0;
        this.wheel.close();
    }
    cancel() {
        if (this.poll) GLib.Source.remove(this.poll);
        this.poll = 0;
        this._stopPadTimer();
        this.pad.reset();
        this.gesture.cancel();
        this._closeWheel();
    }
    destroy() {
        this.cancel();
        if (this.setup) GLib.Source.remove(this.setup);
        this.setup = 0;
        for (const [object, id] of this.signals) object.disconnect(id);
        this.signals = [];
        for (const action of this.actions) this._ungrab(action);
        this.actions = [];
        if (this.searchBinding) Main.wm.removeKeybinding('launcher-shortcut');
        this.searchBinding = 0;
        for (const action of this.searchActions ?? []) this._ungrab(action);
        this.searchActions = [];
        this.owner.restore();
    }
}
