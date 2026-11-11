import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ThemeStore} from '../extensions/charcoal-themes@local/store.js';
import {exportTheme, importTheme} from '../extensions/charcoal-themes@local/transfer.js';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const dir = GLib.dir_make_tmp('charcoal-transfer-XXXXXX');
const store = new ThemeStore(dir);
const file = Gio.File.new_for_path(`${dir}/export.json`);
const wall = Gio.File.new_for_path(`${dir}/original.png`);
wall.replace_contents(new Uint8Array([0, 1, 127, 255]), null, false, Gio.FileCreateFlags.PRIVATE, null);
const profile = {version: 1, id: 'original', name: 'Original', wallpaper: wall.get_uri(), components: {}};
store.save(profile);
exportTheme(profile, file);
wall.delete(null);
const imported = importTheme(file, store);
assert(imported.id !== profile.id, 'fresh ID');
assert(imported.wallpaper !== profile.wallpaper, 'portable wallpaper path');
const [, bytes] = Gio.File.new_for_uri(imported.wallpaper).load_contents(null);
assert(bytes.join() === '0,1,127,255', 'wallpaper bytes survive transfer');
assert(store.get('original').wallpaper === profile.wallpaper, 'existing theme unchanged');
assert(importTheme(file, store).id !== imported.id, 'repeated import gets fresh ID');
exportTheme({...profile, wallpaper: null}, file);
assert(importTheme(file, store).wallpaper === null, 'no wallpaper works');
const reject = action => { let failed = false; try { action(); } catch { failed = true; } assert(failed, 'must reject'); };
reject(() => exportTheme(profile, file));
for (const content of ['{', '{"version":99}', JSON.stringify({format: 'charcoal-theme', version: 1, profile, wallpaper: '!!!'})]) {
    file.replace_contents(new TextEncoder().encode(content), null, false, Gio.FileCreateFlags.PRIVATE, null);
    reject(() => importTheme(file, store));
}
// A typical wallpaper must not exhaust the regular-expression engine's stack.
const large = new Uint8Array(1024 * 1024);
wall.replace_contents(large, null, false, Gio.FileCreateFlags.PRIVATE, null);
exportTheme(profile, file);
assert(importTheme(file, store).wallpaper, 'large wallpaper imports');
print('theme transfer: ok');
