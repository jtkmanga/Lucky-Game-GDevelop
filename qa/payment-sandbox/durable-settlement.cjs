'use strict';

// Offline synthetic SQLite laboratory only. No external I/O except the
// explicitly named local fixture file. Not a production adapter or migration.
const { DatabaseSync } = require('node:sqlite');
const { openSync, closeSync, lstatSync } = require('node:fs');
const { basename, dirname, isAbsolute } = require('node:path');
const { createSettlementWithStore, validatedFixtureOrders } = require('./local-settlement.cjs');
const APPLICATION_ID = 0x4c4b4751;
const FIXTURE_TTL_MS = 86400000;
const PRODUCTS = Object.freeze({ 'lab-shield': 'shield', 'lab-win2': 'double_win' });
const DDL = `
  CREATE TABLE lab_orders (
    orderId TEXT PRIMARY KEY, uid TEXT NOT NULL, productCode TEXT NOT NULL,
    amountMinor INTEGER NOT NULL CHECK (amountMinor > 0),
    currency TEXT NOT NULL CHECK (currency = 'THB'),
    providerReference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending','paid','refunded'))
  ) STRICT;
  CREATE TABLE lab_events (
    seq INTEGER PRIMARY KEY, event_id TEXT UNIQUE NOT NULL,
    order_id TEXT NOT NULL REFERENCES lab_orders(orderId),
    fingerprint TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('settled','refunded')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    applied INTEGER NOT NULL CHECK (applied IN (0,1)), accepted_ms INTEGER NOT NULL,
    UNIQUE (order_id, event_id)
  ) STRICT;
  CREATE TABLE lab_grants (
    order_id TEXT PRIMARY KEY REFERENCES lab_orders(orderId),
    issue_event TEXT NOT NULL UNIQUE,
    refund_event TEXT UNIQUE,
    item TEXT NOT NULL CHECK (item IN ('shield','double_win')),
    starts_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL CHECK (expires_ms > starts_ms),
    FOREIGN KEY (order_id, issue_event) REFERENCES lab_events(order_id, event_id),
    FOREIGN KEY (order_id, refund_event) REFERENCES lab_events(order_id, event_id)
  ) STRICT;
  CREATE INDEX lab_orders_uid_idx ON lab_orders(uid);
  CREATE TRIGGER lab_events_immutable_update BEFORE UPDATE ON lab_events
    BEGIN SELECT RAISE(ABORT,'FIXTURE_HISTORY_IMMUTABLE'); END;
  CREATE TRIGGER lab_events_immutable_delete BEFORE DELETE ON lab_events
    BEGIN SELECT RAISE(ABORT,'FIXTURE_HISTORY_IMMUTABLE'); END;
  CREATE TRIGGER lab_grants_keep_origin BEFORE DELETE ON lab_grants
    BEGIN SELECT RAISE(ABORT,'FIXTURE_GRANT_ORIGIN_IMMUTABLE'); END;
  CREATE TRIGGER lab_grants_only_revoke BEFORE UPDATE ON lab_grants
    WHEN OLD.refund_event IS NOT NULL OR NEW.refund_event IS NULL
      OR OLD.order_id IS NOT NEW.order_id OR OLD.issue_event IS NOT NEW.issue_event
      OR OLD.item IS NOT NEW.item OR OLD.starts_ms IS NOT NEW.starts_ms
      OR OLD.expires_ms IS NOT NEW.expires_ms
    BEGIN SELECT RAISE(ABORT,'FIXTURE_GRANT_ORIGIN_IMMUTABLE'); END;
`;

function openDurableSettlement({ path, initialOrders, lookupProvider, clock = Date.now }) {
  if (typeof path !== 'string' || !isAbsolute(path) ||
      !/^lucky-sandbox-fixture(?:-[a-z0-9]+)?\.sqlite$/.test(basename(path)) ||
      typeof clock !== 'function' || typeof lookupProvider !== 'function') {
    throw Error('INVALID_DURABLE_FIXTURE_CONFIGURATION');
  }
  // Use an owned private scratch directory. Create is exclusive, never
  // overwrites or initializes an existing file. Reopen only the lab format.
  const dir = lstatSync(dirname(path));
  if (!dir.isDirectory() || dir.uid !== process.getuid() || (dir.mode & 0o077)) {
    throw Error('FIXTURE_DIRECTORY_NOT_PRIVATE');
  }
  const seed = initialOrders === undefined ? undefined : validatedFixtureOrders(initialOrders);
  if (seed && [...seed.values()].some(o => !Object.hasOwn(PRODUCTS, o.productCode))) {
    throw Error('FIXTURE_DURABLE_ITEMS_ONLY');
  }
  if (seed) closeSync(openSync(path, 'wx', 0o600));
  const file = lstatSync(path);
  if (!file.isFile() || file.nlink !== 1 || file.uid !== process.getuid() || (file.mode & 0o077)) {
    throw Error('FIXTURE_FILE_NOT_PRIVATE');
  }
  const db = new DatabaseSync(path, { timeout: 1500, enableForeignKeyConstraints: true });
  let poisoned = false;
  let closed = false;
  function transact(fn) {
    if (poisoned || closed) throw Error('FIXTURE_STORE_UNAVAILABLE');
    db.exec('BEGIN IMMEDIATE');
    let committing = false;
    try {
      const result = fn();
      committing = true;
      db.exec('COMMIT');
      return result;
    } catch (error) {
      // Never return success when commit is unclear. Force reopen on commit
      // failure or failed rollback; persisted event ID is the retry anchor.
      if (committing) poisoned = true;
      try { db.exec('ROLLBACK'); } catch { poisoned = true; }
      throw error;
    }
  }
  try {
    if (!seed && (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
        db.prepare('PRAGMA user_version').get().user_version !== 1)) {
      throw Error('UNRECOGNIZED_FIXTURE_DATABASE');
    }
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
    if (seed) transact(() => {
      db.exec(DDL);
      db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1`);
      const insert = db.prepare('INSERT INTO lab_orders VALUES (?,?,?,?,?,?,?)');
      for (const o of seed.values()) {
        insert.run(o.orderId, o.uid, o.productCode, o.amountMinor, o.currency, o.providerReference, o.status);
      }
    });
    const findOrder = db.prepare('SELECT * FROM lab_orders WHERE orderId=?');
    const findEvent = db.prepare('SELECT fingerprint FROM lab_events WHERE event_id=?');
    const insertEvent = db.prepare(
      'INSERT INTO lab_events(event_id,order_id,fingerprint,action,amount_minor,applied,accepted_ms) VALUES(?,?,?,?,?,?,?)');
    const updateOrder = db.prepare('UPDATE lab_orders SET status=? WHERE orderId=? AND status=?');
    const issue = db.prepare('INSERT INTO lab_grants VALUES(?,?,NULL,?,?,?)');
    const revoke = db.prepare('UPDATE lab_grants SET refund_event=? WHERE order_id=? AND refund_event IS NULL');
    const last = db.prepare('SELECT accepted_ms FROM lab_events ORDER BY seq DESC LIMIT 1');
    const eligible = `SELECT EXISTS(
      SELECT 1 FROM lab_orders o JOIN lab_grants g ON g.order_id=o.orderId
      WHERE o.uid=? AND g.item=? AND o.status='paid' AND g.refund_event IS NULL
        AND g.starts_ms<=? AND g.expires_ms>?)`;
    const readItems = db.prepare(`SELECT (${eligible}) AS shield, (${eligible}) AS doubleWin`);

    const sampledClock = () => {
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - FIXTURE_TTL_MS) {
        throw Error('INVALID_FIXTURE_TIME');
      }
      return now;
    };
    const lab = createSettlementWithStore({
      transact,
      findOrder: id => findOrder.get(id),
      findEvent: id => findEvent.get(id)?.fingerprint,
      recordVerified: ({ order, event, status, changed, fingerprint }) => {
        const at = sampledClock();
        if (at < (last.get()?.accepted_ms ?? 0)) throw Error('FIXTURE_CLOCK_MOVED_BACK');
        insertEvent.run(event.eventId, order.orderId, fingerprint, event.kind, order.amountMinor, Number(changed), at);
        if (!changed) return;
        if (updateOrder.run(status, order.orderId, order.status).changes !== 1) throw Error('FIXTURE_ORDER_STATE_CONFLICT');
        if (status === 'paid') {
          issue.run(order.orderId, event.eventId, PRODUCTS[order.productCode], at, at + FIXTURE_TTL_MS);
        } else if (order.status === 'paid') {
          if (revoke.run(event.eventId, order.orderId).changes !== 1) throw Error('FIXTURE_GRANT_NOT_FOUND');
        }
      }
    }, lookupProvider);
    return {
      ...lab,
      snapshotFixture(uid) {
        if (poisoned || closed) throw Error('FIXTURE_STORE_UNAVAILABLE');
        if (typeof uid !== 'string' || !/^lab-uid-[a-z0-9]{1,88}$/.test(uid)) throw Error('INVALID_FIXTURE_UID');
        const now = sampledClock();
        // Both item values come from one SQL snapshot. Any surviving origin
        // suffices; no stacking and no combining distinct time windows.
        const row = readItems.get(uid, 'shield', now, now, uid, 'double_win', now, now);
        return { shield: row.shield === 1, doubleWin: row.doubleWin === 1 };
      },
      close() { if (!closed) { db.close(); closed = true; } }
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openDurableSettlement };
