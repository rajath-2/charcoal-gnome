import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {attachThemeControls} from './theme-controls.js';

export default class CharcoalControlsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'Control wheel', icon_name: 'preferences-system-symbolic'});
        window.add(page);
        const group = new Adw.PreferencesGroup({title: 'Control wheel',
            description: 'Open with Super+Q by default. Click a segment to select it.'});
        page.add(group);
        const shortcut = new Adw.EntryRow({title: 'Shortcut', text: settings.get_strv('shortcut')[0] ?? '',
            show_apply_button: true});
        shortcut.connect('apply', () => settings.set_strv('shortcut', shortcut.text ? [shortcut.text] : []));
        group.add(shortcut);
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
            const row = new Adw.EntryRow({title: label, text: settings.get_string(key), show_apply_button: true});
            row.connect('apply', () => {
                const valid = /^#[0-9a-fA-F]{6}$/.test(row.text);
                if (valid) settings.set_string(key, row.text);
                if (valid) row.remove_css_class('error'); else row.add_css_class('error');
            });
            group.add(row);
        };
        for (const [key, label] of [['background-color', 'Background'], ['foreground-color', 'Text'],
            ['accent-color', 'Accent'], ['border-color', 'Border'], ['shadow-color', 'Shadow']]) color(key, label);
        const status = new Adw.ActionRow({title: 'Shortcut status', subtitle: settings.get_string('status')});
        group.add(status);
        settings.connect('changed::status', () => { status.subtitle = settings.get_string('status'); });
        attachThemeControls(window, page, settings, 'controls');
    }
}
