'use strict';

const medals = ['🥇', '🥈', '🥉'];
const maxScore = '9223372036854775807'; // PostgreSQL bigint

function v12LeaderboardRows(result) {
  if (!Array.isArray(result?.scores)) throw TypeError('Invalid leaderboard scores');
  return Array.from(result.scores, (score, index) => {
    if (Number.isSafeInteger(score) && score >= 0) score = String(score);
    if (typeof score !== 'string' || score.length > maxScore.length ||
        !/^(0|[1-9][0-9]*)$/.test(score) ||
        (score.length === maxScore.length && score > maxScore))
      throw TypeError('Invalid leaderboard score');
    return [medals[index] ?? String(index + 1), '👤', 'ผู้เล่น', score];
  });
}

module.exports = { v12LeaderboardRows };
