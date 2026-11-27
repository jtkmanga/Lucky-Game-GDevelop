'use strict';

const { requireRoomAccess } = require('../auth/room-access.cjs');
const { currentLeaderboard } = require('./current-leaderboard.cjs');
const { v12LeaderboardRows } = require('./v12-leaderboard-rows.cjs');

// Called only after the dispatcher selects the leaderboard path. No listener or provider setup.
function createProtectedLeaderboardRead({ verifyIdentity, store, read }) {
  return async function leaderboard(req, res) {
    function reply(status, data, headers = {}) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store', ...headers });
      res.end(JSON.stringify(data));
    }
    if (req.method !== 'GET') return reply(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    const query = new URLSearchParams(req.url.split('?').slice(1).join('?'));
    const modes = query.getAll('mode');
    if (modes.length !== 1 || !['free', 'vip'].includes(modes[0]))
      return reply(400, { error: 'invalid_mode' });
    const mode = modes[0];
    const authorization = req.headers.authorization;
    const bearer = typeof authorization === 'string' && /^Bearer +([^\s,]+)$/i.exec(authorization);
    let identity;
    if (bearer) {
      try { identity = await verifyIdentity({ accessToken: bearer[1] }); }
      catch { /* Verification failures share the unauthenticated response. */ }
    }
    if (typeof identity?.uid !== 'string' || !identity.uid)
      return reply(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    try {
      await requireRoomAccess(identity, mode, store);
    } catch {
      return reply(403, { error: 'forbidden' });
    }
    let payload;
    try {
      payload = await read(mode);
    } catch {
      return reply(503, { error: 'unavailable' });
    }
    return reply(200, payload);
  };
}

function createLeaderboardHandler({ verifyIdentity, store }) {
  return createProtectedLeaderboardRead({ verifyIdentity, store,
    read: async mode => ({ rows: v12LeaderboardRows(await currentLeaderboard(store, mode)) })
  });
}

module.exports = { createLeaderboardHandler, createProtectedLeaderboardRead };
