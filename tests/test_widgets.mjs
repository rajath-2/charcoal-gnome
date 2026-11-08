import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildCss} from '../extensions/charcoal-widgets@local/theme.js';
import {DEFAULT_POSITIONS, readPositions, toFraction, fromFraction, isDesktopClear, effectBox,
    geocodeUrl, parseGeocode, forecastUrl, parseForecast, describeWeather, monthGrid,
    pickPlayer, trackInfo, formatTime, nextLoop, mergeCardValue,
    placeSearchUrl, parsePlaceSearch, mergePlaces, weekStartDay, weatherDue, widgetLayout, weekGrid, readSize, fitContent, MIN_CARD,
    resizeEdges, resizeRect} from '../extensions/charcoal-widgets@local/policy.js';

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

test('each widget has its own size; 100% keeps the reference sizes', () => {
    const css = buildCss({...defaults, 'music-size': 150, 'calendar-size': 70});
    const block = name => css.slice(css.indexOf(`/* ${name} */`), css.indexOf('/* end */', css.indexOf(`/* ${name} */`)));
    assert.ok(block('weather').includes('padding: 16px'));
    assert.ok(block('weather').includes('font-size: 13pt'));
    assert.ok(block('music').includes('padding: 24px'));
    assert.ok(block('music').includes('font-size: 19.5pt'));
    assert.ok(block('calendar').includes('width: 21px'), 'day cells shrink');
    assert.ok(block('music').includes('.charcoal-widget-music .charcoal-play-ring'));
    assert.doesNotMatch(css, /undefined|NaN/);
    assert.equal(css.split('{').length, css.split('}').length);
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
    assert.deepEqual(parseForecast(good), {temperature: 24, high: 29, low: 19, code: 3, isDay: true,
        feelsLike: null, humidity: null, wind: null});
    const extra = {...good, current: {...good.current, apparent_temperature: 25.4, relative_humidity_2m: 83, wind_speed_10m: 11.6}};
    assert.deepEqual(parseForecast(extra), {temperature: 24, high: 29, low: 19, code: 3, isDay: true,
        feelsLike: 25, humidity: 83, wind: 12});
    assert.equal(parseForecast({error: true, reason: 'x'}), null);
    assert.equal(parseForecast({current: {}}), null);
    assert.equal(parseForecast(null), null);
    assert.deepEqual(parseGeocode({}), []);
    assert.deepEqual(parseGeocode(null), []);
    assert.deepEqual(parseGeocode({results: [{name: 'Bengaluru', admin1: 'Karnataka', country: 'India', latitude: 12.97, longitude: 77.59}]}),
        [{label: 'Bengaluru, Karnataka, India', latitude: 12.97, longitude: 77.59}]);
    assert.ok(geocodeUrl('São Paulo').includes('name=S%C3%A3o%20Paulo'));
    assert.ok(forecastUrl(12.97, 77.59).includes('latitude=12.97&longitude=77.59'));
    assert.ok(forecastUrl(1, 2).includes('apparent_temperature,relative_humidity_2m,wind_speed_10m'));
});

test('weather codes map to text and icons', () => {
    assert.deepEqual(describeWeather(0, false), {text: 'Clear', icon: 'weather-clear-night-symbolic'});
    assert.equal(describeWeather(63, true).text, 'Rain');
    assert.equal(describeWeather(96, true).icon, 'weather-storm-symbolic');
    assert.equal(describeWeather(1234, true).text, 'Unknown');
});

test('month grid matches the top bar calendar: six weeks, same padding', () => {
    const nov = monthGrid(2026, 10, 1);              // Nov 1 2026 is a Sunday
    assert.equal(nov.length, 42);
    assert.equal(nov[0].date.getDate(), 26);         // Mon Oct 26
    assert.equal(nov[0].inMonth, false);
    assert.equal(nov[6].inMonth && nov[6].date.getDate(), 1);
    const sun = monthGrid(2026, 10, 0);              // starts on the week start: one padding week before
    assert.equal(sun.length, 42);
    assert.equal(sun[7].date.getDate(), 1);
    const feb = monthGrid(2027, 1, 1);               // Feb 1 2027 is a Monday, 4 weeks: padded both sides
    assert.equal(feb.length, 42);
    assert.equal(feb[0].date.getDate(), 25);         // Mon Jan 25
    assert.equal(feb.filter(d => d.inMonth).length, 28);
});

test('week start follows the desktop setting, else the locale', () => {
    assert.equal(weekStartDay(0, 0), 0);             // 'default' -> locale (Sunday)
    assert.equal(weekStartDay(1, 0), 1);             // 'monday'
    assert.equal(weekStartDay(7, 1), 0);             // 'sunday'
});

test('weather refreshes every 30 min, retries failures sooner, and notices wall-clock jumps', () => {
    const min = 60e6;
    assert.equal(weatherDue({now: 0, lastAttempt: null, lastSuccess: null, failures: 0}), true);
    assert.equal(weatherDue({now: 29 * min, lastAttempt: 0, lastSuccess: 0, failures: 0}), false);
    assert.equal(weatherDue({now: 30 * min, lastAttempt: 0, lastSuccess: 0, failures: 0}), true);
    assert.equal(weatherDue({now: 1 * min, lastAttempt: 0, lastSuccess: null, failures: 1}), true, 'first retry after a minute');
    assert.equal(weatherDue({now: 1 * min, lastAttempt: 0, lastSuccess: null, failures: 2}), false);
    assert.equal(weatherDue({now: 2 * min, lastAttempt: 0, lastSuccess: null, failures: 2}), true, 'backoff doubles');
    assert.equal(weatherDue({now: 29 * min, lastAttempt: 0, lastSuccess: null, failures: 9}), false, 'capped at 30 min');
    assert.equal(weatherDue({now: 30 * min, lastAttempt: 0, lastSuccess: null, failures: 9}), true);
    assert.equal(weatherDue({now: 12 * 60 * min, lastAttempt: 0, lastSuccess: 0, failures: 0}), true, 'after an overnight suspend');
});

test('the playing player wins over a later-paused one', () => {
    assert.equal(pickPlayer([{name: 'spotify', status: 'Playing', changedAt: 1},
        {name: 'firefox', status: 'Paused', changedAt: 9}]), 'spotify');
    assert.equal(pickPlayer([{name: 'a', status: 'Paused', changedAt: 1}, {name: 'b', status: 'Stopped', changedAt: 5}]), 'b');
    assert.equal(pickPlayer([]), null);
});

test('track info survives malformed metadata', () => {
    assert.deepEqual(trackInfo({'xesam:artist': 'Amber Street', 'mpris:length': 'x'}),
        {title: 'Unknown title', artist: '', album: '', artUrl: '', length: 0, trackId: ''});
    assert.deepEqual(trackInfo(undefined), {title: 'Unknown title', artist: '', album: '', artUrl: '', length: 0, trackId: ''});
    assert.equal(trackInfo({'xesam:album': 'Night Roads'}).album, 'Night Roads');
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

test('city search also understands OpenStreetMap results and merges duplicates', () => {
    assert.ok(placeSearchUrl('Bangalore').startsWith('https://nominatim.openstreetmap.org/search?q=Bangalore&'));
    assert.ok(placeSearchUrl('x').includes('featureType=settlement'), 'cities only, not roads or shops');
    const osm = parsePlaceSearch([{name: 'Bengaluru', lat: '12.9767936', lon: '77.5900820',
        address: {state: 'Karnataka', country: 'India'}}, {name: 'broken'}]);
    assert.deepEqual(osm, [{label: 'Bengaluru, Karnataka, India', latitude: 12.9767936, longitude: 77.590082}]);
    assert.deepEqual(parsePlaceSearch({error: 'x'}), []);
    const meteo = [{label: 'Bengaluru, Karnataka, India', latitude: 12.97, longitude: 77.59},
        {label: 'Bangalore Town, Sindh, Pakistan', latitude: 24.9, longitude: 67.1}];
    assert.deepEqual(mergePlaces(osm, meteo).map(p => p.label), ['Bengaluru, Karnataka, India', 'Bangalore Town, Sindh, Pakistan']);
});

test('calendar changes information with its shape, keeping small dates readable', () => {
    const compact = widgetLayout('calendar', 230, 110);
    assert.equal(compact.mode, 'compact');
    assert.equal(compact.events, 1);
    assert.equal(widgetLayout('calendar', 300, 180).mode, 'week');
    assert.equal(widgetLayout('calendar', 280, 300).mode, 'month');
    assert.equal(widgetLayout('calendar', 150, 500).mode, 'compact', 'height alone cannot fit seven days');
    assert.equal(widgetLayout('calendar', 600, 90).mode, 'compact', 'width alone cannot fit a week');
    const expanded = widgetLayout('calendar', 600, 350);
    assert.equal(expanded.sideBySide, true);
    assert.ok(expanded.events > compact.events);
    assert.equal(widgetLayout('calendar', 60, 45).events, 0);
});

test('weather and music arrange wide shallow cards horizontally and reveal details with room', () => {
    assert.equal(widgetLayout('weather', 400, 90).horizontal, true);
    assert.equal(widgetLayout('weather', 200, 200).horizontal, false);
    assert.equal(widgetLayout('weather', 230, 110).extra, false);
    assert.equal(widgetLayout('weather', 300, 240).extra, true);
    assert.equal(widgetLayout('music', 500, 90).mode, 'strip');
    assert.equal(widgetLayout('music', 260, 260).mode, 'stack');
    assert.equal(widgetLayout('music', 180, 90).seek, false);
    assert.equal(widgetLayout('music', 340, 230).seek, true);
    assert.equal(widgetLayout('music', 340, 280).album, true);
    assert.equal(widgetLayout('music', 70, 50).art, false);
});

test('layout respects typography scale and switches back after repeated resizes', () => {
    for (const name of ['calendar', 'weather', 'music']) {
        assert.deepEqual(widgetLayout(name, 450, 270, 1.5), widgetLayout(name, 300, 180));
        const small = widgetLayout(name, 200, 100);
        widgetLayout(name, 600, 400);
        assert.deepEqual(widgetLayout(name, 200, 100), small);
    }
    assert.equal(widgetLayout('calendar', 280, 300, 1.5).mode, 'compact');
});

test('HiDPI cards choose the same content as equal logical-size cards', () => {
    for (const name of ['calendar', 'weather', 'music'])
        assert.deepEqual(widgetLayout(name, 560, 600, 1, 2), widgetLayout(name, 280, 300));
    assert.equal(widgetLayout('calendar', 280, 300, 1, 2).mode, 'compact');
});

test('calendar refreshes remaining events on a same-day clock tick', () => {
    // Exercise the production timer handler without a Shell session; GI is needed only
    // when constructing actors, which this test deliberately does not do.
    const source = readFileSync(new URL('../extensions/charcoal-widgets@local/calendar.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export const CalendarCard', 'const CalendarCard');
    const CalendarCard = runInNewContext(`${source}\nCalendarCard;`, {
        GObject: {registerClass: cls => cls}, Card: class {}, Date,
    });
    let refreshed = false;
    CalendarCard.prototype._checkDay.call({_today: new Date(), _renderEvents() { refreshed = true; }});
    assert.equal(refreshed, true, 'an event may have ended even though the date has not changed');
});

test('week strip respects first weekday and crosses month/year boundaries', () => {
    const week = weekGrid(new Date(2027, 0, 1), 1);
    assert.equal(week.length, 7);
    assert.equal(week[0].getDay(), 1);
    assert.deepEqual(week.map(d => d.getDate()), [28, 29, 30, 31, 1, 2, 3]);
    assert.equal(week[0].getFullYear(), 2026);
});

test('a drawn shape is read back clamped; anything malformed means "fit the content"', () => {
    assert.deepEqual(readSize('{"calendar":{"width":300.4,"height":20}}', 'calendar'), {width: 300, height: MIN_CARD});
    for (const json of ['', 'nope', '{}', '{"calendar":{"width":"x","height":1}}', 'null'])
        assert.equal(readSize(json, 'calendar'), null, json);
});

test('all four edges and corners resize, while the middle moves', () => {
    const rect = {x: 100, y: 200, width: 300, height: 180};
    const cases = [[101, 201, ['left', 'top']], [399, 201, ['right', 'top']],
        [101, 379, ['left', 'bottom']], [399, 379, ['right', 'bottom']],
        [101, 290, ['left']], [399, 290, ['right']], [250, 201, ['top']],
        [250, 379, ['bottom']], [250, 290, []], [99, 290, []]];
    for (const [x, y, expected] of cases)
        assert.deepEqual(Object.entries(resizeEdges(rect, x, y)).filter(([, active]) => active)
            .map(([edge]) => edge).sort(), expected.sort());
});

test('resizing from each corner anchors the opposite corner', () => {
    const rect = {x: -300, y: 100, width: 300, height: 180};
    assert.deepEqual(resizeRect(rect, {left: true, top: true}, -40, -30),
        {x: -340, y: 70, width: 340, height: 210});
    assert.deepEqual(resizeRect(rect, {right: true, top: true}, 40, -30),
        {x: -300, y: 70, width: 340, height: 210});
    assert.deepEqual(resizeRect(rect, {left: true, bottom: true}, -40, 30),
        {x: -340, y: 100, width: 340, height: 210});
    assert.deepEqual(resizeRect(rect, {right: true, bottom: true}, 40, 30),
        {x: -300, y: 100, width: 340, height: 210});
    assert.deepEqual(resizeRect(rect, {left: true}, 40, 999),
        {x: -260, y: 100, width: 260, height: 180});
    assert.deepEqual(resizeRect(rect, {top: true}, 999, 30),
        {x: -300, y: 130, width: 300, height: 150});
});

test('left/top shrinking stops at minimum size without moving the opposite edge', () => {
    const rect = {x: 100, y: 200, width: 300, height: 180};
    assert.deepEqual(resizeRect(rect, {left: true, top: true}, 1000, 1000),
        {x: 400 - MIN_CARD, y: 380 - MIN_CARD, width: MIN_CARD, height: MIN_CARD});
    assert.deepEqual(resizeRect(rect, {left: true, top: true}, 0, 0), rect,
        'returning to the starting pointer position restores the original shape');
});

test('content fills a wider shape and shrinks into a smaller one', () => {
    const calendar = w => 280 * 248 / w; // wider lays out shorter, like wrapped text
    // Just wider: content stretches to the width, not scaled.
    assert.deepEqual(fitContent(400, 300, 248, () => 260), {width: 400, height: 260, scale: 1});
    // Weather's shape (wide, short): scaled down to fit both ways.
    const fit = fitContent(260, 130, 248, () => 260);
    assert.equal(fit.scale, 0.5);
    assert.ok(fit.width * fit.scale <= 260 && fit.height * fit.scale <= 130);
    // Narrower than the content's minimum: laid out at the minimum, scaled to the width.
    const narrow = fitContent(124, 400, 248, calendar);
    assert.ok(narrow.width * narrow.scale <= 124.001 && narrow.height * narrow.scale <= 400);
    assert.ok(narrow.width >= 248);
});

test('saving one card keeps the other cards at their effective (theme) values', () => {
    const theme = JSON.stringify({weather: {monitor: 0, x: 0.1, y: 0.1}, calendar: {monitor: 0, x: 0.5, y: 0.5}});
    const merged = JSON.parse(mergeCardValue(theme, 'music', {monitor: 0, x: 0.9, y: 0.9}));
    assert.deepEqual(merged, {weather: {monitor: 0, x: 0.1, y: 0.1}, calendar: {monitor: 0, x: 0.5, y: 0.5},
        music: {monitor: 0, x: 0.9, y: 0.9}});
    for (const bad of ['', 'null', '[1]', '{oops'])
        assert.deepEqual(JSON.parse(mergeCardValue(bad, 'music', {x: 1})), {music: {x: 1}});
    const card = readFileSync(new URL('../extensions/charcoal-widgets@local/card.js', import.meta.url), 'utf8');
    assert.match(card, /mergeCardValue\(this\.settings\.get_string\(key\)/, 'card seeds from the effective value');
    assert.doesNotMatch(card, /settings\.local/);
});
