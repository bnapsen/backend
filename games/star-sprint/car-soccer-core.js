(function (globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.CarSoccerTurboCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ARENA = Object.freeze({
    width: 1600,
    height: 900,
    goalWidth: 260,
    goalDepth: 95,
  });
  const MATCH_SECONDS = 180;
  const SCORE_TO_WIN = 5;
  const MAX_PLAYERS = 2;
  const FIXED_DT = 1 / 120;
  const MAX_EVENTS = 28;
  const PLAYER_COLORS = ['#4ec9ff', '#ff8c77'];
  const TEAM_KEYS = ['blue', 'orange'];
  const BOOST_PAD_COOLDOWN = 7;
  const BOOST_PAD_RADIUS = 34;
  const CAR_TURN_POWER = 2.45;
  const CAR_MAX_ANGULAR_SPEED = 0.095;
  const CAR_ACCELERATION = 720;
  const BOOST_FORCE = 1200;
  const BOOST_DRAIN_PER_SEC = 33;
  const BOOST_REGEN_PER_SEC = 12;
  const CAR_MAX_SPEED = 560;
  const BALL_MAX_SPEED = 860;
  const CAR_COLLISION_RADIUS_SCALE = 0.42;
  const DEMOLITION_RELATIVE_SPEED = 520;
  const RESPAWN_SECONDS = 1.1;

  const BOOST_PAD_LAYOUT = Object.freeze([
    { x: ARENA.width * 0.27, y: ARENA.height * 0.24 },
    { x: ARENA.width * 0.5, y: ARENA.height * 0.2 },
    { x: ARENA.width * 0.73, y: ARENA.height * 0.24 },
    { x: ARENA.width * 0.27, y: ARENA.height * 0.76 },
    { x: ARENA.width * 0.5, y: ARENA.height * 0.8 },
    { x: ARENA.width * 0.73, y: ARENA.height * 0.76 },
  ]);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function len(vector) {
    return Math.hypot(vector.x, vector.y);
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function angleToVector(angle) {
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
    };
  }

  function wrapAngle(angle) {
    while (angle > Math.PI) {
      angle -= Math.PI * 2;
    }
    while (angle < -Math.PI) {
      angle += Math.PI * 2;
    }
    return angle;
  }

  function createBall() {
    return {
      x: ARENA.width * 0.5,
      y: ARENA.height * 0.5,
      vx: 0,
      vy: 0,
      radius: 25,
      lastTouchPlayerId: '',
      lastTouchName: '',
      lastTouchSide: '',
    };
  }

  function defaultInput() {
    return {
      throttle: 0,
      steer: 0,
      boost: false,
      handbrake: false,
    };
  }

  function spawnForSeat(seat) {
    return {
      x: seat === 0 ? ARENA.width * 0.25 : ARENA.width * 0.75,
      y: ARENA.height * 0.5,
      angle: seat === 0 ? 0 : Math.PI,
    };
  }

  function teamKeyForSeat(seat) {
    return TEAM_KEYS[seat] || TEAM_KEYS[0];
  }

  function createPlayer(seat, id, name, color) {
    const spawn = spawnForSeat(seat);
    return {
      id,
      name,
      seat,
      team: teamKeyForSeat(seat),
      color: color || PLAYER_COLORS[seat] || PLAYER_COLORS[0],
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      angle: spawn.angle,
      angVel: 0,
      w: 84,
      h: 48,
      boost: 100,
      score: 0,
      touches: 0,
      boostPickups: 0,
      demolished: false,
      respawnTimer: 0,
      input: defaultInput(),
    };
  }

  function clonePlayer(player) {
    return {
      id: player.id,
      name: player.name,
      seat: player.seat,
      team: player.team,
      color: player.color,
      x: player.x,
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      angle: player.angle,
      angVel: player.angVel,
      w: player.w,
      h: player.h,
      boost: player.boost,
      score: player.score,
      touches: player.touches,
      boostPickups: player.boostPickups,
      demolished: player.demolished,
      respawnTimer: player.respawnTimer,
    };
  }

  function createBoostPads() {
    return BOOST_PAD_LAYOUT.map((pad, index) => ({
      id: index + 1,
      x: pad.x,
      y: pad.y,
      radius: BOOST_PAD_RADIUS,
      active: true,
      cooldown: 0,
    }));
  }

  function clonePad(pad) {
    return {
      id: pad.id,
      x: pad.x,
      y: pad.y,
      radius: pad.radius,
      active: pad.active,
      cooldown: pad.cooldown,
    };
  }

  function pushEvent(state, type, payload) {
    state.events.push({
      id: ++state.lastEventId,
      type,
      createdAt: Number(state.elapsed.toFixed(3)),
      ...payload,
    });
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS);
    }
  }

  function setStatus(state, text) {
    state.status = text;
  }

  function createGameState() {
    return {
      title: 'Car Soccer Mini - Turbo Arena Live',
      arena: { ...ARENA },
      roomCode: '',
      status: 'Host a room, invite another driver, or launch solo against Turbo Bot.',
      phase: 'waiting',
      overtime: false,
      winnerId: '',
      winnerName: '',
      scoreLimit: SCORE_TO_WIN,
      timeRemaining: MATCH_SECONDS,
      kickoffTimer: 0,
      elapsed: 0,
      accumulator: 0,
      ball: createBall(),
      players: [],
      boostPads: createBoostPads(),
      events: [],
      lastEventId: 0,
    };
  }

  function cloneState(state) {
    return {
      title: state.title,
      arena: { ...state.arena },
      roomCode: state.roomCode || '',
      status: state.status,
      phase: state.phase,
      overtime: state.overtime,
      winnerId: state.winnerId,
      winnerName: state.winnerName,
      scoreLimit: state.scoreLimit,
      timeRemaining: state.timeRemaining,
      kickoffTimer: state.kickoffTimer,
      elapsed: state.elapsed,
      ball: { ...state.ball },
      score: {
        blue: state.players.find((player) => player.team === 'blue')?.score || 0,
        orange: state.players.find((player) => player.team === 'orange')?.score || 0,
      },
      players: state.players.map(clonePlayer),
      boostPads: state.boostPads.map(clonePad),
      events: state.events.map((event) => ({ ...event })),
    };
  }

  function findPlayer(state, playerId) {
    return state.players.find((player) => player.id === playerId) || null;
  }

  function ballKickoffVelocity() {
    return {
      x: (Math.random() > 0.5 ? 1 : -1) * (140 + Math.random() * 60),
      y: (Math.random() - 0.5) * 120,
    };
  }

  function placePlayerAtSpawn(player) {
    const spawn = spawnForSeat(player.seat);
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.angle = spawn.angle;
    player.angVel = 0;
    player.demolished = false;
    player.respawnTimer = 0;
  }

  function resetBoostPads(state) {
    state.boostPads.forEach((pad) => {
      pad.active = true;
      pad.cooldown = 0;
    });
  }

  function resetBallForKickoff(state) {
    state.ball = createBall();
  }

  function resetPositions(state, refillBoost) {
    state.players.forEach((player) => {
      placePlayerAtSpawn(player);
      player.boost = refillBoost ? 100 : Math.max(player.boost, 55);
    });
    resetBallForKickoff(state);
  }

  function startKickoff(state, reason) {
    resetPositions(state, true);
    state.phase = 'countdown';
    state.kickoffTimer = state.overtime ? 2.1 : 2.6;
    state.winnerId = '';
    state.winnerName = '';
    setStatus(state, reason || (state.overtime
      ? 'Overtime live. Next goal wins.'
      : state.players.length >= 2
        ? 'Both drivers locked in. Kickoff in 3.'
        : 'Waiting for another driver.'));
    pushEvent(state, 'kickoff', {
      overtime: state.overtime,
      message: state.status,
    });
  }

  function freshMatch(state, reason) {
    state.timeRemaining = MATCH_SECONDS;
    state.overtime = false;
    state.events = [];
    state.lastEventId = 0;
    state.players.forEach((player) => {
      player.score = 0;
      player.touches = 0;
      player.boostPickups = 0;
      player.input = defaultInput();
    });
    resetBoostPads(state);
    startKickoff(state, reason || 'Turbo Arena is live. Kickoff in 3.');
  }

  function addPlayer(state, info) {
    const existing = findPlayer(state, info.id);
    if (existing) {
      existing.name = info.name;
      return existing;
    }
    if (state.players.length >= MAX_PLAYERS) {
      return null;
    }

    const player = createPlayer(
      state.players.length,
      info.id,
      info.name,
      info.color || PLAYER_COLORS[state.players.length]
    );
    state.players.push(player);

    if (state.players.length === 1) {
      resetPositions(state, true);
      state.phase = 'waiting';
      state.timeRemaining = MATCH_SECONDS;
      state.overtime = false;
      setStatus(state, `${player.name} is in the arena. Share the invite so another driver can join.`);
    } else {
      freshMatch(state, `${player.name} joined the arena. Kickoff in 3.`);
    }

    return player;
  }

  function removePlayer(state, playerId) {
    const index = state.players.findIndex((player) => player.id === playerId);
    if (index < 0) {
      return;
    }

    state.players.splice(index, 1);
    state.players.forEach((player, seat) => {
      player.seat = seat;
      player.team = teamKeyForSeat(seat);
      player.color = PLAYER_COLORS[seat] || player.color;
      placePlayerAtSpawn(player);
      player.input = defaultInput();
    });

    if (!state.players.length) {
      const fresh = createGameState();
      Object.assign(state, fresh);
      return;
    }

    state.players.forEach((player) => {
      player.score = 0;
      player.touches = 0;
      player.boostPickups = 0;
      player.boost = 100;
    });
    state.phase = 'waiting';
    state.timeRemaining = MATCH_SECONDS;
    state.overtime = false;
    state.kickoffTimer = 0;
    resetBoostPads(state);
    resetPositions(state, true);
    setStatus(state, 'One driver left the arena. The room stays open for a new challenger.');
    pushEvent(state, 'player_left', {
      message: state.status,
    });
  }

  function setPlayerInput(state, playerId, rawInput) {
    const player = findPlayer(state, playerId);
    if (!player) {
      return false;
    }
    const input = rawInput || {};
    player.input.throttle = clamp(Number(input.throttle) || 0, -1, 1);
    player.input.steer = clamp(Number(input.steer) || 0, -1, 1);
    player.input.boost = Boolean(input.boost);
    player.input.handbrake = Boolean(input.handbrake);
    return true;
  }

  function confineCar(player) {
    const halfW = player.w * 0.45;
    const halfH = player.h * 0.45;
    const minX = halfW;
    const maxX = ARENA.width - halfW;
    const minY = halfH;
    const maxY = ARENA.height - halfH;

    if (player.x < minX) {
      player.x = minX;
      player.vx *= -0.35;
    }
    if (player.x > maxX) {
      player.x = maxX;
      player.vx *= -0.35;
    }
    if (player.y < minY) {
      player.y = minY;
      player.vy *= -0.35;
    }
    if (player.y > maxY) {
      player.y = maxY;
      player.vy *= -0.35;
    }
  }

  function updatePlayer(player, dt) {
    if (player.demolished) {
      player.respawnTimer = Math.max(0, player.respawnTimer - dt);
      return;
    }

    const input = player.input || defaultInput();
    const forward = angleToVector(player.angle);
    const right = {
      x: -forward.y,
      y: forward.x,
    };

    player.vx += forward.x * input.throttle * CAR_ACCELERATION * dt;
    player.vy += forward.y * input.throttle * CAR_ACCELERATION * dt;

    const speed = Math.hypot(player.vx, player.vy);
    const grip = input.handbrake ? 0.6 : 1.15;
    const lateral = dot({ x: player.vx, y: player.vy }, right);
    player.vx -= right.x * lateral * grip * dt;
    player.vy -= right.y * lateral * grip * dt;

    player.angVel += input.steer * CAR_TURN_POWER * (0.7 + Math.min(speed / CAR_MAX_SPEED, 1)) * dt;
    player.angVel *= input.handbrake ? 0.9 : 0.82;
    player.angVel = clamp(player.angVel, -CAR_MAX_ANGULAR_SPEED, CAR_MAX_ANGULAR_SPEED);
    player.angle = wrapAngle(player.angle + player.angVel);

    if (input.boost && player.boost > 0) {
      player.vx += forward.x * BOOST_FORCE * dt;
      player.vy += forward.y * BOOST_FORCE * dt;
      player.boost = Math.max(0, player.boost - BOOST_DRAIN_PER_SEC * dt);
    } else {
      player.boost = Math.min(100, player.boost + BOOST_REGEN_PER_SEC * dt);
    }

    const drag = input.handbrake ? 0.991 : 0.996;
    player.vx *= drag;
    player.vy *= drag;

    const nextSpeed = Math.hypot(player.vx, player.vy);
    if (nextSpeed > CAR_MAX_SPEED) {
      const ratio = CAR_MAX_SPEED / nextSpeed;
      player.vx *= ratio;
      player.vy *= ratio;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    confineCar(player);
  }

  function respawnIfReady(player) {
    if (!player.demolished || player.respawnTimer > 0) {
      return false;
    }
    placePlayerAtSpawn(player);
    player.boost = 65;
    return true;
  }

  function awardBoostPad(state, player, pad) {
    player.boost = 100;
    player.boostPickups += 1;
    pad.active = false;
    pad.cooldown = BOOST_PAD_COOLDOWN;
    setStatus(state, `${player.name} grabbed a full boost pad.`);
    pushEvent(state, 'boost', {
      playerId: player.id,
      playerName: player.name,
      x: pad.x,
      y: pad.y,
    });
  }

  function updateBoostPads(state, dt) {
    state.boostPads.forEach((pad) => {
      if (!pad.active) {
        pad.cooldown = Math.max(0, pad.cooldown - dt);
        if (pad.cooldown === 0) {
          pad.active = true;
        }
      }
    });

    state.players.forEach((player) => {
      if (player.demolished) {
        return;
      }
      state.boostPads.forEach((pad) => {
        if (!pad.active) {
          return;
        }
        const dx = player.x - pad.x;
        const dy = player.y - pad.y;
        const radius = pad.radius + Math.max(player.w, player.h) * 0.32;
        if (dx * dx + dy * dy <= radius * radius) {
          awardBoostPad(state, player, pad);
        }
      });
    });
  }

  function resetBallToCenter(state) {
    state.ball.x = ARENA.width * 0.5;
    state.ball.y = ARENA.height * 0.5;
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.ball.lastTouchPlayerId = '';
    state.ball.lastTouchName = '';
    state.ball.lastTouchSide = '';
  }

  function launchBall(state) {
    resetBallToCenter(state);
    const launch = ballKickoffVelocity();
    state.ball.vx = launch.x;
    state.ball.vy = launch.y;
    state.phase = 'live';
    state.kickoffTimer = 0;
    setStatus(state, state.overtime ? 'Sudden death is live.' : 'Kickoff! Drive through the ball and race to five.');
    pushEvent(state, 'live', {
      overtime: state.overtime,
      message: state.status,
    });
  }

  function finishMatch(state, winner, reason) {
    state.phase = 'finished';
    state.kickoffTimer = 0;
    state.winnerId = winner ? winner.id : '';
    state.winnerName = winner ? winner.name : '';
    const blueScore = state.players.find((player) => player.team === 'blue')?.score || 0;
    const orangeScore = state.players.find((player) => player.team === 'orange')?.score || 0;
    if (winner) {
      setStatus(state, `${winner.name} wins ${blueScore}-${orangeScore}${reason ? ` by ${reason}` : ''}.`);
    } else {
      setStatus(state, `Match complete at ${blueScore}-${orangeScore}.`);
    }
    pushEvent(state, 'finish', {
      winnerId: state.winnerId,
      winnerName: state.winnerName,
      reason: reason || '',
      blueScore,
      orangeScore,
      message: state.status,
    });
  }

  function handleTimeExpiry(state) {
    const blue = state.players.find((player) => player.team === 'blue');
    const orange = state.players.find((player) => player.team === 'orange');
    const blueScore = blue ? blue.score : 0;
    const orangeScore = orange ? orange.score : 0;
    if (blueScore === orangeScore) {
      state.overtime = true;
      startKickoff(state, 'Overtime. Next goal wins.');
      pushEvent(state, 'overtime', {
        message: state.status,
      });
      return;
    }
    finishMatch(state, blueScore > orangeScore ? blue : orange, 'time');
  }

  function handleGoal(state, scoringTeam) {
    const scorer = state.players.find((player) => player.team === scoringTeam) || null;
    if (scorer) {
      scorer.score += 1;
    }

    const blueScore = state.players.find((player) => player.team === 'blue')?.score || 0;
    const orangeScore = state.players.find((player) => player.team === 'orange')?.score || 0;

    setStatus(state, scorer
      ? `${scorer.name} scores for ${scoringTeam === 'blue' ? 'Blue' : 'Orange'}!`
      : `${scoringTeam === 'blue' ? 'Blue' : 'Orange'} scores!`);
    pushEvent(state, 'goal', {
      scorerId: scorer ? scorer.id : '',
      scorerName: scorer ? scorer.name : '',
      team: scoringTeam,
      blueScore,
      orangeScore,
      x: state.ball.x,
      y: state.ball.y,
      message: state.status,
    });

    if (state.overtime) {
      finishMatch(state, scorer, 'golden goal');
      return;
    }

    if ((scorer && scorer.score >= state.scoreLimit) || blueScore >= state.scoreLimit || orangeScore >= state.scoreLimit) {
      finishMatch(state, scorer, 'goals');
      return;
    }

    startKickoff(state, `${scorer ? scorer.name : 'A driver'} scored. Kickoff in 3.`);
  }

  function updateBall(state, dt) {
    const ball = state.ball;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const topGoalY = ARENA.height * 0.5 - ARENA.goalWidth * 0.5;
    const bottomGoalY = ARENA.height * 0.5 + ARENA.goalWidth * 0.5;
    const inGoalMouthY = ball.y > topGoalY && ball.y < bottomGoalY;

    if (ball.y - ball.radius < 0) {
      ball.y = ball.radius;
      ball.vy *= -0.88;
    }
    if (ball.y + ball.radius > ARENA.height) {
      ball.y = ARENA.height - ball.radius;
      ball.vy *= -0.88;
    }

    if (!inGoalMouthY && ball.x - ball.radius < 0) {
      ball.x = ball.radius;
      ball.vx *= -0.9;
    }
    if (!inGoalMouthY && ball.x + ball.radius > ARENA.width) {
      ball.x = ARENA.width - ball.radius;
      ball.vx *= -0.9;
    }

    if (inGoalMouthY && ball.x + ball.radius < 0) {
      handleGoal(state, 'orange');
      return;
    }
    if (inGoalMouthY && ball.x - ball.radius > ARENA.width) {
      handleGoal(state, 'blue');
      return;
    }

    ball.vx *= 0.9975;
    ball.vy *= 0.9975;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > BALL_MAX_SPEED) {
      const ratio = BALL_MAX_SPEED / speed;
      ball.vx *= ratio;
      ball.vy *= ratio;
    }
  }

  function demolishPlayer(state, player, x, y) {
    player.demolished = true;
    player.respawnTimer = RESPAWN_SECONDS;
    player.vx = 0;
    player.vy = 0;
    player.angVel = 0;
    setStatus(state, `${player.name} was demolished.`);
    pushEvent(state, 'demo', {
      playerId: player.id,
      playerName: player.name,
      x,
      y,
      message: state.status,
    });
  }

  function collideCars(state, left, right) {
    if (left.demolished || right.demolished) {
      return;
    }

    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const distance = Math.hypot(dx, dy) || 0.0001;
    const minDistance = (Math.max(left.w, left.h) + Math.max(right.w, right.h)) * CAR_COLLISION_RADIUS_SCALE;
    if (distance > minDistance) {
      return;
    }

    const nx = dx / distance;
    const ny = dy / distance;
    const penetration = minDistance - distance;
    left.x -= nx * penetration * 0.5;
    left.y -= ny * penetration * 0.5;
    right.x += nx * penetration * 0.5;
    right.y += ny * penetration * 0.5;

    const relativeVelocity = {
      x: right.vx - left.vx,
      y: right.vy - left.vy,
    };
    const separatingVelocity = dot(relativeVelocity, { x: nx, y: ny });
    if (separatingVelocity < 0) {
      const impulse = -(1.18) * separatingVelocity * 0.5;
      left.vx -= nx * impulse;
      left.vy -= ny * impulse;
      right.vx += nx * impulse;
      right.vy += ny * impulse;
    }

    const closingSpeed = -separatingVelocity;
    if (closingSpeed >= DEMOLITION_RELATIVE_SPEED) {
      const impactX = (left.x + right.x) * 0.5;
      const impactY = (left.y + right.y) * 0.5;
      demolishPlayer(state, left, impactX, impactY);
      demolishPlayer(state, right, impactX, impactY);
      setStatus(state, 'Turbo demo! Both cars need a quick respawn.');
    }
  }

  function collideBallWithPlayer(state, player) {
    if (player.demolished) {
      return;
    }

    const ball = state.ball;
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const cosine = Math.cos(-player.angle);
    const sine = Math.sin(-player.angle);

    const localX = dx * cosine - dy * sine;
    const localY = dx * sine + dy * cosine;

    const halfWidth = player.w * 0.5;
    const halfHeight = player.h * 0.5;
    const closestX = clamp(localX, -halfWidth, halfWidth);
    const closestY = clamp(localY, -halfHeight, halfHeight);

    let diffX = localX - closestX;
    let diffY = localY - closestY;
    const distanceSquared = diffX * diffX + diffY * diffY;
    if (distanceSquared > ball.radius * ball.radius) {
      return;
    }

    const distance = Math.sqrt(distanceSquared) || 0.0001;
    diffX /= distance;
    diffY /= distance;

    const nx = diffX * Math.cos(player.angle) - diffY * Math.sin(player.angle);
    const ny = diffX * Math.sin(player.angle) + diffY * Math.cos(player.angle);
    const penetration = ball.radius - distance + 0.5;
    ball.x += nx * penetration;
    ball.y += ny * penetration;

    const relativeVelocity = {
      x: ball.vx - player.vx,
      y: ball.vy - player.vy,
    };
    const separatingVelocity = dot(relativeVelocity, { x: nx, y: ny });
    if (separatingVelocity >= 0) {
      return;
    }

    const restitution = 0.88;
    const impulse = -(1 + restitution) * separatingVelocity;
    ball.vx += nx * impulse + player.vx * 0.035;
    ball.vy += ny * impulse + player.vy * 0.035;
    ball.lastTouchPlayerId = player.id;
    ball.lastTouchName = player.name;
    ball.lastTouchSide = player.team;
    player.touches += 1;
  }

  function stepMatchClock(state, dt) {
    if (state.overtime) {
      return;
    }
    state.timeRemaining = Math.max(0, state.timeRemaining - dt);
    if (state.timeRemaining === 0) {
      handleTimeExpiry(state);
    }
  }

  function stepFixed(state, dt) {
    state.elapsed += dt;
    updateBoostPads(state, dt);

    state.players.forEach((player) => {
      if (respawnIfReady(player)) {
        pushEvent(state, 'respawn', {
          playerId: player.id,
          playerName: player.name,
          x: player.x,
          y: player.y,
        });
      }
    });

    if (state.phase === 'waiting' || state.phase === 'finished') {
      return;
    }

    if (state.phase === 'countdown') {
      state.kickoffTimer = Math.max(0, state.kickoffTimer - dt);
      if (state.kickoffTimer === 0) {
        launchBall(state);
      }
      return;
    }

    state.players.forEach((player) => {
      updatePlayer(player, dt);
    });

    collideCars(state, state.players[0], state.players[1]);
    updateBall(state, dt);
    if (state.phase !== 'live') {
      return;
    }
    collideBallWithPlayer(state, state.players[0]);
    collideBallWithPlayer(state, state.players[1]);
    stepMatchClock(state, dt);
  }

  function step(state, deltaSeconds) {
    if (state.players.length < 2 && state.phase !== 'waiting') {
      state.phase = 'waiting';
      state.kickoffTimer = 0;
      setStatus(state, 'Waiting for another driver to join the arena.');
    }

    state.accumulator += Math.max(0, deltaSeconds || 0);
    while (state.accumulator >= FIXED_DT) {
      state.accumulator -= FIXED_DT;
      if (state.players.length === 2) {
        stepFixed(state, FIXED_DT);
      } else {
        state.elapsed += FIXED_DT;
        updateBoostPads(state, FIXED_DT);
      }
    }
    return state;
  }

  function resetMatch(state) {
    if (!state.players.length) {
      return state;
    }
    freshMatch(state, 'Fresh match ready. Kickoff in 3.');
    return state;
  }

  return {
    ARENA,
    MATCH_SECONDS,
    SCORE_TO_WIN,
    MAX_PLAYERS,
    PLAYER_COLORS,
    createGameState,
    cloneState,
    addPlayer,
    removePlayer,
    setPlayerInput,
    step,
    resetMatch,
  };
});
