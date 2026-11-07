import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCss} from '../extensions/charcoal-widgets@local/theme.js';
import {DEFAULT_POSITIONS, readPositions, toFraction, fromFraction, isDesktopClear, effectBox} from '../extensions/charcoal-widgets@local/policy.js';

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
