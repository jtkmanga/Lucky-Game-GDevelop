'use strict';

// Apply the proposed rules to disposable copies. Nothing in the game loads this patch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-items-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
for (const name of ['railway/rules.js', 'railway/board-definitions.json',
  'railway/board-maps.cjs', 'railway/multi-board-rules.cjs', 'railway/match-item-effects.cjs',
  'railway/rule-transition-guard.cjs', 'supabase/room-lease-store.cjs']) {
  const relative = path.join('backend', name);
  fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true });
  fs.copyFileSync(path.join(root, relative), path.join(temp, relative));
}
execFileSync('git', ['apply', path.join(__dirname, 'fixtures/item-turn-candidate.patch')], { cwd: temp });
const Rules = require(path.join(temp, 'backend/railway/multi-board-rules.cjs'));
const { requireRuleTransition } = require(path.join(temp, 'backend/railway/rule-transition-guard.cjs'));
const { createRoomLeaseStore } = require(path.join(temp, 'backend/supabase/room-lease-store.cjs'));
const Original = require('../backend/railway/multi-board-rules.cjs');
const originalGuard = require('../backend/railway/rule-transition-guard.cjs').requireRuleTransition;
const roomId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const seats = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'].map(uid => ({ uid }));
const rng = () => 0;

// Only the pg transport is in memory. Capture the actual store's serialized parameters.
function database(initial) {
  let saved = { revision: 0, game: initial, receipts: [], ledger: [] };
  let txn;
  async function query(sql, values) {
    if (sql === 'BEGIN') txn = structuredClone(saved);
    else if (sql === 'COMMIT') saved = txn;
    else if (sql === 'ROLLBACK') txn = undefined;
    else if (sql.includes('UPDATE game.rooms')) {
      const [room, owner, epoch, revision, state] = values;
      if (room !== roomId || owner !== ownerId || epoch !== 1 || revision !== txn.revision || txn.game.over)
        return { rowCount: 0 };
      txn.game = JSON.parse(state);
      return { rowCount: 1, rows: [{ revision: ++txn.revision, mode: initial.mode, seats }] };
    } else if (sql.includes('INSERT INTO game.score_events')) {
      if (txn.ledger.some(row => row[0] === values[0])) return { rowCount: 0 };
      txn.ledger.push(values);
    } else if (sql.includes('INSERT INTO game.turn_receipts')) {
      txn.receipts.push(values);
    } else throw Error('Unexpected SQL ' + sql);
    return { rowCount: 1 };
  }
  const store = createRoomLeaseStore({ query, connect: async () => ({ query, release() {} }) });
  return { read: () => structuredClone(saved), commit: args => store.commitFencedTurn(args) };
}

function scene(map, items) {
  const game = Original.create(['A', 'B'], 'vip', rng, map);
  if (items) game.matchItems = { version: 1, players: [
    { shieldRemaining: 1, winMultiplier: 2 }, { shieldRemaining: 1, winMultiplier: 1 }
  ] };
  return game;
}

function prepare({ game: before, revision }, dice) {
  const game = structuredClone(before);
  const actorIndex = before.current;
  const receipt = { type: dice === null ? 'timeout' : 'roll', actorIndex, dice, outcome: {} };
  const awards = [];
  function award(kind, points) {
    awards.push({ kind, points, uid: seats[actorIndex].uid, mode: game.mode, gameId: roomId,
      eventId: roomId + (kind === 'win' ? ':win' : ':lucky') });
  }
  if (dice === null) Rules.timeout(game);
  else {
    receipt.outcome = Rules.turn(game, dice, rng);
    if (receipt.outcome.reward) award('lucky_box', receipt.outcome.reward);
    if (game.over) award('win', game.players[actorIndex].score - before.players[actorIndex].score);
  }
  requireRuleTransition(before, game, receipt, awards);
  return { roomId, ownerId, leaseEpoch: 1, expectedRevision: revision, game, receipt, awards,
    deadlineMs: game.over ? null : 20000 };
}

for (const map of [1, 2, 3, 4, 5]) {
  test('map ' + map + ' consumes one shield across checkpoint restore and timeout', async () => {
    const game = scene(map, true);
    const heads = Object.keys(game.board.snakes).map(Number);
    const head = heads.at(-2), nextHead = heads.at(-1);
    game.players[0].pos = head - 1;
    const db = database(game);
    const first = prepare(db.read(), 1);
    assert.equal(first.receipt.outcome.type, 'shield');
    assert.equal(first.game.players[0].pos, head);
    assert.throws(() => originalGuard(game, first.game, first.receipt, []), /RULE_TRANSITION_MISMATCH/);
    await db.commit(first);
    const checkpoint = JSON.parse(db.read().receipts[0][8]);
    assert.deepEqual(checkpoint, db.read().game);
    assert.deepEqual(checkpoint.matchItems.players.map(x => x.shieldRemaining), [0, 1]);
    const timeout = prepare({ game: checkpoint, revision: 1 }, null);
    assert.deepEqual(timeout.game.matchItems, checkpoint.matchItems);
    assert.deepEqual(timeout.game.players, checkpoint.players);
    assert.deepEqual(timeout.receipt, { type: 'timeout', actorIndex: 1, dice: null, outcome: {} });
    const refilled = structuredClone(timeout.game);
    refilled.matchItems.players[0].shieldRemaining = 1;
    assert.throws(() => requireRuleTransition(checkpoint, refilled, timeout.receipt, []), /TIMEOUT_ITEMS_CHANGED/);
    await db.commit(timeout);
    const saved = db.read();
    await assert.rejects(db.commit(timeout), /STALE_REVISION/);
    assert.deepEqual(db.read(), saved);
    if (nextHead - head > 6) {
      await db.commit(prepare(db.read(), nextHead - head - 6));
      await db.commit(prepare(db.read(), null));
    }
    const second = prepare(db.read(), nextHead - db.read().game.players[0].pos);
    await db.commit(second);
    assert.equal(second.receipt.outcome.type, 'snake');
    assert.equal(db.read().game.players[0].pos, game.board.snakes[nextHead]);
    assert.deepEqual(db.read().ledger, []);
  });

  test('map ' + map + ' persists one doubled win and rejects replay', async () => {
    const game = scene(map, true);
    game.players[0].pos = 99;
    const db = database(game);
    const win = prepare(db.read(), 4);
    const forged = structuredClone(win);
    forged.awards[0].points = 10;
    assert.throws(() => requireRuleTransition(game, win.game, win.receipt, forged.awards), /MISMATCH/);
    await assert.rejects(db.commit(forged), /Winner award/);
    await db.commit(win);
    const saved = db.read();
    assert.equal(saved.game.players[0].score, 20);
    assert.deepEqual(saved.ledger, [[roomId + ':win', seats[0].uid, 'vip', roomId, 'win', 20]]);
    assert.equal(saved.receipts.length, 1);
    const row = saved.receipts[0];
    assert.deepEqual(row.slice(0, 7), [roomId, 1, 0, 1, 'roll', 0, 4]);
    assert.deepEqual(JSON.parse(row[7]), win.receipt.outcome);
    assert.deepEqual(JSON.parse(row[8]), saved.game);
    assert.deepEqual(JSON.parse(row[9]), [{ eventId: roomId + ':win', uid: seats[0].uid, mode: 'vip', kind: 'win', points: 20 }]);
    await assert.rejects(db.commit(win), /STALE_REVISION/);
    assert.deepEqual(db.read(), saved);
  });

  test('map ' + map + ' preserves ordinary rooms and Lucky Box value', async () => {
    const normal = scene(map, false);
    for (const pos of [Object.keys(normal.board.snakes)[0] - 1, normal.gift - 1, 99]) {
      normal.players[0].pos = pos;
      const legacy = structuredClone(normal);
      const outcome = Original.turn(legacy, 1, rng);
      const db = database(normal);
      const turn = prepare(db.read(), 1);
      assert.deepEqual(turn.receipt.outcome, outcome);
      assert.deepEqual(turn.game, legacy);
      originalGuard(normal, turn.game, turn.receipt, turn.awards);
      await db.commit(turn);
      assert.deepEqual(db.read().game, legacy);
    }
    const entitled = scene(map, true);
    entitled.players[0].pos = entitled.gift - 1;
    const db = database(entitled);
    await db.commit(prepare(db.read(), 1));
    assert.equal(db.read().ledger[0][5], 10);
    assert.equal(db.read().game.players[0].luckyEarned, 10);
  });
}
