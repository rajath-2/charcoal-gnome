import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {validateProfile} from './theme-profile.js';

export function saveOverridesToTheme(component, local, central, allowedKeys,
    dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'charcoal', 'themes'])) {
    const id = central?.get_string('active-theme-id');
    if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('No active theme');
    let overrides;
    try { overrides = JSON.parse(local.get_string('override-activations')); }
    catch { throw new Error('Saved overrides are damaged'); }
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
        throw new Error('Saved overrides are damaged');
    const activation = central.get_string('activation-id');
    const keys = allowedKeys.filter(key => overrides[key] === activation && activation);
    if (!keys.length) return 0;
    const file = Gio.File.new_for_path(GLib.build_filenamev([dir, `${id}.json`]));
    const [, bytes, etag] = file.load_contents(null);
    const profile = JSON.parse(new TextDecoder().decode(bytes));
    if (profile?.id !== id || !validateProfile(profile).ok)
        throw new Error('Active theme is invalid');
    const values = {...(profile.components[component] ?? {})};
    for (const key of keys) {
        const value = local.get_value(key).deepUnpack();
        values[key] = value;
    }
    profile.components[component] = values;
    const checked = validateProfile(profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    file.replace_contents(new TextEncoder().encode(JSON.stringify(checked.profile, null, 2)), etag, false,
        Gio.FileCreateFlags.PRIVATE, null);
    central.set_string('profile-revision', GLib.uuid_string_random());
    return keys.length;
}
