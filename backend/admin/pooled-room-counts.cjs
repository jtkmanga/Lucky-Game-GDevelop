'use strict';

const { createPgAdminRoomCounts } = require('./pg-room-counts.cjs');

const MAX_CHECKOUT_MS = 2000;
const MAX_STATEMENT_MS = 2000;
const RESPONSE_TIMEOUT_MS = 5000;

// Trusted bootstrap supplies an exclusive pg.Pool and the independently approved
// reader LOGIN name. Verify its effective grants, complete rooms RLS visibility,
// search path, TLS and backend session affinity before opting in. Pool ownership
// and shutdown remain with bootstrap. Never pass request input as configuration.
const CHECK_SESSION = `
  SELECT session_user::text = $1
    AND current_user = 'lucky_count_reader'
    AND pg_catalog.current_setting('transaction_read_only') = 'on'
    AND pg_catalog.row_security_active('game.rooms'::pg_catalog.regclass)
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_settings
      WHERE name = 'statement_timeout' AND unit = 'ms'
        AND setting::bigint BETWEEN 1 AND $2::bigint
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolcanlogin
        AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND NOT rolcanlogin
        AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname NOT IN (session_user, current_user)
        AND (pg_catalog.pg_has_role(session_user, oid, 'MEMBER')
             OR pg_catalog.pg_has_role(current_user, oid, 'MEMBER'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles AS identity
      WHERE identity.rolname IN (session_user, current_user) AND (
        pg_catalog.has_function_privilege(identity.oid,'game.set_room_count_grant(uuid,boolean)','EXECUTE')
        OR pg_catalog.has_any_column_privilege(identity.oid,'game.rooms','INSERT,UPDATE')
        OR pg_catalog.has_table_privilege(identity.oid,'game.rooms','DELETE,TRUNCATE')
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute AS col
          WHERE col.attrelid = 'game.rooms'::pg_catalog.regclass AND col.attnum > 0
            AND NOT col.attisdropped AND col.attname NOT IN ('mode','status')
            AND pg_catalog.has_column_privilege(identity.oid,col.attrelid,col.attnum,'SELECT')
        )
        OR EXISTS (
          SELECT 1 FROM (VALUES ('game.room_count_grants'::pg_catalog.regclass),
                                 ('game.room_count_grant_audit'::pg_catalog.regclass)) AS private_table(id)
          WHERE pg_catalog.has_any_column_privilege(identity.oid,private_table.id,'SELECT,INSERT,UPDATE')
             OR pg_catalog.has_table_privilege(identity.oid,private_table.id,'DELETE,TRUNCATE')
        )
      )
    )
    AS ready`;

function bounded(value, max) {
  return Number.isSafeInteger(value) && value > 0 && value <= max;
}

function createPooledAdminRoomCounts({ verifyIdentity, readerPool, readerLogin, connectionMode } = {}) {
  const options = readerPool?.options;
  if (!['verified-direct', 'verified-session-pool'].includes(connectionMode) ||
      typeof verifyIdentity !== 'function' || typeof readerPool?.connect !== 'function' ||
      typeof readerLogin !== 'string' || !readerLogin || options?.user !== readerLogin ||
      ['lucky_game_server_login', 'lucky_game_runtime', 'lucky_count_operator',
       'lucky_count_change_owner', 'lucky_count_predicate_owner', 'lucky_count_reader',
       'anon', 'authenticated'].includes(readerLogin) ||
      !bounded(options.connectionTimeoutMillis, MAX_CHECKOUT_MS) ||
      !bounded(options.statement_timeout, MAX_STATEMENT_MS)) {
    throw Error('ADMIN_ROOM_COUNTS_DISABLED');
  }
  return createPgAdminRoomCounts({ verifyIdentity, reader: {
    async query(text, values) {
      // pg-pool applies connectionTimeoutMillis to queued checkout and connection setup.
      const client = await readerPool.connect();
      let discard = true;
      const run = (sql, params) => client.query({
        text: sql, values: params, query_timeout: RESPONSE_TIMEOUT_MS
      });
      try {
        await run('BEGIN READ ONLY');
        await run('SET LOCAL search_path = pg_catalog, pg_temp');
        await run('SET LOCAL ROLE lucky_count_reader');
        const { rows } = await run(CHECK_SESSION, [readerLogin, MAX_STATEMENT_MS]);
        if (rows.length !== 1 || rows[0]?.ready !== true) throw Error('Unsafe reader session');
        const result = await run(text, values);
        await run('COMMIT');
        discard = false;
        return result;
      } finally {
        // Disconnection rolls back any open transaction. Avoid a second command on
        // a stalled connection or one whose COMMIT acknowledgement was lost.
        client.release(discard);
      }
    }
  }});
}

module.exports = { createPooledAdminRoomCounts };
