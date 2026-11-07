import test from 'node:test';
import assert from 'node:assert/strict';
import {Gesture, wheelGeometry, wheelSelection, restoreBindings, QueryGeneration} from '../extensions/charcoal-launchers@local/policy.js';

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
