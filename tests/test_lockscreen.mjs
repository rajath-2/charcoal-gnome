import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ELEMENTS, MIN_PROMPT, layoutLockElements, safePromptRect, readStyle, readElementStyle, DEFAULT_STYLE, DEFAULT_LAYOUT,
    readValues, previewPlacements, chooseWallpaper} from '../extensions/charcoal-lockscreen@local/policy.js';
import {THEME_KEYS} from '../extensions/charcoal-themes@local/catalog.js';
import {validateProfile} from '../extensions/charcoal-themes@local/profile.js';
import {resolveValue} from '../shared/theme-policy.js';

const mon = (x, y, width, height) => ({x, y, width, height});
const inside = (r, m) => r.x >= m.x && r.y >= m.y && r.x + r.width <= m.x + m.width && r.y + r.height <= m.y + m.height;

test('normal placement scales normalized coordinates to the primary monitor', () => {
    const p = layoutLockElements({clock: {x: 0.5, y: 0.25, w: 0.2, h: 0.1}}, [mon(0, 0, 1000, 800)], 0);
    assert.deepEqual([p.clock.x, p.clock.y, p.clock.width, p.clock.height], [500, 200, 200, 80]);
    assert.equal(p.clock.visible, true);
});

test('negative-coordinate monitors offset correctly', () => {
    const m = [mon(0, 0, 1000, 800), mon(-1920, -100, 1920, 1080)];
    const p = layoutLockElements({clock: {x: 0.5, y: 0.5, w: 0.1, h: 0.1}}, m, 1);
    assert.equal(p.clock.x, -960);
    assert.equal(p.clock.y, 440);
    assert.equal(p.clock.monitor, 1);
});

test('removed monitor falls back to primary, then first; no monitors gives nothing', () => {
    const m = [mon(0, 0, 1000, 800)];
    assert.equal(layoutLockElements({clock: {x: 0, y: 0, monitor: 5}}, m, 0).clock.monitor, 0);
    assert.equal(layoutLockElements({clock: {x: 0, y: 0}}, m, 9).clock.monitor, 0);
    assert.deepEqual(layoutLockElements({clock: {}}, [], 0), {});
});

test('prompt cannot be hidden; text and image are hidden by default', () => {
    const p = layoutLockElements({prompt: {visible: false}, clock: {visible: false}}, [mon(0, 0, 1000, 800)], 0);
    assert.equal(p.prompt.visible, true);
    assert.equal(p.clock.visible, false);
    assert.equal(p.text.visible, false);
    assert.equal(p.image.visible, false);
    assert.deepEqual([...ELEMENTS].sort(), ['clock', 'date', 'image', 'notifications', 'prompt', 'status', 'text', 'user']);
    for (const e of ELEMENTS) assert.ok(DEFAULT_LAYOUT[e]);
});

test('prompt partly off the monitor is clamped with minimum size', () => {
    const m = mon(-1920, 0, 1920, 1080);
    const r = safePromptRect({x: -100, y: 1000, width: 10, height: 10}, m);
    assert.ok(inside(r, m));
    assert.ok(r.width >= MIN_PROMPT.width && r.height >= MIN_PROMPT.height);
});

test('invalid or fully off-screen prompt falls back to GNOME position (null)', () => {
    const m = mon(-1920, 0, 1920, 1080);
    for (const req of [{x: 5000, y: 0, width: 300, height: 150}, {x: -1920, y: -900, width: 300, height: 150},
        {x: NaN, y: 'a'}, {x: 0, y: 0}, null, undefined])
        assert.equal(safePromptRect(req, m), null, JSON.stringify(req));
    assert.equal(layoutLockElements({}, [mon(0, 0, 0, 0)], 0).prompt, null);
});

test('too-small screen shrinks the prompt to the monitor, never beyond', () => {
    const m = mon(10, 20, 200, 90);
    const r = safePromptRect({x: 0, y: 0, width: 900, height: 900}, m);
    assert.deepEqual(r, {x: 10, y: 20, width: 200, height: 90});
});

test('invalid style values return defaults and never throw', () => {
    const s = readStyle({'text-color': 'bogus', 'accent-color': 'rgb(1,2,3)', 'font-weight': 450, 'font-size': NaN,
        'font-family': 'x;}{', 'border-width': -5, 'shadow-size': 1e9, spacing: 'a', 'lock-wallpaper': 5});
    assert.equal(s['text-color'], DEFAULT_STYLE['text-color']);
    assert.equal(s['font-weight'], DEFAULT_STYLE['font-weight']);
    assert.equal(s['font-size'], DEFAULT_STYLE['font-size']);
    assert.equal(s['font-family'], DEFAULT_STYLE['font-family']);
    assert.equal(s['border-width'], 0);
    assert.ok(s['shadow-size'] <= 64);
    assert.equal(s.spacing, DEFAULT_STYLE.spacing);
    assert.equal(s['lock-wallpaper'], '');
    assert.doesNotThrow(() => readStyle(null));
    assert.equal(readStyle({'text-color': '#ABCDEF', 'font-weight': 700, 'font-size': 30})['font-weight'], 700);
});

test('schema defaults agree with policy defaults', () => {
    const xml = readFileSync(new URL('../extensions/charcoal-lockscreen@local/schemas/org.gnome.shell.extensions.charcoal-lockscreen.gschema.xml', import.meta.url), 'utf8');
    const d = Object.fromEntries([...xml.matchAll(/<key name="([^"]+)" type="(.)">\s*<default>([^<]*)<\/default>/g)]
        .map(([, k, t, v]) => [k, t === 's' ? v.slice(1, -1) : t === 'b' ? v === 'true' : Number(v)]));
    for (const [k, v] of Object.entries(DEFAULT_STYLE)) assert.equal(d[k], v, k);
    for (const e of ELEMENTS) {
        const l = DEFAULT_LAYOUT[e];
        for (const f of ['x', 'y', 'w', 'h']) assert.equal(d[`${e}-${f}`], l[f], `${e}-${f}`);
        if (e !== 'prompt') assert.equal(d[`${e}-visible`], l.visible, `${e}-visible`);
    }
    assert.equal(d['text-content'], '');
    assert.equal(d['image-uri'], '');
    assert.equal(d['element-styles'], '{}');
});

test('per-element style: overrides, per-field fallback, malformed input', () => {
    const g = readStyle({});
    const json = JSON.stringify({clock: {'font-size': 90, color: '#112233', align: 'end', 'font-weight': 450,
        'border-color': 'red', 'shadow-size': 1e9, 'font-family': 'x;}'}});
    const s = readElementStyle(g, json, 'clock');
    assert.equal(s['font-size'], 90);
    assert.equal(s.color, '#112233');
    assert.equal(s.align, 'end');
    assert.equal(s['font-weight'], g['font-weight']);
    assert.equal(s['border-color'], g['accent-color']);
    assert.equal(s['shadow-size'], 64);
    assert.equal(s['font-family'], g['font-family']);
    const base = readElementStyle(g, '{}', 'date');
    assert.equal(base.align, 'center');
    assert.equal(base.color, g['text-color']);
    for (const bad of ['{nope', '[]', 'null', '5', undefined, null])
        assert.deepEqual(readElementStyle(g, bad, 'clock'), base);
    assert.deepEqual(readElementStyle(g, json, 'bogus'), base);
    assert.deepEqual(readElementStyle(g, '{"date":5}', 'date'), base);
    for (const a of ['start', 'center', 'end']) assert.equal(readElementStyle(g, `{"user":{"align":"${a}"}}`, 'user').align, a);
    assert.equal(readElementStyle(g, '{"user":{"align":"left"}}', 'user').align, 'center');
});

const SCHEMA = readFileSync(new URL('../extensions/charcoal-lockscreen@local/schemas/org.gnome.shell.extensions.charcoal-lockscreen.gschema.xml', import.meta.url), 'utf8');
const KEYS = Object.fromEntries([...SCHEMA.matchAll(/<key name="([^"]+)" type="(.)">([\s\S]*?)<\/key>/g)].map(([, k, t, body]) => {
    const raw = body.match(/<default>([^<]*)<\/default>/)[1], range = body.match(/<range min="([^"]+)" max="([^"]+)"\/>/);
    return [k, {type: t, value: t === 's' ? raw.slice(1, -1) : t === 'b' ? raw === 'true' : Number(raw),
        range: range && [Number(range[1]), Number(range[2])]}];
}));
const DEFAULTS = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, v.value]));
// GSettings-style source resolving each key the way ThemeClient does.
const source = get => ({get_double: get, get_int: get, get_string: get, get_boolean: get});
const themed = (local, theme, overrides, activationId) => source(key =>
    resolveValue({key, local: local[key], theme: theme[key], linked: true, overrideActivation: overrides, activationId}));
const MON = [mon(0, 0, 1920, 1080)];

test('catalog lockscreen section matches the schema; decorative text stays personal', () => {
    const rules = THEME_KEYS.lockscreen;
    assert.ok(rules, 'lockscreen section');
    assert.equal(rules['text-content'], undefined);
    for (const key of ['follow-theme', 'override-activations', 'status']) assert.equal(rules[key], undefined, key);
    const expect = {s: ['text', 'color', 'json'], b: ['boolean'], i: ['integer'], d: ['number']};
    for (const [key, {type, range}] of Object.entries(KEYS)) {
        if (['text-content', 'follow-theme', 'override-activations', 'status'].includes(key)) continue;
        const rule = rules[key];
        assert.ok(rule, `missing ${key}`);
        assert.ok(expect[type].includes(rule.type), `${key}: ${rule.type}`);
        if (range) assert.deepEqual([rule.min, rule.max], range, key);
        assert.ok(validateProfile({version: 1, id: 't', name: 'T', components: {lockscreen: {[key]: DEFAULTS[key]}}}).ok, key);
    }
    for (const key of Object.keys(rules)) assert.ok(KEYS[key], `catalog key not in schema: ${key}`);
    assert.equal(rules['element-styles'].type, 'json');
    assert.equal(rules['lock-wallpaper'].type, 'text');
    for (const [key, value] of [['clock-x', 1.5], ['clock-w', 0], ['clock-y', '0.2'], ['font-size', 300], ['text-content', 'hi']])
        assert.equal(validateProfile({version: 1, id: 't', name: 'T', components: {lockscreen: {[key]: value}}}).ok, false, key);
});

test('themed layout resolves through policy; local override is dormant after a switch and restorable', () => {
    const local = {...DEFAULTS, 'clock-y': 0.1};
    const theme = {'clock-y': 0.4, 'font-size': 48};
    const clockY = (overrides, activation) => layoutLockElements(readValues(themed(local, theme, overrides, activation)).elements, MON, 0).clock.y;
    assert.equal(clockY({}, 'a'), Math.round(0.4 * 1080), 'theme wins when linked');
    assert.equal(readValues(themed(local, theme, {}, 'a')).style['font-size'], 48);
    assert.equal(clockY({'clock-y': 'a'}, 'a'), Math.round(0.1 * 1080), 'override wins');
    assert.equal(clockY({'clock-y': 'a'}, 'b'), Math.round(0.4 * 1080), 'override dormant after switch');
    assert.equal(clockY({'clock-y': 'b'}, 'b'), Math.round(0.1 * 1080), 'override restored');
    const unlinked = source(key => local[key]);
    assert.equal(layoutLockElements(readValues(unlinked).elements, MON, 0).clock.y, Math.round(0.1 * 1080));
    assert.equal(readValues(unlinked).elements.prompt.visible, true, 'prompt has no visible key and is always shown');
});

test('missing lock wallpaper keeps the previous background and reports an error', () => {
    assert.deepEqual(chooseWallpaper('', null, 'file:///old.png'), {uri: null, error: ''});
    assert.deepEqual(chooseWallpaper('/new.png', 'file:///new.png', 'file:///old.png'), {uri: 'file:///new.png', error: ''});
    const missing = chooseWallpaper('/gone.png', null, 'file:///old.png');
    assert.equal(missing.uri, 'file:///old.png');
    assert.match(missing.error, /gone\.png/);
    assert.equal(chooseWallpaper('/gone.png', null, null).uri, null);
});

test('preferences preview uses the shell layout policy (parity)', () => {
    const values = readValues(themed({...DEFAULTS, 'clock-x': 0.62, 'prompt-y': 0.97, 'text-visible': true}, {'date-w': 0.5}, {}, 'a'));
    const monitor = {width: 2560, height: 1440};
    const shell = layoutLockElements(values.elements, [{x: 0, y: 0, ...monitor}], 0);
    assert.deepEqual(previewPlacements(values, monitor, 1), shell);
    const small = previewPlacements(values, monitor, 0.25);
    for (const name of ELEMENTS) {
        for (const f of ['x', 'y', 'width', 'height']) assert.equal(small[name][f], shell[name][f] * 0.25, `${name}.${f}`);
        assert.equal(small[name].visible, shell[name].visible);
    }
    const prefs = readFileSync(new URL('../extensions/charcoal-lockscreen@local/prefs.js', import.meta.url), 'utf8');
    assert.match(prefs, /import \{[^}]*\breadValues\b[^}]*\bpreviewPlacements\b[^}]*\} from '\.\/policy\.js'/);
    assert.match(prefs, /new ThemeClient\('lockscreen'/);
    assert.match(prefs, /attachThemeControls\(window, [^,]+, settings, 'lockscreen'\)/);
    const shellSource = readFileSync(new URL('../extensions/charcoal-lockscreen@local/extension.js', import.meta.url), 'utf8');
    assert.match(shellSource, /import \{[^}]*\breadValues\b[^}]*\blayoutLockElements\b[^}]*\} from '\.\/policy\.js'/);
    assert.match(shellSource, /new ThemeClient\('lockscreen', this\._settings\)/);
});
