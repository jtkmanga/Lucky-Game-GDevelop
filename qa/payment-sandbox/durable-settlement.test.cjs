'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, chmodSync, rmSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openDurableSettlement } = require('./durable-settlement.cjs');
const TTL = 86400000;
const orders = ['a', 'b', 'c', 'd'].map(id => ({
  orderId: 'lab-order-' + id, uid: id === 'd' ? 'lab-uid-other' : 'lab-uid-owner',
  productCode: id === 'c' ? 'lab-win2' : 'lab-shield', amountMinor: 1250,
  currency: 'THB', providerReference: 'lab-payment-' + id, status: 'pending'
}));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lucky-durable-fixture-'));
  const path = join(dir, 'lucky-sandbox-fixture.sqlite');
  const states = new Map(), handles = [];
  let now = 10 * TTL;
  let lab;
  function open(seed) {
    lab = openDurableSettlement({path, initialOrders: seed, lookupProvider: ref => states.get(ref), clock: () => now});
    handles.push(lab);
    return lab;
  }
  open(orders);
  t.after(() => {
    try { for (const handle of handles) handle.close(); }
    finally { rmSync(dir, {recursive: true, force: true}); }
  });
  const raw = (id, order, kind) => Buffer.from(JSON.stringify({
    eventId: 'lab-event-' + id, orderId: order.orderId, providerReference: order.providerReference, kind
  }));
  function apply(id, order, kind = 'settled', info = {}) {
    states.set(order.providerReference, {...order, state: kind, refundMinor: order.amountMinor, ...info});
    return send(id,order,kind);
  }
  function send(id, order, kind) {
    const msg = raw(id, order, kind);
    return lab.accept(msg, lab.signFixture(msg));
  }
  const sql = (query) => {
    const db = new DatabaseSync(path, {readOnly: true});
    try { return db.prepare(query).all().map(row => ({...row})); }
    finally { db.close(); }
  };
  const changeDb = query => {
    const db = new DatabaseSync(path, {enableForeignKeyConstraints: true});
    try { db.exec(query); } finally { db.close(); }
  };
  return {path, dir, open, apply, send, sql, changeDb, advance: amount => {now += amount;},
    snapshot: (uid = orders[0].uid) => lab.snapshotFixture(uid), now: () => now, close: () => lab.close()};
}

test('persists distinct origins across process restart; refund targets the source order only', t => {
  const [a,b,c,d] = orders, f = fixture(t);
  assert.equal(statSync(f.path).mode & 0o777, 0o600);
  assert.equal(f.apply('a', a).outcome, 'paid');
  f.advance(100);
  assert.equal(f.apply('b', b).outcome, 'paid');
  assert.equal(f.apply('c', c).outcome, 'paid');
  assert.equal(f.apply('d', d).outcome, 'paid');
  assert.equal(f.apply('refunda', a, 'refunded').outcome, 'refunded');
  f.close();
  const child = spawnSync(process.execPath, ['-e', `
    const {openDurableSettlement} = require(process.argv[1]);
    const f = openDurableSettlement({path:process.argv[2], clock:()=>Number(process.argv[3]),
      lookupProvider:()=>{throw Error('replay must not call provider');}});
    const raw=Buffer.from(JSON.stringify({eventId:'lab-event-a',orderId:'lab-order-a',
      providerReference:'lab-payment-a',kind:'settled'}));
    console.log(JSON.stringify({owner:f.snapshotFixture('lab-uid-owner'),other:f.snapshotFixture('lab-uid-other'),
      replay:f.accept(raw,f.signFixture(raw))}));
    f.close();
  `, require.resolve('./durable-settlement.cjs'), f.path, String(f.now())], {encoding:'utf8'});
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {owner:{shield:true,doubleWin:true},
    other:{shield:true,doubleWin:false},replay:{outcome:'duplicate'}});
  f.open();
  assert.equal(f.apply('refundb', b, 'refunded').outcome, 'refunded');
  assert.deepEqual(f.snapshot(), {shield:false, doubleWin:true});
  assert.deepEqual(f.sql('SELECT order_id,issue_event,refund_event FROM lab_grants ORDER BY order_id').slice(0,2), [
    {order_id:a.orderId, issue_event:'lab-event-a', refund_event:'lab-event-refunda'},
    {order_id:b.orderId, issue_event:'lab-event-b', refund_event:'lab-event-refundb'}
  ]);
  assert.equal(f.sql('SELECT event_id FROM lab_events').length, 6);
});

test('honors exclusive expiry and gaps; duplicate settlement never extends the grant', t => {
  const [a,b] = orders, f = fixture(t);
  f.apply('a', a);
  f.advance(TTL - 1);
  assert.equal(f.apply('redelivery', a).outcome, 'duplicate');
  assert.equal(f.snapshot().shield, true);
  f.advance(1);
  assert.equal(f.snapshot().shield, false);
  f.advance(3000);
  assert.equal(f.snapshot().shield, false);
  f.apply('b', b);
  assert.equal(f.snapshot().shield, true);
  assert.deepEqual(f.sql('SELECT action,applied FROM lab_events ORDER BY seq'), [
    {action:'settled',applied:1},{action:'settled',applied:0},{action:'settled',applied:1}
  ]);
});

test('grant write failure rolls back receipt and order, and same verified event can retry', t => {
  const [a] = orders, f = fixture(t);
  f.changeDb(`CREATE TRIGGER fixture_injected_failure BEFORE INSERT ON lab_grants
    BEGIN SELECT RAISE(ABORT,'INJECTED_GRANT_FAILURE'); END;`);
  assert.throws(() => f.apply('a', a), /INJECTED_GRANT_FAILURE/);
  assert.deepEqual(f.sql('SELECT status FROM lab_orders WHERE orderId=\'lab-order-a\''), [{status:'pending'}]);
  assert.equal(f.sql('SELECT event_id FROM lab_events').length, 0);
  assert.equal(f.snapshot().shield, false);
  f.changeDb('DROP TRIGGER fixture_injected_failure');
  assert.equal(f.apply('a', a).outcome, 'paid');
  f.changeDb(`CREATE TRIGGER fixture_injected_failure BEFORE UPDATE ON lab_grants
    BEGIN SELECT RAISE(ABORT,'INJECTED_REFUND_FAILURE'); END;`);
  assert.throws(() => f.apply('refund', a, 'refunded'), /INJECTED_REFUND_FAILURE/);
  assert.equal(f.snapshot().shield, true);
  assert.deepEqual(f.sql('SELECT event_id FROM lab_events'), [{event_id:'lab-event-a'}]);
  f.changeDb('DROP TRIGGER fixture_injected_failure');
  assert.equal(f.apply('refund', a, 'refunded').outcome, 'refunded');
  assert.equal(f.snapshot().shield, false);
});

test('unverified and conflicting events cannot change the ledger; refund-first stays terminal', t => {
  const [a,b] = orders, f = fixture(t);
  assert.equal(f.apply('refund', a, 'refunded', {refundMinor:1}).reason, 'partial-or-unverified-refund');
  assert.equal(f.apply('refund', a, 'refunded').outcome, 'refunded');
  assert.equal(f.apply('settle', a).reason, 'refunded-order');
  assert.equal(f.apply('refund', b).reason, 'event-conflict');
  assert.equal(f.apply('invalid', b, 'settled', {uid: a.uid + 'wrong'}).reason, 'provider-mismatch');
  assert.equal(f.sql('SELECT * FROM lab_grants').length, 0);
  assert.deepEqual(f.sql('SELECT event_id,amount_minor FROM lab_events'), [{event_id:'lab-event-refund', amount_minor:a.amountMinor}]);
  assert.throws(() => f.changeDb("UPDATE lab_events SET amount_minor=1"), /FIXTURE_HISTORY_IMMUTABLE/);
});

test('does not initialize an unrelated database or replace an existing private fixture', t => {
  const f = fixture(t);
  assert.throws(() => f.open(orders), {code:'EEXIST'});
  const other = join(f.dir, 'lucky-sandbox-fixture-other.sqlite');
  const db = new DatabaseSync(other);
  db.exec('CREATE TABLE unrelated (x TEXT)');
  db.close();
  chmodSync(other, 0o600);
  const before = readFileSync(other);
  assert.throws(() => openDurableSettlement({path:other,lookupProvider:() => {}}), /UNRECOGNIZED_FIXTURE_DATABASE/);
  assert.deepEqual(readFileSync(other), before);
});
