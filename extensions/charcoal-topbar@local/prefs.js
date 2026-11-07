import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MODES = [['auto', 'Automatic'], ['compact', 'Compact bar'], ['islands', 'Islands']];

export default class CharcoalTopbarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'Top bar', icon_name: 'preferences-desktop-display-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Top bar'});
        page.add(group);
        window.add(page);

        const mode = new Adw.ComboRow({title: 'Layout',
            subtitle: 'Automatic: full bar on the desktop, islands while an app is maximized',
            model: Gtk.StringList.new(MODES.map(([, label]) => label))});
        const sync = () => { mode.selected = Math.max(0, MODES.findIndex(([id]) => id === settings.get_string('mode'))); };
        sync();
        const id = settings.connect('changed::mode', sync);
        mode.connect('notify::selected', () => settings.set_string('mode', MODES[mode.selected][0]));
        window.connect('close-request', () => { settings.disconnect(id); return false; });
        group.add(mode);

        const blur = new Adw.SwitchRow({title: 'Static blur',
            subtitle: 'Blur only the wallpaper behind the bar and menus. Off: live blur of windows (more GPU)'});
        settings.bind('static-blur', blur, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(blur);
    }
}
