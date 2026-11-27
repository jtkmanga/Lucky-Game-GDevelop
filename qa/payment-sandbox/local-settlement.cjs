'use strict';

// In-process payment simulation only. No HTTP, environment keys, DB, or real grants.
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const products = new Set(['lab-vip', 'lab-shield', 'lab-win2']);
const token = (s, pattern) => typeof s === 'string' && s.length <= 96 && pattern.test(s);
const orderId = s => token(s, /^lab-order-[a-z0-9]+$/);
const paymentId = s => token(s, /^lab-payment-[a-z0-9]+$/);
const eventId = s => token(s, /^lab-event-[a-z0-9]+$/);

function sameOrder(a, b) {
  return a.orderId === b.orderId && a.uid === b.uid && a.productCode === b.productCode &&
    a.amountMinor === b.amountMinor && a.currency === b.currency &&
    a.providerReference === b.providerReference;
}

function validatedFixtureOrders(orderRows) {
  const orders = new Map();
  const byProvider = new Set();
  for (const order of orderRows) {
    if (!order || !orderId(order.orderId) || !paymentId(order.providerReference) ||
        !token(order.uid, /^lab-uid-[a-z0-9]+$/) || !products.has(order.productCode) ||
        !Number.isSafeInteger(order.amountMinor) || order.amountMinor <= 0 ||
        order.currency !== 'THB' || order.status !== 'pending' ||
        orders.has(order.orderId) || byProvider.has(order.providerReference)) {
      throw Error('INVALID_SYNTHETIC_ORDER');
    }
    orders.set(order.orderId, Object.freeze({
      orderId: order.orderId, uid: order.uid, productCode: order.productCode,
      amountMinor: order.amountMinor, currency: order.currency,
      providerReference: order.providerReference, status: 'pending'
    }));
    byProvider.add(order.providerReference);
  }

  return orders;
}

function createSettlementWithStore(store, lookupProvider) {
  if (typeof lookupProvider !== 'function') throw Error('INVALID_FIXTURE_PROVIDER');
  const secret = randomBytes(32);
  const signFixture = raw => createHmac('sha256', secret).update(raw).digest('hex');

  function accept(raw, signature) {
    const reject = reason => ({ outcome: 'rejected', reason });
    if (!Buffer.isBuffer(raw) || raw.length > 2048 ||
        typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signFixture(raw), 'hex'))) {
      return reject('invalid-signature');
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); }
    catch { return reject('invalid-event'); }
    if (!event || Object.keys(event).length !== 4 || !eventId(event.eventId) ||
        !orderId(event.orderId) || !paymentId(event.providerReference) ||
        !['settled', 'refunded'].includes(event.kind)) return reject('invalid-event');
    return store.transact(() => {
      // Same signed identity across outages never restores a refunded order.
      const fingerprint = JSON.stringify([event.orderId, event.providerReference, event.kind]);
      const previous = store.findEvent(event.eventId);
      if (previous !== undefined) {
        return previous === fingerprint ? { outcome: 'duplicate' } : reject('event-conflict');
      }
      const order = store.findOrder(event.orderId);
      if (!order || event.providerReference !== order.providerReference) return reject('unknown-order');
      let payment;
      try { payment = lookupProvider(event.providerReference); }
      catch { return reject('provider-unavailable'); }
      if (!payment || !sameOrder(order, payment) || payment.state !== event.kind) {
        return reject('provider-mismatch');
      }
      if (event.kind === 'refunded' && payment.refundMinor !== order.amountMinor) {
        return reject('partial-or-unverified-refund');
      }
      if (event.kind === 'settled' && order.status === 'refunded') return reject('refunded-order');
      const status = event.kind === 'settled' ? 'paid' : 'refunded';
      const changed = order.status !== status;
      store.recordVerified({ order, event, status, changed, fingerprint });
      return { outcome: changed ? status : 'duplicate' };
    });
  }

  return { signFixture, accept };
}

function createLocalSettlement(orderRows, lookupProvider) {
  const orders = validatedFixtureOrders(orderRows);
  const events = new Map();
  const ledger = new Set(); // Synthetic order IDs only; never grants a user a product.
  const lab = createSettlementWithStore({
    transact: fn => fn(),
    findEvent: id => events.get(id),
    findOrder: id => orders.get(id),
    recordVerified: ({ order, event, status, changed, fingerprint }) => {
      if (changed) {
        orders.set(order.orderId, Object.freeze({ ...order, status }));
        if (status === 'paid') ledger.add(order.orderId);
        else ledger.delete(order.orderId);
      }
      events.set(event.eventId, fingerprint);
    }
  }, lookupProvider);
  return {
    ...lab,
    inspectFixture: () => ({
      orderStates: [...orders].map(([id, order]) => [id, order.status]),
      syntheticFulfillments: [...ledger],
      acceptedEvents: events.size
    })
  };
}

module.exports = { createLocalSettlement, createSettlementWithStore, validatedFixtureOrders };
