'use strict';

// Integration fixture only: the payment ledger and the item query both are in
// process. Only the existing JavaScript entry points are executed, not SQL.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createLocalSettlement } = require('./local-settlement.cjs');
const { createItemEntitlementReader, READ_SQL } = require('../../backend/railway/pg-item-entitlements.cjs');
const { restoreMatchItems } = require('../../backend/railway/match-item-admission.cjs');
const { planMatchItemEffects } = require('../../backend/railway/match-item-effects.cjs');

const start = Date.UTC(2030, 2, 1, 0, 0, 0);
const uid = 'aaaaaaaa-0000-4000-8000-000000000001';
const other = 'aaaaaaaa-0000-4000-8000-000000000002';
const roster = [uid, other].map(id => ({uid:id, verified:true}));
const board = {snakes:{37:15}};

function fixture(windows) {
  const orders = ['a','b'].map(id => Object.freeze({
    orderId:'lab-order-'+id, providerReference:'lab-payment-'+id, uid:'lab-uid-player',
    productCode:'lab-shield', amountMinor:1234, currency:'THB', status:'pending'
  }));
  const origins = new Map(orders.map((order,i) => [order.orderId, Object.freeze({
    reference:order.orderId, owner:order.uid, uid, item:'shield',
    startsAt: windows[i][0], expiresAt: windows[i][1]
  })]));
  const provider = new Map();
  const lab = createLocalSettlement(orders, ref => provider.get(ref));
  let now = start, samples = [];
  function notify(index, kind, event, setProvider = true) {
    const order = orders[index];
    if (setProvider) provider.set(order.providerReference, {
      ...order, state:kind, ...(kind === 'refunded' ? {refundMinor:order.amountMinor} : {})
    });
    const raw = Buffer.from(JSON.stringify({
      eventId:'lab-event-'+event, orderId:order.orderId, providerReference:order.providerReference, kind
    }));
    return lab.accept(raw, lab.signFixture(raw)).outcome;
  }
  const read = createItemEntitlementReader({async query(sql, params) {
    assert.equal(sql, READ_SQL);
    assert.match(sql, /e\.starts_at<=t\.sampled_at AND e\.expires_at>t\.sampled_at/);
    assert.deepEqual(params, [[uid, other]]);
    // Only this mock projects fake settled order IDs to server-owned origins.
    // It does not model a provider callback, DB transaction, renewal, or a
    // policy that combines windows by earliest start/latest expiry.
    const active = lab.inspectFixture().syntheticFulfillments.map(id => {
      const origin = origins.get(id), order = orders.find(o => o.orderId === id);
      assert.ok(order && origin);
      assert.equal(origin.owner, order.uid);
      return origin;
    });
    const sample = now;
    samples.push(sample);
    const eligible = (id,item) => active.some(o =>
      o.uid === id && o.item === item && o.startsAt <= sample && sample < o.expiresAt);
    return {rows:params[0].map(id => ({uid:id, shield:eligible(id,'shield'), doubleWin:eligible(id,'double_win')}))};
  }});
  return {
    notify, setTime(ms) { now = ms; }, samples, read: () => read(roster),
    paid: () => lab.inspectFixture().syntheticFulfillments
  };
}

function expectShields(snapshot, n) {
  assert.deepEqual(snapshot, {version:1, players:[
    {shieldRemaining:n, winMultiplier:1}, {shieldRemaining:0, winMultiplier:1}
  ]});
}

for (const ending of ['refund','expiry']) {
  test('synthetic origin-specific shield survives refund of A until B '+ending, async () => {
    const f = fixture([[start,start+120], [start+20,start+100]]);
    assert.equal(f.notify(0,'settled','paya'), 'paid');
    assert.equal(f.notify(1,'settled','payb'), 'paid');
    f.setTime(start+20); // inclusive start for B; both are eligible.
    const first = await f.read();
    expectShields(first, 1); // existence only; two active origins are not stacked.
    const game = {players:[{},{}], current:0, matchItems:first};
    const consumed = planMatchItemEffects(game, board, 37);
    assert.equal(consumed.shieldUsed, true);
    game.matchItems = consumed.nextMatchItems;

    f.setTime(start+21);
    assert.equal(f.notify(0,'refunded','refunda'), 'refunded');
    assert.deepEqual(f.paid(), ['lab-order-b']);
    expectShields(await f.read(), 1); // same owner/item, different origin remains.
    const resumed = restoreMatchItems(JSON.parse(JSON.stringify(game)));
    expectShields(resumed, 0);
    assert.equal(planMatchItemEffects({...game, matchItems:resumed},board,37).shieldUsed, false);

    if (ending === 'refund') {
      f.setTime(start+22);
      assert.equal(f.notify(1,'refunded','refundb'), 'refunded');
      assert.deepEqual(f.paid(), []);
    } else {
      f.setTime(start+99);
      expectShields(await f.read(), 1);
      f.setTime(start+100); // exactly at expiry, not one millisecond later.
      assert.deepEqual(f.paid(), ['lab-order-b']); // expiration is not a refund.
    }
    expectShields(await f.read(), 0);
    assert.equal(f.notify(0,'settled','paya', false), 'duplicate');
    expectShields(await f.read(), 0);
    assert.deepEqual(f.samples, ending === 'refund'
      ? [start+20,start+21,start+22,start+22]
      : [start+20,start+21,start+99,start+100,start+100]);
  });
}

test('synthetic origin-specific shield has no eligibility between disjoint windows', async () => {
  const f = fixture([[start,start+10],[start+20,start+30]]);
  assert.equal(f.notify(0,'settled','paya'), 'paid');
  assert.equal(f.notify(1,'settled','payb'), 'paid');
  for (const [offset,expected] of [[0,1],[9,1],[10,0],[19,0],[20,1],[29,1],[30,0]]) {
    f.setTime(start+offset);
    expectShields(await f.read(), expected);
  }
  assert.deepEqual(f.paid(), ['lab-order-a','lab-order-b']);
});
