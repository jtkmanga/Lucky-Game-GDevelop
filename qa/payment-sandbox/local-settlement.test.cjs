'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalSettlement } = require('./local-settlement.cjs');

const a = Object.freeze({
  orderId: 'lab-order-a', providerReference: 'lab-payment-a', productCode: 'lab-shield',
  uid: 'lab-uid-a', amountMinor: 1234, currency: 'THB', status: 'pending'
});
const b = Object.freeze({
  ...a, orderId: 'lab-order-b', providerReference: 'lab-payment-b', productCode: 'lab-vip', uid: 'lab-uid-b'
});
function fixture() {
  const states = new Map();
  let reads = 0;
  const lab = createLocalSettlement([a, b], ref => {
    reads++;
    const p = states.get(ref);
    if (p instanceof Error) throw p;
    return p;
  });
  function webhook(id, kind = 'settled', order = a) {
    const raw = Buffer.from(JSON.stringify({
      eventId: 'lab-event-' + id, orderId: order.orderId, providerReference: order.providerReference, kind
    }));
    return lab.accept(raw, lab.signFixture(raw));
  }
  return { lab, webhook, states, reads: () => reads };
}

test('valid signed settlement validates server order and is idempotent across distinct accepted events', () => {
  const { lab, webhook, states, reads } = fixture();
  states.set(a.providerReference, { ...a, state: 'settled' });
  assert.deepEqual(webhook('one'), { outcome: 'paid' });
  assert.deepEqual(webhook('one'), { outcome: 'duplicate' });
  assert.equal(reads(), 1);
  assert.deepEqual(webhook('two'), { outcome: 'duplicate' });
  assert.deepEqual(lab.inspectFixture(), {
    orderStates: [[a.orderId,'paid'], [b.orderId,'pending']],
    syntheticFulfillments:[a.orderId], acceptedEvents:2
  });
});

test('missing or mismatched authorization and event shape do not read the provider or mutate', () => {
  const { lab, reads } = fixture();
  const raw = Buffer.from('{}');
  for (const signature of [null, '0'.repeat(64), '0'.repeat(63)]) {
    assert.equal(lab.accept(raw, signature).reason, 'invalid-signature');
  }
  const invalid = Buffer.from('[');
  assert.equal(lab.accept(invalid,lab.signFixture(invalid)).reason, 'invalid-event');
  const extra = Buffer.from(JSON.stringify({
    eventId: 'lab-event-x', orderId: a.orderId, providerReference: a.providerReference,
    kind: 'settled', uid: 'lab-uid-b'
  }));
  assert.equal(lab.accept(extra, lab.signFixture(extra)).reason, 'invalid-event');
  assert.equal(reads(), 0);
  assert.deepEqual(lab.inspectFixture().syntheticFulfillments, []);
});

test('unknown, unpaid, mismatched or unavailable trusted provider results fail closed', () => {
  const { lab, webhook, states } = fixture();
  assert.equal(webhook('id','settled',{...a, providerReference:b.providerReference}).reason, 'unknown-order');
  for (const bad of [undefined, {state:'pending'}, {state:'unknown'}, {orderId:b.orderId},
                     {providerReference:b.providerReference}, {uid:b.uid}, {productCode:b.productCode},
                     {amountMinor:a.amountMinor + 1}, {currency:'USD'}]) {
    states.set(a.providerReference, bad && { ...a, state:'settled', ...bad });
    assert.equal(webhook('id').reason, 'provider-mismatch');
  }
  states.set(a.providerReference, Error('synthetic outage'));
  assert.equal(webhook('id').reason, 'provider-unavailable');
  assert.equal(lab.inspectFixture().acceptedEvents, 0);
  assert.deepEqual(lab.inspectFixture().syntheticFulfillments, []);
  states.set(a.providerReference, { ...a, state:'settled' });
  assert.equal(webhook('id').outcome, 'paid'); // Rejected transient event IDs may retry.
});

test('event ID cannot be reassigned to a different order or transition', () => {
  const { lab, webhook, states } = fixture();
  states.set(a.providerReference, { ...a, state:'settled' });
  states.set(b.providerReference, { ...b, state:'settled' });
  assert.equal(webhook('fixed').outcome, 'paid');
  assert.equal(webhook('fixed','settled',b).reason, 'event-conflict');
  assert.equal(webhook('fixed','refunded',a).reason, 'event-conflict');
  assert.deepEqual(lab.inspectFixture().syntheticFulfillments, [a.orderId]);
  assert.throws(() => createLocalSettlement([a,{...b,providerReference:a.providerReference}], () => {}), /INVALID_SYNTHETIC_ORDER/);
});

test('only a verified full refund clears the synthetic grant and stale settlement cannot restore it', () => {
  const { lab, webhook, states } = fixture();
  states.set(a.providerReference, { ...a, state:'settled' });
  assert.equal(webhook('paid').outcome, 'paid');
  states.set(a.providerReference, { ...a, state:'refunded', refundMinor:1 });
  assert.equal(webhook('refund','refunded').reason, 'partial-or-unverified-refund');
  assert.deepEqual(lab.inspectFixture().syntheticFulfillments, [a.orderId]);
  states.set(a.providerReference, { ...a, state:'refunded', refundMinor:a.amountMinor });
  assert.equal(webhook('refund','refunded').outcome, 'refunded');
  assert.equal(webhook('refund','refunded').outcome, 'duplicate');
  assert.equal(webhook('paid').outcome, 'duplicate');
  states.set(a.providerReference, { ...a, state:'settled' });
  assert.equal(webhook('stale').reason, 'refunded-order');
  assert.deepEqual(lab.inspectFixture().syntheticFulfillments, []);
});

test('refund arriving first records a terminal synthetic state and cannot create a fulfillment', () => {
  const { lab, webhook, states } = fixture();
  states.set(a.providerReference, { ...a, state:'refunded', refundMinor:a.amountMinor });
  assert.equal(webhook('first','refunded').outcome, 'refunded');
  assert.deepEqual(lab.inspectFixture().syntheticFulfillments, []);
  states.set(a.providerReference, { ...a, state:'settled' });
  assert.equal(webhook('later').reason, 'refunded-order');
});
