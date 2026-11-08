import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {validateProfile} from './theme-profile.js';

export function listThemes() {
    const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'charcoal', 'themes']);
    let entries;
    try { entries = Gio.File.new_for_path(path).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null); }
    catch { return []; }
    const result = [];
    for (const entry of entries) {
        const name = entry.get_name();
        if (!/^[a-z0-9][a-z0-9-]{0,63}\.json$/.test(name)) continue;
        try {
            const file = Gio.File.new_for_path(GLib.build_filenamev([path, name]));
            const [, bytes] = file.load_contents(null);
            const profile = JSON.parse(new TextDecoder().decode(bytes));
            if (profile.id === name.slice(0, -5) && validateProfile(profile).ok) result.push(profile);
        } catch { /* Ignore a damaged profile. */ }
    }
    entries.close(null);
    return result.sort((a, b) => a.name.localeCompare(b.name));
}
