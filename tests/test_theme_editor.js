// gjs -m tests/test_theme_editor.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {saveOverridesToTheme} from '../shared/theme-editor.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const dir = GLib.dir_make_tmp('charcoal-theme-editor-XXXXXX');
const file = Gio.File.new_for_path(GLib.build_filenamev([dir, 'night.json']));
file.replace_contents(new TextEncoder().encode(JSON.stringify({version: 1, id: 'night', name: 'Night',
    wallpaper: null, components: {topbar: {'bar-color': '#121212', 'bar-height': 30}}})),
null, false, Gio.FileCreateFlags.NONE, null);
const local = {get_string: key => key === 'override-activations' ? '{"bar-color":"a","bar-height":"old","favorites":"a"}' : '',
    get_value: key => ({deepUnpack: () => ({'bar-color': '#abcdef', 'bar-height': 40, favorites: ['app']})[key]})};
const state = {'active-theme-id': 'night', 'activation-id': 'a', 'profile-revision': 'old'};
const central = {get_string: key => state[key], set_string: (key, value) => { state[key] = value; }};
const count = saveOverridesToTheme('topbar', local, central, ['bar-color', 'bar-height'], dir);
const [, bytes] = file.load_contents(null);
const saved = JSON.parse(new TextDecoder().decode(bytes));
assert(count === 1, 'only current override is saved');
assert(saved.components.topbar['bar-color'] === '#abcdef', 'edited color saved to theme');
assert(saved.components.topbar['bar-height'] === 30, 'old inactive override left alone');
assert(!Object.hasOwn(saved.components.topbar, 'favorites'), 'feature value excluded');
assert(state['profile-revision'] !== 'old', 'readers notified');
const revision = state['profile-revision'];
const badLocal = {get_string: key => key === 'override-activations' ? '{"bar-color":"a"}' : '',
    get_value: () => ({deepUnpack: () => 'not-a-color'})};
let rejected = false;
try { saveOverridesToTheme('topbar', badLocal, central, ['bar-color'], dir); }
catch { rejected = true; }
assert(rejected, 'invalid local color is rejected before publishing');
assert(state['profile-revision'] === revision, 'rejected edit does not notify readers');
const [, afterBad] = file.load_contents(null);
assert(JSON.parse(new TextDecoder().decode(afterBad)).components.topbar['bar-color'] === '#abcdef',
    'rejected edit preserves the theme');
// Do not publish an edit over a damaged profile, even if the edited value itself is valid.
file.replace_contents(new TextEncoder().encode(JSON.stringify({...saved, name: ''})),
    null, false, Gio.FileCreateFlags.PRIVATE, null);
rejected = false;
try { saveOverridesToTheme('topbar', local, central, ['bar-color'], dir); }
catch { rejected = true; }
assert(rejected, 'full profile validation is shared with imports and consumers');
assert(state['profile-revision'] === revision, 'damaged profile does not notify readers');
file.delete(null);
Gio.File.new_for_path(dir).delete(null);
print('theme editor: ok');
