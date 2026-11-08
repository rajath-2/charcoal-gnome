import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateProfile, updateProfile} from '../extensions/charcoal-themes@local/profile.js';
import {THEME_KEYS} from '../extensions/charcoal-themes@local/catalog.js';
import {resolveValue, selectOverride, switchTheme, effectiveSnapshot} from '../shared/theme-policy.js';
import {activateTheme} from '../extensions/charcoal-themes@local/activation.js';
import {buildCss as topbarCss} from '../extensions/charcoal-topbar@local/theme.js';
import {buildCss as widgetCss} from '../extensions/charcoal-widgets@local/theme.js';
import {surfaceCss} from '../extensions/charcoal-launchers@local/policy.js';

const minimal = {version: 1, id: 'night', name: 'Night', wallpaper: null,
    components: {topbar: {'bar-color': '#121212', 'bar-height': 30}}};

test('valid profile accepts cataloged appearance and layout values', () => {
    const result = validateProfile(minimal, THEME_KEYS);
    assert.equal(result.ok, true);
    assert.deepEqual(result.profile, minimal);
});

test('profile rejects unknown, personal, feature, and out-of-range values', () => {
    for (const [component, key, value] of [
        ['topbar', 'not-a-key', 1],
        ['widgets', 'weather-city', 'Bengaluru'],
        ['launchers', 'favorites', ['app']],
        ['launchers', 'search-enabled', false],
        ['topbar', 'bar-height', 900],
        ['topbar', 'bar-color', 'transparent; color: red'],
    ]) {
        const result = validateProfile({...minimal, components: {[component]: {[key]: value}}}, THEME_KEYS);
        assert.equal(result.ok, false, `${component}.${key}`);
        assert.ok(result.errors.length, `${component}.${key}`);
    }
});

test('profile requires a version, stable ID and name', () => {
    for (const patch of [{version: 3}, {id: '../outside'}, {name: ''}])
        assert.equal(validateProfile({...minimal, ...patch}, THEME_KEYS).ok, false);
});

test('updating a profile preserves stable ID and does not mutate the store', () => {
    const store = {night: minimal};
    const changed = updateProfile(store, 'night', {name: 'Blue night'});
    assert.equal(changed.night.name, 'Blue night');
    assert.equal(changed.night.id, 'night');
    assert.equal(store.night.name, 'Night');
    assert.throws(() => updateProfile(store, 'night', {id: 'other'}));
});

test('linked setting follows theme while unlinked or missing theme uses saved local value', () => {
    const input = {key: 'bar-color', local: '#112233', theme: '#445566', linked: true,
        overrideActivation: {}, activationId: 'a'};
    assert.equal(resolveValue(input), '#445566');
    assert.equal(resolveValue({...input, linked: false}), '#112233');
    assert.equal(resolveValue({...input, theme: undefined}), '#112233');
});

test('override is restorable after theme switch and survives profile revision', () => {
    const initial = {themeId: 'night', activationId: 1, overrides: {}};
    const selected = selectOverride(initial, 'bar-color', 1);
    const value = (state, theme) => resolveValue({key: 'bar-color', local: '#112233', theme,
        linked: true, overrideActivation: state.overrides, activationId: state.activationId});
    assert.equal(value(selected, '#445566'), '#112233');
    assert.equal(value({...selected, profileRevision: 2}, '#778899'), '#112233');
    const switched = switchTheme(selected, 'day');
    assert.equal(value(switched, '#ffffff'), '#ffffff');
    assert.equal(value(selectOverride(switched, 'bar-color', switched.activationId), '#ffffff'), '#112233');
    assert.equal(selected.overrides['bar-color'], 1, 'saved override is retained');
});

test('activation validates before changing active ID or token', () => {
    const values = {'active-theme-id': 'old', 'activation-id': 'old-token', status: ''};
    const settings = {get_string: key => values[key], set_string: (key, value) => { values[key] = value; }};
    const profile = {version: 1, id: 'night', name: 'Night', wallpaper: null, components: {}};
    const store = {get: id => id === 'night' ? profile : null};
    assert.equal(activateTheme('missing', settings, store, () => ({ok: true}), () => 'new-token'), false);
    assert.equal(values['active-theme-id'], 'old');
    assert.equal(values['activation-id'], 'old-token');
    assert.equal(activateTheme('night', settings, store, () => ({ok: true}), () => 'new-token'), true);
    assert.equal(values['active-theme-id'], 'night');
    assert.equal(values['activation-id'], 'new-token');
});

test('missing wallpaper still activates other theme values and reports the error', () => {
    const values = {'active-theme-id': 'old', 'activation-id': 'old-token', status: ''};
    const settings = {set_string: (key, value) => { values[key] = value; }};
    const store = {get: () => ({version: 1, id: 'night', name: 'Night', wallpaper: null, components: {}})};
    assert.equal(activateTheme('night', settings, store, () => ({ok: false, error: 'missing wallpaper'}), () => 'new-token'), true);
    assert.equal(values['active-theme-id'], 'night');
    assert.equal(values['activation-id'], 'new-token');
    assert.equal(values.status, 'missing wallpaper');
});

test('topbar and widget CSS use effective theme values', () => {
    const defaults = component => Object.fromEntries([...readFileSync(new URL(
        `../extensions/charcoal-${component}@local/schemas/org.gnome.shell.extensions.charcoal-${component}.gschema.xml`,
        import.meta.url), 'utf8').matchAll(/<key name="([^"]+)" type="(.)">[\s\S]*?<default>([^<]+)<\/default>/g)]
        .map(([, key, type, raw]) => [key, type === 's' ? raw.slice(1, -1) : type === 'b' ? raw === 'true' : Number(raw)]));
    const localSettings = values => ({settings_schema: {list_keys: () => Object.keys(values)},
        get_value: key => ({deepUnpack: () => values[key]})});
    const local = localSettings(defaults('topbar'));
    const themed = {get: key => ({...defaults('topbar'), 'bar-color': '#112233', 'bar-height': 42, 'text-color': '#abcdef'})[key]};
    const topbar = effectiveSnapshot(local, themed);
    assert.equal(topbar['bar-height'], 42);
    assert.ok(topbarCss({...topbar, mode: 'compact'}).includes('rgba(17,34,51'));

    const widgetLocal = localSettings(defaults('widgets'));
    const widget = effectiveSnapshot(widgetLocal, {get: key => ({...defaults('widgets'),
        'background-color': '#222222', 'accent-color': '#00aaff'})[key]});
    assert.ok(widgetCss(widget).includes('#00aaff'));
});

test('launcher theme changes look while favorites and shortcuts stay local', () => {
    const local = {'background-color': '#202127', 'foreground-color': '#f0f0f2',
        'accent-color': '#a6b5cc', 'background-opacity': 94, 'border-color': '#ffffff',
        'border-width': 1, 'border-opacity': 12, 'shadow-color': '#000000',
        'shadow-size': 32, 'shadow-opacity': 30, 'text-size': 100, 'corner-radius': 20,
        favorites: ['app-a'], 'launcher-shortcut': ['<Super>space']};
    const theme = {'background-color': '#112233', 'launcher-width': 800};
    const values = Object.fromEntries(Object.entries(local).map(([key, value]) =>
        [key, resolveValue({key, local: value, theme: theme[key], linked: true, activationId: 'a'})]));
    assert.ok(surfaceCss(values).includes('rgba(17,34,51'));
    assert.deepEqual(values.favorites, ['app-a']);
    assert.deepEqual(values['launcher-shortcut'], ['<Super>space']);
});
