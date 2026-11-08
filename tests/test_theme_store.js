// gjs -m tests/test_theme_store.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {ThemeStore, captureSettings, ensureDefaultTheme} from '../extensions/charcoal-themes@local/store.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const dir = GLib.dir_make_tmp('charcoal-theme-store-XXXXXX');
const store = new ThemeStore(dir);
const profile = {version: 1, id: 'test', name: 'Test', wallpaper: null,
    components: {topbar: {'bar-color': '#112233'}}};

assert(store.list().length === 0, 'empty store');
store.save(profile);
assert(store.get('test').components.topbar['bar-color'] === '#112233', 'saved profile round-trips');
ensureDefaultTheme(store, {});
assert(store.get('charcoal-default')?.name === 'Charcoal Default', 'bundled default exists alongside custom theme');
assert(new ThemeStore(dir).get('test').name === 'Test', 'new store reads persisted file');
assert(store.get('../escape') === null, 'invalid ID cannot escape directory');
const captured = captureSettings('captured', 'Captured', {topbar: {
    get_value(key) { return {deepUnpack() { return key === 'bar-color' ? '#abcdef' : 30; }}; },
    settings_schema: {has_key(key) { return ['bar-color', 'bar-height'].includes(key); }},
}});
assert(captured.components.topbar['bar-color'] === '#abcdef', 'capture reads current settings');
assert(!Object.hasOwn(captured.components.topbar, 'weather-city'), 'capture excludes personal keys');
const defaulted = captureSettings('built-in', 'Charcoal Default', {topbar: {
    get_value() { return {deepUnpack: () => '#ffffff'}; },
    settings_schema: {has_key(key) { return key === 'bar-color'; },
        get_key() { return {get_default_value: () => ({deepUnpack: () => '#121212'})}; }},
}}, true);
assert(defaulted.components.topbar['bar-color'] === '#121212', 'built-in uses schema default, not live value');
store.delete('test');
store.delete('charcoal-default');
assert(store.list().length === 0, 'delete removes profile');
Gio.File.new_for_path(dir).delete(null);
print('theme store: ok');
