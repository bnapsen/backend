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

  function longestPrime(state, player) {
    let best = 0;
    let streak = 0;
    for (let index = 0; index < 24; index += 1) {
      const value = state.points[index];
      const owned = player === WHITE ? value >= 2 : value <= -2;
      if (owned) {
        streak += 1;
        if (streak > best) {
          best = streak;
        }
      } else {
        streak = 0;
      }
    }
    return best;
  }

  function rearCheckerDistance(state, player) {
    if (state.bar[player] > 0) {
      return 25;
    }
    if (player === WHITE) {
      for (let index = 23; index >= 0; index -= 1) {
        if (state.points[index] > 0) {
          return index + 1;
        }
      }
      return 0;
    }
    for (let index = 0; index < 24; index += 1) {
      if (state.points[index] < 0) {
        return 24 - index;
      }
    }
    return 0;
  }

  function stackPressure(state, player) {
    let total = 0;
    for (let index = 0; index < 24; index += 1) {
      const value = player === WHITE
        ? Math.max(0, state.points[index])
        : Math.max(0, -state.points[index]);
      if (value > 3) {
        total += value - 3;
      }
    }
    return total;
  }

  function directShotsOnPoint(state, attacker, targetIndex) {
    let total = 0;
    if (state.bar[attacker] > 0) {
      const entryDie = attacker === WHITE ? 24 - targetIndex : targetIndex + 1;
      return entryDie >= 1 && entryDie <= 6 ? 1 : 0;
    }

    for (let source = 0; source < 24; source += 1) {
      if (!hasChecker(state, attacker, source)) {
        continue;
      }
      const die = attacker === WHITE ? source - targetIndex : targetIndex - source;
      if (die >= 1 && die <= 6) {
        total += 1;
      }
    }
    return total;
  }

  function attackPressure(state, player) {
    let total = 0;
    for (let index = 0; index < 24; index += 1) {
      if ((player === WHITE && state.points[index] === -1) ||
          (player === BLACK && state.points[index] === 1)) {
        total += directShotsOnPoint(state, player, index);
      }
    }
    return total;
  }

  function exposedBlotThreat(state, player) {
    let total = state.bar[player] * 6;
    for (let index = 0; index < 24; index += 1) {
      if ((player === WHITE && state.points[index] === 1) ||
          (player === BLACK && state.points[index] === -1)) {
        total += directShotsOnPoint(state, -player, index);
      }
    }
    return total;
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
    const myPrime = longestPrime(state, player);
    const opponentPrime = longestPrime(state, -player);
    const myRear = rearCheckerDistance(state, player);
    const opponentRear = rearCheckerDistance(state, -player);
    const myThreat = attackPressure(state, player);
    const opponentThreat = attackPressure(state, -player);
    const myRisk = exposedBlotThreat(state, player);
    const opponentRisk = exposedBlotThreat(state, -player);
    const myStacks = stackPressure(state, player);
    const opponentStacks = stackPressure(state, -player);
    const pipEdge = opponentPip - myPip;

    let score = 0;
    score += (state.borneOff[player] - state.borneOff[-player]) * 75;
    score += (state.bar[-player] - state.bar[player]) * 55;
    score += pipEdge * 1.2;
    score += (opponentBlots - myBlots) * 11;
    score += myMadePoints * 8;
    score += myAnchors * 7;
    score += myHome * 10;
    score += (myPrime - opponentPrime) * 12;
    score += (myThreat - opponentThreat) * 7;
    score += (opponentRisk - myRisk) * 6;
    score += (opponentRear - myRear) * 1.6;
    score += (opponentStacks - myStacks) * 3.5;

    if (phase === 'race') {
      score += pipEdge * 1.6;
      score += state.borneOff[player] * 25;
      score -= myBlots * 6;
      score -= myRisk * 4.5;
      score -= myRear * 1.6;
    } else if (phase === 'attack') {
      score += state.bar[-player] * 35;
      score += myHome * 14;
      score += opponentBlots * 16;
      score += myThreat * 10;
      score += myPrime * 5;
    } else if (phase === 'prime') {
      score += myMadePoints * 14;
      score += myAnchors * 12;
      score -= myBlots * 8;
      score += myPrime * 14;
      score -= myStacks * 4;
    } else {
      score += myAnchors * 8;
      score += opponentBlots * 8;
      score += myThreat * 7;
      score -= myRisk * 5.5;
    }

    return score;
  }

  function createRollOutcomes() {
    const outcomes = [];
    for (let first = 1; first <= 6; first += 1) {
      for (let second = first; second <= 6; second += 1) {
        outcomes.push({
          dice: [first, second],
          weight: first === second ? 1 : 2,
        });
      }
    }
    return outcomes;
  }

  const ROLL_OUTCOMES = createRollOutcomes();

  function moveExecutionValue(move, player) {
    if (!move) {
      return 0;
    }
    if (move.to === 'off') {
      return move.die + 2;
    }
    return player === WHITE ? move.from - move.to : move.to - move.from;
  }

  function normalizePlannedMove(move) {
    return {
      from: move.from,
      to: move.to,
      die: move.die,
      di: move.di,
      bearOff: Boolean(move.bearOff),
    };
  }

  function getTurnPlans(state, player = state.current) {
    const plans = [];
    const initial = cloneState(state);

    function visit(position, sequence, stats) {
      if (position.winner || position.current !== player || !position.dice.length) {
        if (sequence.length) {
          plans.push({
            moves: sequence.slice(),
            firstMove: sequence[0],
            resultState: cloneState(position),
            stats: {
              hits: stats.hits,
              bearOffs: stats.bearOffs,
              entries: stats.entries,
              progress: stats.progress,
            },
          });
        }
        return;
      }

      const legalMoves = getAllLegalMoves(position, player, position.dice);
      if (!legalMoves.length) {
        if (sequence.length) {
          plans.push({
            moves: sequence.slice(),
            firstMove: sequence[0],
            resultState: cloneState(position),
            stats: {
              hits: stats.hits,
              bearOffs: stats.bearOffs,
              entries: stats.entries,
              progress: stats.progress,
            },
          });
        }
        return;
      }

      const seen = new Set();
      for (const move of legalMoves) {
        const key = `${move.from}|${move.to}|${move.die}|${move.bearOff ? 'off' : 'board'}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const sandbox = cloneState(position);
        sandbox.current = player;
        sandbox.dice = position.dice.slice();
        const result = applyMove(sandbox, move);
        if (!result.ok) {
          continue;
        }
        sequence.push(normalizePlannedMove(move));
        visit(sandbox, sequence, {
          hits: stats.hits + (result.hit ? 1 : 0),
          bearOffs: stats.bearOffs + (move.to === 'off' ? 1 : 0),
          entries: stats.entries + (move.from === 'bar' ? 1 : 0),
          progress: stats.progress + moveExecutionValue(move, player),
        });
        sequence.pop();
      }
    }

    visit(initial, [], {
      hits: 0,
      bearOffs: 0,
      entries: 0,
      progress: 0,
    });
    return plans;
  }

  function scoreTurnPlan(initialState, plan, player) {
    const beforeMadePoints = madePoints(initialState, player);
    const beforeHome = homeBoardStrength(initialState, player);
    const beforePrime = longestPrime(initialState, player);
    const beforeThreat = attackPressure(initialState, player);
    const beforeRisk = exposedBlotThreat(initialState, player);
    const beforePip = pipCount(initialState, player);
    const beforeRear = rearCheckerDistance(initialState, player);

    const after = plan.resultState;
    let score = evaluateBoard(after, player);
    score += plan.stats.progress * 2.2;
    score += plan.stats.hits * 34;
    score += plan.stats.bearOffs * 42;
    score += plan.stats.entries * 18;
    score += Math.max(0, beforeMadePoints - madePoints(after, player)) * -8;
    score += (madePoints(after, player) - beforeMadePoints) * 16;
    score += (homeBoardStrength(after, player) - beforeHome) * 14;
    score += (longestPrime(after, player) - beforePrime) * 18;
    score += (attackPressure(after, player) - beforeThreat) * 9;
    score += (beforeRisk - exposedBlotThreat(after, player)) * 7;
    score -= Math.max(0, exposedBlotThreat(after, player) - beforeRisk) * 11;
    score += (beforePip - pipCount(after, player)) * 0.65;
    score += (beforeRear - rearCheckerDistance(after, player)) * 1.4;

    if (after.winner === player) {
      score += 100000;
    }
    if (after.winner === -player) {
      score -= 100000;
    }
    return score;
  }

  function chooseBestTurnPlan(state, player = state.current, options = {}) {
    const includeReply = options.includeReply !== false;
    const maxReplyCandidates = Math.max(1, options.maxReplyCandidates || 6);
    const plans = getTurnPlans(state, player);
    if (!plans.length) {
      return null;
    }

    for (const plan of plans) {
      plan.baseScore = scoreTurnPlan(state, plan, player);
      plan.score = plan.baseScore;
    }

    if (includeReply) {
      const candidates = [...plans]
        .sort((left, right) => right.baseScore - left.baseScore)
        .slice(0, Math.min(maxReplyCandidates, plans.length));
      for (const plan of candidates) {
        const replyScore = estimateOpponentReply(plan.resultState, player);
        plan.score = plan.baseScore * 0.6 + replyScore * 0.4;
      }
    }

    return plans.reduce((best, candidate) => {
      if (!best || candidate.score > best.score) {
        return candidate;
      }
      if (candidate.score < best.score) {
        return best;
      }
      return candidate.moves.length > best.moves.length ? candidate : best;
    }, null);
  }

  function estimateOpponentReply(state, player) {
    if (state.winner === player) {
      return 100000;
    }
    if (state.winner === -player) {
      return -100000;
    }

    const opponent = -player;
    let total = 0;
    let weightTotal = 0;

    for (const outcome of ROLL_OUTCOMES) {
      const sandbox = cloneState(state);
      sandbox.current = opponent;
      sandbox.dice = [];
      const roll = rollDice(sandbox, outcome.dice);
      if (!roll.ok) {
        continue;
      }

      let score;
      if (sandbox.winner) {
        score = evaluateBoard(sandbox, player);
      } else if (roll.passed || sandbox.current !== opponent || !sandbox.dice.length) {
        score = evaluateBoard(sandbox, player);
      } else {
        const reply = chooseBestTurnPlan(sandbox, opponent, {
          includeReply: false,
          maxReplyCandidates: 4,
        });
        score = reply ? evaluateBoard(reply.resultState, player) : evaluateBoard(sandbox, player);
      }

      total += score * outcome.weight;
      weightTotal += outcome.weight;
    }

    return weightTotal ? total / weightTotal : evaluateBoard(state, player);
  }

  function chooseBestMove(state, player = state.current, dice = state.dice) {
    const sandbox = cloneState(state);
    sandbox.current = player;
    sandbox.dice = Array.isArray(dice) ? dice.slice() : [];
    const plan = chooseBestTurnPlan(sandbox, player, {
      includeReply: true,
      maxReplyCandidates: 6,
    });
    if (!plan || !plan.firstMove) {
      return null;
    }

    return {
      move: normalizePlannedMove(plan.firstMove),
      score: plan.score,
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
