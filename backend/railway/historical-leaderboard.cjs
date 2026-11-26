'use strict';

const { getPeriod } = require('../storage/score-periods.cjs');
const { v12LeaderboardRows } = require('./v12-leaderboard-rows.cjs');

// Provisional ledger view: later commits can change scores for this closed period.
async function historicalLeaderboard(store, { mode, startMs, endMs }, clock = Date.now) {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs))
    throw Error('Invalid historical window');
  const period = getPeriod(mode, startMs);
  if (period.startMs !== startMs || period.endMs !== endMs)
    throw Error('Invalid historical window');
  const nowMs = clock();
  if (!Number.isSafeInteger(nowMs) || !Number.isFinite(new Date(nowMs).getTime()) || nowMs < endMs)
    throw Error('Historical window must be closed');
  const records = await store.leaderboard(mode, startMs, endMs);
  const rows = v12LeaderboardRows({ scores: records.map(record => record.score) });
  return { provisional: true, period, rows };
}

module.exports = { historicalLeaderboard };
