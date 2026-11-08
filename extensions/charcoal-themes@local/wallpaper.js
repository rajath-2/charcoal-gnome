import Gio from 'gi://Gio';

const KEYS = ['picture-uri', 'picture-uri-dark'];

// Journal (saved-wallpaper): the user's values from before the theme took over, plus the URI the
// theme applied and the activation it applied it for.
function readJournal(saved) {
    try {
        const value = JSON.parse(saved.get_string('saved-wallpaper'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch { return null; }
}

export function applyWallpaper(profile, desktop, saved, activation = '') {
    const uri = profile.wallpaper;
    if (!uri) return {ok: true, error: ''};
    if (typeof uri !== 'string' || !uri.startsWith('file://') || !Gio.File.new_for_uri(uri).query_exists(null))
        return {ok: false, error: `Wallpaper file is missing: ${uri}`};
    const current = Object.fromEntries(KEYS.map(key => [key, desktop.get_string(key)]));
    const journal = readJournal(saved);
    // A key still showing the theme's wallpaper keeps the journaled original; anything else is the user's choice.
    const before = Object.fromEntries(KEYS.map(key => [key,
        journal?.applied !== undefined && current[key] === journal.applied && typeof journal[key] === 'string'
            ? journal[key] : current[key]]));
    try {
        for (const key of KEYS) {
            if (!desktop.set_string(key, uri)) throw new Error(`Could not set ${key}`);
        }
        saved.set_string('saved-wallpaper', JSON.stringify({...before, applied: uri, activation}));
        return {ok: true, error: ''};
    } catch (error) {
        for (const [key, value] of Object.entries(current)) desktop.set_string(key, value);
        return {ok: false, error: error.message};
    }
}

// Re-applies only when the activation or the theme's wallpaper changed since the last apply,
// so a wallpaper the user picked afterwards survives enable/disable and edits to other themes.
// Returns null when nothing needed doing.
export function syncWallpaper(profile, desktop, saved, activation) {
    const journal = readJournal(saved);
    if (journal && journal.activation === activation && journal.applied === profile.wallpaper) return null;
    return applyWallpaper(profile, desktop, saved, activation);
}

export function restoreWallpaper(desktop, saved) {
    const journal = readJournal(saved);
    if (!journal) return;
    // Journals from before `applied` was recorded restore unconditionally, as they used to.
    const ours = KEYS.filter(key => journal.applied === undefined || desktop.get_string(key) === journal.applied);
    for (const key of ours) {
        if (typeof journal[key] !== 'string' || !desktop.set_string(key, journal[key])) return;
    }
    // Keep the journal when the user changed the wallpaper, so enable does not re-apply over it.
    if (ours.length === KEYS.length) saved.set_string('saved-wallpaper', '');
}
