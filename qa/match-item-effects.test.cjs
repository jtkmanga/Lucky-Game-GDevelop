'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planMatchItemEffects } = require('../backend/railway/match-item-effects.cjs');

const mapA = Object.freeze({ snakes: Object.freeze({ 39: 9, 98: 77 }) });
const mapB = Object.freeze({ snakes: Object.freeze({ 42: 10, 97: 33 }) });
const seats = [{}, {}, {}, {}];
function room(current = 0, count = 4) {
  return {
    current,
    players: seats.slice(0, count),
    matchItems: { version: 1, players: [
      { shieldRemaining: 1, winMultiplier: 2 },
      { shieldRemaining: 1, winMultiplier: 1 },
      { shieldRemaining: 0, winMultiplier: 1 },
      { shieldRemaining: 0, winMultiplier: 1 }
    ].slice(0, count) }
  };
}

test('legacy checkpoints preserve ordinary landing and +10 on exact or overshoot win', () => {
  const game = { players: seats, current: 0 };
  assert.deepEqual(planMatchItemEffects(game, mapA, 39),
    { shieldUsed: false, winnerPoints: 0, nextMatchItems: undefined });
  for (const landing of [100, 102]) assert.equal(planMatchItemEffects(game, mapA, landing).winnerPoints, 10);
  assert.equal(Object.hasOwn(game, 'matchItems'), false);
});

test('only a snake head on the selected board consumes the acting seat shield', () => {
  const game = room();
  const saved = structuredClone(game);
  assert.equal(planMatchItemEffects(game, mapB, 39).shieldUsed, false);
  const result = planMatchItemEffects(game, mapA, 39);
  assert.equal(result.shieldUsed, true);
  assert.equal(result.winnerPoints, 0);
  assert.deepEqual(result.nextMatchItems.players.map(p => p.shieldRemaining), [0, 1, 0, 0]);
  assert.deepEqual(game, saved);
});

test('consumed shield remains consumed after serialized checkpoint restore', () => {
  const game = room();
  const first = planMatchItemEffects(game, mapA, 39);
  const restored = JSON.parse(JSON.stringify({ ...game, matchItems: first.nextMatchItems }));
  assert.equal(planMatchItemEffects(restored, mapA, 98).shieldUsed, false);
  assert.equal(planMatchItemEffects({ ...restored, current: 1 }, mapA, 98).shieldUsed, true);
});

test('double applies to winning points only and never consumes the shield', () => {
  const game = room(0, 2);
  for (const landing of [100, 105]) {
    const result = planMatchItemEffects(game, mapA, landing);
    assert.equal(result.winnerPoints, 20);
    assert.equal(result.shieldUsed, false);
    assert.equal(result.nextMatchItems.players[0].shieldRemaining, 1);
  }
  assert.equal(planMatchItemEffects(game, mapA, 40).winnerPoints, 0);
  assert.equal(planMatchItemEffects({ ...game, current: 1 }, mapA, 100).winnerPoints, 10);
});

test('bad version, missing seat, or unsupported values fail closed', () => {
  for (const corrupt of [
    x => { x.version = 2; },
    x => { x.players.length = 3; },
    x => { delete x.players[1]; },
    x => { x.players[3].winMultiplier = 3; },
    x => { x.players[0].shieldRemaining = 2; },
    x => { x.players[0].extra = true; }
  ]) {
    const game = room();
    corrupt(game.matchItems);
    assert.throws(() => planMatchItemEffects(game, mapA, 100), /INVALID_MATCH_ITEM_SNAPSHOT/);
  }
});
