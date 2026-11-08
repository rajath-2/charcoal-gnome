import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfile, updateProfile} from '../extensions/charcoal-themes@local/profile.js';
import {THEME_KEYS} from '../extensions/charcoal-themes@local/catalog.js';

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
