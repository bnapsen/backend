const canvas = document.getElementById("breakthrough-canvas");
const ctx = canvas.getContext("2d", { alpha: false });

const ui = {
  breach: document.getElementById("breach-display"),
  lives: document.getElementById("lives-display"),
  score: document.getElementById("score-display"),
  combo: document.getElementById("combo-display"),
  best: document.getElementById("best-display"),
  sim: document.getElementById("run-sim-display"),
  start: document.getElementById("start-button"),
  pause: document.getElementById("pause-button"),
  restart: document.getElementById("restart-button"),
  overlay: document.getElementById("screen-overlay"),
  overlayKicker: document.getElementById("overlay-kicker"),
  overlayTitle: document.getElementById("overlay-title"),
  overlayCopy: document.getElementById("overlay-copy"),
  statusTitle: document.getElementById("status-title"),
  statusCopy: document.getElementById("status-copy"),
  rewardTitle: document.getElementById("reward-title"),
  rewardCopy: document.getElementById("reward-copy"),
};

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const BEST_KEY = "bnapsen:breakthrough:best";
const PROD_API_BASE = "https://nova-arcade-backend-2rpkpv7fpq-uc.a.run.app";
const COLORS = ["#63f7ff", "#8b6dff", "#ff4db8", "#ffd36a", "#7dffe2", "#ff765f"];
const POWERUP_COLORS = {
  wide: "#7dffe2",
  multi: "#ff4db8",
  pierce: "#ffd36a",
  slow: "#8b6dff",
};
const POWERUP_LABELS = { wide: "W", multi: "M", pierce: "P", slow: "S" };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createRunId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadBest() {
  try {
    return Math.max(0, Number.parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0);
  } catch {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem(BEST_KEY, String(state.best));
  } catch {
    // A blocked storage API should never stop the run.
  }
}

function formatScore(value) {
  return Math.max(0, Math.round(value)).toString().padStart(6, "0");
}

function formatSim(amountCents) {
  const amount = Math.max(0, Number(amountCents) || 0) / 100;
  return `${Number.isInteger(amount) ? amount : amount.toFixed(2)} SIM`;
}

const state = {
  mode: "ready",
  breach: 1,
  lives: 3,
  score: 0,
  best: loadBest(),
  combo: 1,
  comboHits: 0,
  bankedSimCents: 0,
  runId: createRunId(),
  claimedRewards: new Set(),
  paddle: { x: WIDTH / 2, y: HEIGHT - 47, width: 148, baseWidth: 148, height: 17, targetX: WIDTH / 2 },
  balls: [],
  bricks: [],
  powerups: [],
  particles: [],
  floaters: [],
  stars: [],
  sparks: [],
  input: { left: false, right: false, pointer: false },
  wideTimer: 0,
  pierceTimer: 0,
  slowTimer: 0,
  screenShake: 0,
  flash: 0,
  clearTimer: 0,
  statusTimer: 0,
  time: 0,
  lastTime: 0,
  audio: null,
};

function makeStars() {
  state.stars = Array.from({ length: 92 }, () => ({
    x: Math.random() * WIDTH,
    y: Math.random() * HEIGHT,
    z: randomBetween(0.25, 1),
    twinkle: Math.random() * Math.PI * 2,
  }));
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function setStatus(title, copy, duration = 0) {
  ui.statusTitle.textContent = title;
  ui.statusCopy.textContent = copy;
  state.statusTimer = duration;
}

function setReward(title, copy) {
  ui.rewardTitle.textContent = title;
  ui.rewardCopy.textContent = copy;
}

function setOverlay(kicker, title, copy, hidden = false) {
  ui.overlayKicker.textContent = kicker;
  const titleParts = String(title).split("//");
  if (titleParts.length === 2) {
    const slash = document.createElement("span");
    slash.textContent = "//";
    ui.overlayTitle.replaceChildren(titleParts[0], slash, titleParts[1]);
  } else {
    ui.overlayTitle.textContent = title;
  }
  ui.overlayCopy.textContent = copy;
  ui.overlay.classList.toggle("hidden", hidden);
  ui.overlay.setAttribute("aria-hidden", hidden ? "true" : "false");
  canvas.tabIndex = hidden ? 0 : -1;
}

function updateHud() {
  ui.breach.textContent = String(state.breach).padStart(2, "0");
  ui.lives.textContent = String(state.lives);
  ui.score.textContent = formatScore(state.score);
  ui.combo.textContent = `x${state.combo}`;
  ui.best.textContent = formatScore(state.best);
  ui.sim.textContent = formatSim(state.bankedSimCents);
}

function ensureAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!state.audio) state.audio = new AudioContext();
  if (state.audio.state === "suspended") state.audio.resume().catch(() => {});
  return state.audio;
}

function tone(frequency, duration = 0.08, type = "sine", gain = 0.035, slideTo = 0, delay = 0) {
  const audio = ensureAudio();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slideTo > 0) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.015, duration / 3));
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume);
  volume.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function sfx(name) {
  if (name === "launch") {
    tone(240, 0.11, "sawtooth", 0.04, 720);
  } else if (name === "paddle") {
    tone(360, 0.055, "square", 0.025, 540);
  } else if (name === "brick") {
    tone(520 + state.combo * 9, 0.045, "triangle", 0.022, 780 + state.combo * 8);
  } else if (name === "break") {
    tone(180, 0.09, "sawtooth", 0.035, 80);
    tone(720, 0.07, "triangle", 0.023, 1020, 0.025);
  } else if (name === "powerup") {
    tone(440, 0.1, "triangle", 0.04, 880);
    tone(660, 0.11, "sine", 0.03, 1320, 0.07);
  } else if (name === "life") {
    tone(260, 0.2, "sawtooth", 0.05, 70);
  } else if (name === "breach") {
    tone(330, 0.17, "triangle", 0.045, 660);
    tone(495, 0.19, "triangle", 0.045, 990, 0.1);
    tone(740, 0.23, "sine", 0.035, 1480, 0.2);
  } else if (name === "reward") {
    tone(660, 0.12, "triangle", 0.04, 990);
    tone(990, 0.14, "sine", 0.035, 1480, 0.09);
  }
}

function createBall(attached = true) {
  return {
    x: state.paddle.x,
    y: state.paddle.y - 17,
    radius: 8,
    vx: 0,
    vy: 0,
    attached,
    trail: [],
    phase: Math.random() * Math.PI * 2,
  };
}

function launchBall(ball = state.balls.find((item) => item.attached)) {
  if (!ball) return;
  const speed = 410 + Math.min(160, state.breach * 14);
  const angle = randomBetween(-0.62, 0.62);
  ball.vx = Math.sin(angle) * speed;
  ball.vy = -Math.cos(angle) * speed;
  ball.attached = false;
  sfx("launch");
  setStatus("Pulse launched", "Keep the return angle sharp and build the multiplier.", 2.1);
}

function shouldSkipBrick(row, column, rows, columns, breach) {
  if (breach % 4 === 2 && row > 0 && row < rows - 1 && (column === 2 || column === columns - 3)) return true;
  if (breach % 4 === 3 && row % 2 === 1 && (column + row) % 4 === 0) return true;
  if (breach % 4 === 0 && row > 1 && Math.abs(column - (columns - 1) / 2) < 1.1) return true;
  return false;
}

function buildBreach(number) {
  const columns = 12;
  const rows = Math.min(8, 5 + Math.floor((number - 1) / 2));
  const gapX = 8;
  const gapY = 9;
  const marginX = 62;
  const brickWidth = (WIDTH - marginX * 2 - gapX * (columns - 1)) / columns;
  const brickHeight = 28;
  const startY = 82;
  const bricks = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (shouldSkipBrick(row, column, rows, columns, number)) continue;
      const isCore = row === Math.floor(rows / 2) && column === Math.floor(columns / 2);
      const armor = number >= 3 && (row + column + number) % 7 === 0 ? 1 : 0;
      const maxHp = isCore ? Math.min(5, 2 + Math.floor(number / 3)) : 1 + armor + (number >= 8 && row === 0 ? 1 : 0);
      bricks.push({
        x: marginX + column * (brickWidth + gapX),
        y: startY + row * (brickHeight + gapY),
        width: brickWidth,
        height: brickHeight,
        hp: maxHp,
        maxHp,
        color: COLORS[(row + Math.floor(number / 2)) % COLORS.length],
        core: isCore,
        phase: randomBetween(0, Math.PI * 2),
        alive: true,
      });
    }
  }

  state.bricks = bricks;
  state.powerups = [];
  state.particles = [];
  state.floaters = [];
  state.combo = 1;
  state.comboHits = 0;
  state.paddle.width = state.paddle.baseWidth;
  state.wideTimer = 0;
  state.pierceTimer = 0;
  state.slowTimer = 0;
  state.balls = [createBall(true)];
  updateHud();
}

function startRun() {
  ensureAudio();
  state.mode = "running";
  state.breach = 1;
  state.lives = 3;
  state.score = 0;
  state.combo = 1;
  state.comboHits = 0;
  state.bankedSimCents = 0;
  state.runId = createRunId();
  state.claimedRewards.clear();
  state.screenShake = 0;
  state.flash = 0;
  state.clearTimer = 0;
  state.paddle.x = WIDTH / 2;
  state.paddle.targetX = WIDTH / 2;
  buildBreach(1);
  setOverlay("", "", "", true);
  setReward("1 SIM per breach", "Every fifth breach pays 5 SIM. Sign in to bank rewards.");
  setStatus("Firewall live", "Break every node. Powerups fall from unstable blocks.", 2.5);
  launchBall();
  updateHud();
  canvas.focus({ preventScroll: true });
}

function restartRun() {
  startRun();
}

function togglePause() {
  if (state.mode === "ready" || state.mode === "over" || state.mode === "clear") return;
  if (state.mode === "paused") {
    state.mode = "running";
    setOverlay("", "", "", true);
    setStatus("Signal restored", "The firewall is moving again.", 1.8);
    canvas.focus({ preventScroll: true });
  } else if (state.mode === "running") {
    state.mode = "paused";
    setOverlay("Run suspended", "PAUSED", "Press P or Pause to re-enter the breach.", false);
    setStatus("Run suspended", "The pulse is frozen in place.");
  }
}

function spawnBurst(x, y, color, count = 12, speed = 150) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = randomBetween(speed * 0.3, speed);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life: randomBetween(0.22, 0.62),
      maxLife: 0.62,
      radius: randomBetween(1.2, 3.8),
      color,
      streak: Math.random() > 0.55,
    });
  }
}

function addFloater(x, y, text, color = "#ffffff", scale = 1) {
  state.floaters.push({ x, y, text, color, scale, life: 0.85, maxLife: 0.85 });
}

function maybeDropPowerup(brick) {
  if (Math.random() > 0.15 && !brick.core) return;
  const types = ["wide", "multi", "pierce", "slow"];
  const type = types[Math.floor(Math.random() * types.length)];
  state.powerups.push({
    x: brick.x + brick.width / 2,
    y: brick.y + brick.height / 2,
    vy: 145,
    size: 15,
    type,
    phase: Math.random() * Math.PI * 2,
  });
}

function updateCombo() {
  state.comboHits += 1;
  state.combo = Math.min(12, 1 + Math.floor(state.comboHits / 4));
}

function damageBrick(brick, ball) {
  brick.hp -= 1;
  updateCombo();
  const hitPoints = 18 * state.combo * state.breach;
  state.score += hitPoints;
  state.screenShake = Math.max(state.screenShake, brick.core ? 8 : 3.5);
  spawnBurst(ball.x, ball.y, brick.color, brick.hp <= 0 ? 15 : 7, brick.core ? 230 : 150);
  addFloater(brick.x + brick.width / 2, brick.y, `+${hitPoints}`, brick.color, 0.8 + state.combo * 0.025);

  if (brick.hp <= 0) {
    brick.alive = false;
    state.score += 85 * state.combo * state.breach;
    maybeDropPowerup(brick);
    sfx("break");
  } else {
    sfx("brick");
  }

  if (state.score > state.best) {
    state.best = state.score;
    saveBest();
  }
  updateHud();

  if (state.bricks.every((item) => !item.alive)) completeBreach();
}

function circleHitsRect(ball, rect) {
  const nearestX = clamp(ball.x, rect.x, rect.x + rect.width);
  const nearestY = clamp(ball.y, rect.y, rect.y + rect.height);
  const dx = ball.x - nearestX;
  const dy = ball.y - nearestY;
  return dx * dx + dy * dy <= ball.radius * ball.radius;
}

function reflectFromBrick(ball, brick, previousX, previousY) {
  const cameFromLeft = previousX + ball.radius <= brick.x;
  const cameFromRight = previousX - ball.radius >= brick.x + brick.width;
  const cameFromTop = previousY + ball.radius <= brick.y;
  const cameFromBottom = previousY - ball.radius >= brick.y + brick.height;
  if (cameFromLeft || cameFromRight) {
    ball.vx *= -1;
  } else if (cameFromTop || cameFromBottom) {
    ball.vy *= -1;
  } else if (Math.abs(ball.vx) > Math.abs(ball.vy)) {
    ball.vx *= -1;
  } else {
    ball.vy *= -1;
  }
}

function applyPowerup(type) {
  sfx("powerup");
  state.flash = Math.max(state.flash, 0.18);
  if (type === "wide") {
    state.wideTimer = 12;
    state.paddle.width = 220;
    setStatus("Wide array online", "A larger return surface is active for 12 seconds.", 2.7);
  } else if (type === "multi") {
    const sourceBalls = state.balls.filter((ball) => !ball.attached).slice(0, 3);
    for (const source of sourceBalls) {
      for (const direction of [-1, 1]) {
        const angle = Math.atan2(source.vy, source.vx) + direction * 0.42;
        const speed = Math.hypot(source.vx, source.vy);
        state.balls.push({ ...createBall(false), x: source.x, y: source.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
      }
    }
    setStatus("Multiball breach", "Three attack angles are better than one.", 2.7);
  } else if (type === "pierce") {
    state.pierceTimer = 8;
    setStatus("Overdrive armed", "The pulse will cut through blocks for 8 seconds.", 2.7);
  } else if (type === "slow") {
    state.slowTimer = 8;
    setStatus("Time drag active", "Firewall motion is damped for 8 seconds.", 2.7);
  }
  addFloater(state.paddle.x, state.paddle.y - 22, POWERUP_LABELS[type], POWERUP_COLORS[type], 1.5);
}

function loseLife() {
  state.lives -= 1;
  state.combo = 1;
  state.comboHits = 0;
  state.screenShake = 12;
  state.flash = 0.28;
  sfx("life");
  updateHud();

  if (state.lives <= 0) {
    state.mode = "over";
    saveBest();
    setOverlay("Firewall held", "RUN OVER", `Score ${formatScore(state.score)} · ${state.breach - 1} breaches cleared. Tap to run it back.`, false);
    setStatus("Connection severed", "Start a new run and rebuild the multiplier.");
    return;
  }

  state.balls = [createBall(true)];
  setStatus("Pulse lost", `${state.lives} ${state.lives === 1 ? "life" : "lives"} left. Press Space or tap Launch.`, 3.2);
}

function breakthroughApiBase() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname) ? window.location.origin : PROD_API_BASE;
}

async function attemptRewardCredit({ runId, breach, score, expectedCents, retries = 8 }) {
  const auth = window.NovaAuth;
  if (!auth || typeof auth.getIdToken !== "function") {
    if (retries > 0) {
      window.setTimeout(() => attemptRewardCredit({ runId, breach, score, expectedCents, retries: retries - 1 }), 250);
    } else {
      setReward(`${formatSim(expectedCents)} unlocked`, "Sign in before your next breach to bank SIM rewards.");
    }
    return;
  }

  if (typeof auth.isSignedIn === "function" && !auth.isSignedIn()) {
    setReward(`${formatSim(expectedCents)} unlocked`, "Sign in to your AP account before clearing a breach to bank it.");
    return;
  }

  try {
    const token = await auth.getIdToken();
    if (!token) {
      setReward(`${formatSim(expectedCents)} unlocked`, "Sign in to your AP account to bank the reward.");
      return;
    }

    const response = await fetch(`${breakthroughApiBase()}/api/sim/breakthrough/breach`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ runId, breach, score }),
    });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 429 && payload.code === "sim/reward-rate-limited" && retries > 0) {
      const retryAfterMs = clamp(Number(payload.retryAfterMs) || 1000, 250, 60000);
      setReward("SIM reward queued", "The wallet is rate-limiting credits; this same breach will retry.");
      window.setTimeout(
        () => attemptRewardCredit({ runId, breach, score, expectedCents, retries: retries - 1 }),
        retryAfterMs,
      );
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to bank the breach reward.");
    }

    const awardCents = Math.max(0, Math.round(Number(payload.reward?.awardCents) || 0));
    if (awardCents <= 0) {
      setReward("Breach already settled", "The server ignored a duplicate reward claim safely.");
      return;
    }

    state.bankedSimCents += awardCents;
    updateHud();
    sfx("reward");
    setReward(`+${formatSim(awardCents)} banked`, `${formatSim(state.bankedSimCents)} earned in this run.`);
    if (typeof auth.refreshWallet === "function") auth.refreshWallet().catch(() => {});
  } catch (error) {
    setReward("SIM sync paused", error?.message || "The reward could not be banked. Your run can continue safely.");
  }
}

function bankBreachReward(amountCents) {
  const rewardId = `${state.runId}:breach-${state.breach}`;
  if (state.claimedRewards.has(rewardId)) return;
  state.claimedRewards.add(rewardId);
  attemptRewardCredit({ runId: state.runId, breach: state.breach, score: state.score, expectedCents: amountCents });
}

function completeBreach() {
  if (state.mode !== "running") return;
  state.mode = "clear";
  state.clearTimer = 2.3;
  state.flash = 0.72;
  state.screenShake = 16;
  const rewardCents = state.breach % 5 === 0 ? 500 : 100;
  state.score += 1000 * state.breach;
  if (state.score > state.best) {
    state.best = state.score;
    saveBest();
  }
  updateHud();
  sfx("breach");
  spawnBurst(WIDTH / 2, HEIGHT / 2, state.breach % 5 === 0 ? "#ffd36a" : "#63f7ff", 64, 360);
  setOverlay(
    `${formatSim(rewardCents)} reward unlocked`,
    `BREACH ${String(state.breach).padStart(2, "0")} CRACKED`,
    state.breach % 5 === 0 ? "Fifth-wall jackpot. Banking 5 SIM and loading the next firewall." : "Firewall erased. Banking 1 SIM and loading the next pattern.",
    false,
  );
  setStatus("Firewall shattered", `Breach ${state.breach} clear bonus: +${1000 * state.breach}.`, 2.3);
  setReward(`Banking ${formatSim(rewardCents)}`, "Signed-in AP accounts receive the reward automatically.");
  bankBreachReward(rewardCents);
}

function beginNextBreach() {
  state.breach += 1;
  buildBreach(state.breach);
  state.mode = "running";
  setOverlay("", "", "", true);
  setStatus(`Breach ${state.breach} live`, "Armor and pulse speed climb from here.", 2.6);
  launchBall();
  canvas.focus({ preventScroll: true });
}

function updatePaddle(deltaTime) {
  const speed = 650;
  if (state.input.pointer) {
    state.paddle.x = lerp(state.paddle.x, state.paddle.targetX, Math.min(1, deltaTime * 14));
  } else {
    const direction = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
    state.paddle.x += direction * speed * deltaTime;
  }

  if (state.wideTimer > 0) {
    state.wideTimer -= deltaTime;
    if (state.wideTimer <= 0) state.paddle.width = state.paddle.baseWidth;
  }
  state.paddle.x = clamp(state.paddle.x, state.paddle.width / 2 + 18, WIDTH - state.paddle.width / 2 - 18);
}

function updateBalls(deltaTime) {
  const motionScale = state.slowTimer > 0 ? 0.72 : 1;
  if (state.slowTimer > 0) state.slowTimer -= deltaTime;
  if (state.pierceTimer > 0) state.pierceTimer -= deltaTime;

  for (const ball of state.balls) {
    if (ball.attached) {
      ball.x = state.paddle.x;
      ball.y = state.paddle.y - 17;
      continue;
    }

    const previousX = ball.x;
    const previousY = ball.y;
    ball.x += ball.vx * deltaTime * motionScale;
    ball.y += ball.vy * deltaTime * motionScale;
    ball.phase += deltaTime * 8;
    ball.trail.unshift({ x: ball.x, y: ball.y });
    if (ball.trail.length > 12) ball.trail.pop();

    if (ball.x - ball.radius < 15 && ball.vx < 0) {
      ball.x = 15 + ball.radius;
      ball.vx *= -1;
      state.screenShake = Math.max(state.screenShake, 2);
    } else if (ball.x + ball.radius > WIDTH - 15 && ball.vx > 0) {
      ball.x = WIDTH - 15 - ball.radius;
      ball.vx *= -1;
      state.screenShake = Math.max(state.screenShake, 2);
    }
    if (ball.y - ball.radius < 18 && ball.vy < 0) {
      ball.y = 18 + ball.radius;
      ball.vy *= -1;
    }

    const paddle = {
      x: state.paddle.x - state.paddle.width / 2,
      y: state.paddle.y - state.paddle.height / 2,
      width: state.paddle.width,
      height: state.paddle.height,
    };
    if (ball.vy > 0 && circleHitsRect(ball, paddle)) {
      const offset = clamp((ball.x - state.paddle.x) / (state.paddle.width / 2), -0.92, 0.92);
      const speed = clamp(Math.hypot(ball.vx, ball.vy) * 1.015, 410, 760);
      ball.vx = offset * speed * 0.9;
      ball.vy = -Math.sqrt(Math.max(speed * speed - ball.vx * ball.vx, speed * speed * 0.28));
      ball.y = paddle.y - ball.radius - 1;
      spawnBurst(ball.x, state.paddle.y, state.pierceTimer > 0 ? "#ffd36a" : "#63f7ff", 6, 90);
      sfx("paddle");
    }

    for (const brick of state.bricks) {
      if (!brick.alive || !circleHitsRect(ball, brick)) continue;
      if (state.pierceTimer <= 0) reflectFromBrick(ball, brick, previousX, previousY);
      damageBrick(brick, ball);
      break;
    }
  }

  state.balls = state.balls.filter((ball) => ball.y - ball.radius < HEIGHT + 18);
  if (state.balls.length === 0) loseLife();
}

function updatePowerups(deltaTime) {
  for (const powerup of state.powerups) {
    powerup.y += powerup.vy * deltaTime;
    powerup.phase += deltaTime * 4;
    const caught =
      Math.abs(powerup.x - state.paddle.x) < state.paddle.width / 2 + powerup.size &&
      Math.abs(powerup.y - state.paddle.y) < state.paddle.height / 2 + powerup.size;
    if (caught) {
      powerup.collected = true;
      applyPowerup(powerup.type);
      spawnBurst(powerup.x, powerup.y, POWERUP_COLORS[powerup.type], 22, 210);
    }
  }
  state.powerups = state.powerups.filter((powerup) => !powerup.collected && powerup.y < HEIGHT + 30);
}

function updateEffects(deltaTime) {
  for (const particle of state.particles) {
    particle.x += particle.vx * deltaTime;
    particle.y += particle.vy * deltaTime;
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    particle.life -= deltaTime;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);

  for (const floater of state.floaters) {
    floater.y -= 42 * deltaTime;
    floater.life -= deltaTime;
  }
  state.floaters = state.floaters.filter((floater) => floater.life > 0);

  state.screenShake = Math.max(0, state.screenShake - 34 * deltaTime);
  state.flash = Math.max(0, state.flash - 1.8 * deltaTime);
  if (state.statusTimer > 0) state.statusTimer -= deltaTime;
}

function update(deltaTime) {
  state.time += deltaTime;
  for (const star of state.stars) {
    star.y += (11 + star.z * 24) * deltaTime;
    star.twinkle += deltaTime * (1 + star.z * 2);
    if (star.y > HEIGHT + 4) {
      star.y = -4;
      star.x = Math.random() * WIDTH;
    }
  }

  if (state.mode === "running") {
    updatePaddle(deltaTime);
    updateBalls(deltaTime);
    updatePowerups(deltaTime);
  } else if (state.mode === "clear") {
    state.clearTimer -= deltaTime;
    if (state.clearTimer <= 0) beginNextBreach();
  }
  updateEffects(deltaTime);
}

function drawBackground() {
  const backdrop = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  backdrop.addColorStop(0, "#071530");
  backdrop.addColorStop(0.52, "#070818");
  backdrop.addColorStop(1, "#02030b");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.34, 30, WIDTH / 2, HEIGHT * 0.45, WIDTH * 0.7);
  glow.addColorStop(0, "rgba(99,247,255,0.11)");
  glow.addColorStop(0.42, "rgba(126,74,255,0.07)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (const star of state.stars) {
    const alpha = (0.22 + star.z * 0.5) * (0.76 + Math.sin(star.twinkle) * 0.24);
    ctx.fillStyle = `rgba(190,240,255,${alpha})`;
    ctx.fillRect(star.x, star.y, star.z > 0.72 ? 2 : 1, star.z > 0.72 ? 2 : 1);
  }

  ctx.save();
  ctx.strokeStyle = "rgba(99,247,255,0.065)";
  ctx.lineWidth = 1;
  const horizon = HEIGHT * 0.46;
  for (let index = -10; index <= 10; index += 1) {
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, horizon);
    ctx.lineTo(WIDTH / 2 + index * 92, HEIGHT);
    ctx.stroke();
  }
  for (let row = 0; row < 8; row += 1) {
    const progress = row / 8;
    const y = horizon + Math.pow(progress, 1.65) * (HEIGHT - horizon);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 104px Oxanium, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`BREACH ${String(state.breach).padStart(2, "0")}`, WIDTH / 2, HEIGHT * 0.68);
  ctx.restore();
}

function drawBricks() {
  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    const pulse = brick.core ? 0.7 + Math.sin(state.time * 4 + brick.phase) * 0.3 : 1;
    ctx.save();
    ctx.shadowBlur = brick.core ? 24 : 12;
    ctx.shadowColor = brick.color;
    const gradient = ctx.createLinearGradient(brick.x, brick.y, brick.x, brick.y + brick.height);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)");
    gradient.addColorStop(0.18, brick.color);
    gradient.addColorStop(1, "rgba(9,18,41,0.95)");
    ctx.fillStyle = gradient;
    roundedRect(ctx, brick.x, brick.y, brick.width, brick.height, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${0.34 + pulse * 0.2})`;
    ctx.lineWidth = brick.core ? 2 : 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.2)";
    roundedRect(ctx, brick.x + 4, brick.y + 3, brick.width - 8, 4, 2);
    ctx.fill();

    if (brick.hp < brick.maxHp) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(brick.x + brick.width * 0.44, brick.y + 2);
      ctx.lineTo(brick.x + brick.width * 0.52, brick.y + brick.height * 0.46);
      ctx.lineTo(brick.x + brick.width * 0.39, brick.y + brick.height - 2);
      ctx.stroke();
    }

    if (brick.maxHp > 1) {
      ctx.fillStyle = "rgba(3,8,20,0.76)";
      ctx.font = "700 10px Oxanium, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(brick.hp), brick.x + brick.width / 2, brick.y + brick.height / 2 + 1);
    }
    ctx.restore();
  }
}

function drawPaddle() {
  const paddle = state.paddle;
  ctx.save();
  ctx.translate(paddle.x, paddle.y);
  ctx.shadowBlur = state.pierceTimer > 0 ? 34 : 22;
  ctx.shadowColor = state.pierceTimer > 0 ? "#ffd36a" : "#63f7ff";
  const gradient = ctx.createLinearGradient(-paddle.width / 2, 0, paddle.width / 2, 0);
  gradient.addColorStop(0, "#20aee9");
  gradient.addColorStop(0.45, "#e9ffff");
  gradient.addColorStop(0.58, state.pierceTimer > 0 ? "#ffd36a" : "#d9ff67");
  gradient.addColorStop(1, "#ff4db8");
  ctx.fillStyle = gradient;
  roundedRect(ctx, -paddle.width / 2, -paddle.height / 2, paddle.width, paddle.height, 9);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(3,12,28,0.72)";
  roundedRect(ctx, -paddle.width / 2 + 11, -3, paddle.width - 22, 7, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(99,247,255,0.22)";
  ctx.beginPath();
  ctx.moveTo(-paddle.width / 2 + 20, 9);
  ctx.lineTo(-paddle.width / 2 + 36, 25 + Math.sin(state.time * 15) * 3);
  ctx.lineTo(-paddle.width / 2 + 51, 9);
  ctx.moveTo(paddle.width / 2 - 51, 9);
  ctx.lineTo(paddle.width / 2 - 36, 25 + Math.cos(state.time * 15) * 3);
  ctx.lineTo(paddle.width / 2 - 20, 9);
  ctx.fill();
  ctx.restore();
}

function drawBalls() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const ball of state.balls) {
    ball.trail.forEach((point, index) => {
      const alpha = (1 - index / ball.trail.length) * 0.25;
      ctx.fillStyle = state.pierceTimer > 0 ? `rgba(255,211,106,${alpha})` : `rgba(99,247,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(1, ball.radius * (1 - index / 15)), 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.shadowBlur = state.pierceTimer > 0 ? 30 : 22;
    ctx.shadowColor = state.pierceTimer > 0 ? "#ffd36a" : "#63f7ff";
    const orb = ctx.createRadialGradient(ball.x - 3, ball.y - 4, 1, ball.x, ball.y, ball.radius + 3);
    orb.addColorStop(0, "#ffffff");
    orb.addColorStop(0.33, state.pierceTimer > 0 ? "#fff1a7" : "#a9ffff");
    orb.addColorStop(0.7, state.pierceTimer > 0 ? "#ff9d27" : "#2ddcf6");
    orb.addColorStop(1, "rgba(44,75,255,0.2)");
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius + Math.sin(state.time * 9 + ball.phase) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPowerups() {
  for (const powerup of state.powerups) {
    ctx.save();
    ctx.translate(powerup.x, powerup.y);
    ctx.rotate(powerup.phase);
    ctx.shadowBlur = 22;
    ctx.shadowColor = POWERUP_COLORS[powerup.type];
    ctx.fillStyle = POWERUP_COLORS[powerup.type];
    ctx.beginPath();
    ctx.moveTo(0, -powerup.size);
    ctx.lineTo(powerup.size, 0);
    ctx.lineTo(0, powerup.size);
    ctx.lineTo(-powerup.size, 0);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-powerup.phase);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#07101a";
    ctx.font = "800 12px Oxanium, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(POWERUP_LABELS[powerup.type], 0, 1);
    ctx.restore();
  }
}

function drawEffects() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const particle of state.particles) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = particle.color;
    if (particle.streak) {
      ctx.fillRect(particle.x, particle.y, particle.radius * 3, particle.radius * 0.7);
    } else {
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  for (const floater of state.floaters) {
    const alpha = clamp(floater.life / floater.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = floater.color;
    ctx.shadowBlur = 11;
    ctx.shadowColor = floater.color;
    ctx.font = `800 ${Math.round(15 * floater.scale)}px Oxanium, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(floater.text, floater.x, floater.y);
    ctx.restore();
  }

  if (state.combo >= 4 && state.mode === "running") {
    ctx.save();
    ctx.globalAlpha = 0.11 + Math.sin(state.time * 7) * 0.025;
    ctx.fillStyle = state.combo >= 8 ? "#ffd36a" : "#ff4db8";
    ctx.font = `800 ${58 + state.combo * 2}px Oxanium, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(`x${state.combo} OVERLOAD`, WIDTH / 2, HEIGHT * 0.58);
    ctx.restore();
  }
}

function render() {
  ctx.save();
  if (state.screenShake > 0) {
    ctx.translate(randomBetween(-state.screenShake, state.screenShake), randomBetween(-state.screenShake, state.screenShake));
  }
  drawBackground();
  drawBricks();
  drawPowerups();
  drawPaddle();
  drawBalls();
  drawEffects();
  ctx.restore();

  if (state.flash > 0) {
    ctx.fillStyle = `rgba(190,250,255,${Math.min(0.62, state.flash)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

function frame(timestamp) {
  if (!state.lastTime) state.lastTime = timestamp;
  const deltaTime = Math.min(0.025, Math.max(0, (timestamp - state.lastTime) / 1000));
  state.lastTime = timestamp;
  update(deltaTime);
  render();
  requestAnimationFrame(frame);
}

function pointerX(event) {
  const rect = canvas.getBoundingClientRect();
  return clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH, 0, WIDTH);
}

function beginFromIntent() {
  ensureAudio();
  if (state.mode === "ready" || state.mode === "over") {
    startRun();
  } else if (state.mode === "paused") {
    togglePause();
  } else if (state.mode === "running") {
    launchBall();
  }
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "arrowleft" || key === "a") {
    state.input.pointer = false;
    state.input.left = true;
  }
  if (key === "arrowright" || key === "d") {
    state.input.pointer = false;
    state.input.right = true;
  }
  if (key === " " || key === "arrowup" || key === "w") {
    event.preventDefault();
    beginFromIntent();
  }
  if (key === "p" || key === "escape") togglePause();
  if (key === "r") restartRun();
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (key === "arrowleft" || key === "a") state.input.left = false;
  if (key === "arrowright" || key === "d") state.input.right = false;
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  state.input.pointer = true;
  state.paddle.targetX = pointerX(event);
  beginFromIntent();
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is best-effort on older mobile browsers.
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse" || state.input.pointer) {
    state.input.pointer = true;
    state.paddle.targetX = pointerX(event);
  }
});

function releasePointer() {
  state.input.pointer = false;
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType !== "mouse") releasePointer();
});

ui.start.addEventListener("click", beginFromIntent);
ui.pause.addEventListener("click", togglePause);
ui.restart.addEventListener("click", restartRun);
ui.overlay.addEventListener("click", beginFromIntent);

for (const control of document.querySelectorAll("[data-control]")) {
  const action = control.dataset.control;
  if (action === "launch") {
    control.addEventListener("click", beginFromIntent);
    continue;
  }
  if (action === "pause") {
    control.addEventListener("click", togglePause);
    continue;
  }
  if (action === "restart") {
    control.addEventListener("click", restartRun);
    continue;
  }
  const setPressed = (pressed) => {
    state.input[action] = pressed;
    if (pressed) {
      state.input.pointer = false;
      ensureAudio();
    }
  };
  control.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    setPressed(true);
  });
  control.addEventListener("pointerup", () => setPressed(false));
  control.addEventListener("pointercancel", () => setPressed(false));
  control.addEventListener("pointerleave", () => setPressed(false));
}

window.addEventListener("blur", () => {
  state.input.left = false;
  state.input.right = false;
  state.input.pointer = false;
  if (state.mode === "running") togglePause();
});

makeStars();
buildBreach(1);
updateHud();
setStatus("Firewall waiting", "Launch the pulse and keep the return angle alive.");
setReward("Clear a breach. Earn SIM.", "Sign in with your AP account to bank each reward.");
setOverlay("System armed", "BREAK//THROUGH", "Smash the firewall. Chain the rebound. Clear breaches to bank SIM.", false);
requestAnimationFrame(frame);
