'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { admitMatchItems, restoreMatchItems } = require('../backend/railway/match-item-admission.cjs');
const { planMatchItemEffects } = require('../backend/railway/match-item-effects.cjs');
const seats = ['a', 'b', 'c', 'd'].map(c => ({ uid: c.repeat(8) + '-0000-4000-8000-000000000000', verified: true }));
const results = seats.map(({ uid }, i) => ({ uid, shield: i === 0 || i === 3, doubleWin: i >= 2 }));

test('shuffled source rows bind all four combinations to verified seat order', () => {
  const shuffled = [results[2], results[3], { ...results[0], uid: seats[0].uid.toUpperCase() }, results[1]];
  assert.deepEqual(admitMatchItems(seats, shuffled).players, [
    { shieldRemaining: 1, winMultiplier: 1 }, { shieldRemaining: 0, winMultiplier: 1 },
    { shieldRemaining: 0, winMultiplier: 2 }, { shieldRemaining: 1, winMultiplier: 2 }
  ]);
});

test('ambiguous rosters, unverified seats and incomplete entitlement results fail closed', () => {
  const [a, b] = seats, [x, y] = results;
  for (const [roster, rows] of [
    [[a, a], [x, y]], [[a, b], [x, x]], [[a, b], [x]], [[a, b], [x, results[2]]],
    [[a, { uid: b.uid }], [x, y]], [[a, { ...b, verified: false }], [x, y]],
    [[a, b], [x, { uid: b.uid }]], [[a, b], [x, { ...y, shield: 0 }]],
    [[a, b], [x, { ...y, uid: 'unknown' }]]
  ]) assert.throws(() => admitMatchItems(roster, rows), /ITEM/);
});

test('a restored consumed shield stays spent and preserves the win multiplier', () => {
  const game = { players: [{}, {}], current: 1, matchItems: admitMatchItems(seats.slice(2), results.slice(2)) };
  const board = { snakes: { 37: 15 } };
  const hit = planMatchItemEffects(game, board, 37);
  assert.equal(hit.shieldUsed, true);
  game.matchItems = hit.nextMatchItems;
  const restored = restoreMatchItems(JSON.parse(JSON.stringify(game)));
  assert.deepEqual(restored.players[1], { shieldRemaining: 0, winMultiplier: 2 });
  assert.equal(planMatchItemEffects({ ...game, matchItems: restored }, board, 37).shieldUsed, false);
  assert.notEqual(restored.players[1], game.matchItems.players[1]);
});

test('only an absent snapshot gets legacy behavior', () => {
  const game = { players: [{}, {}] };
  assert.equal(restoreMatchItems(game), undefined);
  const good = admitMatchItems(seats.slice(0, 2), results.slice(0, 2));
  for (const matchItems of [undefined, null, {}, { ...good, version: 2 }, { ...good, extra: true },
    { ...good, players: [] }, { ...good, players: Array(2) },
    ...[{ shieldRemaining: false, winMultiplier: 1 }, { shieldRemaining: 1, winMultiplier: 3 },
      { ...good.players[0], uid: seats[0].uid }].map(entry => ({ ...good, players: [entry, good.players[1]] }))
  ]) assert.throws(() => restoreMatchItems({ ...game, matchItems }), /INVALID_MATCH_ITEM_SNAPSHOT/);
});
