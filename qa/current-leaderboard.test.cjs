'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { currentLeaderboard } = require('../backend/railway/current-leaderboard.cjs');

const ms = date => Date.parse(date + 'T17:00:00Z'); // following midnight in Bangkok
function fixture() {
  const calls = [];
  const store = { leaderboard(...args) {
    calls.push(args);
    return [{ uid: 'private', display_name: 'private', score: '12' }];
  } };
  return { calls, store };
}

test('Free switches exactly at Sunday midnight on March 1', async () => {
  const { store, calls } = fixture();
  const boundary = ms('2026-02-28');
  await currentLeaderboard(store, 'free', 7, () => boundary - 1);
  await currentLeaderboard(store, 'free', 7, () => boundary);
  assert.deepEqual(calls, [
    ['free', ms('2026-02-21'), boundary, 7], ['free', boundary, ms('2026-03-07'), 7]
  ]);
});

test('VIP changes at New Year while the Free window stays anchored', async () => {
  const { store, calls } = fixture();
  const boundary = ms('2025-12-31');
  for (const mode of ['vip', 'free']) {
    for (const instant of [boundary - 1, boundary])
      await currentLeaderboard(store, mode, undefined, () => instant);
  }
  const week = ['free', ms('2025-12-27'), ms('2026-01-03'), 50];
  assert.deepEqual(calls, [
    ['vip', ms('2025-12-30'), boundary, 50], ['vip', boundary, ms('2026-01-01'), 50], week, week
  ]);
});

test('each read samples once, forwards the anchored window once and returns only scores', async () => {
  const { store, calls } = fixture();
  const instant = ms('2025-12-31');
  const window = { mode: 'vip', startMs: instant, endMs: ms('2026-01-01') };
  let ticks = 0;
  const clock = () => { ticks++; return instant; };
  for (let i = 1; i <= 2; i++) {
    assert.deepEqual(await currentLeaderboard(store, 'vip', 100, clock), { period: window, scores: ['12'] });
    assert.equal(ticks, i);
    assert.equal(calls.length, i);
    assert.deepEqual(calls[i - 1], ['vip', window.startMs, window.endMs, 100]);
  }
});

test('invalid store, mode, limit and clock fail before any read', async () => {
  const { store, calls } = fixture();
  await assert.rejects(currentLeaderboard({}, 'free'), /store/);
  await assert.rejects(currentLeaderboard(store, 'other'), /mode/);
  for (const limit of [0, 101, 1.5, '2', null])
    await assert.rejects(currentLeaderboard(store, 'vip', limit), /limit/);
  await assert.rejects(currentLeaderboard(store, 'vip', 1, 0), /clock/);
  for (const time of [undefined, -1, NaN, Number.MAX_SAFE_INTEGER])
    await assert.rejects(currentLeaderboard(store, 'free', 1, () => time), /epoch/);
  assert.deepEqual(calls, []);
});
