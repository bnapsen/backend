(() => {
  'use strict';

  const SETTINGS_KEY = 'carSoccerMini.settings.v1';
  const FIELD = { width: 1600, height: 900, goalWidth: 260, goalDepth: 95 };
  const MATCH_SECONDS = 180;
  const WIN_GOALS = 5;
  const FIXED_DT = 1 / 120;

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const ui = {
    score: document.getElementById('score'),
    time: document.getElementById('time'),
    boost: document.getElementById('boost'),
    graphicsLabel: document.getElementById('graphicsLabel'),
    pauseMenu: document.getElementById('pauseMenu'),
    menuStatus: document.getElementById('menuStatus'),
    graphicsToggle: document.getElementById('graphicsToggle'),
    volumeSlider: document.getElementById('volumeSlider'),
    fullscreenToggle: document.getElementById('fullscreenToggle'),
    resumeBtn: document.getElementById('resumeBtn'),
    restartBtn: document.getElementById('restartBtn'),
    touchControls: document.getElementById('touchControls')
  };

  const state = {
    running: true,
    paused: false,
    gameOver: false,
    accumulator: 0,
    lastFrame: performance.now(),
    scoreA: 0,
    scoreB: 0,
    countdown: MATCH_SECONDS,
    message: 'Kickoff!',
    messageTime: 1.4,
    shake: 0,
    particles: [],
    highGraphics: true,
    volume: 0.3,
    fullscreenPreferred: false
  };

  const keys = new Set();

  function v(x = 0, y = 0) { return { x, y }; }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function len(a) { return Math.hypot(a.x, a.y); }
  function norm(a) { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function angleToVec(a) { return { x: Math.cos(a), y: Math.sin(a) }; }
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function createCar(x, y, angle, color, controls) {
    return {
      pos: v(x, y),
      vel: v(),
      angle,
      angVel: 0,
      w: 84,
      h: 48,
      color,
      boost: 100,
      controls,
      isBot: controls === null
    };
  }

  const player = createCar(FIELD.width * 0.25, FIELD.height * 0.5, 0, '#4ec9ff', {
    up: 'w', down: 's', left: 'a', right: 'd', boost: 'shift', handbrake: ' ', reset: 'r'
  });
  const bot = createCar(FIELD.width * 0.75, FIELD.height * 0.5, Math.PI, '#ff6f61', null);

  const ball = {
    pos: v(FIELD.width * 0.5, FIELD.height * 0.5),
    vel: v(),
    radius: 25
  };

  const audio = {
    ctx: null,
    unlocked: false,
    init() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    },
    ping(freq = 320, duration = 0.12, type = 'square', gain = 0.08) {
      if (!this.unlocked) return;
      this.init();
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(gain * state.volume, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + duration);
    }
  };

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (typeof parsed.highGraphics === 'boolean') state.highGraphics = parsed.highGraphics;
      if (typeof parsed.volume === 'number') state.volume = clamp(parsed.volume, 0, 1);
      if (typeof parsed.fullscreenPreferred === 'boolean') state.fullscreenPreferred = parsed.fullscreenPreferred;
    } catch (_) {}
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      highGraphics: state.highGraphics,
      volume: state.volume,
      fullscreenPreferred: state.fullscreenPreferred
    }));
  }

  function isTouchDevice() {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  function resizeCanvas() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen() {
    const sx = window.innerWidth / FIELD.width;
    const sy = window.innerHeight / FIELD.height;
    const scale = Math.min(sx, sy);
    const offsetX = (window.innerWidth - FIELD.width * scale) * 0.5;
    const offsetY = (window.innerHeight - FIELD.height * scale) * 0.5;
    return { scale, offsetX, offsetY };
  }

  function spawnParticles(x, y, count, color, speed = 220) {
    if (!state.highGraphics) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random());
      state.particles.push({
        pos: v(x, y),
        vel: v(Math.cos(a) * s, Math.sin(a) * s),
        life: 0.3 + Math.random() * 0.5,
        maxLife: 0.3 + Math.random() * 0.5,
        color
      });
    }
  }

  function handleInput() {
    if (keys.has('p')) {
      keys.delete('p');
      togglePause();
    }
    if (keys.has('r')) {
      resetPositions();
      keys.delete('r');
    }
  }

  function getControlsForCar(car) {
    if (car.isBot) return computeBotControls();
    const c = car.controls;
    return {
      throttle: (keys.has(c.up) ? 1 : 0) - (keys.has(c.down) ? 1 : 0),
      steer: (keys.has(c.right) ? 1 : 0) - (keys.has(c.left) ? 1 : 0),
      boost: keys.has(c.boost),
      handbrake: keys.has(c.handbrake)
    };
  }

  function computeBotControls() {
    const target = v(ball.pos.x, ball.pos.y);
    if (ball.pos.x > FIELD.width * 0.62) {
      target.x = Math.min(target.x, FIELD.width * 0.58);
      target.y = FIELD.height * 0.5 + Math.sin(performance.now() / 500) * 120;
    }
    const toTarget = { x: target.x - bot.pos.x, y: target.y - bot.pos.y };
    const desiredAngle = Math.atan2(toTarget.y, toTarget.x);
    const angleDiff = wrapAngle(desiredAngle - bot.angle);

    let steer = clamp(angleDiff * 2.6, -1, 1);
    steer += (Math.random() - 0.5) * 0.08;

    const dist = len(toTarget);
    const towardGoal = ball.pos.x < bot.pos.x;

    return {
      throttle: dist > 90 ? 1 : 0.35,
      steer,
      boost: dist > 280 && Math.abs(angleDiff) < 0.35,
      handbrake: Math.abs(angleDiff) > 1.0 && towardGoal
    };
  }

  function updateCar(car, dt) {
    const input = getControlsForCar(car);
    const forward = angleToVec(car.angle);
    const right = { x: -forward.y, y: forward.x };

    const accel = 720;
    const turnPower = 3.6;
    const maxSpeed = 560;

    car.vel.x += forward.x * input.throttle * accel * dt;
    car.vel.y += forward.y * input.throttle * accel * dt;

    const speed = len(car.vel);
    const grip = input.handbrake ? 0.6 : 1.15;
    const lateral = dot(car.vel, right);
    car.vel.x -= right.x * lateral * grip * dt;
    car.vel.y -= right.y * lateral * grip * dt;

    car.angVel += input.steer * turnPower * (0.7 + Math.min(speed / maxSpeed, 1)) * dt;
    car.angVel *= input.handbrake ? 0.90 : 0.82;
    car.angle += car.angVel;

    if (input.boost && car.boost > 0) {
      const boostForce = 1200;
      car.vel.x += forward.x * boostForce * dt;
      car.vel.y += forward.y * boostForce * dt;
      car.boost = Math.max(0, car.boost - 33 * dt);
      if (Math.random() < 0.7) spawnParticles(car.pos.x - forward.x * 34, car.pos.y - forward.y * 34, 1, '#87c6ff', 80);
    } else {
      car.boost = Math.min(100, car.boost + 12 * dt);
    }

    const drag = input.handbrake ? 0.991 : 0.996;
    car.vel.x *= drag;
    car.vel.y *= drag;

    const s2 = len(car.vel);
    if (s2 > maxSpeed) {
      const r = maxSpeed / s2;
      car.vel.x *= r;
      car.vel.y *= r;
    }

    car.pos.x += car.vel.x * dt;
    car.pos.y += car.vel.y * dt;

    confineCar(car);
  }

  function confineCar(car) {
    const halfW = car.w * 0.45;
    const halfH = car.h * 0.45;
    const minX = halfW;
    const maxX = FIELD.width - halfW;
    const minY = halfH;
    const maxY = FIELD.height - halfH;

    if (car.pos.x < minX) { car.pos.x = minX; car.vel.x *= -0.35; }
    if (car.pos.x > maxX) { car.pos.x = maxX; car.vel.x *= -0.35; }
    if (car.pos.y < minY) { car.pos.y = minY; car.vel.y *= -0.35; }
    if (car.pos.y > maxY) { car.pos.y = maxY; car.vel.y *= -0.35; }
  }

  function updateBall(dt) {
    ball.pos.x += ball.vel.x * dt;
    ball.pos.y += ball.vel.y * dt;

    const topGoalY = FIELD.height * 0.5 - FIELD.goalWidth * 0.5;
    const bottomGoalY = FIELD.height * 0.5 + FIELD.goalWidth * 0.5;
    const inGoalMouthY = ball.pos.y > topGoalY && ball.pos.y < bottomGoalY;

    if (ball.pos.y - ball.radius < 0) {
      ball.pos.y = ball.radius;
      ball.vel.y *= -0.88;
    }
    if (ball.pos.y + ball.radius > FIELD.height) {
      ball.pos.y = FIELD.height - ball.radius;
      ball.vel.y *= -0.88;
    }

    if (!inGoalMouthY && ball.pos.x - ball.radius < 0) {
      ball.pos.x = ball.radius;
      ball.vel.x *= -0.9;
    }
    if (!inGoalMouthY && ball.pos.x + ball.radius > FIELD.width) {
      ball.pos.x = FIELD.width - ball.radius;
      ball.vel.x *= -0.9;
    }

    // Full-crossing goal detection.
    if (inGoalMouthY && ball.pos.x + ball.radius < 0) {
      scoreGoal('bot');
    } else if (inGoalMouthY && ball.pos.x - ball.radius > FIELD.width) {
      scoreGoal('player');
    }

    ball.vel.x *= 0.9975;
    ball.vel.y *= 0.9975;
    const maxBallSpeed = 860;
    const sp = len(ball.vel);
    if (sp > maxBallSpeed) {
      const m = maxBallSpeed / sp;
      ball.vel.x *= m;
      ball.vel.y *= m;
    }
  }

  function collideBallCar(car) {
    const dx = ball.pos.x - car.pos.x;
    const dy = ball.pos.y - car.pos.y;
    const cos = Math.cos(-car.angle);
    const sin = Math.sin(-car.angle);

    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const hx = car.w * 0.5;
    const hy = car.h * 0.5;

    const closestX = clamp(localX, -hx, hx);
    const closestY = clamp(localY, -hy, hy);

    let diffX = localX - closestX;
    let diffY = localY - closestY;
    const distSq = diffX * diffX + diffY * diffY;

    if (distSq > ball.radius * ball.radius) return;

    const dist = Math.sqrt(distSq) || 0.0001;
    diffX /= dist;
    diffY /= dist;

    const nx = diffX * Math.cos(car.angle) - diffY * Math.sin(car.angle);
    const ny = diffX * Math.sin(car.angle) + diffY * Math.cos(car.angle);

    const penetration = ball.radius - dist + 0.5;
    ball.pos.x += nx * penetration;
    ball.pos.y += ny * penetration;

    const relVel = { x: ball.vel.x - car.vel.x, y: ball.vel.y - car.vel.y };
    const sepVel = dot(relVel, { x: nx, y: ny });

    if (sepVel < 0) {
      const restitution = 0.88;
      const impulse = -(1 + restitution) * sepVel;
      ball.vel.x += nx * impulse + car.vel.x * 0.035;
      ball.vel.y += ny * impulse + car.vel.y * 0.035;
      state.shake = Math.min(0.25, state.shake + 0.05);
      spawnParticles(ball.pos.x, ball.pos.y, 2, '#dff7ff', 120);
      audio.ping(240 + Math.random() * 60, 0.04, 'square', 0.05);
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.vel.x *= 0.95;
      p.vel.y *= 0.95;
    }
  }

  function scoreGoal(side) {
    if (state.gameOver) return;
    if (side === 'player') state.scoreA += 1;
    else state.scoreB += 1;

    state.message = side === 'player' ? 'GOAL! You scored!' : 'Bot scores!';
    state.messageTime = 1.6;
    state.shake = 0.35;
    spawnParticles(ball.pos.x, ball.pos.y, 45, side === 'player' ? '#4ec9ff' : '#ff8d87', 400);
    audio.ping(side === 'player' ? 520 : 190, 0.25, 'sawtooth', 0.12);

    if (state.scoreA >= WIN_GOALS || state.scoreB >= WIN_GOALS) {
      endMatch();
    } else {
      resetPositions();
    }
  }

  function resetPositions() {
    player.pos = v(FIELD.width * 0.25, FIELD.height * 0.5);
    player.vel = v();
    player.angle = 0;
    player.angVel = 0;
    player.boost = 100;

    bot.pos = v(FIELD.width * 0.75, FIELD.height * 0.5);
    bot.vel = v();
    bot.angle = Math.PI;
    bot.angVel = 0;
    bot.boost = 100;

    ball.pos = v(FIELD.width * 0.5, FIELD.height * 0.5);
    ball.vel = v((Math.random() - 0.5) * 130, (Math.random() - 0.5) * 100);
  }

  function endMatch() {
    state.gameOver = true;
    state.paused = true;
    const label = state.scoreA === state.scoreB ? 'Draw Game!' : state.scoreA > state.scoreB ? 'You Win!' : 'Bot Wins!';
    ui.menuStatus.textContent = `${label} (${state.scoreA}-${state.scoreB})`;
    ui.pauseMenu.classList.remove('hidden');
  }

  function togglePause(forceValue) {
    if (typeof forceValue === 'boolean') state.paused = forceValue;
    else state.paused = !state.paused;

    if (state.paused) {
      ui.menuStatus.textContent = state.gameOver ? ui.menuStatus.textContent : 'Paused';
      ui.pauseMenu.classList.remove('hidden');
    } else {
      ui.pauseMenu.classList.add('hidden');
      if (state.fullscreenPreferred && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    }
  }

  function restartMatch() {
    state.scoreA = 0;
    state.scoreB = 0;
    state.countdown = MATCH_SECONDS;
    state.message = 'Kickoff!';
    state.messageTime = 1.2;
    state.gameOver = false;
    state.paused = false;
    resetPositions();
    ui.pauseMenu.classList.add('hidden');
  }

  function updateUI() {
    ui.score.textContent = `${state.scoreA} - ${state.scoreB}`;
    const mins = Math.floor(state.countdown / 60).toString().padStart(2, '0');
    const secs = Math.floor(state.countdown % 60).toString().padStart(2, '0');
    ui.time.textContent = `${mins}:${secs}`;
    ui.boost.textContent = `${Math.round(player.boost)}`;
    ui.graphicsLabel.textContent = state.highGraphics ? 'High' : 'Low';
    ui.graphicsToggle.textContent = state.highGraphics ? 'High' : 'Low';
    ui.fullscreenToggle.textContent = state.fullscreenPreferred ? 'On' : 'Off';
    ui.volumeSlider.value = state.volume.toFixed(2);
  }

  function update(dt) {
    handleInput();

    if (state.paused || state.gameOver) return;

    updateCar(player, dt);
    updateCar(bot, dt);
    updateBall(dt);
    collideBallCar(player);
    collideBallCar(bot);

    updateParticles(dt);

    state.countdown -= dt;
    if (state.countdown <= 0) {
      state.countdown = 0;
      endMatch();
    }

    if (state.messageTime > 0) state.messageTime -= dt;
    state.shake = Math.max(0, state.shake - dt * 0.8);
  }

  function drawField(transform) {
    const { scale, offsetX, offsetY } = transform;

    ctx.save();
    ctx.fillStyle = '#081222';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    if (state.shake > 0 && state.highGraphics) {
      const shakeAmount = state.shake * 8;
      ctx.translate((Math.random() - 0.5) * shakeAmount, (Math.random() - 0.5) * shakeAmount);
    }

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const grad = ctx.createLinearGradient(0, 0, FIELD.width, FIELD.height);
    grad.addColorStop(0, '#11452d');
    grad.addColorStop(1, '#0f3b27');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);

    ctx.strokeStyle = 'rgba(236, 247, 255, 0.75)';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, FIELD.width, FIELD.height);

    ctx.beginPath();
    ctx.moveTo(FIELD.width * 0.5, 0);
    ctx.lineTo(FIELD.width * 0.5, FIELD.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(FIELD.width * 0.5, FIELD.height * 0.5, 110, 0, Math.PI * 2);
    ctx.stroke();

    const gy = FIELD.height * 0.5 - FIELD.goalWidth * 0.5;
    ctx.fillStyle = 'rgba(78, 201, 255, 0.28)';
    ctx.fillRect(-FIELD.goalDepth, gy, FIELD.goalDepth, FIELD.goalWidth);
    ctx.fillStyle = 'rgba(255, 111, 97, 0.28)';
    ctx.fillRect(FIELD.width, gy, FIELD.goalDepth, FIELD.goalWidth);

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.strokeRect(-FIELD.goalDepth, gy, FIELD.goalDepth, FIELD.goalWidth);
    ctx.strokeRect(FIELD.width, gy, FIELD.goalDepth, FIELD.goalWidth);

    ctx.restore();
  }

  function drawCar(car, transform) {
    const { scale, offsetX, offsetY } = transform;
    ctx.save();
    ctx.translate(offsetX + car.pos.x * scale, offsetY + car.pos.y * scale);
    ctx.rotate(car.angle);

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-car.w * 0.5 * scale + 4, -car.h * 0.5 * scale + 4, car.w * scale, car.h * scale);

    ctx.fillStyle = car.color;
    ctx.fillRect(-car.w * 0.5 * scale, -car.h * 0.5 * scale, car.w * scale, car.h * scale);

    ctx.fillStyle = '#f9fdff';
    ctx.fillRect(car.w * 0.22 * scale, -car.h * 0.2 * scale, car.w * 0.2 * scale, car.h * 0.4 * scale);

    ctx.restore();
  }

  function drawBall(transform) {
    const { scale, offsetX, offsetY } = transform;
    ctx.save();
    ctx.translate(offsetX + ball.pos.x * scale, offsetY + ball.pos.y * scale);
    const r = ball.radius * scale;
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, 2, 0, 0, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#d0deea');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles(transform) {
    const { scale, offsetX, offsetY } = transform;
    for (const p of state.particles) {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
      if (!ctx.fillStyle.includes('rgba')) ctx.fillStyle = `rgba(180,220,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(offsetX + p.pos.x * scale, offsetY + p.pos.y * scale, Math.max(1.5, 3 * scale * alpha), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMessage() {
    if (state.messageTime <= 0) return;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '700 38px Inter, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.message, window.innerWidth / 2, window.innerHeight * 0.16);
    ctx.restore();
  }

  function render() {
    const transform = worldToScreen();
    drawField(transform);
    if (state.highGraphics) drawParticles(transform);
    drawBall(transform);
    drawCar(player, transform);
    drawCar(bot, transform);
    drawMessage();
  }

  function frame(now) {
    const dtSec = Math.min(0.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    state.accumulator += dtSec;

    while (state.accumulator >= FIXED_DT) {
      update(FIXED_DT);
      state.accumulator -= FIXED_DT;
    }

    render();
    updateUI();

    if (state.running) requestAnimationFrame(frame);
  }

  function setupEvents() {
    const toKey = (key) => {
      if (key === ' ') return ' ';
      if (key === 'Shift' || key === 'ShiftLeft' || key === 'ShiftRight') return 'shift';
      return key.toLowerCase();
    };

    window.addEventListener('keydown', (e) => {
      const k = toKey(e.key);
      keys.add(k);
      if (['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      audio.unlocked = true;
      audio.init();
    });
    window.addEventListener('keyup', (e) => keys.delete(toKey(e.key)));

    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !state.paused) togglePause(true);
    });

    ui.resumeBtn.addEventListener('click', () => togglePause(false));
    ui.restartBtn.addEventListener('click', restartMatch);

    ui.graphicsToggle.addEventListener('click', () => {
      state.highGraphics = !state.highGraphics;
      saveSettings();
    });

    ui.volumeSlider.addEventListener('input', () => {
      state.volume = clamp(parseFloat(ui.volumeSlider.value), 0, 1);
      saveSettings();
    });

    ui.fullscreenToggle.addEventListener('click', () => {
      state.fullscreenPreferred = !state.fullscreenPreferred;
      saveSettings();
      if (!state.fullscreenPreferred && document.fullscreenElement) {
        document.exitFullscreen?.();
      }
    });

    if (isTouchDevice()) {
      ui.touchControls.classList.remove('hidden');
      const map = { shift: 'shift', space: ' ' };
      ui.touchControls.querySelectorAll('button').forEach((btn) => {
        const key = map[btn.dataset.key] || btn.dataset.key;
        const press = (down) => {
          if (down) keys.add(key);
          else keys.delete(key);
        };
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); press(true); }, { passive: false });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); press(false); }, { passive: false });
        btn.addEventListener('touchcancel', (e) => { e.preventDefault(); press(false); }, { passive: false });
      });
    }
  }

  loadSettings();
  resizeCanvas();
  setupEvents();
  resetPositions();
  updateUI();
  requestAnimationFrame(frame);
})();
