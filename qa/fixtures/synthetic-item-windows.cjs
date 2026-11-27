'use strict';

// Lab storage returns all matching grant windows and its own admission instant
// as one successful batch. An exception or incomplete batch aborts admission.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports = function syntheticReader(readBatch) {
  return async function readEntitlements(ids) {
    if (!Array.isArray(ids) || ![2, 4].includes(ids.length) ||
        !ids.every(id => typeof id === 'string' && uuid.test(id))) throw Error('INVALID_ROSTER');
    const rows = new Map(ids.map(uid => [uid.toLowerCase(), {uid, shield:false, doubleWin:false}]));
    if (rows.size !== ids.length) throw Error('DUPLICATE_SEAT');
    const batch = await readBatch([...rows.keys()]);
    if (!batch || batch.complete !== true || !Number.isSafeInteger(batch.atMs) ||
        !Array.isArray(batch.windows)) throw Error('INCOMPLETE_BATCH');
    const seen = new Set();
    for (const {uid,item,startMs,endMs} of batch.windows) {
      const key = typeof uid === 'string' && uid.toLowerCase();
      const row = rows.get(key);
      if (!row || !['shield','doubleWin'].includes(item) ||
          !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs >= endMs)
        throw Error('INVALID_WINDOW');
      const pair = key + '/' + item;
      // One window per item per seat in this fixture's storage contract.
      if (seen.has(pair)) throw Error('AMBIGUOUS_WINDOW');
      seen.add(pair);
      row[item] = startMs <= batch.atMs && batch.atMs < endMs;
    }
    return [...rows.values()];
  };
};
