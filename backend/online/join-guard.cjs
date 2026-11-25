'use strict';

// Authenticated matchmaking boundary; reference wiring for the future
// authoritative server. NOT yet called from the current ZIP WebSocket server.
const {requirePlayerIdentity}=require('../auth/firebase-id-token.cjs');
const {requireRoomAccess}=require('../auth/room-access.cjs');

function createJoinGuard({firebaseProjectId,storage}) {
  if (typeof firebaseProjectId !== 'string' || !firebaseProjectId) {
    throw new Error('FIREBASE_PROJECT_ID is required');
  }
  if (!storage || typeof storage.getVipEntitlement !== 'function') {
    throw new Error('Trusted storage adapter is required');
  }
  return async function authorizeJoin(message) {
    if (!message || message.type !== 'join' ||
        (message.mode !== 'free' && message.mode !== 'vip')) {
      const error=new Error('Invalid join request');
      error.code='BAD_JOIN';
      throw error;
    }
    const identity=await requirePlayerIdentity(message,{projectId:firebaseProjectId});
    await requireRoomAccess(identity,message.mode,storage);
    return Object.freeze({
      uid:identity.uid,
      email:identity.email,
      emailVerified:identity.emailVerified,
      mode:message.mode
    });
  };
}

module.exports={createJoinGuard};
