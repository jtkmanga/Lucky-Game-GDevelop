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
      const groups = new Set();
      return rows.map(({ mode, status, count }) => {
        if (!['free', 'vip'].includes(mode) || !['playing', 'finished', 'closed'].includes(status) ||
            typeof count !== 'string' || !/^[1-9][0-9]{0,18}$/.test(count) ||
            (count.length === 19 && count > '9223372036854775807')) throw Error();
        const key = mode + '/' + status;
        if (groups.has(key)) throw Error();
        groups.add(key);
        return { mode, status, count };
      });
    } catch {
      throw Error('ROOM_COUNTS_UNAVAILABLE');
    }
  };
}

module.exports = { createAdminRoomCounts };
