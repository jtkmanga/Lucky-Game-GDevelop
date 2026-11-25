'use strict';
// Automated rule checks against the actual legacy game engine.
// Authoring only: do not run until owner explicitly lifts the testing pause.
const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../render-web/rules.js');

test('Free requires exactly four seats; VIP requires exactly two', () => {
  assert.equal(Rules.create(['a','b','c','d'],'free').players.length,4);
  assert.equal(Rules.create(['a','b'],'vip').players.length,2);
  assert.throws(()=>Rules.create(['a','b'],'free'));
  assert.throws(()=>Rules.create(['a','b','c','d'],'vip'));
});
test('server rules reject dice outside 1–6', () => {
  for(const x of [0,7,-1,1.5,NaN,'6'])
    assert.throws(()=>Rules.turn(Rules.create(['a','b'],'vip'),x));
});
test('timeout only skips turn, never rolls', () => {
  const g=Rules.create(['a','b'],'vip');
  const before=g.players.map(p=>p.pos);
  Rules.timeout(g);
  assert.equal(g.current,1);
  assert.deepEqual(g.players.map(p=>p.pos),before);
  assert.equal(g.lastRoll,null);
});
test('overshoot at 100 wins and yields +10 points', () => {
  const g=Rules.create(['a','b'],'vip');
  g.players[0].pos=99;
  Rules.turn(g,6);
  assert.equal(g.over,true);
  assert.equal(g.winner,0);
  assert.equal(g.players[0].pos,100);
  assert.equal(g.players[0].score,10);
});
test('ladder and snake changes occur in authoritative engine', () => {
  const g=Rules.create(['a','b'],'vip');
  g.players[0].pos=3;
  Rules.turn(g,1);
  assert.equal(g.players[0].pos,25); // ladder 4=>25
  g.players[1].pos=79;
  Rules.turn(g,1);
  assert.equal(g.players[1].pos,49); // snake 80=>49
});
test('Lucky Box can award only once within a game', () => {
  const g=Rules.create(['a','b'],'vip');
  g.gift=15;g.players[0].pos=14;
  const first=Rules.turn(g,1,()=>0);
  assert.equal(first.reward,10);
  assert.equal(g.giftUsed,true);
  const prev=g.players[1].luckyEarned;
  g.players[1].pos=14;
  const second=Rules.turn(g,1,()=>0);
  assert.equal(second.reward,0);
  assert.equal(g.players[1].luckyEarned,prev);
});
test('a game still exposes only map 1 (feature gap, not a success)', () => {
  const g=Rules.create(['a','b'],'vip');
  assert.equal(g.map,1);
});
