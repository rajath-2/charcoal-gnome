import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {THEME_KEYS} from './catalog.js';
import {validateProfile} from './profile.js';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class ThemeStore {
    constructor(dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'charcoal', 'themes'])) {
        this.dir = dir;
    }

    _file(id) {
        return ID.test(id) ? Gio.File.new_for_path(GLib.build_filenamev([this.dir, `${id}.json`])) : null;
    }

    get(id) {
        const file = this._file(id);
        if (!file) return null;
        try {
            const [, bytes] = file.load_contents(null);
            const value = JSON.parse(new TextDecoder().decode(bytes));
            const checked = validateProfile(value);
            return checked.ok && value.id === id ? checked.profile : null;
        } catch {
            return null;
        }
    }

    list() {
        const folder = Gio.File.new_for_path(this.dir);
        let entries;
        try { entries = folder.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null); }
        catch { return []; }
        const profiles = [];
        for (const info of entries) {
            const name = info.get_name();
            if (!name.endsWith('.json')) continue;
            const profile = this.get(name.slice(0, -5));
            if (profile) profiles.push(profile);
        }
        entries.close(null);
        return profiles.sort((a, b) => a.name.localeCompare(b.name));
    }

    save(profile) {
        const checked = validateProfile(profile);
        if (!checked.ok) throw new Error(checked.errors.join('; '));
        GLib.mkdir_with_parents(this.dir, 0o700);
        const file = this._file(profile.id);
        file.replace_contents(new TextEncoder().encode(JSON.stringify(checked.profile, null, 2)), null, false,
            Gio.FileCreateFlags.PRIVATE, null);
    }

    delete(id) {
        const file = this._file(id);
        if (!file) throw new Error('Invalid theme ID');
        try { file.delete(null); }
        catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) throw error;
        }
    }
}

export function captureSettings(id, name, settingsByComponent, useDefaults = false) {
    const components = {};
    for (const [component, settings] of Object.entries(settingsByComponent)) {
        const values = {};
        for (const key of Object.keys(THEME_KEYS[component] ?? {})) {
            if (settings.settings_schema.has_key(key)) values[key] = (useDefaults
                ? settings.settings_schema.get_key(key).get_default_value() : settings.get_value(key)).deepUnpack();
        }
        components[component] = values;
    }
    const profile = {version: 1, id, name, wallpaper: null, components};
    const checked = validateProfile(profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return profile;
}

export function installedComponentSettings() {
    const components = {};
    for (const component of ['topbar', 'appearance', 'launchers', 'widgets']) {
        // User install first, then system-wide installs.
        const dir = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]
            .map(d => GLib.build_filenamev([d, 'gnome-shell', 'extensions', `charcoal-${component}@local`, 'schemas']))
            .find(d => GLib.file_test(d, GLib.FileTest.IS_DIR));
        try {
            const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
            const schema = source.lookup(`org.gnome.shell.extensions.charcoal-${component}`, true);
            if (schema) components[component] = new Gio.Settings({settings_schema: schema});
        } catch { /* The component is optional. */ }
    }
    return components;
}

export function ensureDefaultTheme(store, components) {
    const existing = store.get('charcoal-default');
    const captured = captureSettings('charcoal-default', 'Charcoal Default', components, true);
    if (!existing) {
        store.save(captured);
        return;
    }
    const missing = Object.fromEntries(Object.entries(captured.components)
        .filter(([component]) => !Object.hasOwn(existing.components, component)));
    if (Object.keys(missing).length)
        store.save({...existing, components: {...existing.components, ...missing}});
}
