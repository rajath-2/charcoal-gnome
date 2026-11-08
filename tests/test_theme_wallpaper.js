// gjs -m tests/test_theme_wallpaper.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {applyWallpaper, restoreWallpaper, syncWallpaper} from '../extensions/charcoal-themes@local/wallpaper.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const values = {'picture-uri': 'file:///before-light.jpg', 'picture-uri-dark': 'file:///before-dark.jpg'};
let writes = 0;
const desktop = {get_string: key => values[key], set_string: (key, value) => { writes++; values[key] = value; return true; }};
const saved = {value: '', get_string() { return this.value; }, set_string(_key, value) { this.value = value; }};
const dir = GLib.dir_make_tmp('charcoal-wallpaper-XXXXXX');
const path = GLib.build_filenamev([dir, 'wall.jpg']);
GLib.file_set_contents(path, 'fake image bytes');
const uri = Gio.File.new_for_path(path).get_uri();

assert(applyWallpaper({wallpaper: null}, desktop, saved).ok, 'no wallpaper is allowed');
assert(values['picture-uri'] === 'file:///before-light.jpg', 'empty wallpaper does not change desktop');
const missing = applyWallpaper({wallpaper: 'file:///definitely-missing-charcoal.jpg'}, desktop, saved);
assert(!missing.ok, 'missing wallpaper reports error');
assert(values['picture-uri'] === 'file:///before-light.jpg', 'missing wallpaper preserves desktop');
assert(applyWallpaper({wallpaper: uri}, desktop, saved).ok, 'existing wallpaper applies');
assert(values['picture-uri'] === uri && values['picture-uri-dark'] === uri, 'both modes switch');
assert(saved.value.includes('before-light.jpg'), 'original values journaled');
restoreWallpaper(desktop, saved);
assert(values['picture-uri'] === 'file:///before-light.jpg' && values['picture-uri-dark'] === 'file:///before-dark.jpg',
    'disable restores both originals');
assert(saved.value === '', 'journal cleared');

// Lock/unlock cycle: disable restores the original, enable puts the theme wallpaper back.
const theme = {wallpaper: uri};
assert(syncWallpaper(theme, desktop, saved, 'a').ok, 'enable applies theme wallpaper');
restoreWallpaper(desktop, saved);
assert(values['picture-uri'] === 'file:///before-light.jpg', 'disable restores original');
syncWallpaper(theme, desktop, saved, 'a');
assert(values['picture-uri'] === uri, 'enable after restore re-applies theme wallpaper');

// The user picks a wallpaper while the theme is active; it must survive disable + enable.
values['picture-uri'] = values['picture-uri-dark'] = 'file:///user-choice.jpg';
writes = 0;
restoreWallpaper(desktop, saved);
assert(syncWallpaper(theme, desktop, saved, 'a') === null, 'enable with unchanged activation does nothing');
assert(writes === 0 && values['picture-uri'] === 'file:///user-choice.jpg' &&
    values['picture-uri-dark'] === 'file:///user-choice.jpg', 'user wallpaper kept across disable/enable');

// Editing another theme bumps profile-revision; the active theme is unchanged, so nothing is written.
assert(syncWallpaper(theme, desktop, saved, 'a') === null && writes === 0, 'revision change of non-active theme writes nothing');

// Switching themes (new activation) applies again and journals the user's choice as the original.
assert(syncWallpaper(theme, desktop, saved, 'b').ok && values['picture-uri'] === uri, 'new activation applies');
restoreWallpaper(desktop, saved);
assert(values['picture-uri'] === 'file:///user-choice.jpg', 'restore returns the user choice, not the stale original');
Gio.File.new_for_path(path).delete(null);
Gio.File.new_for_path(dir).delete(null);
print('theme wallpaper: ok');
