const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const scoreDisplay = document.getElementById("score-display");
const bestDisplay = document.getElementById("best-display");
const levelDisplay = document.getElementById("level-display");
const livesDisplay = document.getElementById("lives-display");
const pulseDisplay = document.getElementById("pulse-display");
const overlay = document.getElementById("screen-overlay");
const overlayKicker = document.getElementById("overlay-kicker");
const overlayTitle = document.getElementById("overlay-title");
const overlayCopy = document.getElementById("overlay-copy");
const startButton = document.getElementById("start-button");
const restartButton = document.getElementById("restart-button");
const pauseButton = document.getElementById("pause-button");
const pulseButton = document.getElementById("pulse-button");
const muteButton = document.getElementById("mute-button");
const statusTitle = document.getElementById("status-title");
const statusCopy = document.getElementById("status-copy");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const STORAGE_KEY = "signal-surge:best-score";
const SOUND_KEY = "signal-surge:sound-enabled";

const keys = new Set();
const controls = new Set();

const state = {
  mode: "ready",
  score: 0,
  best: readNumber(STORAGE_KEY, 0),
  level: 1,
  lives: 3,
  pulses: 2,
  streak: 0,
  time: 0,
  lastFrame: 0,
  shardTimer: 0,
  lockTimer: 0,
  batteryTimer: 4,
  shake: 0,
  pulseWave: 0,
  invulnerable: 0,
  muted: !readBoolean(SOUND_KEY, true),
  audioContext: null,
  pointer: null,
  player: createPlayer(),
  shards: [],
  locks: [],
  particles: [],
};

function createPlayer() {
  return {
    x: WIDTH * 0.5,
    y: HEIGHT - 82,
    vx: 0,
    vy: 0,
    radius: 15,
  };
}

function readNumber(key, fallback) {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readBoolean(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage may be blocked in private browsing.
  }
}

function formatScore(value) {
  return String(Math.max(0, Math.floor(value))).padStart(6, "0");
}

function updateHud() {
  scoreDisplay.textContent = formatScore(state.score);
  bestDisplay.textContent = formatScore(state.best);
  levelDisplay.textContent = String(state.level).padStart(2, "0");
  livesDisplay.textContent = String(Math.max(0, state.lives));
  pulseDisplay.textContent = String(Math.max(0, state.pulses));
  muteButton.textContent = state.muted ? "Sound Off" : "Sound On";
  muteButton.setAttribute("aria-pressed", String(!state.muted));
}

function setOverlay(mode) {
  if (mode === "playing") {
    overlay.classList.add("hidden");
    return;
  }

  overlay.classList.remove("hidden");
  const content = {
    ready: ["Ready", "Signal Surge", "Collect clean signals, dodge red locks, and spend pulses before the grid closes in.", "Start Run"],
    paused: ["Paused", "Run Holding", "Resume when the lane opens.", "Resume"],
    gameover: ["Run Ended", "Signal Lost", `Final score ${formatScore(state.score)}. Best score ${formatScore(state.best)}.`, "Run Again"],
  }[mode];

  overlayKicker.textContent = content[0];
  overlayTitle.textContent = content[1];
  overlayCopy.textContent = content[2];
  startButton.textContent = content[3];
}

function setStatus(title, copy) {
  statusTitle.textContent = title;
  statusCopy.textContent = copy;
}

function resetRun() {
  state.mode = "ready";
  state.score = 0;
  state.level = 1;
  state.lives = 3;
  state.pulses = 2;
  state.streak = 0;
  state.time = 0;
  state.shardTimer = 0;
  state.lockTimer = 0;
  state.batteryTimer = 4;
  state.shake = 0;
  state.pulseWave = 0;
  state.invulnerable = 0;
  state.pointer = null;
  state.player = createPlayer();
  state.shards = [];
  state.locks = [];
  state.particles = [];
  setStatus("Grid standing by", "Signal lanes are open. Start the run when ready.");
  setOverlay("ready");
  updateHud();
}

function startRun() {
  if (state.mode === "gameover") {
    resetRun();
  }

  if (state.mode === "ready") {
    state.mode = "playing";
    state.lastFrame = performance.now();
    setStatus("Signal live", "Keep the streak active and use pulse to clear tight lanes.");
    primeAudio();
    playTone(440, 0.08, "triangle", 0.04);
    setOverlay("playing");
    return;
  }

  if (state.mode === "paused") {
    state.mode = "playing";
    state.lastFrame = performance.now();
    setStatus("Signal live", "Run resumed.");
    primeAudio();
    setOverlay("playing");
  }
}

function pauseRun() {
  if (state.mode === "playing") {
    state.mode = "paused";
    setStatus("Paused", "The run is holding.");
    setOverlay("paused");
  } else if (state.mode === "paused") {
    startRun();
  }
}

function endRun() {
  state.mode = "gameover";
  if (state.score > state.best) {
    state.best = state.score;
    writeStorage(STORAGE_KEY, state.best);
  }
  setStatus("Signal lost", "The last red lock broke through.");
  setOverlay("gameover");
  updateHud();
}

function inputVector() {
  let x = 0;
  let y = 0;

  if (keys.has("arrowleft") || keys.has("a") || controls.has("left")) x -= 1;
  if (keys.has("arrowright") || keys.has("d") || controls.has("right")) x += 1;
  if (keys.has("arrowup") || keys.has("w") || controls.has("up")) y -= 1;
  if (keys.has("arrowdown") || keys.has("s") || controls.has("down")) y += 1;

  if (state.pointer) {
    const dx = state.pointer.x - state.player.x;
    const dy = state.pointer.y - state.player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 8) {
      x += dx / Math.max(distance, 1);
      y += dy / Math.max(distance, 1);
    }
  }

  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

function spawnShard(type = "signal") {
  const margin = 40;
  const radius = type === "battery" ? 13 : 10;
  state.shards.push({
    type,
    x: margin + Math.random() * (WIDTH - margin * 2),
    y: -30,
    radius,
    vy: 90 + state.level * 11 + Math.random() * 34,
    drift: (Math.random() - 0.5) * 40,
    phase: Math.random() * Math.PI * 2,
  });
}

function spawnLock() {
  const size = 28 + Math.min(22, state.level * 2);
  const x = 30 + Math.random() * (WIDTH - 60);
  state.locks.push({
    x,
    y: -50,
    width: size,
    height: size,
    vx: (Math.random() - 0.5) * (38 + state.level * 3),
    vy: 118 + state.level * 16 + Math.random() * 46,
    spin: (Math.random() - 0.5) * 3,
    angle: Math.random() * Math.PI,
  });
}

function addParticles(x, y, color, count, speed = 160) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = speed * (0.28 + Math.random() * 0.72);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life: 0.35 + Math.random() * 0.35,
      maxLife: 0.7,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

function spendPulse() {
  if (state.mode !== "playing" || state.pulses <= 0 || state.pulseWave > 0) {
    return;
  }

  state.pulses -= 1;
  state.pulseWave = 0.55;
  state.shake = Math.max(state.shake, 7);
  let cleared = 0;

  state.locks = state.locks.filter((lock) => {
    const distance = Math.hypot(lock.x - state.player.x, lock.y - state.player.y);
    if (distance < 210) {
      cleared += 1;
      addParticles(lock.x, lock.y, "#3fd0d4", 12, 220);
      return false;
    }
    return true;
  });

  if (cleared > 0) {
    state.score += cleared * 150;
    state.streak += cleared;
    setStatus("Pulse cleared", `${cleared} red ${cleared === 1 ? "lock" : "locks"} removed.`);
    playTone(180, 0.12, "sawtooth", 0.045);
    playTone(520, 0.16, "triangle", 0.035);
  } else {
    setStatus("Pulse spent", "No locks were inside the pulse radius.");
    playTone(260, 0.08, "square", 0.025);
  }

  updateHud();
}

function circleRectCollision(circle, rect) {
  const closestX = Math.max(rect.x - rect.width / 2, Math.min(circle.x, rect.x + rect.width / 2));
  const closestY = Math.max(rect.y - rect.height / 2, Math.min(circle.y, rect.y + rect.height / 2));
  return Math.hypot(circle.x - closestX, circle.y - closestY) < circle.radius;
}

function update(dt) {
  state.time += dt;
  state.level = 1 + Math.floor(state.score / 1400);
  state.shardTimer -= dt;
  state.lockTimer -= dt;
  state.batteryTimer -= dt;
  state.shake = Math.max(0, state.shake - dt * 28);
  state.pulseWave = Math.max(0, state.pulseWave - dt);
  state.invulnerable = Math.max(0, state.invulnerable - dt);

  if (state.shardTimer <= 0) {
    spawnShard("signal");
    state.shardTimer = Math.max(0.24, 0.66 - state.level * 0.025);
  }

  if (state.lockTimer <= 0) {
    spawnLock();
    state.lockTimer = Math.max(0.32, 1.05 - state.level * 0.045);
  }

  if (state.batteryTimer <= 0) {
    spawnShard("battery");
    state.batteryTimer = 7.5 + Math.random() * 3;
  }

  const input = inputVector();
  const player = state.player;
  const acceleration = 1600;
  const drag = Math.pow(0.001, dt);
  const maxSpeed = 390;
  player.vx = (player.vx + input.x * acceleration * dt) * drag;
  player.vy = (player.vy + input.y * acceleration * dt) * drag;
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > maxSpeed) {
    player.vx = (player.vx / speed) * maxSpeed;
    player.vy = (player.vy / speed) * maxSpeed;
  }
  player.x = Math.max(22, Math.min(WIDTH - 22, player.x + player.vx * dt));
  player.y = Math.max(44, Math.min(HEIGHT - 26, player.y + player.vy * dt));

  state.shards.forEach((shard) => {
    shard.phase += dt * 4;
    shard.y += shard.vy * dt;
    shard.x += Math.sin(shard.phase) * shard.drift * dt;
  });

  state.locks.forEach((lock) => {
    lock.y += lock.vy * dt;
    lock.x += lock.vx * dt;
    lock.angle += lock.spin * dt;
    if (lock.x < 28 || lock.x > WIDTH - 28) {
      lock.vx *= -1;
    }
  });

  state.particles.forEach((particle) => {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.pow(0.18, dt);
    particle.vy *= Math.pow(0.18, dt);
  });

  state.shards = state.shards.filter((shard) => {
    if (shard.y > HEIGHT + 40) {
      return false;
    }

    if (Math.hypot(shard.x - player.x, shard.y - player.y) < shard.radius + player.radius) {
      if (shard.type === "battery") {
        state.pulses = Math.min(5, state.pulses + 1);
        state.score += 75;
        addParticles(shard.x, shard.y, "#75bf7a", 14, 190);
        setStatus("Pulse charged", "Battery collected.");
        playTone(700, 0.08, "triangle", 0.04);
      } else {
        state.streak += 1;
        state.score += 100 + Math.min(250, state.streak * 25);
        addParticles(shard.x, shard.y, "#f0b64d", 10, 160);
        if (state.streak % 6 === 0) {
          setStatus("Streak rising", `${state.streak} clean signals chained.`);
        }
        playTone(520 + Math.min(state.streak, 12) * 22, 0.05, "sine", 0.025);
      }
      return false;
    }

    return true;
  });

  state.locks = state.locks.filter((lock) => {
    if (lock.y > HEIGHT + 60) {
      return false;
    }

    if (circleRectCollision(player, lock)) {
      if (state.invulnerable > 0) {
        return false;
      }

      state.lives -= 1;
      state.streak = 0;
      state.invulnerable = 1.25;
      state.shake = 12;
      addParticles(player.x, player.y, "#e1574f", 18, 240);
      setStatus("Lock impact", state.lives > 0 ? "Shield recovered. Rebuild the streak." : "No lives remaining.");
      playTone(120, 0.18, "sawtooth", 0.05);
      if (state.lives <= 0) {
        endRun();
      }
      return false;
    }

    return true;
  });

  state.particles = state.particles.filter((particle) => particle.life > 0);

  if (state.score > state.best) {
    state.best = state.score;
    writeStorage(STORAGE_KEY, state.best);
  }

  updateHud();
}

function drawGrid(offset) {
  ctx.save();
  ctx.strokeStyle = "rgba(83, 126, 154, 0.22)";
  ctx.lineWidth = 1;
  const cell = 48;
  const yOffset = offset % cell;
  for (let x = 0; x <= WIDTH; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = -cell; y <= HEIGHT + cell; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, y + yOffset);
    ctx.lineTo(WIDTH, y + yOffset);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer() {
  const player = state.player;
  const flicker = state.invulnerable > 0 && Math.floor(state.time * 18) % 2 === 0;
  if (flicker) {
    return;
  }

  ctx.save();
  ctx.translate(player.x, player.y);
  const heading = Math.atan2(player.vy, player.vx || 0.001);
  ctx.rotate(Math.abs(player.vx) + Math.abs(player.vy) > 30 ? heading + Math.PI / 2 : 0);

  ctx.shadowBlur = 18;
  ctx.shadowColor = "#3fd0d4";
  ctx.fillStyle = "#dffcff";
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(15, 14);
  ctx.lineTo(0, 8);
  ctx.lineTo(-15, 14);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#3fd0d4";
  ctx.fillRect(-4, -4, 8, 16);
  ctx.restore();

  if (state.invulnerable > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(63, 208, 212, 0.68)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 27 + Math.sin(state.time * 18) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawShard(shard) {
  ctx.save();
  ctx.translate(shard.x, shard.y);
  ctx.rotate(shard.phase * 0.6);
  ctx.shadowBlur = shard.type === "battery" ? 18 : 14;
  ctx.shadowColor = shard.type === "battery" ? "#75bf7a" : "#f0b64d";
  ctx.fillStyle = shard.type === "battery" ? "#75bf7a" : "#f0b64d";
  ctx.beginPath();
  ctx.moveTo(0, -shard.radius);
  ctx.lineTo(shard.radius, 0);
  ctx.lineTo(0, shard.radius);
  ctx.lineTo(-shard.radius, 0);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
  ctx.stroke();
  ctx.restore();
}

function drawLock(lock) {
  ctx.save();
  ctx.translate(lock.x, lock.y);
  ctx.rotate(lock.angle);
  ctx.shadowBlur = 16;
  ctx.shadowColor = "#e1574f";
  ctx.fillStyle = "#e1574f";
  ctx.fillRect(-lock.width / 2, -lock.height / 2, lock.width, lock.height);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-lock.width / 2, -lock.height / 2, lock.width, lock.height);
  ctx.beginPath();
  ctx.moveTo(-lock.width * 0.28, -lock.height * 0.28);
  ctx.lineTo(lock.width * 0.28, lock.height * 0.28);
  ctx.moveTo(lock.width * 0.28, -lock.height * 0.28);
  ctx.lineTo(-lock.width * 0.28, lock.height * 0.28);
  ctx.stroke();
  ctx.restore();
}

function drawParticles() {
  state.particles.forEach((particle) => {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    ctx.restore();
  });
}

function drawPulse() {
  if (state.pulseWave <= 0) {
    return;
  }

  const progress = 1 - state.pulseWave / 0.55;
  ctx.save();
  ctx.globalAlpha = 1 - progress;
  ctx.strokeStyle = "#3fd0d4";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(state.player.x, state.player.y, 28 + progress * 190, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function draw() {
  ctx.save();
  if (state.shake > 0) {
    ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  }

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#081018");
  gradient.addColorStop(0.5, "#111927");
  gradient.addColorStop(1, "#111a18");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawGrid(state.time * (52 + state.level * 6));

  ctx.fillStyle = "rgba(63, 208, 212, 0.08)";
  ctx.fillRect(0, HEIGHT - 76, WIDTH, 2);
  ctx.fillStyle = "rgba(240, 182, 77, 0.08)";
  ctx.fillRect(0, 76, WIDTH, 2);

  state.shards.forEach(drawShard);
  state.locks.forEach(drawLock);
  drawParticles();
  drawPulse();
  drawPlayer();

  ctx.restore();
}

function frame(now) {
  const dt = Math.min(0.033, (now - state.lastFrame) / 1000 || 0);
  state.lastFrame = now;
  if (state.mode === "playing") {
    update(dt);
  }
  draw();
  window.requestAnimationFrame(frame);
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
  const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
  return {
    x: ((clientX - rect.left) / rect.width) * WIDTH,
    y: ((clientY - rect.top) / rect.height) * HEIGHT,
  };
}

function getAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }
  if (!state.audioContext) {
    state.audioContext = new AudioContextCtor();
  }
  return state.audioContext;
}

async function primeAudio() {
  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== "suspended") {
    return;
  }
  try {
    await audioContext.resume();
  } catch {
    // Browser autoplay policy can defer audio until another gesture.
  }
}

function playTone(frequency, duration, type, volume) {
  if (state.muted) {
    return;
  }

  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const start = audioContext.currentTime + 0.01;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.04);
}

startButton.addEventListener("click", startRun);
restartButton.addEventListener("click", () => {
  resetRun();
  startRun();
});
pauseButton.addEventListener("click", pauseRun);
pulseButton.addEventListener("click", spendPulse);
muteButton.addEventListener("click", () => {
  state.muted = !state.muted;
  writeStorage(SOUND_KEY, !state.muted);
  updateHud();
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
  }
  if (key === "enter") {
    startRun();
  } else if (key === "p") {
    pauseRun();
  } else if (key === " ") {
    spendPulse();
  } else {
    keys.add(key);
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

canvas.addEventListener("pointerdown", (event) => {
  if (state.mode !== "playing") {
    startRun();
  }
  canvas.setPointerCapture(event.pointerId);
  state.pointer = getCanvasPoint(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.buttons) {
    state.pointer = getCanvasPoint(event);
  }
});

canvas.addEventListener("pointerup", () => {
  state.pointer = null;
});

document.querySelectorAll("[data-control]").forEach((button) => {
  const control = button.getAttribute("data-control");
  const press = (event) => {
    event.preventDefault();
    controls.add(control);
    primeAudio();
    if (state.mode !== "playing") {
      startRun();
    }
  };
  const release = () => controls.delete(control);
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("pointercancel", release);
});

resetRun();
draw();
window.requestAnimationFrame(frame);
