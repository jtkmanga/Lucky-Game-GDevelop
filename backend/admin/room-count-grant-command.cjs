'use strict';

const { requirePlayerIdentity } = require('../auth/supabase-access-token.cjs');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalId(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw Error('Invalid UUID');
  return value.toLowerCase();
}

// Unmounted. The store must serialize competing uses of each requestId, run the
// callback in one transaction, commit before returning, and roll back on failure.
// isOperator reads server-owned authority and must keep its decision valid through
// commit. sessionPrincipal identifies the DB login. setGrant atomically changes
// the target and returns a boolean. appendReceipt inserts a unique, durable audit
// record even for a no-op. Keep receipts across subsequent revokes and deletions.
function createRoomCountGrantCommand(store) {
  return async function setRoomCountGrant(accessToken, { targetUid, desired, requestId }) {
    targetUid = canonicalId(targetUid);
    requestId = canonicalId(requestId);
    if (typeof desired !== 'boolean') throw Error('Invalid desired state');
    const { uid } = await requirePlayerIdentity({ accessToken });
    const actorUid = canonicalId(uid);

    return store.transactionForRequest(requestId, async tx => {
      if (await tx.isOperator(actorUid) !== true) throw Error('Operator access denied');
      const sessionPrincipal = await tx.sessionPrincipal();
      if (typeof sessionPrincipal !== 'string' || !sessionPrincipal) throw Error('Missing database principal');
      const prior = await tx.findReceipt(requestId);
      if (prior) {
        if (prior.actorUid !== actorUid || prior.targetUid !== targetUid ||
            prior.desired !== desired || prior.sessionPrincipal !== sessionPrincipal ||
            prior.requestId !== requestId) throw Error('Request ID conflict');
        if (typeof prior.changed !== 'boolean') throw Error('Invalid stored outcome');
        return prior.changed;
      }
      const changed = await tx.setGrant(targetUid, desired);
      if (typeof changed !== 'boolean') throw Error('Invalid grant outcome');
      await tx.appendReceipt({ requestId, actorUid, targetUid, desired, sessionPrincipal, changed });
      return changed;
    });
  };
}

module.exports = { createRoomCountGrantCommand };
