const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(__dirname, '..', 'wedding-day-now.js'), 'utf8'), sandbox);
const { getState } = sandbox.window.WeddingDayNow;
const events = [
  { id: 'first', start: '05:30', end: '06:00' },
  { id: 'second', start: '06:00', end: '07:00' },
  { id: 'overlap', start: '06:30', end: '08:00' },
  { id: 'arrival', start: '07:00', end: null },
  { id: 'last', start: '23:00', end: '23:45' }
];
const at = time => new Date(`2026-11-12T${time}:00+08:00`);
const ids = rows => Array.from(rows, e => e.id);

test('before the wedding: no fictional current task and two upcoming events', () => {
  const state = getState(events, new Date('2026-09-22T12:00:00Z'));
  assert.equal(state.phase, 'before');
  assert.deepEqual(ids(state.current), []);
  assert.deepEqual(ids(state.next), ['first', 'second']);
});

test('Hong Kong time wins even when UTC is still the previous date', () => {
  const state = getState(events, new Date('2026-11-11T21:45:00Z'));
  assert.deepEqual(ids(state.current), ['first']);
  assert.deepEqual(ids(state.next), ['second', 'overlap']);
});

test('task starts are inclusive, task ends exclusive, and overlaps remain visible', () => {
  assert.deepEqual(ids(getState(events, at('06:00')).current), ['second']);
  assert.deepEqual(ids(getState(events, at('06:45')).current), ['second', 'overlap']);
  assert.deepEqual(ids(getState(events, at('06:45')).next), ['arrival', 'last']);
});

test('milestones have no invented duration after their scheduled minute', () => {
  assert.deepEqual(ids(getState(events, at('07:00')).current), ['overlap', 'arrival']);
  assert.deepEqual(ids(getState(events, at('07:01')).current), ['overlap']);
  assert.deepEqual(ids(getState(events, at('07:01')).next), ['last']);
});

test('a gap does not keep an earlier task current', () => {
  const state = getState(events, at('10:00'));
  assert.deepEqual(ids(state.current), []);
  assert.deepEqual(ids(state.next), ['last']);
});

test('no current or upcoming task remains after the day ends', () => {
  for (const now of [at('23:45'), new Date('2026-11-13T00:01:00+08:00')]) {
    const state = getState(events, now);
    assert.equal(state.phase, 'after');
    assert.deepEqual(ids(state.current), []);
    assert.deepEqual(ids(state.next), []);
  }
});

test('empty and selected-team event sets cannot leak other teams into next tasks', () => {
  const state = getState([events[2], events[4]], at('05:30'));
  assert.deepEqual(ids(state.current), []);
  assert.deepEqual(ids(state.next), ['overlap', 'last']);
  assert.deepEqual(ids(getState([], at('09:00')).current), []);
  assert.deepEqual(ids(getState([], at('09:00')).next), []);
});
