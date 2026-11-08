import {validateProfile} from './profile.js';

export function activateTheme(id, settings, store, applyWallpaper, newActivationId) {
    const profile = store.get(id);
    if (!profile || !validateProfile(profile).ok) {
        settings.set_string('status', `Theme not found or invalid: ${id}`);
        return false;
    }
    const activationId = newActivationId();
    let wallpaper;
    try { wallpaper = applyWallpaper(profile, activationId); }
    catch (error) { wallpaper = {ok: false, error: error.message}; }
    // One change set, so consumers never see the new theme with the old activation (stale overrides).
    settings.delay?.();
    settings.set_string('active-theme-id', id);
    settings.set_string('activation-id', activationId);
    settings.set_string('status', wallpaper.ok ? '' : wallpaper.error);
    settings.apply?.();
    return true;
}
