'use strict';

// QA only: existing HMAC verifier -> synthetic provider lookup -> actual
// guarded PG17 fixture ledger. Uses a new standalone cluster; no socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createSettlementWithStore, validatedFixtureOrders} = require('../local-settlement.cjs');

const order = Object.freeze({
  orderId:'lab-order-a', providerReference:'lab-payment-a', uid:'lab-uid-a',
  productCode:'lab-shield', amountMinor:123, currency:'THB', status:'pending'
});
// Fixture-only translation between the existing two sandbox naming schemes.
const sqlRef = 'lab-ref-a';
const sqlItem = 'shield';
const db = 'lucky_qa_item_ledger';
const literal = s => {
  assert.match(s,/^[a-z0-9-]+$/i);
  return "'" + s + "'";
};
const baseArgs = [db];

test('signed sandbox facts settle and refund through a real disposable PostgreSQL ledger', {
  skip:process.env.LUCKY_PG17_BIN === undefined
}, () => {
  const variable = process.env.LUCKY_PG17_BIN;
  assert.ok(variable && path.isAbsolute(variable), 'set LUCKY_PG17_BIN to the absolute local PG17 binaries directory');
  const bin = fs.realpathSync(variable);
  const env = {PATH:'/usr/bin:/bin',LC_ALL:'C'};
  function command(binary, args, input) {
    const r = spawnSync(path.join(bin,binary), args, {input,env,encoding:'utf8',timeout:30000});
    assert.ifError(r.error);
    assert.equal(r.status,0,r.stderr);
    assert.doesNotMatch(r.stderr,/\b(?:ERROR|FATAL|PANIC):/);
    return r.stdout;
  }
  assert.match(command('postgres',['--version']),/^postgres \(PostgreSQL\) 17\./);
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'lucky-signed-ledger-'));
  try {
    const data = path.join(root,'data');
    command('initdb',['-D',data,'-A','reject','--no-locale','-E','UTF8']);
    function single(sql, target = baseArgs) {
      return command('postgres',['--single','-D',data,'-j','-c','lucky.disposable_ledger=on',...target],
        sql.trim().replace(/\n[ \t]*\n/g,'\n')+'\n\n');
    }
    single('CREATE DATABASE '+db,['postgres']);
    single("DO $$ BEGIN EXECUTE (SELECT 'CREATE TYPE oid_pad AS ENUM (' || string_agg(quote_literal(n::text), ',') || ')' FROM generate_series(1,3000) n); END $$; DROP TYPE oid_pad;");
    single(fs.readFileSync(path.join(__dirname,'ledger.sql'),'utf8'));
    single("INSERT INTO lab_ledger.orders (id,uid,item,ref,amount,currency) VALUES ("+
      [order.orderId,order.uid,sqlItem,sqlRef].map(literal).concat([order.amountMinor,literal(order.currency)]).join(',')+");");
    const readMarker = (sql,tag) => {
      const match = single(sql).match(new RegExp('"' + tag + ':([^"]+)"'));
      assert.ok(match,'missing readback '+tag);
      return match[1];
    };
    const summary = () => readMarker("SELECT 'SUMMARY:' || (SELECT status FROM lab_ledger.orders) || ':' || (SELECT count(*) FROM lab_ledger.audit) || ':' || (SELECT count(*) FROM lab_ledger.origins);",'SUMMARY');
    const snapshot = () => readMarker("SET SESSION AUTHORIZATION lab_item_snapshot_fixture; SELECT 'SNAP:' || shield::text || ':' || double_win::text FROM lab_ledger.snapshot_fixture('lab-uid-a');",'SNAP');
    const trusted = validatedFixtureOrders([order]);
    const seen = new Map();
    let provider, reads=0, accepted=0;
    const lab = createSettlementWithStore({
      // The synchronous in-process bridge is NOT a database outer transaction.
      // apply_verified performs the writes atomically in the standalone backend.
      transact:fn=>fn(),
      findEvent:id=>seen.get(id),
      findOrder:id=>trusted.get(id),
      recordVerified({order:verified,event,status,fingerprint}) {
        assert.ok(provider && provider.orderId===verified.orderId);
        const refundedAmount = event.kind === 'refunded' ? provider.refundMinor : null;
        assert.ok(refundedAmount === null || Number.isSafeInteger(refundedAmount));
        const args = [event.eventId,verified.orderId,event.kind,verified.uid,sqlItem,sqlRef].map(literal)
          .concat([verified.amountMinor,literal(verified.currency),refundedAmount ?? 'NULL']).join(',');
        const flag = readMarker("SET SESSION AUTHORIZATION lab_verified_fixture; SELECT 'APPLY:' || lab_ledger.apply_verified("+args+");",'APPLY');
        assert.equal(flag,status);
        trusted.set(verified.orderId,Object.freeze({...verified,status}));
        seen.set(event.eventId,fingerprint);
        accepted++;
      }
    }, ref => {
      reads++;
      assert.equal(ref,order.providerReference);
      return provider;
    });
    const hook = (id,kind) => Buffer.from(JSON.stringify({
      eventId:'lab-event-'+id,orderId:order.orderId,providerReference:order.providerReference,kind
    }));
    const settle = hook('settled','settled');
    assert.equal(lab.accept(settle,'0'.repeat(64)).reason,'invalid-signature');
    assert.equal(reads,0);
    provider = Object.freeze({...order,state:'settled',amountMinor:124});
    assert.equal(lab.accept(settle,lab.signFixture(settle)).reason,'provider-mismatch');
    assert.equal(summary(),'pending:0:0');

    provider = Object.freeze({...order,state:'settled'});
    assert.equal(lab.accept(settle,lab.signFixture(settle)).outcome,'paid');
    assert.equal(summary(),'paid:1:1');
    assert.equal(snapshot(),'true:false');

    const refund = hook('refund','refunded');
    provider = Object.freeze({...order,state:'refunded',refundMinor:122});
    assert.equal(lab.accept(refund,lab.signFixture(refund)).reason,'partial-or-unverified-refund');
    assert.equal(summary(),'paid:1:1');
    provider = Object.freeze({...order,state:'refunded',refundMinor:123});
    assert.equal(lab.accept(refund,lab.signFixture(refund)).outcome,'refunded');
    assert.equal(lab.accept(settle,lab.signFixture(settle)).outcome,'duplicate');
    assert.equal(summary(),'refunded:2:1');
    assert.equal(snapshot(),'false:false');
    assert.equal(accepted,2);
    const receipt = readMarker("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY; SET LOCAL SESSION AUTHORIZATION lab_receipt_lookup; SELECT 'OUTCOME:' || lab_ledger.reconcile_verified('lab-event-refund','lab-order-a','refunded','lab-uid-a','shield','lab-ref-a',123,'THB',123); COMMIT;",'OUTCOME');
    assert.equal(receipt,'committed_exact');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
