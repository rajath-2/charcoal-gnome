import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {THEME, SOURCE, installedVersion, updateIcons} from './update.js';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Installed icon themes; cursor themes are the ones with a cursors/ folder.
function themes(cursors) {
    const dirs = [GLib.build_filenamev([GLib.get_home_dir(), '.icons']),
        ...[GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()].map(d => GLib.build_filenamev([d, 'icons']))];
    const names = new Set();
    for (const dir of dirs) {
        let children;
        try {
            children = Gio.File.new_for_path(dir).enumerate_children('standard::name', 0, null);
        } catch {
            continue;
        }
        for (const info of children) {
            const name = info.get_name();
            const path = GLib.build_filenamev([dir, name, cursors ? 'cursors' : 'index.theme']);
            if (GLib.file_test(path, cursors ? GLib.FileTest.IS_DIR : GLib.FileTest.IS_REGULAR))
                names.add(name);
        }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}

export default class CharcoalAppearancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'Appearance', icon_name: 'applications-graphics-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Desktop appearance',
            description: 'Applied while this extension is enabled. Disable it to restore your previous settings.'});
        page.add(group);
        window.add(page);
        const ids = [];
        window.connect('close-request', () => { ids.forEach(id => settings.disconnect(id)); return false; });

        const choice = (key, title, options, labels = options) => {
            const row = new Adw.ComboRow({title, model: Gtk.StringList.new(labels)});
            const sync = () => {
                const index = options.indexOf(settings.get_string(key));
                if (index >= 0) row.selected = index;
            };
            sync();
            ids.push(settings.connect(`changed::${key}`, sync));
            row.connect('notify::selected', () => settings.set_string(key, options[row.selected]));
            group.add(row);
        };
        const withCurrent = (key, list) => list.includes(settings.get_string(key)) ? list : [settings.get_string(key), ...list];
        choice('icon-theme', 'Icons', withCurrent('icon-theme', themes(false)));
        choice('cursor-theme', 'Cursor', withCurrent('cursor-theme', themes(true)));
        const size = Adw.SpinRow.new_with_range(16, 96, 8);
        size.title = 'Cursor size';
        settings.bind('cursor-size', size, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(size);
        choice('color-scheme', 'Style', ['prefer-dark', 'default', 'prefer-light'], ['Dark', 'Default', 'Light']);
        const buttons = new Adw.EntryRow({title: 'Window buttons (GNOME button-layout)', show_apply_button: true,
            text: settings.get_string('button-layout')});
        buttons.connect('apply', () => settings.set_string('button-layout', buttons.text));
        group.add(buttons);

        const updates = new Adw.PreferencesGroup({title: 'Icon updates', description: `${THEME} from ${SOURCE}`});
        page.add(updates);
        const auto = new Adw.SwitchRow({title: 'Update automatically', subtitle: 'Checks once a day in the background'});
        settings.bind('icon-updates', auto, 'active', Gio.SettingsBindFlags.DEFAULT);
        updates.add(auto);
        const status = new Adw.ActionRow({title: 'Installed version', subtitle: installedVersion() ?? 'Not installed in your icons folder'});
        const check = new Gtk.Button({label: 'Check now', valign: Gtk.Align.CENTER});
        check.connect('clicked', async () => {
            check.sensitive = false;
            status.subtitle = 'Checking…';
            try {
                const version = await updateIcons();
                settings.set_int64('icon-last-check', Math.floor(Date.now() / 1000));
                status.subtitle = version ? `Updated to ${version}` : `${installedVersion() ?? 'Not installed'} (up to date)`;
            } catch (error) {
                status.subtitle = `Update failed: ${error.message}`;
            } finally {
                check.sensitive = true;
            }
        });
        status.add_suffix(check);
        updates.add(status);
    }
}
