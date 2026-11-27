'use strict';

// Unmounted adapter. Caller supplies reserved, verified seats and a dedicated
// read-only pool. It does not grant, consume, renew, or sell an entitlement.
const { admitMatchItems } = require('./match-item-admission.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_SQL = `
WITH allowed_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS sampled_at
  WHERE current_user = 'lucky_item_read_login' AND session_user = current_user
    AND row_security_active('game.item_entitlement_current'::regclass)
), roster AS (
  SELECT uid, ord FROM unnest($1::uuid[]) WITH ORDINALITY AS r(uid, ord)
)
SELECT r.uid,
  EXISTS (SELECT 1 FROM game.item_entitlement_current e
    WHERE e.uid=r.uid AND e.item='shield' AND e.revoked_at IS NULL
      AND e.starts_at<=t.sampled_at AND e.expires_at>t.sampled_at) AS shield,
  EXISTS (SELECT 1 FROM game.item_entitlement_current e
    WHERE e.uid=r.uid AND e.item='double_win' AND e.revoked_at IS NULL
      AND e.starts_at<=t.sampled_at AND e.expires_at>t.sampled_at) AS "doubleWin"
FROM roster r CROSS JOIN allowed_clock t ORDER BY r.ord`;

function createItemEntitlementReader(pool) {
  if (!pool || typeof pool.query !== 'function') throw Error('ITEM_READER_NOT_CONFIGURED');
  return async function readMatchSnapshot(reserved) {
    if (!Array.isArray(reserved) || ![2,4].includes(reserved.length) ||
        Array.from(reserved).some(s => !s || !Object.hasOwn(s,'verified') ||
          s.verified !== true || !Object.hasOwn(s,'uid') || typeof s.uid !== 'string' || !UUID.test(s.uid)))
      throw Error('INVALID_ITEM_ROSTER');
    // Freeze identity inputs across the async boundary; controller ownership
    // and roster generation still need rechecking before room INSERT.
    const seats = reserved.map(({uid}) => ({uid:uid.toLowerCase(),verified:true}));
    const ids = seats.map(s => s.uid);
    if (new Set(ids).size !== ids.length) throw Error('INVALID_ITEM_ROSTER');
    const result = await pool.query(READ_SQL,[ids]);
    return admitMatchItems(seats,result?.rows);
  };
}
module.exports = { createItemEntitlementReader, READ_SQL };
