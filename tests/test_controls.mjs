import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {nextWheelState, pickWheelItem, clampWheel, releaseSelection, themeItems} from '../extensions/charcoal-controls@local/policy.js';
import {requiresConfirmation, dispatchAction} from '../extensions/charcoal-controls@local/actions.js';

test('control wheel navigation and safe selection', () => {
    let state = nextWheelState('closed', 'open');
    assert.equal(state, 'actions');
    state = nextWheelState(state, 'themes');
    assert.equal(state, 'themes');
    assert.equal(nextWheelState(state, 'back'), 'actions');
    assert.equal(nextWheelState(state, 'close'), 'closed');
    assert.equal(nextWheelState('actions', 'confirm'), 'confirm');
    const geometry = clampWheel(20, 20, {x: 0, y: 0, width: 800, height: 600}, 160);
    assert.deepEqual([geometry.x, geometry.y], [160, 160]);
    assert.equal(pickWheelItem(geometry.x, geometry.y, geometry, ['one']), null);
    assert.equal(pickWheelItem(geometry.x + 300, geometry.y, geometry, ['one']), null);
    assert.equal(pickWheelItem(geometry.x, geometry.y - 100, geometry, []), null);
    assert.equal(pickWheelItem(geometry.x, geometry.y - 100, geometry, ['one']), 'one');
});

test('theme list keeps stable IDs and active marker', () => {
    assert.deepEqual(themeItems([{id: 'night', name: 'Night'}, {id: 'day', name: 'Day'}], 'night'),
        [['night', '● Night'], ['day', 'Day']]);
    assert.deepEqual(themeItems([], ''), []);
});

test('destructive actions require confirmation and dispatch once', async () => {
    for (const id of ['logout', 'restart', 'poweroff']) assert.equal(requiresConfirmation(id), true);
    for (const id of ['lock', 'suspend', 'note', 'settings']) assert.equal(requiresConfirmation(id), false);
    const called = [];
    const services = Object.fromEntries(['lock', 'suspend', 'note', 'settings', 'logout', 'restart', 'poweroff']
        .map(id => [id, async () => called.push(id)]));
    await dispatchAction('restart', services, false);
    assert.deepEqual(called, []);
    await dispatchAction('restart', services, true);
    assert.deepEqual(called, ['restart']);
});

test('only deliberate matching press and release selects once', () => {
    assert.equal(releaseSelection('note', 'note', false), 'note');
    assert.equal(releaseSelection('note', 'poweroff', false), null);
    assert.equal(releaseSelection('note', 'note', true), null);
    assert.equal(releaseSelection(null, 'note', false), null);
});

test('prefs entry rows show an apply button so edits save', () => {
    const prefs = readFileSync(new URL('../extensions/charcoal-controls@local/prefs.js', import.meta.url), 'utf8');
    const rows = prefs.match(/new Adw\.EntryRow\(\{[^}]*\}\)/g);
    assert.equal(rows.length, 2);
    for (const row of rows) assert.match(row, /show_apply_button: true/);
});
