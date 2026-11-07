import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCss} from '../extensions/charcoal-widgets@local/theme.js';
import {DEFAULT_POSITIONS, readPositions, toFraction, fromFraction, isDesktopClear, effectBox,
    geocodeUrl, parseGeocode, forecastUrl, parseForecast, describeWeather, monthGrid,
    pickPlayer, trackInfo, formatTime, nextLoop} from '../extensions/charcoal-widgets@local/policy.js';

const schema = readFileSync(new URL('../extensions/charcoal-widgets@local/schemas/org.gnome.shell.extensions.charcoal-widgets.gschema.xml', import.meta.url), 'utf8');
const defaults = Object.fromEntries([...schema.matchAll(/<key name="([^"]+)" type="(.)">[\s\S]*?<default>([^<]+)<\/default>/g)]
    .map(([, key, type, value]) => [key, type === 's' ? value.slice(1, -1) : type === 'b' ? value === 'true' : Number(value)]));

test('default look reproduces the amber reference card', () => {
    const css = buildCss(defaults);
    for (const s of ['rgba(21,17,13,0.7)', 'border: 1px solid rgba(217,144,61,0.45)',
        'box-shadow: 0 0 18px rgba(217,144,61,0.25)', 'border-radius: 18px', '#f0a24a', 'rgba(242,236,228,0.6)'])
        assert.ok(css.includes(s), s);
    assert.doesNotMatch(css, /undefined|NaN/);
    assert.equal(css.split('{').length, css.split('}').length);
});

test('zero border and shadow, bad colors fall back to gray', () => {
    const css = buildCss({...defaults, 'border-width': 0, 'shadow-size': 0, 'accent-color': 'bogus'});
    assert.ok(css.includes('border: none'));
    assert.ok(css.includes('box-shadow: none'));
    assert.ok(css.includes('#808080'));
});

test('saved positions survive garbage and missing monitors', () => {
    assert.deepEqual(readPositions('nope', 1, 0), DEFAULT_POSITIONS);
    const p = readPositions(JSON.stringify({music: {monitor: 3, x: 0.1, y: 0.1}, weather: {monitor: 0, x: 4, y: -1}}), 2, 1);
    assert.deepEqual(p.music, {...DEFAULT_POSITIONS.music, monitor: 1});
    assert.deepEqual(p.weather, {monitor: 0, x: 1, y: 0});
});

test('fractions round-trip and keep the card on screen', () => {
    const area = {x: 0, y: 40, width: 1920, height: 1040}, size = {width: 320, height: 140};
    assert.deepEqual(fromFraction(area, size, {x: 0.5, y: 1}), {x: 800, y: 940});
    assert.deepEqual(toFraction(area, size, {x: 800, y: 940}), {x: 0.5, y: 1});
    assert.deepEqual(toFraction(area, size, {x: 5000, y: -50}), {x: 1, y: 0});
    assert.deepEqual(toFraction({...area, width: 100}, size, {x: 0, y: 40}), {x: 0, y: 0});
});

test('desktop is clear only without visible normal windows on that monitor', () => {
    const w = (normal, minimized, monitor) => ({normal, minimized, monitor});
    assert.equal(isDesktopClear([], 0), true);
    assert.equal(isDesktopClear([w(true, true, 0), w(false, false, 0), w(true, false, 1)], 0), true);
    assert.equal(isDesktopClear([w(true, false, 0)], 0), false);
});

test('blur mask maps through the enlarged effect texture', () => {
    assert.deepEqual(effectBox(18, 3, 1244, 30), [-2, -2, 1247, 33]);
    const [x, y, w, h] = effectBox(18.4, 3.6, 1244.2, 30);
    assert.ok(x <= 0 && y <= 0 && x + w >= 1244.2 && y + h >= 30);
});

test('weather parsing tolerates bad responses', () => {
    const good = {current: {temperature_2m: 23.6, weather_code: 3, is_day: 1},
        daily: {temperature_2m_max: [29.2], temperature_2m_min: [18.7]}};
    assert.deepEqual(parseForecast(good), {temperature: 24, high: 29, low: 19, code: 3, isDay: true});
    assert.equal(parseForecast({error: true, reason: 'x'}), null);
    assert.equal(parseForecast({current: {}}), null);
    assert.equal(parseForecast(null), null);
    assert.deepEqual(parseGeocode({}), []);
    assert.deepEqual(parseGeocode(null), []);
    assert.deepEqual(parseGeocode({results: [{name: 'Bengaluru', admin1: 'Karnataka', country: 'India', latitude: 12.97, longitude: 77.59}]}),
        [{label: 'Bengaluru, Karnataka, India', latitude: 12.97, longitude: 77.59}]);
    assert.ok(geocodeUrl('São Paulo').includes('name=S%C3%A3o%20Paulo'));
    assert.ok(forecastUrl(12.97, 77.59).includes('latitude=12.97&longitude=77.59'));
});

test('weather codes map to text and icons', () => {
    assert.deepEqual(describeWeather(0, false), {text: 'Clear', icon: 'weather-clear-night-symbolic'});
    assert.equal(describeWeather(63, true).text, 'Rain');
    assert.equal(describeWeather(96, true).icon, 'weather-storm-symbolic');
    assert.equal(describeWeather(1234, true).text, 'Unknown');
});

test('month grid has the needed weeks for each week start', () => {
    const nov = monthGrid(2026, 10, 1);              // Nov 1 2026 is a Sunday
    assert.equal(nov.length, 42);
    assert.equal(nov[0].date.getDate(), 26);         // Mon Oct 26
    assert.equal(nov[0].inMonth, false);
    assert.equal(nov[6].inMonth && nov[6].date.getDate(), 1);
    assert.equal(monthGrid(2026, 10, 0).length, 35); // Sunday start
    const feb = monthGrid(2027, 1, 1);               // Feb 1 2027 is a Monday
    assert.equal(feb.length, 28);
    assert.ok(feb.every(d => d.inMonth));
});

test('the playing player wins over a later-paused one', () => {
    assert.equal(pickPlayer([{name: 'spotify', status: 'Playing', changedAt: 1},
        {name: 'firefox', status: 'Paused', changedAt: 9}]), 'spotify');
    assert.equal(pickPlayer([{name: 'a', status: 'Paused', changedAt: 1}, {name: 'b', status: 'Stopped', changedAt: 5}]), 'b');
    assert.equal(pickPlayer([]), null);
});

test('track info survives malformed metadata', () => {
    assert.deepEqual(trackInfo({'xesam:artist': 'Amber Street', 'mpris:length': 'x'}),
        {title: 'Unknown title', artist: '', artUrl: '', length: 0, trackId: ''});
    assert.deepEqual(trackInfo(undefined), {title: 'Unknown title', artist: '', artUrl: '', length: 0, trackId: ''});
    assert.equal(trackInfo({'xesam:title': 'Midnight Drive', 'xesam:artist': ['A', 'B']}).artist, 'A, B');
    assert.equal(trackInfo({'mpris:length': 268000000}).length, 268000000);
});

test('time and loop helpers', () => {
    assert.equal(formatTime(134_000_000), '2:14');
    assert.equal(formatTime(3_725_000_000), '1:02:05');
    assert.equal(formatTime(NaN), '0:00');
    assert.equal(formatTime(-5), '0:00');
    assert.deepEqual(['None', 'Playlist', 'Track', 'weird'].map(nextLoop), ['Playlist', 'Track', 'None', 'Playlist']);
});
