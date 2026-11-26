'use strict';

const { getPeriod } = require('../storage/score-periods.cjs');

async function currentLeaderboard(store, mode, limit = 50, clock = Date.now) {
  if (typeof store?.leaderboard !== 'function') throw Error('Invalid leaderboard store');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid leaderboard limit');
  if (typeof clock !== 'function') throw Error('Invalid leaderboard clock');
  const nowMs = clock();
  if (!Number.isSafeInteger(nowMs) || !Number.isFinite(new Date(nowMs).getTime()))
    throw Error('Invalid epoch milliseconds');
  const period = getPeriod(mode, nowMs);
  if (!Number.isSafeInteger(period.startMs) || !Number.isSafeInteger(period.endMs))
    throw Error('Invalid leaderboard period');
  const rows = await store.leaderboard(mode, period.startMs, period.endMs, limit);
  return { period, scores: rows.map(row => row.score) };
}

module.exports = { currentLeaderboard };
