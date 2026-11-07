import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCss} from '../extensions/charcoal-topbar@local/theme.js';
import {morphRects, morphShapes} from '../extensions/charcoal-topbar@local/morph.js';

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
