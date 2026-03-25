(function (globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.NeonBackgammonCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const WHITE = 1;
  const BLACK = -1;
  const START_POINTS = [
    -2, 0, 0, 0, 0, 5,
    0, 3, 0, 0, 0, -5,
    5, 0, 0, 0, -3, 0,
    -5, 0, 0, 0, 0, 2,
  ];

  function playerName(player) {
    return player === WHITE ? 'White' : 'Black';
  }

  function createCounts(white = 0, black = 0) {
    return {
      1: white,
      [-1]: black,
    };
  }

  function createGameState() {
    return {
      title: 'Neon Backgammon Blitz',
      points: START_POINTS.slice(),
      current: WHITE,
      bar: createCounts(),
      borneOff: createCounts(),
      dice: [],
      lastRoll: [0, 0],
      winner: 0,
      status: 'White to roll.',
    };
  }

  function cloneState(state) {
    return {
      title: state.title || 'Neon Backgammon Blitz',
      points: state.points.slice(),
      current: state.current,
      bar: createCounts(state.bar[WHITE], state.bar[BLACK]),
      borneOff: createCounts(state.borneOff[WHITE], state.borneOff[BLACK]),
      dice: state.dice.slice(),
      lastRoll: Array.isArray(state.lastRoll) ? state.lastRoll.slice(0, 2) : [0, 0],
      winner: state.winner || 0,
      status: state.status || '',
    };
  }

  function isHome(player, index) {
    return player === WHITE
      ? index >= 0 && index <= 5
      : index >= 18 && index <= 23;
  }

  function allInHome(state, player) {
    if (state.bar[player] > 0) {
      return false;
    }
    for (let index = 0; index < 24; index += 1) {
      const value = state.points[index];
      if ((player === WHITE && value > 0 && !isHome(player, index)) ||
          (player === BLACK && value < 0 && !isHome(player, index))) {
        return false;
      }
    }
    return true;
  }

  function canLand(state, player, index) {
    const value = state.points[index];
    return player === WHITE ? value >= -1 : value <= 1;
  }

  function hasChecker(state, player, source) {
    if (source === 'bar') {
      return state.bar[player] > 0;
    }
    const value = state.points[source];
    return player === WHITE ? value > 0 : value < 0;
  }

  function normalizeSource(raw) {
    if (raw === 'bar') {
      return 'bar';
    }
    const source = Number(raw);
    if (!Number.isInteger(source) || source < 0 || source > 23) {
      return null;
    }
    return source;
  }

  function normalizeDestination(raw) {
    if (raw === 'off') {
      return 'off';
    }
    const destination = Number(raw);
    if (!Number.isInteger(destination) || destination < 0 || destination > 23) {
      return null;
    }
    return destination;
  }

  function getLegalMovesForSource(state, rawSource, player = state.current, dice = state.dice) {
    if (state.winner || !Array.isArray(dice) || !dice.length) {
      return [];
    }

    const source = normalizeSource(rawSource);
    if (source === null) {
      return [];
    }

    if (!hasChecker(state, player, source)) {
      return [];
    }

    const moves = [];
    for (let dieIndex = 0; dieIndex < dice.length; dieIndex += 1) {
      const die = Number(dice[dieIndex]);
      if (!Number.isInteger(die) || die < 1 || die > 6) {
        continue;
      }

      if (state.bar[player] > 0 && source !== 'bar') {
        continue;
      }

      const to = source === 'bar'
        ? (player === WHITE ? 24 - die : die - 1)
        : source + (player === WHITE ? -die : die);

      if (to >= 0 && to <= 23) {
        if (canLand(state, player, to)) {
          moves.push({
            from: source,
            to,
            die,
            di: dieIndex,
            bearOff: false,
          });
        }
        continue;
      }

      if (source === 'bar' || !allInHome(state, player) || !isHome(player, source)) {
        continue;
      }

      if (player === WHITE && to < 0) {
        let higherChecker = false;
        for (let index = source + 1; index <= 5; index += 1) {
          if (state.points[index] > 0) {
            higherChecker = true;
            break;
          }
        }
        if (to === -1 || !higherChecker) {
          moves.push({
            from: source,
            to: 'off',
            die,
            di: dieIndex,
            bearOff: true,
          });
        }
      }

      if (player === BLACK && to > 23) {
        let lowerChecker = false;
        for (let index = 18; index < source; index += 1) {
          if (state.points[index] < 0) {
            lowerChecker = true;
            break;
          }
        }
        if (to === 24 || !lowerChecker) {
          moves.push({
            from: source,
            to: 'off',
            die,
            di: dieIndex,
            bearOff: true,
          });
        }
      }
    }

    return moves;
  }

  function getAllSources(state, player = state.current) {
    if (state.bar[player] > 0) {
      return ['bar'];
    }

    const sources = [];
    for (let index = 0; index < 24; index += 1) {
      if (hasChecker(state, player, index)) {
        sources.push(index);
      }
    }
    return sources;
  }

  function getAllLegalMoves(state, player = state.current, dice = state.dice) {
    const moves = [];
    for (const source of getAllSources(state, player)) {
      moves.push(...getLegalMovesForSource(state, source, player, dice));
    }
    return moves;
  }

  function hasAnyLegalMove(state, player = state.current, dice = state.dice) {
    return getAllLegalMoves(state, player, dice).length > 0;
  }

  function endTurn(state, status) {
    state.current *= -1;
    state.dice = [];
    state.status = status || `${playerName(state.current)} to roll.`;
  }

  function rollDice(state, forcedRoll) {
    if (state.winner) {
      return { ok: false, error: 'The match is already over.' };
    }
    if (state.dice.length) {
      return { ok: false, error: 'Use your remaining dice first.' };
    }

    const values = Array.isArray(forcedRoll)
      ? forcedRoll.slice(0, 2).map((value) => Number(value))
      : [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];

    const [first, second] = values;
    if (![first, second].every((value) => Number.isInteger(value) && value >= 1 && value <= 6)) {
      return { ok: false, error: 'Dice must be values from 1 to 6.' };
    }

    const roller = state.current;
    state.lastRoll = [first, second];
    state.dice = first === second ? [first, first, first, first] : [first, second];

    if (!hasAnyLegalMove(state, roller)) {
      endTurn(state, `No legal moves for ${playerName(roller)}. ${playerName(state.current * -1)} to roll.`);
      return {
        ok: true,
        rolled: [first, second],
        passed: true,
      };
    }

    state.status = `${playerName(roller)} rolled ${first} and ${second}.`;
    return {
      ok: true,
      rolled: [first, second],
      passed: false,
    };
  }

  function moveMatches(candidate, target) {
    return candidate.from === target.from &&
      candidate.to === target.to &&
      (target.di === undefined || candidate.di === target.di) &&
      (target.die === undefined || candidate.die === target.die);
  }

  function resolveLegalMove(state, rawMove) {
    const target = {
      from: normalizeSource(rawMove && rawMove.from),
      to: normalizeDestination(rawMove && rawMove.to),
      di: rawMove && Number.isInteger(rawMove.di) ? rawMove.di : undefined,
      die: rawMove && Number.isInteger(rawMove.die) ? rawMove.die : undefined,
    };

    if (target.from === null || target.to === null) {
      return null;
    }

    const legalMoves = getLegalMovesForSource(state, target.from);
    if (!legalMoves.length) {
      return null;
    }

    return legalMoves.find((candidate) => moveMatches(candidate, target)) ||
      legalMoves.find((candidate) => candidate.from === target.from && candidate.to === target.to) ||
      null;
  }

  function applyMove(state, rawMove) {
    if (state.winner) {
      return { ok: false, error: 'The match is already over.' };
    }
    if (!state.dice.length) {
      return { ok: false, error: 'Roll the dice first.' };
    }

    const move = resolveLegalMove(state, rawMove);
    if (!move) {
      return { ok: false, error: 'That backgammon move is not legal.' };
    }

    const player = state.current;
    let hit = false;

    if (move.from === 'bar') {
      state.bar[player] -= 1;
    } else {
      state.points[move.from] += player === WHITE ? -1 : 1;
    }

    if (move.to === 'off') {
      state.borneOff[player] += 1;
    } else {
      const destinationValue = state.points[move.to];
      if (player === WHITE && destinationValue === -1) {
        state.points[move.to] = 0;
        state.bar[BLACK] += 1;
        hit = true;
      }
      if (player === BLACK && destinationValue === 1) {
        state.points[move.to] = 0;
        state.bar[WHITE] += 1;
        hit = true;
      }
      state.points[move.to] += player;
    }

    state.dice.splice(move.di, 1);

    if (state.borneOff[player] >= 15) {
      state.winner = player;
      state.dice = [];
      state.status = `${playerName(player)} wins the match.`;
      return {
        ok: true,
        move,
        hit,
        winner: player,
      };
    }

    if (!state.dice.length) {
      endTurn(state, `${playerName(player)} finished the turn. ${playerName(player * -1)} to roll.`);
      return {
        ok: true,
        move,
        hit,
        turnEnded: true,
      };
    }

    if (!hasAnyLegalMove(state, player)) {
      endTurn(state, `No remaining legal moves for ${playerName(player)}. ${playerName(player * -1)} to roll.`);
      return {
        ok: true,
        move,
        hit,
        turnEnded: true,
        passed: true,
      };
    }

    state.status = `${playerName(player)} to move. ${state.dice.length} die${state.dice.length === 1 ? '' : 's'} left.`;
    return {
      ok: true,
      move,
      hit,
      turnEnded: false,
    };
  }

  function cloneBoardState(state) {
    return {
      points: state.points.slice(),
      bar: createCounts(state.bar[WHITE], state.bar[BLACK]),
      borneOff: createCounts(state.borneOff[WHITE], state.borneOff[BLACK]),
    };
  }

  function pipCount(state, player) {
    let total = state.bar[player] * 25;
    for (let index = 0; index < 24; index += 1) {
      const count = player === WHITE
        ? Math.max(0, state.points[index])
        : Math.max(0, -state.points[index]);
      if (!count) {
        continue;
      }
      const distance = player === WHITE ? index + 1 : 24 - index;
      total += count * distance;
    }
    return total;
  }

  function blotsExposed(state, player) {
    let count = 0;
    for (let index = 0; index < 24; index += 1) {
      if ((player === WHITE && state.points[index] === 1) ||
          (player === BLACK && state.points[index] === -1)) {
        count += 1;
      }
    }
    return count;
  }

  function madePoints(state, player) {
    let count = 0;
    for (let index = 0; index < 24; index += 1) {
      const value = state.points[index];
      if ((player === WHITE && value >= 2) || (player === BLACK && value <= -2)) {
        count += 1;
      }
    }
    return count;
  }

  function anchoredPoints(state, player) {
    const start = player === WHITE ? 18 : 0;
    const end = player === WHITE ? 23 : 5;
    let count = 0;
    for (let index = start; index <= end; index += 1) {
      const value = state.points[index];
      if ((player === WHITE && value >= 2) || (player === BLACK && value <= -2)) {
        count += 1;
      }
    }
    return count;
  }

  function homeBoardStrength(state, player) {
    const start = player === WHITE ? 0 : 18;
    const end = player === WHITE ? 5 : 23;
    let count = 0;
    for (let index = start; index <= end; index += 1) {
      const value = state.points[index];
      if ((player === WHITE && value >= 2) || (player === BLACK && value <= -2)) {
        count += 1;
      }
    }
    return count;
  }

  function boardPhase(state, player) {
    const myPip = pipCount(state, player);
    const opponentPip = pipCount(state, -player);
    if (state.borneOff[player] >= 8 || myPip < 70) {
      return 'race';
    }
    if (state.bar[-player] > 0 || homeBoardStrength(state, player) >= 4) {
      return 'attack';
    }
    if (opponentPip - myPip > 25) {
      return 'prime';
    }
    return 'contact';
  }

  function evaluateBoard(state, player) {
    const phase = boardPhase(state, player);
    const myPip = pipCount(state, player);
    const opponentPip = pipCount(state, -player);
    const myBlots = blotsExposed(state, player);
    const opponentBlots = blotsExposed(state, -player);
    const myMadePoints = madePoints(state, player);
    const myAnchors = anchoredPoints(state, player);
    const myHome = homeBoardStrength(state, player);
    const pipEdge = opponentPip - myPip;

    let score = 0;
    score += (state.borneOff[player] - state.borneOff[-player]) * 75;
    score += (state.bar[-player] - state.bar[player]) * 55;
    score += pipEdge * 1.2;
    score += (opponentBlots - myBlots) * 11;
    score += myMadePoints * 8;
    score += myAnchors * 7;
    score += myHome * 10;

    if (phase === 'race') {
      score += pipEdge * 1.6;
      score += state.borneOff[player] * 25;
      score -= myBlots * 6;
    } else if (phase === 'attack') {
      score += state.bar[-player] * 35;
      score += myHome * 14;
      score += opponentBlots * 16;
    } else if (phase === 'prime') {
      score += myMadePoints * 14;
      score += myAnchors * 12;
      score -= myBlots * 8;
    } else {
      score += myAnchors * 8;
      score += opponentBlots * 8;
    }

    return score;
  }

  function chooseBestMove(state, player = state.current, dice = state.dice) {
    const legalMoves = getAllLegalMoves(state, player, dice);
    if (!legalMoves.length) {
      return null;
    }

    let best = null;
    let bestScore = -Infinity;

    for (const move of legalMoves) {
      const sandbox = cloneState(state);
      sandbox.current = player;
      sandbox.dice = dice.slice();
      const result = applyMove(sandbox, move);
      if (!result.ok) {
        continue;
      }

      let score = evaluateBoard(cloneBoardState(sandbox), player);
      if (sandbox.current === player && sandbox.dice.length) {
        const followUp = chooseBestMove(sandbox, player, sandbox.dice);
        if (followUp) {
          score += followUp.score * 0.55;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }

    if (!best) {
      return null;
    }

    return {
      move: {
        from: best.from,
        to: best.to,
        die: best.die,
        di: best.di,
        bearOff: best.bearOff,
      },
      score: bestScore,
    };
  }

  function moveProgressForPlayer(move, player) {
    if (!move) {
      return -Infinity;
    }
    if (move.to === 'off') {
      return 999;
    }
    return player === WHITE ? move.from - move.to : move.to - move.from;
  }

  function furthestMove(moves, player) {
    if (!Array.isArray(moves) || !moves.length) {
      return null;
    }
    return moves.reduce((best, candidate) => {
      if (!best) {
        return candidate;
      }
      const candidateScore = moveProgressForPlayer(candidate, player);
      const bestScore = moveProgressForPlayer(best, player);
      if (candidateScore > bestScore) {
        return candidate;
      }
      if (candidateScore < bestScore) {
        return best;
      }
      if (candidate.to === 'off' && best.to !== 'off') {
        return candidate;
      }
      if (candidate.to !== 'off' && best.to === 'off') {
        return best;
      }
      return candidate.die >= best.die ? candidate : best;
    }, null);
  }

  return {
    WHITE,
    BLACK,
    createGameState,
    cloneState,
    playerName,
    getAllSources,
    getAllLegalMoves,
    getLegalMovesForSource,
    hasAnyLegalMove,
    moveProgressForPlayer,
    furthestMove,
    rollDice,
    applyMove,
    evaluateBoard,
    chooseBestMove,
  };
});
