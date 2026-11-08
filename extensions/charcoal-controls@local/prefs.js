import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {attachThemeControls} from './theme-controls.js';
import {WHEEL_ITEMS} from './policy.js';

export default class CharcoalControlsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'Control wheel', icon_name: 'preferences-system-symbolic'});
        window.add(page);
        const group = new Adw.PreferencesGroup({title: 'Control wheel',
            description: 'Set a shortcut to open the wheel. Click a segment to select it.'});
        page.add(group);
        const shortcut = new Adw.ActionRow({title: 'Shortcut'});
        const shortcutButton = new Gtk.Button({valign: Gtk.Align.CENTER});
        const clear = new Gtk.Button({icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Remove shortcut'});
        const updateShortcut = () => {
            const accel = settings.get_strv('shortcut')[0];
            shortcutButton.label = accel ? this._label(accel) : 'Set shortcut';
            clear.sensitive = !!accel;
        };
        updateShortcut(); settings.connect('changed::shortcut', updateShortcut);
        shortcutButton.connect('clicked', () => this._record(window, 'Set control wheel shortcut', accel => settings.set_strv('shortcut', [accel])));
        clear.connect('clicked', () => settings.set_strv('shortcut', []));
        shortcut.add_suffix(shortcutButton); shortcut.add_suffix(clear);
        group.add(shortcut);
        const items = new Adw.PreferencesGroup({title: 'Wheel items', description: 'Choose what appears on the wheel'});
        page.add(items);
        for (const [id, label] of WHEEL_ITEMS) {
            const row = new Adw.SwitchRow({title: label});
            const sync = () => { row.active = settings.get_strv('wheel-items').includes(id); };
            sync(); settings.connect('changed::wheel-items', sync);
            row.connect('notify::active', () => {
                const shown = settings.get_strv('wheel-items');
                if (row.active === shown.includes(id)) return;
                // Kept in WHEEL_ITEMS order so the wheel layout doesn't depend on toggle order.
                settings.set_strv('wheel-items', WHEEL_ITEMS.map(([item]) => item)
                    .filter(item => item === id ? row.active : shown.includes(item)));
            });
            items.add(row);
        }
        const spin = (key, label, min, max) => {
            const row = Adw.SpinRow.new_with_range(min, max, 1);
            row.title = label;
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };
        spin('radius', 'Wheel radius', 100, 320);
        spin('neutral-radius', 'Neutral center', 20, 80);
        spin('text-size', 'Text size', 10, 32);
        spin('border-width', 'Border width', 0, 6);
        spin('shadow-size', 'Shadow size', 0, 60);
        const color = (key, label) => {
            const row = new Adw.ActionRow({title: label});
            const picker = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false}), valign: Gtk.Align.CENTER});
            const update = () => { const rgba = new Gdk.RGBA(); rgba.parse(settings.get_string(key)); picker.rgba = rgba; };
            update(); settings.connect(`changed::${key}`, update);
            picker.connect('notify::rgba', () => {
                const c = picker.rgba;
                const hex = '#' + [c.red, c.green, c.blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
                if (settings.get_string(key) !== hex) settings.set_string(key, hex);
            });
            row.add_suffix(picker); group.add(row);
        };
        for (const [key, label] of [['background-color', 'Background'], ['foreground-color', 'Text'],
            ['accent-color', 'Accent'], ['border-color', 'Border'], ['shadow-color', 'Shadow']]) color(key, label);
        const status = new Adw.ActionRow({title: 'Shortcut status'});
        const updateStatus = () => {
            status.subtitle = settings.get_string('status') || (settings.get_strv('shortcut').length ? 'No conflicts reported' : 'No shortcut set');
        };
        updateStatus(); settings.connect('changed::status', updateStatus); settings.connect('changed::shortcut', updateStatus);
        group.add(status);
        attachThemeControls(window, page, settings, 'controls');
    }
    // shortcut: copied from charcoal-launchers prefs (extensions can't import each other); move to shared/ if a third copy appears.
    _label(accel) {
        const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
        return ok && keyval ? Gtk.accelerator_get_label(keyval, mods) : accel;
    }
    _record(parent, title, done) {
        const dialog = new Adw.Window({title, transient_for: parent, modal: true,
            default_width: 420, default_height: 180, resizable: false});
        const view = new Adw.ToolbarView(); view.add_top_bar(new Adw.HeaderBar());
        const label = new Gtk.Label({label: 'Press a key or key combination\nEscape cancels', margin_top: 32, margin_bottom: 32,
            justify: Gtk.Justification.CENTER});
        view.content = label; dialog.content = view;
        // Without this GNOME runs its own Super shortcuts instead of letting us record them.
        dialog.connect('map', () => dialog.get_surface()?.inhibit_system_shortcuts(null));
        dialog.connect('close-request', () => { dialog.get_surface()?.restore_system_shortcuts(); return false; });
        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_, keyval, keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_Escape && !mods) { dialog.close(); return true; }
            if (!Gtk.accelerator_valid(keyval, mods)) return true; // A modifier on its own: wait for the key.
            if (!mods && Gdk.keyval_to_unicode(keyval)) {
                label.label = 'Add Super, Ctrl or Alt to that key\nEscape cancels';
                return true;
            }
            done(Gtk.accelerator_name(keyval, mods));
            dialog.close(); return true;
        });
        dialog.add_controller(controller); dialog.present();
    }
}
