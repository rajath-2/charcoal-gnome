import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ControlWheel} from './wheel.js';
import {dispatchAction, requiresConfirmation} from './actions.js';
import {saveNote} from './notes.js';

function sessionCall(method, parameters = null) {
    Gio.DBus.session.call_sync('org.gnome.SessionManager', '/org/gnome/SessionManager',
        'org.gnome.SessionManager', method, parameters, null, Gio.DBusCallFlags.NONE, -1, null);
}

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
        this._session = Main.sessionMode.connect('updated', () => {
            this._wheel.close(); this._dialog?.close(); this._dialog = null;
        });
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

    _select(id) {
        this._wheel.close();
        if (requiresConfirmation(id)) {
            this._showDialog(`Confirm ${id === 'poweroff' ? 'power off' : id}?`, null,
                [{label: 'Cancel', action: () => {}},
                    {label: 'Confirm', action: () => this._run(id, true)}]);
            return;
        }
        this._run(id, false);
    }

    _showDialog(title, entry, buttons) {
        this._dialog?.destroy();
        const dialog = new ModalDialog.ModalDialog({styleClass: 'prompt-dialog'});
        this._dialog = dialog;
        dialog.contentLayout.add_child(new St.Label({text: title}));
        if (entry) dialog.contentLayout.add_child(entry);
        dialog.setButtons(buttons.map(button => ({label: button.label,
            action: () => { dialog.close(); if (this._dialog === dialog) this._dialog = null; button.action(); }})));
        dialog.open();
        if (entry) global.stage.set_key_focus(entry.clutter_text);
    }

    _note() {
        const entry = new St.Entry({hint_text: 'Write a quick note', can_focus: true,
            style: 'width: 440px; height: 180px; padding: 12px;'});
        entry.clutter_text.set_single_line_mode(false);
        entry.clutter_text.set_line_wrap(true);
        this._showDialog('Quick note', entry, [
            {label: 'Cancel', action: () => {}},
            {label: 'Save', action: () => {
                try { saveNote(entry.get_text()); this._settings.set_string('status', 'Note saved'); }
                catch (error) { this._settings.set_string('status', error.message); }
            }},
        ]);
    }

    async _run(id, confirmed) {
        if (Main.sessionMode.currentMode !== 'user') return;
        try {
            await dispatchAction(id, {
                lock: () => Main.screenShield.lock(true),
                suspend: () => Gio.DBus.system.call_sync('org.freedesktop.login1', '/org/freedesktop/login1',
                    'org.freedesktop.login1.Manager', 'Suspend', new GLib.Variant('(b)', [true]),
                    null, Gio.DBusCallFlags.NONE, -1, null),
                logout: () => sessionCall('Logout', new GLib.Variant('(u)', [0])),
                restart: () => sessionCall('Reboot'),
                poweroff: () => sessionCall('Shutdown'),
                note: () => this._note(),
                settings: () => this.openPreferences(),
            }, confirmed);
        } catch (error) { this._settings?.set_string('status', error.message); }
    }

    disable() {
        this._wheel?.destroy(); this._wheel = null;
        this._dialog?.destroy(); this._dialog = null;
        for (const action of this._accelerators ?? []) global.display.ungrab_accelerator(action);
        this._accelerators = [];
        if (this._activated) global.display.disconnect(this._activated);
        if (this._shortcut) this._settings.disconnect(this._shortcut);
        if (this._session) Main.sessionMode.disconnect(this._session);
        this._activated = this._shortcut = this._session = 0;
        this._settings = null;
    }
}
