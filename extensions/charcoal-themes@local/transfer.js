import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {validateProfile} from './profile.js';

const MAX_IMAGE = 32 * 1024 * 1024;
const MAX_BUNDLE = 48 * 1024 * 1024;

function read(file, limit) {
    const stream = file.read(null);
    try {
        const chunks = [];
        let size = 0;
        while (true) {
            const bytes = stream.read_bytes(Math.min(65536, limit + 1 - size), null).get_data();
            if (!bytes?.length) break;
            size += bytes.length;
            if (size > limit) throw new Error('Theme file or wallpaper is too large');
            chunks.push(bytes);
        }
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        return result;
    } finally { stream.close(null); }
}

function checked(profile) {
    const result = validateProfile(profile);
    if (!result.ok) throw new Error(result.errors.join('; '));
    return result.profile;
}

export function exportTheme(profile, file) {
    profile = checked(profile);
    const wallpaper = profile.wallpaper
        ? GLib.base64_encode(read(Gio.File.new_for_uri(profile.wallpaper), MAX_IMAGE)) : null;
    const bundle = {format: 'charcoal-theme', version: 1,
        profile: {...profile, wallpaper: null}, wallpaper};
    const bytes = new TextEncoder().encode(JSON.stringify(bundle, null, 2));
    if (bytes.length > MAX_BUNDLE) throw new Error('Theme export is too large');
    file.replace_contents(bytes, null, false, Gio.FileCreateFlags.PRIVATE, null);
}

export function importTheme(file, store) {
    const bundle = JSON.parse(new TextDecoder().decode(read(file, MAX_BUNDLE)));
    if (bundle?.format !== 'charcoal-theme' || bundle.version !== 1)
        throw new Error('Not a supported Charcoal theme export');
    const profile = checked(bundle.profile);
    let bytes = null;
    if (bundle.wallpaper !== null) {
        if (typeof bundle.wallpaper !== 'string' || !bundle.wallpaper.length ||
            bundle.wallpaper.length > Math.ceil(MAX_IMAGE / 3) * 4 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bundle.wallpaper))
            throw new Error('Invalid embedded wallpaper');
        bytes = GLib.base64_decode(bundle.wallpaper);
        if (bytes.length > MAX_IMAGE) throw new Error('Wallpaper is too large');
    }
    const id = `theme-${GLib.uuid_string_random()}`;
    const imported = {...profile, id, wallpaper: null};
    let asset = null;
    try {
        if (bytes) {
            const dir = GLib.build_filenamev([store.dir, 'wallpapers']);
            GLib.mkdir_with_parents(dir, 0o700);
            asset = Gio.File.new_for_path(GLib.build_filenamev([dir, id]));
            asset.replace_contents(bytes, null, false, Gio.FileCreateFlags.PRIVATE, null);
            imported.wallpaper = asset.get_uri();
        }
        store.save(imported);
    } catch (error) {
        if (asset) { try { asset.delete(null); } catch { /* Preserve original error. */ } }
        throw error;
    }
    return imported;
}
