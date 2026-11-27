'use strict';
const { requirePlayerIdentity } = require('../auth/supabase-access-token.cjs');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Trusted bootstrap owns this exclusive direct pool, CA, endpoint and login.
// It must provide clean autocommit sessions already using the operator role.
// The SQL function alone handles operator authorization, receipts and replay.
const applyGrant = `
  SELECT game.set_room_count_grant($1::pg_catalog.uuid,$2::pg_catalog.bool,
           $3::pg_catalog.uuid,$4::pg_catalog.uuid) AS changed
  WHERE session_user::pg_catalog.text = $5 AND current_user = 'lucky_count_operator'
    AND pg_catalog.current_database() = $6
    AND pg_catalog.current_setting('search_path') = 'pg_catalog, pg_temp'
    AND pg_catalog.current_setting('transaction_read_only') = 'off'
    AND pg_catalog.current_setting('row_security') = 'on'
    AND EXISTS (SELECT FROM pg_catalog.pg_settings WHERE name='statement_timeout'
                AND unit='ms' AND CASE WHEN setting ~ '^[0-9]{1,10}$'
                    THEN setting::pg_catalog.int8 BETWEEN 1 AND 2000 ELSE false END)
    AND EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname=session_user AND rolcanlogin
                AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
    AND EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname=current_user AND NOT rolcanlogin
                AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
    AND NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname NOT IN (current_user,session_user)
                AND (pg_catalog.pg_has_role(session_user,oid,'MEMBER')
                     OR pg_catalog.pg_has_role(current_user,oid,'MEMBER')))`;

function bounded(ms) { return Number.isInteger(ms) && ms > 0 && ms <= 2000; }
function createPgRoomCountGrant({ operatorPool, host, port, database, login, connectionMode } = {}) {
  const o = operatorPool?.options;
  if (connectionMode !== 'verified-direct' || typeof operatorPool?.connect !== 'function' ||
      typeof host !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/i.test(host) ||
      !Number.isInteger(port) || port < 1 || port > 65535 || !database || typeof database !== 'string' ||
      typeof login !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(login) ||
      /^(?:pg_|lucky_count_|lucky_game_|postgres$|anon$|authenticated$|service_role$)/.test(login) ||
      o?.host !== host || o.port !== port || o.database !== database || o.user !== login ||
      o.connectionString || o.ssl?.rejectUnauthorized !== true || !o.ssl.ca ||
      o.ssl.checkServerIdentity || (o.ssl.servername && o.ssl.servername !== host) ||
      !bounded(o.connectionTimeoutMillis) || !bounded(o.statement_timeout))
    throw Error('Unsafe operator pool');

  return async function setGrant(accessToken, {targetUid, desired, requestId}) {
    if (typeof targetUid !== 'string' || !uuid.test(targetUid) || typeof desired !== 'boolean' ||
        typeof requestId !== 'string' || !uuid.test(requestId)) throw Error('Invalid grant command');
    const {uid} = await requirePlayerIdentity({accessToken});
    const client = await operatorPool.connect();
    let discard = true;
    try {
      if (client.getTransactionStatus?.() !== 'I') throw Error('Unsafe operator transaction state');
      const {rows, rowCount} = await client.query({text:applyGrant, query_timeout:5000,
        values:[targetUid.toLowerCase(), desired, requestId.toLowerCase(), uid.toLowerCase(), login, database]});
      if (rowCount === 0) throw Error('Unsafe operator session');
      if (rowCount !== 1 || rows?.length !== 1 || typeof rows[0]?.changed !== 'boolean')
        throw Error('Unconfirmed grant outcome');
      if (client.getTransactionStatus?.() !== 'I') throw Error('Unconfirmed grant transaction state');
      discard = false;
      return rows[0].changed;
    } finally {
      // On loss of acknowledgement, reconcile by resubmitting the same command ID.
      client.release(discard);
    }
  };
}
module.exports = { createPgRoomCountGrant };
