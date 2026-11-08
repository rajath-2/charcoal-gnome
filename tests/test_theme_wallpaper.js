// gjs -m tests/test_theme_wallpaper.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {applyWallpaper, restoreWallpaper} from '../extensions/charcoal-themes@local/wallpaper.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const values = {'picture-uri': 'file:///before-light.jpg', 'picture-uri-dark': 'file:///before-dark.jpg'};
const desktop = {get_string: key => values[key], set_string: (key, value) => { values[key] = value; return true; }};
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
Gio.File.new_for_path(path).delete(null);
Gio.File.new_for_path(dir).delete(null);
print('theme wallpaper: ok');
