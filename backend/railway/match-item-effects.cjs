'use strict';

// Draft pure rules only. No admission, persistence, WebSocket or payment
// integration. The snapshot must be authored by the server, never a client.
function planMatchItemEffects(game, board, landing) {
  if (!game || !Array.isArray(game.players) ||
      !Number.isSafeInteger(game.current) || game.current < 0 ||
      game.current >= game.players.length ||
      !Number.isSafeInteger(landing) || landing < 1 ||
      !board || !board.snakes || typeof board.snakes !== 'object') {
    throw Error('INVALID_MATCH_ITEM_INPUT');
  }

  const win = landing >= 100;
  if (!Object.hasOwn(game, 'matchItems')) {
    return { shieldUsed: false, winnerPoints: win ? 10 : 0, nextMatchItems: undefined };
  }

  const snapshot = game.matchItems;
  if (!snapshot || snapshot.version !== 1 ||
      !Array.isArray(snapshot.players) ||
      snapshot.players.length !== game.players.length || Object.keys(snapshot).length !== 2) {
    throw Error('INVALID_MATCH_ITEM_SNAPSHOT');
  }
  for (const entry of snapshot.players) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).length !== 2 ||
        !Object.hasOwn(entry, 'shieldRemaining') || !Object.hasOwn(entry, 'winMultiplier') ||
        (entry.shieldRemaining !== 0 && entry.shieldRemaining !== 1) ||
        (entry.winMultiplier !== 1 && entry.winMultiplier !== 2)) {
      throw Error('INVALID_MATCH_ITEM_SNAPSHOT');
    }
  }

  const item = snapshot.players[game.current];
  const shieldUsed = !win && item.shieldRemaining === 1 && Object.hasOwn(board.snakes, landing);
  const nextMatchItems = shieldUsed
    ? { version: 1, players: snapshot.players.map((entry, index) => index === game.current
        ? { ...entry, shieldRemaining: 0 }
        : entry) }
    : snapshot;
  return { shieldUsed, winnerPoints: win ? 10 * item.winMultiplier : 0, nextMatchItems };
}

module.exports = { planMatchItemEffects };
