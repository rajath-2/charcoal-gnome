import {validateProfile} from './profile.js';

export function activateTheme(id, settings, store, applyWallpaper, newActivationId) {
    const profile = store.get(id);
    if (!profile || !validateProfile(profile).ok) {
        settings.set_string('status', `Theme not found or invalid: ${id}`);
        return false;
    }
    let wallpaper;
    try { wallpaper = applyWallpaper(profile); }
    catch (error) { wallpaper = {ok: false, error: error.message}; }
    settings.set_string('active-theme-id', id);
    settings.set_string('activation-id', newActivationId());
    settings.set_string('status', wallpaper.ok ? '' : wallpaper.error);
    return true;
}
