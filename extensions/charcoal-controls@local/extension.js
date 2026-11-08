import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ControlWheel} from './wheel.js';

export default class CharcoalControls extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._wheel = new ControlWheel(this._settings, id => this._select(id));
        this._accelerators = [];
        this._activated = global.display.connect('accelerator-activated', (_, action) => {
            if (!this._accelerators.includes(action) || Main.sessionMode.currentMode !== 'user') return;
            const [x, y] = global.get_pointer();
            this._wheel.open(x, y);
        });
        this._shortcut = this._settings.connect('changed::shortcut', () => this._claimShortcut());
        this._session = Main.sessionMode.connect('updated', () => this._wheel.close());
        this._claimShortcut();
    }

    _claimShortcut() {
        for (const action of this._accelerators) global.display.ungrab_accelerator(action);
        this._accelerators = [];
        this._settings.set_string('status', '');
        for (const shortcut of this._settings.get_strv('shortcut')) {
            const action = global.display.grab_accelerator(shortcut, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
            if (!action) {
                this._settings.set_string('status', `${shortcut} is already in use. Choose another shortcut.`);
                continue;
            }
            this._accelerators.push(action);
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.NORMAL);
        }
    }

    _select(_id) { this._wheel.close(); }

    disable() {
        this._wheel?.destroy(); this._wheel = null;
        for (const action of this._accelerators ?? []) global.display.ungrab_accelerator(action);
        this._accelerators = [];
        if (this._activated) global.display.disconnect(this._activated);
        if (this._shortcut) this._settings.disconnect(this._shortcut);
        if (this._session) Main.sessionMode.disconnect(this._session);
        this._activated = this._shortcut = this._session = 0;
        this._settings = null;
    }
}
