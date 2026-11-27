'use strict';

const { createAuthorizedRoomCounts } = require('./room-counts.cjs');

// Activation requires a reviewed server-owned STABLE predicate that reads the
// current room_counts.read grant for exactly this UID in the statement snapshot.
// game.can_read_room_counts(uuid) is a proposed interface. No fallback exists.
// Inject a dedicated server-side pg reader with EXECUTE on that predicate,
// schema USAGE and SELECT(mode,status) on rooms, with complete RLS visibility.
// Its role must lack room writes and grant management. Bound execution time
// on that role: result cardinality is bounded, but exact counts scan rows.
const ROOM_COUNTS_SQL = `
  SELECT CASE WHEN game.can_read_room_counts($1::uuid) IS TRUE THEN (
    SELECT COALESCE(jsonb_agg(to_jsonb(counts) ORDER BY mode, status), '[]'::jsonb)
    FROM (
      SELECT mode, status, count(mode)::text AS count
      FROM game.rooms
      GROUP BY mode, status
    ) AS counts
  ) END AS counts`;

function createPgAdminRoomCounts({ verifyIdentity, reader } = {}) {
  if (typeof verifyIdentity !== 'function' || typeof reader?.query !== 'function')
    throw Error('ADMIN_ROOM_COUNTS_DISABLED');

  return createAuthorizedRoomCounts({
    verifyIdentity,
    async readAuthorizedRoomCounts(uid) {
      const { rows } = await reader.query(ROOM_COUNTS_SQL, [uid]);
      if (!Array.isArray(rows) || rows.length !== 1 ||
          !Object.hasOwn(rows[0], 'counts')) throw Error('Invalid count result');
      const counts = rows[0].counts;
      if (counts === null) return { authorized: false };
      if (!Array.isArray(counts) || counts.length > 6) throw Error('Invalid count result');
      return { authorized: true, rows: counts };
    }
  });
}

module.exports = { createPgAdminRoomCounts };
