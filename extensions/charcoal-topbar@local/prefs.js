import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MODES = [['auto', 'Automatic'], ['compact', 'Compact bar'], ['islands', 'Islands']];

export default class CharcoalTopbarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 760);
        const ids = [];
        const watch = (key, callback) => ids.push(settings.connect(`changed::${key}`, callback));
        window.connect('close-request', () => { ids.forEach(id => settings.disconnect(id)); return false; });
        const page = (title, icon) => {
            const p = new Adw.PreferencesPage({title, icon_name: icon}); window.add(p); return p;
        };
        const group = (p, title, description = '') => {
            const g = new Adw.PreferencesGroup({title, description}); p.add(g); return g;
        };
        const toggle = (g, key, title, subtitle = '') => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT); g.add(row);
        };
        const spin = (g, key, title, min, max, step, subtitle = '') => {
            const row = Adw.SpinRow.new_with_range(min, max, step);
            row.title = title; row.subtitle = subtitle;
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT); g.add(row);
        };
        const color = (g, key, title) => {
            const row = new Adw.ActionRow({title});
            const picker = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false}), valign: Gtk.Align.CENTER});
            const update = () => { const rgba = new Gdk.RGBA(); rgba.parse(settings.get_string(key)); picker.rgba = rgba; };
            update(); watch(key, update);
            picker.connect('notify::rgba', () => {
                const c = picker.rgba;
                const hex = `#${[c.red, c.green, c.blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
                if (settings.get_string(key) !== hex) settings.set_string(key, hex);
            });
            row.add_suffix(picker); g.add(row);
        };

        const general = page('Top bar', 'preferences-desktop-display-symbolic');
        const layout = group(general, 'Layout');
        const mode = new Adw.ComboRow({title: 'Layout',
            subtitle: 'Automatic: full bar on the desktop, islands while an app is maximized',
            model: Gtk.StringList.new(MODES.map(([, label]) => label))});
        const sync = () => { mode.selected = Math.max(0, MODES.findIndex(([id]) => id === settings.get_string('mode'))); };
        sync(); watch('mode', sync);
        mode.connect('notify::selected', () => settings.set_string('mode', MODES[mode.selected][0]));
        layout.add(mode);
        toggle(layout, 'static-blur', 'Static blur',
            'Blur only the wallpaper behind the bar and menus. Off: live blur of windows (more GPU)');
        const size = group(general, 'Size and spacing');
        spin(size, 'bar-height', 'Height', 22, 48, 1, 'Pixels');
        spin(size, 'corner-radius', 'Corner radius', 0, 20, 1);
        spin(size, 'top-margin', 'Gap above and below', 0, 16, 1);
        spin(size, 'side-margin', 'Side gap: compact bar', 0, 400, 2);
        spin(size, 'island-margin', 'Side gap: islands and automatic', 0, 120, 2);

        const look = page('Appearance', 'applications-graphics-symbolic');
        const bar = group(look, 'Bar');
        color(bar, 'bar-color', 'Background');
        spin(bar, 'bar-opacity', 'Opacity', 0, 100, 1, 'Percent. Compact bar, and both states of Automatic');
        spin(bar, 'islands-opacity', 'Opacity: Islands layout', 0, 100, 1, 'Percent. Only the fixed Islands layout');
        spin(bar, 'border-opacity', 'Outline strength', 0, 60, 1, 'Percent, 0 hides the outline');
        color(bar, 'text-color', 'Text and icons');
        color(bar, 'accent-color', 'Highlight');
        toggle(bar, 'bold-text', 'Bold text');
        toggle(bar, 'shadow', 'Drop shadows', 'Under the bar, menus and notifications');
        const popups = group(look, 'Menus and popups', 'Quick settings, calendar, notifications and panel menus');
        color(popups, 'popup-color', 'Background');
        spin(popups, 'popup-opacity', 'Opacity', 30, 100, 1, 'Percent');
        spin(popups, 'popup-radius', 'Corner radius', 0, 32, 1);

        const defaults = group(look, 'Defaults');
        const reset = new Adw.ActionRow({title: 'Reset appearance', subtitle: 'Restore the original charcoal look. Layout and blur stay as they are.'});
        const button = new Gtk.Button({label: 'Reset…', css_classes: ['destructive-action'], valign: Gtk.Align.CENTER});
        button.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({heading: 'Reset top bar appearance?', body: 'Your custom colors, sizes and spacing will be replaced.'});
            dialog.add_response('cancel', 'Cancel'); dialog.add_response('reset', 'Reset');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.default_response = 'cancel'; dialog.close_response = 'cancel';
            dialog.choose(window, null, (source, result) => {
                if (source.choose_finish(result) !== 'reset') return;
                for (const key of settings.settings_schema.list_keys())
                    if (!['mode', 'static-blur'].includes(key)) settings.reset(key);
            });
        });
        reset.add_suffix(button); defaults.add(reset);
    }
}
