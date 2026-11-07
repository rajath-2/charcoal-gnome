import test from 'node:test';
import assert from 'node:assert/strict';
import {Gesture, wheelGeometry, wheelSelection, restoreBindings, QueryGeneration, surfaceCss} from '../extensions/charcoal-launchers@local/policy.js';

test('a short Super tap opens overview once', () => {
    const g = new Gesture();
    assert.equal(g.press(), true);
    assert.deepEqual(g.release(null), {type: 'tap'});
    assert.deepEqual(g.release('app'), {type: 'none'});
});
test('holding and releasing launches only the selected app', () => {
    const g = new Gesture(); g.press(); g.open();
    assert.equal(g.press(), false);
    assert.deepEqual(g.release('org.gnome.Calculator.desktop'), {type: 'launch', app: 'org.gnome.Calculator.desktop'});
    assert.deepEqual(g.release('app'), {type: 'none'});
});
test('neutral selection and cancellation never launch or open overview', () => {
    const g = new Gesture(); g.press(); g.open();
    assert.deepEqual(g.release(null), {type: 'none'});
    for (const open of [false, true]) {
        g.press(); if (open) g.open(); g.cancel();
        assert.deepEqual(g.release('app'), {type: 'none'});
    }
});
test('wheel remains inside a monitor including negative coordinates', () => {
    assert.deepEqual(wheelGeometry([0, 0], {x: 0, y: 0, width: 800, height: 600}, 160), {x: 172, y: 172, radius: 160});
    assert.deepEqual(wheelGeometry([-10, 400], {x: -800, y: 0, width: 800, height: 600}, 160), {x: -172, y: 400, radius: 160});
    const small = wheelGeometry([0, 0], {x: 0, y: 0, width: 200, height: 200}, 160);
    assert.deepEqual(small, {x: 100, y: 100, radius: 88});
});
test('wheel hit testing uses top-first clockwise sectors and neutral boundaries', () => {
    const geo = {x: 200, y: 200, radius: 160};
    assert.equal(wheelSelection(200, 200, geo, 4, 45), -1);
    assert.equal(wheelSelection(200, 100, geo, 4, 45), 0);
    assert.equal(wheelSelection(300, 200, geo, 4, 45), 1);
    assert.equal(wheelSelection(200, 300, geo, 4, 45), 2);
    assert.equal(wheelSelection(100, 200, geo, 4, 45), 3);
    assert.equal(wheelSelection(400, 200, geo, 4, 45), -1);
    assert.equal(wheelSelection(200, 100, geo, 0, 45), -1);
});
test('shortcut restoration preserves original order when unedited', () => {
    assert.deepEqual(restoreBindings(['<Super>space', 'XF86Keyboard'], ['XF86Keyboard'], ['XF86Keyboard']), ['<Super>space', 'XF86Keyboard']);
});
test('shortcut restoration preserves intervening user additions and removals', () => {
    assert.deepEqual(restoreBindings(['<Super>space', 'XF86Keyboard'], ['XF86Keyboard'], ['<Alt>space']), ['<Super>space', '<Alt>space']);
    assert.deepEqual(restoreBindings(['<Super>space'], [], ['<Super>space', '<Alt>space']), ['<Super>space', '<Alt>space']);
});
test('old provider responses are invalid after query replacement or close', () => {
    const gate = new QueryGeneration(); const first = gate.next();
    assert.equal(gate.current(first), true);
    const second = gate.next(); assert.equal(gate.current(first), false);
    assert.equal(gate.current(second), true);
    gate.next(); assert.equal(gate.current(second), false);
});

test('dock rings retain favorites and add running apps without duplicates', async () => {
    const {appRings} = await import('../extensions/charcoal-launchers@local/policy.js');
    assert.deepEqual(appRings(['a','b'], ['b','c','d','e'], true, 2), [['a','b'],['c','d'],['e']]);
    assert.deepEqual(appRings(['a'], ['b'], false, 2), [['a']]);
    assert.deepEqual(appRings([], ['a','b','c'], true, 2), [['a','b'],['c']]);
});

test('touchpad wheel: hold opens, slide aims within the wheel, lift launches', async () => {
    const {TouchpadWheel} = await import('../extensions/charcoal-launchers@local/policy.js');
    const pad = new TouchpadWheel();
    assert.equal(pad.hold('begin'), 'start-timer');
    assert.equal(pad.timer(), 'open');
    assert.equal(pad.hold('cancel'), 'none', 'fingers starting to move keep the wheel open');
    assert.equal(pad.swipe('begin'), 'aim');
    assert.equal(pad.swipe('update', 30, 40, 1000), 'aim');
    assert.deepEqual(pad.offset, [30, 40]);
    pad.swipe('update', 300, 400, 100);
    assert.ok(Math.abs(Math.hypot(...pad.offset) - 100) < 1e-9, 'aim stays inside the wheel');
    assert.equal(pad.swipe('end'), 'launch');
    assert.equal(pad.state, 'idle');
});

test('touchpad wheel: quick swipes stay with GNOME, lifting without sliding cancels', async () => {
    const {TouchpadWheel} = await import('../extensions/charcoal-launchers@local/policy.js');
    const pad = new TouchpadWheel();
    pad.hold('begin');
    assert.equal(pad.swipe('begin'), 'stop-timer', 'moved before the delay: a normal workspace swipe');
    assert.equal(pad.timer(), 'none');
    assert.equal(pad.swipe('update', 10, 0), 'none');
    pad.hold('begin');
    assert.equal(pad.hold('end'), 'stop-timer', 'tap-and-lift before the delay does nothing');
    pad.hold('begin'); pad.timer();
    assert.equal(pad.hold('end'), 'close', 'lifted without sliding');
});

test('window previews sit just outside the wheel in the hovered direction, inside the monitor', async () => {
    const {previewPlacement} = await import('../extensions/charcoal-launchers@local/policy.js');
    const monitor = {x: 0, y: 0, width: 1920, height: 1080};
    const up = previewPlacement([960, 540], -Math.PI / 2, 120, [300, 100], monitor);
    assert.deepEqual(up, {x: 810, y: 540 - 120 - 12 - 100});
    const right = previewPlacement([960, 540], 0, 120, [300, 100], monitor);
    assert.deepEqual(right, {x: 960 + 132, y: 490});
    const clamped = previewPlacement([1900, 1060], 0, 120, [300, 100], monitor);
    assert.deepEqual(clamped, {x: 1920 - 300 - 8, y: 1080 - 100 - 8});
});

test('the pointer picks by direction: overshooting or ring gaps still select, only the centre cancels', async () => {
    const {pickSector} = await import('../extensions/charcoal-launchers@local/policy.js');
    const center = {x: 500, y: 500};
    const rings = [{inner: 36, outer: 120, count: 4}, {inner: 125, outer: 188, count: 8}];
    assert.equal(pickSector(500, 480, center, rings), null, 'centre cancels');
    assert.deepEqual(pickSector(500, 420, center, rings), {ring: 0, sector: 0}, 'inside the first ring, top');
    assert.deepEqual(pickSector(500, 500 - 122, center, rings), {ring: 1, sector: 0}, 'gap between rings belongs to the outer ring');
    assert.deepEqual(pickSector(500, 100, center, rings), {ring: 1, sector: 0}, 'far beyond the wheel: outermost ring, same direction');
    assert.deepEqual(pickSector(900, 500, center, rings), {ring: 1, sector: 2}, 'beyond, to the right');
    assert.deepEqual(pickSector(900, 500, center, [rings[0]]), {ring: 0, sector: 1}, 'single ring: beyond picks it');
});

test('search and wheel surfaces take their own border, shadow and text size', () => {
    const base = {'background-color': '#202127', 'foreground-color': '#f0f0f2', 'corner-radius': 20, 'background-opacity': 94,
        'border-color': '#ffffff', 'border-width': 1, 'border-opacity': 12, 'shadow-color': '#000000', 'shadow-size': 32,
        'shadow-opacity': 30, 'text-size': 100};
    const css = surfaceCss(base);
    for (const s of ['background-color: rgba(32,33,39,0.94)', 'border: 1px solid rgba(255,255,255,0.12)',
        'box-shadow: 0 12px 32px 2px rgba(0,0,0,0.3)', 'font-size: 1em', 'border-radius: 20px'])
        assert.ok(css.includes(s), s);
    const custom = surfaceCss({...base, 'border-width': 0, 'shadow-size': 0, 'text-size': 125, 'foreground-color': 'bad'});
    assert.ok(custom.includes('border: none') && custom.includes('box-shadow: none') && custom.includes('font-size: 1.25em'));
    assert.ok(custom.includes('color: #808080'));
});
