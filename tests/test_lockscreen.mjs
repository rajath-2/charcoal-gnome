import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ELEMENTS, MIN_PROMPT, layoutLockElements, safePromptRect, readStyle, DEFAULT_STYLE, DEFAULT_LAYOUT}
    from '../extensions/charcoal-lockscreen@local/policy.js';

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

test('prompt outside the monitor is pulled back with minimum size', () => {
    const m = mon(-1920, 0, 1920, 1080);
    for (const req of [{x: 5000, y: -400, width: 10, height: 10}, {x: NaN, y: 'a'}, null, undefined]) {
        const r = safePromptRect(req, m);
        assert.ok(inside(r, m), JSON.stringify(req));
        assert.ok(r.width >= MIN_PROMPT.width && r.height >= MIN_PROMPT.height);
    }
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
});
