'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { historicalLeaderboard } = require('../backend/railway/historical-leaderboard.cjs');

test('Free week and VIP day are readable exactly at Bangkok close', async () => {
  const endMs = Date.parse('2026-03-01T00:00:00+07:00');
  for (const [mode, days] of [['free', 7], ['vip', 1]]) {
    const startMs = endMs - days * 86400000;
    const window = { mode, startMs, endMs };
    const calls = [];
    const store = { leaderboard(...args) { calls.push(args); return []; } };
    for (const instant of [startMs - 1, endMs - 1])
      await assert.rejects(historicalLeaderboard(store, window, () => instant), /closed/);
    for (const invalid of [{ ...window, startMs: startMs + 1 }, { ...window, endMs: endMs - 1 }])
      await assert.rejects(historicalLeaderboard(store, invalid, () => endMs), /Invalid historical window/);
    assert.deepEqual(calls, []);
    let ticks = 0;
    assert.deepEqual(await historicalLeaderboard(store, window, () => { ticks++; return endMs; }),
      { provisional: true, period: window, rows: [] });
    assert.equal(ticks, 1);
    assert.deepEqual(calls, [[mode, startMs, endMs]]);
  }
});

test('a fresh read sees a late committed in-window score and excludes the upper endpoint', async () => {
  const startMs = Date.parse('2026-01-01T00:00:00+07:00'), endMs = startMs + 86400000;
  const window = { mode: 'vip', startMs, endMs };
  const entries = [[startMs - 1, 50], [startMs, 10], [endMs, 100]];
  const store = { leaderboard(mode, lo, hi) {
    assert.deepEqual([mode, lo, hi], ['vip', startMs, endMs]);
    const total = entries.filter(([at]) => lo <= at && at < hi).reduce((n, [, points]) => n + points, 0);
    return [{ uid: 'private', display_name: 'private', score: String(total) }];
  } };
  const read = () => historicalLeaderboard(store, window, () => endMs + 1000);
  const first = await read();
  entries.push([endMs - 1, 5]); // Simulate a newly visible commit for the same player.
  const second = await read();
  assert.deepEqual(first.rows, [['🥇', '👤', 'ผู้เล่น', '10']]);
  assert.deepEqual(second, { provisional: true, period: window, rows: [['🥇', '👤', 'ผู้เล่น', '15']] });
});
