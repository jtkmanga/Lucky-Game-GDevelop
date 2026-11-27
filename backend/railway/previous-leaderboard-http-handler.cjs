'use strict';

const { previousPeriod } = require('../storage/score-periods.cjs');
const { historicalLeaderboard } = require('./historical-leaderboard.cjs');
const { createProtectedLeaderboardRead } = require('./leaderboard-http-handler.cjs');

// Source-only: deliberately not mounted by the dispatcher. Only the server's
// immediately preceding Bangkok period is readable; caller dates are ignored.
function createPreviousLeaderboardHandler({ verifyIdentity, store, clock = Date.now }) {
  return createProtectedLeaderboardRead({ verifyIdentity, store,
    read(mode) {
      const nowMs = clock();
      return historicalLeaderboard(store, previousPeriod(mode, nowMs), () => nowMs);
    }
  });
}

module.exports = { createPreviousLeaderboardHandler };
