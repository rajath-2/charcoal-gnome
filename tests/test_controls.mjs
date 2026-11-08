import assert from 'node:assert/strict';
import test from 'node:test';
import {nextWheelState, pickWheelItem, clampWheel, releaseSelection} from '../extensions/charcoal-controls@local/policy.js';

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

test('only deliberate matching press and release selects once', () => {
    assert.equal(releaseSelection('note', 'note', false), 'note');
    assert.equal(releaseSelection('note', 'poweroff', false), null);
    assert.equal(releaseSelection('note', 'note', true), null);
    assert.equal(releaseSelection(null, 'note', false), null);
});
