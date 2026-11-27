'use strict';

// Dependencies are supplied by trusted server code. The grant reader must return
// its current decision for the verified UID in the form { uid, admin: boolean }.
function createAdminRoomCounts({ verifyIdentity, readAdminGrant, query }) {
  return async function roomCounts(message) {
    try {
      const identity = await verifyIdentity({ accessToken: message?.accessToken });
      const uid = identity?.uid;
      if (typeof uid !== 'string' || !uid.trim()) throw Error();
      const grant = await readAdminGrant(uid);
      if (!grant || Array.isArray(grant) || !Object.hasOwn(grant, 'uid') ||
          !Object.hasOwn(grant, 'admin') || Object.keys(grant).length !== 2 ||
          grant.uid !== uid || grant.admin !== true) throw Error();
    } catch {
      throw Error('ADMIN_ACCESS_DENIED');
    }
    try {
      const { rows } = await query('SELECT mode, status, count(*)::text AS count FROM game.rooms GROUP BY mode, status ORDER BY mode, status');
      return normalizeCounts(rows);
    } catch {
      throw Error('ROOM_COUNTS_UNAVAILABLE');
    }
  };
}

function normalizeCounts(rows) {
  if (!Array.isArray(rows)) throw Error();
  const groups = new Set();
  return Array.from(rows, ({ mode, status, count }) => {
    if (!['free', 'vip'].includes(mode) || !['playing', 'finished', 'closed'].includes(status) ||
        typeof count !== 'string' || !/^[1-9][0-9]{0,18}$/.test(count) ||
        (count.length === 19 && count > '9223372036854775807')) throw Error();
    const key = mode + '/' + status;
    if (groups.has(key)) throw Error();
    groups.add(key);
    return { mode, status, count };
  });
}

// The trusted reader must decide the current grant and aggregate from one storage
// snapshot for this UID. Return { authorized: false } or { authorized: true, rows }.
function createAuthorizedRoomCounts({ verifyIdentity, readAuthorizedRoomCounts }) {
  return async function roomCounts(message) {
    let uid;
    try {
      const identity = await verifyIdentity({ accessToken: message?.accessToken });
      uid = identity?.uid;
      if (typeof uid !== 'string' || !uid.trim()) throw Error();
    } catch {
      throw Error('ADMIN_ACCESS_DENIED');
    }
    let decision;
    try {
      decision = await readAuthorizedRoomCounts(uid);
    } catch {
      throw Error('ROOM_COUNTS_UNAVAILABLE');
    }
    if (!decision || !Object.hasOwn(decision, 'authorized') || decision.authorized !== true)
      throw Error('ADMIN_ACCESS_DENIED');
    try {
      if (!Object.hasOwn(decision, 'rows') || Object.keys(decision).length !== 2) throw Error();
      return normalizeCounts(decision.rows);
    } catch {
      throw Error('ROOM_COUNTS_UNAVAILABLE');
    }
  };
}

module.exports = { createAdminRoomCounts, createAuthorizedRoomCounts };
