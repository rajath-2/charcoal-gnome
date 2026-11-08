import Gio from 'gi://Gio';

const KEYS = ['picture-uri', 'picture-uri-dark'];

export function applyWallpaper(profile, desktop, saved) {
    const uri = profile.wallpaper;
    if (!uri) return {ok: true, error: ''};
    if (typeof uri !== 'string' || !uri.startsWith('file://') || !Gio.File.new_for_uri(uri).query_exists(null))
        return {ok: false, error: `Wallpaper file is missing: ${uri}`};
    const before = Object.fromEntries(KEYS.map(key => [key, desktop.get_string(key)]));
    try {
        for (const key of KEYS) {
            if (!desktop.set_string(key, uri)) throw new Error(`Could not set ${key}`);
        }
        if (!saved.get_string('saved-wallpaper')) saved.set_string('saved-wallpaper', JSON.stringify(before));
        return {ok: true, error: ''};
    } catch (error) {
        for (const [key, value] of Object.entries(before)) desktop.set_string(key, value);
        return {ok: false, error: error.message};
    }
}

export function restoreWallpaper(desktop, saved) {
    const journal = saved.get_string('saved-wallpaper');
    if (!journal) return;
    let values;
    try { values = JSON.parse(journal); }
    catch { return; }
    for (const key of KEYS) {
        if (typeof values[key] !== 'string' || !desktop.set_string(key, values[key])) return;
    }
    saved.set_string('saved-wallpaper', '');
}
