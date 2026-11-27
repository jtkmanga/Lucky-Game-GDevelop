'use strict';

const { createProtectedLeaderboardRead } = require('./leaderboard-http-handler.cjs');
const { currentLeaderboard } = require('./current-leaderboard.cjs');
const { v12LeaderboardRows } = require('./v12-leaderboard-rows.cjs');

// Dormant: the caller must provide a separate pool authenticated as the
// scoped reader on a verified isolated test DB. Never fall back to store.
function createIsolatedTestLeaderboard({ verifyIdentity, store, scopedPool, clock = Date.now, limit = 50 }) {
  const scopedStore = {
    async leaderboard(mode, start, end, count) {
      const result = await scopedPool.query(
        'SELECT score::text AS score FROM lucky_rank_qa.read_current($1::text,$2::bigint,$3::bigint,$4::integer) WITH ORDINALITY ORDER BY ordinality',
        [mode, start, end, count]);
      return result.rows;
    },
  };
  return createProtectedLeaderboardRead({ verifyIdentity, store,
    read: async mode => ({ rows: v12LeaderboardRows(await currentLeaderboard(scopedStore, mode, limit, clock)) })
  });
}

module.exports = { createIsolatedTestLeaderboard };
