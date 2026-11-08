import Clutter from 'gi://Clutter';
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
import {ThemeClient} from './theme-client.js';
import {listThemes} from './theme-library.js';

export default class CharcoalControls extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._theme = new ThemeClient('controls', this._settings);
        this._wheel = new ControlWheel(this._theme, id => this._select(id));
        this._themeChanged = this._theme.connectChanged(() => this._refreshThemes());
        this._accelerators = [];
        this._activated = global.display.connect('accelerator-activated', (_, action) => {
            if (!this._accelerators.includes(action) || Main.sessionMode.currentMode !== 'user') return;
            const [x, y] = global.get_pointer();
            this._refreshThemes();
            this._wheel.open(x, y);
        });
        this._shortcut = this._settings.connect('changed::shortcut', () => this._claimShortcut());
        this._session = Main.sessionMode.connect('updated', () => {
            this._wheel.close(); this._dialog?.close(); this._dialog = null;
        });
        this._claimShortcut();
    }

    _refreshThemes() {
        const themes = this._theme.central ? listThemes() : [];
        this._wheel.setThemes(themes, this._theme.central?.get_string('active-theme-id'));
        if (this._wheel.actor && this._wheel.layer === 'themes' && themes.length === 0) {
            const {x, y} = this._wheel.geometry;
            this._wheel.open(x, y, 'actions');
        }
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
        if (id === 'themes') {
            const themes = this._theme.central ? listThemes() : [];
            if (!themes.length) {
                this._settings.set_string('status', 'No themes available');
                this._wheel.close(); return;
            }
            this._wheel.setThemes(themes, this._theme.central?.get_string('active-theme-id'));
            const {x, y} = this._wheel.geometry;
            this._wheel.open(x, y, 'themes');
            return;
        }
        if (this._wheel.layer === 'themes') {
            if (id === 'back') {
                const {x, y} = this._wheel.geometry;
                this._wheel.open(x, y, 'actions');
            } else {
                if (this._theme.central && listThemes().some(profile => profile.id === id))
                    this._theme.central.set_string('requested-theme-id', id);
                this._wheel.close();
            }
            return;
        }
        this._wheel.close();
        if (requiresConfirmation(id)) {
            this._showDialog(`Confirm ${id === 'poweroff' ? 'power off' : id}?`, null,
                [{label: 'Cancel', key: Clutter.KEY_Escape, action: () => {}},
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
        dialog.setButtons(buttons.map(button => ({label: button.label, key: button.key,
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
            {label: 'Cancel', key: Clutter.KEY_Escape, action: () => {}},
            {label: 'Save', action: () => {
                try { saveNote(entry.get_text()); this._settings.set_string('status', 'Note saved'); }
                catch (error) { this._settings.set_string('status', error.message); }
            }},
        ]);
    }

    // Async: the shell itself answers polkit and end-session prompts, so a sync call would freeze it.
    _call(bus, name, path, iface, method, parameters = null) {
        bus.call(name, path, iface, method, parameters, null, Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
            try { connection.call_finish(result); } catch (error) {
                this._settings?.set_string('status', error.message);
                Main.notify('Control wheel', `${method} failed: ${error.message}`);
            }
        });
    }

    async _run(id, confirmed) {
        if (Main.sessionMode.currentMode !== 'user') return;
        const session = (method, parameters) => this._call(Gio.DBus.session, 'org.gnome.SessionManager',
            '/org/gnome/SessionManager', 'org.gnome.SessionManager', method, parameters);
        try {
            await dispatchAction(id, {
                lock: () => Main.screenShield.lock(true),
                suspend: () => this._call(Gio.DBus.system, 'org.freedesktop.login1', '/org/freedesktop/login1',
                    'org.freedesktop.login1.Manager', 'Suspend', new GLib.Variant('(b)', [true])),
                logout: () => session('Logout', new GLib.Variant('(u)', [0])),
                restart: () => session('Reboot'),
                poweroff: () => session('Shutdown'),
                note: () => this._note(),
                settings: () => this.openPreferences(),
            }, confirmed);
        } catch (error) { this._settings?.set_string('status', error.message); }
    }

    disable() {
        this._wheel?.destroy(); this._wheel = null;
        this._themeChanged?.(); this._themeChanged = null;
        this._theme?.destroy(); this._theme = null;
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
