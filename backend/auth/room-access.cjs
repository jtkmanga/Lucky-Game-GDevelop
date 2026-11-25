'use strict';

/**
 * Fail-closed VIP authorization for integration into the online room handler.
 * No client-provided "vip: true", price, payment confirmation, or localStorage
 * flag is trusted. Entitlement comes only from server-owned persistence.
 */

class VipAccessDeniedError extends Error {
  constructor() {
    super('VIP access is not active');
    this.code = 'VIP_ACCESS_DENIED';
  }
}

function validEntitlement(row, uid, now) {
  return Boolean(
    row &&
    typeof row === 'object' &&
    row.uid === uid &&
    row.tier === 'vip' &&
    row.status === 'active' &&
    Number.isFinite(row.expiresAtMs) &&
    row.expiresAtMs > now
  );
}

/**
 * @param {object} identity Output of requirePlayerIdentity (verified server-side)
 * @param {'free'|'vip'} mode Requested room type
 * @param {{getVipEntitlement: (uid:string)=>Promise<object|null>}} storage Server-controlled DB adapter
 * @returns {Promise<boolean>}
 */
async function requireRoomAccess(identity, mode, storage) {
  if (!identity || typeof identity.uid !== 'string' || !identity.uid) {
    const err = new Error('Unauthenticated');
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  if (mode === 'free') return true;
  if (mode !== 'vip') throw new Error('Invalid room mode');
  if (!storage || typeof storage.getVipEntitlement !== 'function') {
    throw new VipAccessDeniedError();
  }
  let record;
  try {
    record = await storage.getVipEntitlement(identity.uid);
  } catch {
    // Do not allow VIP on DB failure.
    throw new VipAccessDeniedError();
  }
  if (!validEntitlement(record, identity.uid, Date.now())) {
    throw new VipAccessDeniedError();
  }
  return true;
}

module.exports = { requireRoomAccess, VipAccessDeniedError };
