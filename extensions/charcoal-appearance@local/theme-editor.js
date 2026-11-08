import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {THEME_KEYS} from './theme-catalog.js';

function valid(value, rule) {
    if (!rule) return false;
    if (rule.type === 'color') return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
    if (rule.type === 'boolean') return typeof value === 'boolean';
    if (rule.type === 'integer') return Number.isInteger(value) && value >= rule.min && value <= rule.max;
    if (rule.type === 'choice') return rule.values.includes(value);
    if (rule.type === 'text') return typeof value === 'string' && value.length <= 256 && !value.includes('\0');
    if (rule.type === 'json') {
        try { return typeof value === 'string' && value.length <= 16384 &&
            !!JSON.parse(value) && !Array.isArray(JSON.parse(value)); }
        catch { return false; }
    }
    return false;
}

export function saveOverridesToTheme(component, local, central, allowedKeys,
    dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'charcoal', 'themes'])) {
    const id = central?.get_string('active-theme-id');
    if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('No active theme');
    let overrides;
    try { overrides = JSON.parse(local.get_string('override-activations')); }
    catch { throw new Error('Saved overrides are damaged'); }
    const activation = central.get_string('activation-id');
    const keys = allowedKeys.filter(key => overrides[key] === activation && activation);
    if (!keys.length) return 0;
    const file = Gio.File.new_for_path(GLib.build_filenamev([dir, `${id}.json`]));
    const [, bytes, etag] = file.load_contents(null);
    const profile = JSON.parse(new TextDecoder().decode(bytes));
    if (profile.version !== 1 || profile.id !== id || !profile.components || typeof profile.components !== 'object')
        throw new Error('Active theme is invalid');
    const values = {...(profile.components[component] ?? {})};
    for (const key of keys) {
        const value = local.get_value(key).deepUnpack();
        if (!valid(value, THEME_KEYS[component]?.[key])) throw new Error(`Invalid value for ${key}`);
        values[key] = value;
    }
    profile.components[component] = values;
    file.replace_contents(new TextEncoder().encode(JSON.stringify(profile, null, 2)), etag, false,
        Gio.FileCreateFlags.PRIVATE, null);
    central.set_string('profile-revision', GLib.uuid_string_random());
    return keys.length;
}
