import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCss} from '../extensions/charcoal-topbar@local/theme.js';
import {morphRects, morphShapes} from '../extensions/charcoal-topbar@local/morph.js';
import {useIslands} from '../extensions/charcoal-topbar@local/policy.js';

const schema = readFileSync(new URL('../extensions/charcoal-topbar@local/schemas/org.gnome.shell.extensions.charcoal-topbar.gschema.xml', import.meta.url), 'utf8');
const defaults = Object.fromEntries([...schema.matchAll(/<key name="([^"]+)" type="(.)">[\s\S]*?<default>([^<]+)<\/default>/g)]
    .map(([, key, type, value]) => [key, type === 's' ? value.slice(1, -1) : type === 'b' ? value === 'true' : Number(value)]));

test('default appearance reproduces the original charcoal stylesheet values', () => {
    const css = buildCss(defaults);
    for (const original of ['margin: 3px 72px 3px', 'margin: 3px 18px 3px', 'height: 30px', 'rgba(18,18,18,0.78)',
        'rgba(18,18,18,0.9)', 'rgba(20,20,20,0.86)', 'border-radius: 22px', 'border-radius: 14px', 'border-radius: 16px',
        '#323232', '#414141', '#292929', '#343434', '#454545', 'rgba(30,30,30,0.94)', 'rgba(36,36,36,0.94)',
        'background-color: #c7c7c7', 'font-weight: 600', 'color: #ededed'])
        assert.ok(css.includes(original), original);
    assert.doesNotMatch(css, /undefined|NaN/);
    assert.equal(css.split('{').length, css.split('}').length);
});

test('preferences change the generated stylesheet', () => {
    const css = buildCss({...defaults, 'bar-color': '#203040', 'bar-opacity': 50, 'bar-height': 36,
        'bold-text': false, shadow: false, 'popup-radius': 11, 'text-color': 'bogus'});
    assert.ok(css.includes('rgba(32,48,64,0.5)'));
    assert.ok(css.includes('height: 36px'));
    assert.ok(css.includes('font-weight: 400'));
    assert.ok(css.includes('border-radius: 7px'), 'toggle radius scales with popup radius');
    assert.doesNotMatch(css, /box-shadow: 0 4px/);
    assert.doesNotMatch(css, /undefined|NaN/);
});

test('morph corner radius follows the preference', () => {
    const boxes = [{x: 0, width: 100}, {x: 300, width: 100}, {x: 700, width: 100}];
    assert.equal(morphRects(800, 30, boxes, 1, 6)[0].leftRadius, 6);
    assert.equal(morphRects(800, 30, boxes, 1, 40)[0].leftRadius, 15, 'capped at half the height');
});

test('auto bar shapes: one joined bar at rest, three pieces once splitting', () => {
    const boxes = [{x: 0, width: 100}, {x: 300, width: 100}, {x: 700, width: 100}];
    const joined = morphShapes(800, 30, boxes, 0, 10);
    assert.deepEqual(joined, [{x: 0, width: 800, height: 30, leftRadius: 10, rightRadius: 10}]);
    const split = morphShapes(800, 30, boxes, 1, 10);
    assert.equal(split.length, 3);
    assert.deepEqual(split.map(r => [r.x, r.width]), [[0, 100], [300, 100], [700, 100]]);
});

test('blur mask maps through the enlarged effect texture, not the bare layer box', async () => {
    const {effectBox} = await import('../extensions/charcoal-topbar@local/morph.js');
    // Panel at (18, 3), 1244x30: Clutter renders the effect into a 1247x33 texture starting 2px up-left.
    assert.deepEqual(effectBox(18, 3, 1244, 30), [-2, -2, 1247, 33]);
    const [x, y, w, h] = effectBox(18.4, 3.6, 1244.2, 30);
    assert.ok(x <= 0 && y <= 0 && x + w >= 1244.2 && y + h >= 30, 'texture always covers the layer');
});

test('auto layout: islands while an app is maximized, swapped when inverted', () => {
    const win = (horizontal, vertical, minimized = false) => ({visible: true, normal: true, monitor: 0, minimized, horizontal, vertical});
    const maximized = [win(true, true)], small = [win(false, false)], hidden = [win(true, true, true)];
    assert.equal(useIslands(maximized, 0), true);
    assert.equal(useIslands(small, 0), false);
    assert.equal(useIslands(maximized, 0, true), false, 'inverted: full bar over a maximized app');
    assert.equal(useIslands(small, 0, true), true, 'inverted: islands when nothing is maximized');
    assert.equal(useIslands(hidden, 0, true), true, 'a minimized maximized app does not count');
    assert.equal(useIslands([], 0, true), true);
});

test('border, shadow, text size and popup surfaces follow their own preferences', () => {
    const css = buildCss({...defaults, 'border-color': '#ff0000', 'border-width': 2, 'border-opacity': 50,
        'shadow-color': '#0000ff', 'shadow-size': 30, 'shadow-opacity': 40, 'text-size': 120,
        'popup-text-color': '#00ff00', 'popup-border-color': '#ffff00', 'popup-border-width': 3, 'popup-border-opacity': 20,
        'popup-shadow-color': '#ff00ff', 'popup-shadow-size': 36, 'popup-shadow-opacity': 50});
    assert.ok(css.includes('border: 2px solid rgba(255,0,0,0.5)'));
    assert.ok(css.includes('box-shadow: 0 10px 30px rgba(0,0,255,0.4)'));
    assert.ok(css.includes('font-size: 1.2em'));
    assert.ok(css.includes('border: 3px solid rgba(255,255,0,0.2)'));
    assert.ok(css.includes('box-shadow: 0 12px 36px 0 rgba(255,0,255,0.5)'));
    assert.match(css, /\.popup-menu-content[^}]*color: #00ff00/);
    const none = buildCss({...defaults, 'border-width': 0, 'popup-border-width': 0});
    assert.ok(none.includes('border: none'));
});

test('default shadows and borders stay as before', () => {
    const css = buildCss(defaults);
    for (const s of ['box-shadow: 0 4px 12px rgba(0,0,0,0.22)', 'box-shadow: 0 8px 24px 0 rgba(0,0,0,0.28)',
        'border: 1px solid rgba(237,237,237,0.15)', 'border: 1px solid rgba(237,237,237,0.13)'])
        assert.ok(css.includes(s), s);
});
