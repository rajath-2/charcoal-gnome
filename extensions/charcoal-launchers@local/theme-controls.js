import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {THEME_KEYS} from './theme-catalog.js';
import {ThemeClient} from './theme-client.js';
import {valueSources} from './theme-policy.js';
import {saveOverridesToTheme} from './theme-editor.js';

export function attachThemeControls(window, page, settings, component) {
    const keys = Object.keys(THEME_KEYS[component] ?? {});
    const client = new ThemeClient(component, settings);
    const group = new Adw.PreferencesGroup({title: 'Theme link',
        description: 'Local edits stay saved as overrides. Switching themes makes them dormant until restored.'});
    page.add(group);
    const link = new Adw.SwitchRow({title: 'Follow active theme'});
    settings.bind('follow-theme', link, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(link);
    const status = new Adw.ActionRow({title: 'Current source'});
    group.add(status);
    const sources = new Adw.ActionRow({title: 'Value sources', subtitle_lines: 0});
    group.add(sources);
    const action = (title, label, handler) => {
        const row = new Adw.ActionRow({title});
        const button = new Gtk.Button({label, valign: Gtk.Align.CENTER});
        button.connect('clicked', handler);
        row.add_suffix(button); group.add(row);
        return button;
    };
    const overrides = () => client._overrides();
    const use = action('Use theme values', 'Use theme', () => {
        const values = overrides();
        for (const key of keys) if (Object.hasOwn(values, key)) values[key] = '';
        settings.set_string('override-activations', JSON.stringify(values));
        refresh();
    });
    const restore = action('Restore saved local overrides', 'Restore', () => {
        const active = client.central?.get_string('activation-id');
        if (!active) return;
        const values = overrides();
        for (const key of keys) if (Object.hasOwn(values, key)) values[key] = active;
        settings.set_string('override-activations', JSON.stringify(values));
        refresh();
    });
    const save = action('Save active overrides to this theme', 'Save to theme', () => {
        try {
            const count = saveOverridesToTheme(component, settings, client.central, keys);
            status.subtitle = count ? `Saved ${count} setting${count === 1 ? '' : 's'} to the active theme` : 'No active overrides to save';
        } catch (error) { status.subtitle = error.message; }
    });
    const refresh = () => {
        const profile = client._activeProfile();
        const linked = settings.get_boolean('follow-theme');
        status.subtitle = profile ? `Following ${profile.name}` : linked ? 'Theme engine or active theme unavailable' : 'Using saved local settings';
        use.sensitive = restore.sensitive = save.sensitive = !!profile;
        // Controls below show local values; this row says which of them the theme currently replaces.
        const {local, theme} = valueSources(keys, profile?.components?.[component], overrides(),
            client.central?.get_string('activation-id'));
        sources.subtitle = profile ? `Overridden locally: ${local.join(', ') || 'none'}\n` +
            `Following theme: ${theme.join(', ') || 'none'}` : 'All settings use their local values';
    };
    const ids = keys.map(key => settings.connect(`changed::${key}`, () => {
        if (settings.get_boolean('follow-theme')) client.selectOverride(key);
        refresh();
    }));
    ids.push(settings.connect('changed::follow-theme', refresh));
    ids.push(settings.connect('changed::override-activations', refresh));
    const unwatch = client.connectChanged(refresh);
    window.connect('close-request', () => {
        ids.forEach(id => settings.disconnect(id));
        unwatch(); client.destroy();
        return false;
    });
    refresh();
}
