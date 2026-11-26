'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { v12LeaderboardRows } = require('../backend/railway/v12-leaderboard-rows.cjs');
const period = { mode: 'free', startMs: 0, endMs: 604800000 };

test('anonymous v12 tuples preserve rank, ties and exact bigint score text', () => {
  const scores = Object.freeze(['9223372036854775807', '9007199254740993', '9007199254740993', 0]);
  assert.deepEqual(v12LeaderboardRows({ period, scores, uid: 'private', name: 'private' }), [
    ['🥇', '👤', 'ผู้เล่น', '9223372036854775807'], ['🥈', '👤', 'ผู้เล่น', '9007199254740993'],
    ['🥉', '👤', 'ผู้เล่น', '9007199254740993'], ['4', '👤', 'ผู้เล่น', '0']
  ]);
});

test('empty scores select the existing empty-state rendering path', () => {
  assert.deepEqual(v12LeaderboardRows({ period, scores: [] }), []);
});

test('malformed lists, unsafe numbers and noncanonical score text fail closed', () => {
  for (const scores of [null, {}, Array(1), [null], [{ score: '1', uid: 'private' }],
    [Number.MAX_SAFE_INTEGER + 1], [-1], [0.5], ['9223372036854775808'], ['01'],
    ['1e2'], ['12\n'], ['<b>1</b>']])
    assert.throws(() => v12LeaderboardRows({ period, scores }), TypeError);
});
