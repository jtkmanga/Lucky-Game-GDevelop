'use strict';

const { isDeepStrictEqual } = require('node:util');
const { previousPeriod } = require('../storage/score-periods.cjs');
const { historicalLeaderboard } = require('./historical-leaderboard.cjs');
const { createProtectedLeaderboardRead } = require('./leaderboard-http-handler.cjs');
const { v12LeaderboardRows } = require('./v12-leaderboard-rows.cjs');

const readArchive = `SELECT mode, period_start_ms, period_end_ms, snapshot
FROM game.leaderboard_archives WHERE mode=$1 AND period_start_ms=$2 LIMIT 2`;

function normalizedSnapshot(snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length>50) throw Error('INVALID_ARCHIVE_SNAPSHOT');
  const expected=v12LeaderboardRows({scores: Array.from(snapshot,row=>row?.[3])});
  if (!isDeepStrictEqual(snapshot,expected)) throw Error('INVALID_ARCHIVE_SNAPSHOT');
  for (let i=1;i<expected.length;i++) {
    if (BigInt(expected[i-1][3])<BigInt(expected[i][3])) throw Error('INVALID_ARCHIVE_ORDER');
  }
  return expected;
}

// Deliberately unmounted. Trusted bootstrap must supply a separately verified
// archive-only reader with full RLS visibility for this period. The current
// gameplay pool cannot distinguish invisible archive rows from real absence.
function createArchivedPreviousLeaderboardCandidate({verifyIdentity,store,archivePool,clock=Date.now}) {
  if (typeof archivePool?.query!=='function') throw Error('ARCHIVE_READER_REQUIRED');
  return createProtectedLeaderboardRead({verifyIdentity,store,async read(mode) {
    const nowMs=clock();
    const period=previousPeriod(mode,nowMs);
    const result=await archivePool.query(readArchive,[mode,period.startMs]);
    if (!Array.isArray(result?.rows) || result.rows.length>1) throw Error('INVALID_ARCHIVE_ROWS');
    if (!result.rows.length) return historicalLeaderboard(store,period,()=>nowMs);
    const row=result.rows[0];
    if (row?.mode!==mode || row.period_start_ms!==String(period.startMs) ||
        row.period_end_ms!==String(period.endMs)) throw Error('ARCHIVE_PERIOD_MISMATCH');
    // A stored snapshot alone cannot attest all writers were fenced. Expose
    // provenance in the laboratory while retaining the existing public warning.
    return {provisional:true,source:'archive',period,rows:normalizedSnapshot(row.snapshot)};
  }});
}

module.exports = { createArchivedPreviousLeaderboardCandidate };
