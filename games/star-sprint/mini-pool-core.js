#!/usr/bin/env node
'use strict';

const TABLE = Object.freeze({
  width: 1000,
  height: 560,
  rail: 46,
  pocketR: 28,
  friction: 0.977,
  cushionBounce: 0.88,
  ballBounce: 0.96,
  tangentBounce: 0.992,
  railGrip: 0.985,
});

const COLORS = ['white', 'black'];
const MAX_EVENTS = 8;
const MAX_RACKS = 3;
const RACK_BONUS = 14;
const SHOT_MAX_DISTANCE = 220;
const SHOT_MIN_POWER = 0.04;
const SHOT_MIN_SPEED = 0.85;
const SHOT_SPEED = 12.1;
const SCRATCH_PENALTY = 6;
const BLOCKER_PENALTY = 8;
const STOP_EPSILON = 0.018;
const SOFT_SETTLE_SPEED = 0.11;
const TARGET_VALUE = 10;
const CROWN_VALUE = 18;
const TARGET_SUBSTEP_SECONDS = 1 / 120;
const LOW_SPEED_BRAKE_THRESHOLD = 1.15;
const LOW_SPEED_BRAKE = 0.93;
const POCKET_PULL = 0.3;

function capitalize(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}

function otherColor(color) {
  return color === 'white' ? 'black' : 'white';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneBall(ball) {
  return {
    id: ball.id,
    x: ball.x,
    y: ball.y,
    vx: ball.vx,
    vy: ball.vy,
    r: ball.r,
    color: ball.color,
    kind: ball.kind,
    label: ball.label,
    points: ball.points,
    sunk: Boolean(ball.sunk),
  };
}

function makeBall(id, x, y, color, kind, label, points = 0) {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    r: 11,
    color,
    kind,
    label,
    points,
    sunk: false,
  };
}

function pushEvent(game, text) {
  game.events.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
  });
  game.events = game.events.slice(0, MAX_EVENTS);
  game.status = text;
}

function getRackSpots() {
  const spacing = 23.5;
  const startX = TABLE.width * 0.665;
  const startY = TABLE.height / 2;
  const spots = [];
  for (let row = 0; row < 4; row += 1) {
    const x = startX + row * spacing;
    const count = row + 1;
    const topY = startY - ((count - 1) * spacing) / 2;
    for (let index = 0; index < count; index += 1) {
      spots.push({ x, y: topY + index * spacing });
    }
  }
  return spots;
}

function rackBalls() {
  const spots = getRackSpots();
  const targets = [
    ['flare-1', '#ff5f96', '1', TARGET_VALUE],
    ['flare-2', '#f7ca45', '2', TARGET_VALUE],
    ['flare-3', '#55e4ff', '3', TARGET_VALUE],
    ['flare-4', '#9cff6c', '4', TARGET_VALUE],
    ['flare-5', '#c27fff', '5', TARGET_VALUE],
    ['flare-6', '#ff9154', '6', TARGET_VALUE],
    ['flare-7', '#61c6ff', '7', TARGET_VALUE],
    ['crown', '#ffe37d', 'C', CROWN_VALUE],
    ['jammer-1', '#5d6679', 'X', -BLOCKER_PENALTY],
    ['jammer-2', '#4a5367', 'X', -BLOCKER_PENALTY],
  ];

  return targets.map((entry, index) => {
    const [id, color, label, points] = entry;
    const kind = points < 0 ? 'blocker' : id === 'crown' ? 'crown' : 'target';
    return makeBall(id, spots[index].x, spots[index].y, color, kind, label, points);
  });
}

function createCueBall() {
  return makeBall('cue', TABLE.width * 0.23, TABLE.height / 2, '#ffffff', 'cue', '', 0);
}

function createBalls() {
  return [createCueBall(), ...rackBalls()];
}

function createShotState(color) {
  return {
    shooter: color,
    pocketedTargets: 0,
    points: 0,
    penalties: 0,
    scratch: false,
  };
}

function createGameState() {
  return {
    roomCode: '',
    table: TABLE,
    rackNumber: 1,
    maxRacks: MAX_RACKS,
    turn: 'white',
    breaker: 'white',
    scores: {
      white: 0,
      black: 0,
    },
    balls: createBalls(),
    shotCount: 0,
    activeShot: null,
    status: 'Pocket the glowing targets, dodge the jammers, and race for the best score.',
    events: [
      {
        id: 'intro',
        text: 'Mini Pool Showdown is ready. First player breaks when both seats are filled.',
      },
    ],
    winner: null,
    drawReason: null,
  };
}

function cloneState(game) {
  return {
    table: { ...game.table },
    rackNumber: game.rackNumber,
    maxRacks: game.maxRacks,
    turn: game.turn,
    breaker: game.breaker,
    scores: {
      white: game.scores.white,
      black: game.scores.black,
    },
    balls: game.balls.map(cloneBall),
    shotCount: game.shotCount,
    moving: areBallsMoving(game),
    status: game.status,
    events: game.events.map((event) => ({ ...event })),
    winner: game.winner,
    drawReason: game.drawReason,
  };
}

function activeCue(game) {
  return game.balls.find((ball) => ball.kind === 'cue');
}

function targetBallsRemaining(game) {
  return game.balls.filter((ball) => !ball.sunk && (ball.kind === 'target' || ball.kind === 'crown')).length;
}

function feltBounds() {
  const minX = TABLE.rail;
  const minY = TABLE.rail;
  return {
    minX,
    minY,
    maxX: TABLE.width - TABLE.rail,
    maxY: TABLE.height - TABLE.rail,
  };
}

function pocketCoords() {
  const { minX, minY, maxX, maxY } = feltBounds();
  return [
    { x: minX, y: minY },
    { x: (minX + maxX) / 2, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: (minX + maxX) / 2, y: maxY },
    { x: maxX, y: maxY },
  ];
}

function isPositionClear(balls, x, y, radius) {
  return !balls.some((ball) => {
    if (ball.sunk || ball.kind === 'cue') {
      return false;
    }
    return Math.hypot(ball.x - x, ball.y - y) < ball.r + radius + 4;
  });
}

function respotCueBall(game) {
  const cue = activeCue(game);
  if (!cue) {
    return;
  }
  cue.sunk = false;
  cue.vx = 0;
  cue.vy = 0;

  const startX = TABLE.width * 0.23;
  const startY = TABLE.height / 2;
  cue.x = startX;
  cue.y = startY;
  if (isPositionClear(game.balls, startX, startY, cue.r)) {
    return;
  }

  for (let offset = 18; offset < TABLE.height * 0.28; offset += 14) {
    if (isPositionClear(game.balls, startX, startY - offset, cue.r)) {
      cue.y = startY - offset;
      return;
    }
    if (isPositionClear(game.balls, startX, startY + offset, cue.r)) {
      cue.y = startY + offset;
      return;
    }
  }
}

function areBallsMoving(game) {
  return game.balls.some((ball) => !ball.sunk && (Math.abs(ball.vx) > STOP_EPSILON || Math.abs(ball.vy) > STOP_EPSILON));
}

function maxBallSpeed(game) {
  return game.balls.reduce((max, ball) => {
    if (ball.sunk) {
      return max;
    }
    return Math.max(max, Math.hypot(ball.vx, ball.vy));
  }, 0);
}

function zeroAllVelocity(game) {
  for (const ball of game.balls) {
    ball.vx = 0;
    ball.vy = 0;
  }
}

function resolveRailBounce(ball, normalX, normalY) {
  const tangentX = -normalY;
  const tangentY = normalX;
  const normalVelocity = ball.vx * normalX + ball.vy * normalY;
  const tangentVelocity = ball.vx * tangentX + ball.vy * tangentY;
  if (normalVelocity >= 0) {
    return;
  }
  const bouncedNormal = -normalVelocity * TABLE.cushionBounce;
  const slowedTangent = tangentVelocity * TABLE.railGrip;
  ball.vx = normalX * bouncedNormal + tangentX * slowedTangent;
  ball.vy = normalY * bouncedNormal + tangentY * slowedTangent;
}

function resolveBallCollisions(game) {
  for (let i = 0; i < game.balls.length; i += 1) {
    for (let j = i + 1; j < game.balls.length; j += 1) {
      const a = game.balls[i];
      const b = game.balls[j];
      if (a.sunk || b.sunk) {
        continue;
      }

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const minDist = a.r + b.r;
      if (dist >= minDist) {
        continue;
      }

      if (dist < 0.0001) {
        dx = 1;
        dy = 0;
        dist = 1;
      }

      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      const separation = overlap / 2 + 0.02;
      a.x -= nx * separation;
      a.y -= ny * separation;
      b.x += nx * separation;
      b.y += ny * separation;

      const relativeNormalVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relativeNormalVelocity >= 0) {
        continue;
      }

      const tx = -ny;
      const ty = nx;
      const aNormal = a.vx * nx + a.vy * ny;
      const bNormal = b.vx * nx + b.vy * ny;
      const aTangent = a.vx * tx + a.vy * ty;
      const bTangent = b.vx * tx + b.vy * ty;

      const nextANormal = ((1 - TABLE.ballBounce) * aNormal + (1 + TABLE.ballBounce) * bNormal) / 2;
      const nextBNormal = ((1 + TABLE.ballBounce) * aNormal + (1 - TABLE.ballBounce) * bNormal) / 2;
      const nextATangent = aTangent * TABLE.tangentBounce;
      const nextBTangent = bTangent * TABLE.tangentBounce;

      a.vx = nx * nextANormal + tx * nextATangent;
      a.vy = ny * nextANormal + ty * nextATangent;
      b.vx = nx * nextBNormal + tx * nextBTangent;
      b.vy = ny * nextBNormal + ty * nextBTangent;
    }
  }
}

function stepBall(ball, timeScale, bounds, pockets, pocketCaptureR, pocketSinkR, hasPocketClearanceOnTopBottom, hasPocketClearanceOnLeftRight) {
  ball.x += ball.vx * timeScale;
  ball.y += ball.vy * timeScale;

  let frictionFactor = Math.pow(TABLE.friction, timeScale);
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < LOW_SPEED_BRAKE_THRESHOLD) {
    frictionFactor *= Math.pow(LOW_SPEED_BRAKE, timeScale);
  }
  ball.vx *= frictionFactor;
  ball.vy *= frictionFactor;

  if (Math.abs(ball.vx) < 0.006) {
    ball.vx = 0;
  }
  if (Math.abs(ball.vy) < 0.006) {
    ball.vy = 0;
  }

  for (const pocket of pockets) {
    const dx = ball.x - pocket.x;
    const dy = ball.y - pocket.y;
    const dist = Math.hypot(dx, dy);
    if (dist < pocketCaptureR && dist > 0.001) {
      const pull = ((pocketCaptureR - dist) / pocketCaptureR) * POCKET_PULL * timeScale;
      ball.vx -= (dx / dist) * pull;
      ball.vy -= (dy / dist) * pull;
    }
    if (dist < pocketSinkR) {
      return true;
    }
  }

  if (ball.x - ball.r < bounds.minX && !hasPocketClearanceOnLeftRight(ball.y, bounds.minX)) {
    ball.x = bounds.minX + ball.r;
    resolveRailBounce(ball, 1, 0);
  } else if (ball.x + ball.r > bounds.maxX && !hasPocketClearanceOnLeftRight(ball.y, bounds.maxX)) {
    ball.x = bounds.maxX - ball.r;
    resolveRailBounce(ball, -1, 0);
  }

  if (ball.y - ball.r < bounds.minY && !hasPocketClearanceOnTopBottom(ball.x, bounds.minY)) {
    ball.y = bounds.minY + ball.r;
    resolveRailBounce(ball, 0, 1);
  } else if (ball.y + ball.r > bounds.maxY && !hasPocketClearanceOnTopBottom(ball.x, bounds.maxY)) {
    ball.y = bounds.maxY - ball.r;
    resolveRailBounce(ball, 0, -1);
  }

  return false;
}

function resolvePocket(game, ball) {
  if (ball.sunk) {
    return;
  }
  ball.sunk = true;
  ball.vx = 0;
  ball.vy = 0;

  if (!game.activeShot) {
    return;
  }

  if (ball.kind === 'cue') {
    game.activeShot.scratch = true;
    return;
  }

  if (ball.kind === 'blocker') {
    game.activeShot.penalties += BLOCKER_PENALTY;
    return;
  }

  game.activeShot.pocketedTargets += 1;
  game.activeShot.points += ball.points;
}

function settleTurn(game) {
  const shot = game.activeShot;
  if (!shot) {
    return false;
  }

  const shooter = shot.shooter;
  const nextColor = otherColor(shooter);
  let delta = shot.points - shot.penalties;
  if (shot.scratch) {
    delta -= SCRATCH_PENALTY;
    respotCueBall(game);
  }
  game.scores[shooter] = Math.max(0, game.scores[shooter] + delta);

  const rackCleared = targetBallsRemaining(game) === 0;
  const turnKeeps = shot.pocketedTargets > 0 && !shot.scratch;

  const summaryParts = [];
  if (shot.pocketedTargets > 0) {
    summaryParts.push(`${capitalize(shooter)} pockets ${shot.pocketedTargets} target${shot.pocketedTargets === 1 ? '' : 's'} for ${shot.points}.`);
  } else {
    summaryParts.push(`${capitalize(shooter)} misses the scoring balls.`);
  }
  if (shot.penalties > 0) {
    summaryParts.push(`Jammer penalty -${shot.penalties}.`);
  }
  if (shot.scratch) {
    summaryParts.push(`Scratch -${SCRATCH_PENALTY}.`);
  }

  if (rackCleared) {
    game.scores[shooter] += RACK_BONUS;
    summaryParts.push(`Rack clear +${RACK_BONUS}.`);

    if (game.rackNumber >= game.maxRacks) {
      if (game.scores.white === game.scores.black) {
        game.drawReason = 'score-tie';
        game.winner = null;
        pushEvent(game, `${summaryParts.join(' ')} Match drawn ${game.scores.white}-${game.scores.black}.`);
      } else {
        const winner = game.scores.white > game.scores.black ? 'white' : 'black';
        game.winner = winner;
        game.drawReason = null;
        pushEvent(game, `${summaryParts.join(' ')} ${capitalize(winner)} wins ${game.scores.white}-${game.scores.black}.`);
      }
      game.activeShot = null;
      return true;
    }

    game.rackNumber += 1;
    game.breaker = otherColor(game.breaker);
    game.turn = game.breaker;
    game.balls = createBalls();
    game.activeShot = null;
    pushEvent(game, `${summaryParts.join(' ')} Rack ${game.rackNumber} is ready. ${capitalize(game.turn)} breaks next.`);
    return true;
  }

  game.turn = turnKeeps ? shooter : nextColor;
  game.activeShot = null;
  pushEvent(
    game,
    `${summaryParts.join(' ')} ${capitalize(turnKeeps ? shooter : nextColor)} ${turnKeeps ? 'shoots again' : 'shoots next'}.`
  );
  return true;
}

function applyShot(game, color, payload) {
  if (game.winner || game.drawReason) {
    return {
      ok: false,
      error: 'This match is already finished. Start a new one.',
    };
  }
  if (game.turn !== color) {
    return {
      ok: false,
      error: `It is ${capitalize(game.turn)}'s turn.`,
    };
  }
  if (areBallsMoving(game) || game.activeShot) {
    return {
      ok: false,
      error: 'Wait for the balls to stop before shooting again.',
    };
  }

  const cue = activeCue(game);
  if (!cue) {
    return {
      ok: false,
      error: 'Cue ball not found.',
    };
  }
  if (cue.sunk) {
    respotCueBall(game);
  }

  const rawX = Number(payload && payload.vectorX);
  const rawY = Number(payload && payload.vectorY);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return {
      ok: false,
      error: 'Shot vector is invalid.',
    };
  }

  const magnitude = Math.hypot(rawX, rawY);
  const explicitPower = Number(payload && payload.power);
  const normalizedPower = Number.isFinite(explicitPower)
    ? clamp(explicitPower, 0, 1)
    : clamp(magnitude / SHOT_MAX_DISTANCE, 0, 1);
  if (normalizedPower < SHOT_MIN_POWER || magnitude < 0.0001) {
    return {
      ok: false,
      error: 'Line up the cue and drag farther to load the shot.',
    };
  }

  const easedPower = Math.pow(normalizedPower, 1.28);
  const speed = SHOT_MIN_SPEED + easedPower * (SHOT_SPEED - SHOT_MIN_SPEED);
  cue.vx = (rawX / magnitude) * speed;
  cue.vy = (rawY / magnitude) * speed;
  game.shotCount += 1;
  game.activeShot = createShotState(color);
  game.status = `${capitalize(color)} sends the cue ball down-table.`;
  return { ok: true };
}

function step(game, deltaSeconds) {
  if (!areBallsMoving(game) && !game.activeShot) {
    return false;
  }

  const boundedDelta = clamp(deltaSeconds, TARGET_SUBSTEP_SECONDS, 0.12);
  const substeps = Math.max(1, Math.ceil(boundedDelta / TARGET_SUBSTEP_SECONDS));
  const substepSeconds = boundedDelta / substeps;
  const bounds = feltBounds();
  const pockets = pocketCoords();
  const pocketCaptureR = TABLE.pocketR + 4;
  const pocketSinkR = Math.max(7, TABLE.pocketR - 4);
  const mouthClearance = TABLE.pocketR * 1.45;

  const hasPocketClearanceOnTopBottom = (x, boundaryY) => pockets.some(
    (pocket) => Math.abs(pocket.y - boundaryY) < 1 && Math.abs(x - pocket.x) < mouthClearance
  );
  const hasPocketClearanceOnLeftRight = (y, boundaryX) => pockets.some(
    (pocket) => Math.abs(pocket.x - boundaryX) < 1 && Math.abs(y - pocket.y) < mouthClearance
  );

  for (let stepIndex = 0; stepIndex < substeps; stepIndex += 1) {
    const timeScale = clamp(substepSeconds * 60, 0.4, 1.1);

    for (const ball of game.balls) {
      if (ball.sunk) {
        continue;
      }
      if (stepBall(
        ball,
        timeScale,
        bounds,
        pockets,
        pocketCaptureR,
        pocketSinkR,
        hasPocketClearanceOnTopBottom,
        hasPocketClearanceOnLeftRight
      )) {
        resolvePocket(game, ball);
      }
    }

    resolveBallCollisions(game);
    resolveBallCollisions(game);

    if (!areBallsMoving(game)) {
      break;
    }
  }

  if (maxBallSpeed(game) < SOFT_SETTLE_SPEED) {
    zeroAllVelocity(game);
  }

  if (!areBallsMoving(game)) {
    settleTurn(game);
  }

  return true;
}

module.exports = {
  COLORS,
  TABLE,
  createGameState,
  cloneState,
  applyShot,
  step,
};
