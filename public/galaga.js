const STORAGE_KEY = "bnapsen:galaga:best";
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const playfield = document.querySelector(".playfield");
const screenFrame = document.querySelector(".screen-frame");

const scoreDisplay = document.getElementById("score-display");
const bestDisplay = document.getElementById("best-display");
const waveDisplay = document.getElementById("wave-display");
const livesDisplay = document.getElementById("lives-display");
const statusTitle = document.getElementById("status-title");
const statusCopy = document.getElementById("status-copy");
const overlay = document.getElementById("screen-overlay");
const overlayKicker = document.getElementById("overlay-kicker");
const overlayTitle = document.getElementById("overlay-title");
const overlayCopy = document.getElementById("overlay-copy");
const startButton = document.getElementById("start-button");
const pauseButton = document.getElementById("pause-button");
const restartButton = document.getElementById("restart-button");
const KILLS_PER_SIM_DROP = 10;
const SIM_DOLLAR_VALUE_CENTS = 100;
const SIM_TEN_DOLLAR_VALUE_CENTS = 1000;
const SIM_TEN_DOLLAR_DROP_CHANCE = 0.02;
const SIM_COIN_COLLECT_RADIUS = 42;
const SIM_COIN_DROP_SPEED = 310;
const SIM_COIN_LAND_PADDING = 58;
const SIM_COIN_LANDED_TTL = 18;

const state = {
  width: canvas.width,
  height: canvas.height,
  running: false,
  paused: false,
  awaitingStart: true,
  score: 0,
  stage: 1,
  hits: 0,
  killsThisRun: 0,
  best: loadBestScore(),
  runId: createRunId(),
  player: {
    x: canvas.width / 2,
    y: canvas.height - 56,
    width: 26,
    height: 20,
    speed: 280,
    fireCooldown: 0,
    invulnerable: 0,
  },
  formation: null,
  enemies: [],
  bullets: [],
  enemyBullets: [],
  simCoins: [],
  particles: [],
  stars: [],
  coinSerial: 0,
  audio: {
    context: null,
    lastFireSoundAt: 0,
  },
  input: {
    left: false,
    right: false,
    fire: false,
    pointerActive: false,
    pointerX: canvas.width / 2,
  },
  enemyFireCooldown: 0.7,
  enemyFireTimer: 0.4,
  diveTimer: 1.8,
  waveIntro: 0,
  statusTimer: 0,
  time: 0,
  lastTime: 0,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRunId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ensureAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return null;
  }
  if (!state.audio.context) {
    state.audio.context = new AudioContext();
  }
  if (state.audio.context.state === "suspended") {
    state.audio.context.resume().catch(() => {});
  }
  return state.audio.context;
}

function playTone({
  frequency = 440,
  slideTo = 0,
  type = "sine",
  gain = 0.04,
  duration = 0.08,
  delay = 0,
} = {}) {
  const audio = ensureAudioContext();
  if (!audio) {
    return;
  }
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slideTo > 0) {
    oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  }
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume);
  volume.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playLaserSound() {
  if (state.time - state.audio.lastFireSoundAt < 0.06) {
    return;
  }
  state.audio.lastFireSoundAt = state.time;
  playTone({ frequency: 840, slideTo: 1320, type: "square", gain: 0.025, duration: 0.055 });
}

function playExplosionSound() {
  playTone({ frequency: 140, slideTo: 55, type: "sawtooth", gain: 0.045, duration: 0.13 });
  playTone({ frequency: 260, slideTo: 90, type: "triangle", gain: 0.028, duration: 0.11, delay: 0.018 });
}

function playCoinDropSound() {
  playTone({ frequency: 720, slideTo: 540, type: "triangle", gain: 0.036, duration: 0.12 });
  playTone({ frequency: 1120, slideTo: 880, type: "sine", gain: 0.022, duration: 0.1, delay: 0.055 });
}

function playCoinPickupSound() {
  playTone({ frequency: 660, slideTo: 980, type: "triangle", gain: 0.048, duration: 0.11 });
  playTone({ frequency: 990, slideTo: 1480, type: "sine", gain: 0.036, duration: 0.12, delay: 0.07 });
}

function playHitSound() {
  playTone({ frequency: 180, slideTo: 70, type: "sawtooth", gain: 0.07, duration: 0.18 });
}

function playWaveSound() {
  playTone({ frequency: 330, slideTo: 495, type: "triangle", gain: 0.032, duration: 0.12 });
  playTone({ frequency: 495, slideTo: 740, type: "triangle", gain: 0.034, duration: 0.14, delay: 0.09 });
}

function formatSimDropValue(valueCents) {
  const value = Math.max(0, Math.round(Number(valueCents) || 0)) / 100;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function chooseSimDropValueCents() {
  return Math.random() < SIM_TEN_DOLLAR_DROP_CHANCE
    ? SIM_TEN_DOLLAR_VALUE_CENTS
    : SIM_DOLLAR_VALUE_CENTS;
}

function recordSimCoinPickup(coin, retries = 4) {
  if (!window.NovaAuth || typeof window.NovaAuth.adjustSimWallet !== "function") {
    if (retries > 0) {
      window.setTimeout(() => recordSimCoinPickup(coin, retries - 1), 250);
    } else {
      setStatus("Drop caught locally", "Sign in before collecting to bank SIM on your account.", 2.8);
    }
    return;
  }
  if (typeof window.NovaAuth.isSignedIn === "function" && !window.NovaAuth.isSignedIn()) {
    setStatus("Drop caught locally", "Sign in before collecting to bank SIM on your account.", 2.8);
    return;
  }
  const amountCents = Math.max(SIM_DOLLAR_VALUE_CENTS, Math.round(Number(coin.valueCents) || SIM_DOLLAR_VALUE_CENTS));
  Promise.resolve(window.NovaAuth.adjustSimWallet({
    amountCents,
    source: "galaga",
    action: "sim-coin-pickup",
    note: `Galaga ${formatSimDropValue(amountCents)} SIM drop`,
    metadata: {
      coinId: coin.id,
      drop: coin.isJackpot ? "rare-ten-dollar" : "dollar",
      game: "galaga",
      killCount: KILLS_PER_SIM_DROP,
      killsThisRun: state.killsThisRun,
      score: state.score,
      stage: state.stage,
      runId: state.runId,
    },
  }))
    .catch(() => {
      setStatus("Drop pickup queued", "Your SIM wallet will retry the pickup when it syncs.", 2.8);
    });
}

function recordSimBulletHit(retries = 4) {
  if (!window.NovaAuth || typeof window.NovaAuth.adjustSimWallet !== "function") {
    if (retries > 0) {
      window.setTimeout(() => recordSimBulletHit(retries - 1), 250);
    }
    return;
  }
  window.NovaAuth.adjustSimWallet({
    amountCents: -1,
    source: "galaga",
    action: "bullet-hit-penalty",
    note: "Galaga enemy bullet hit penalty",
    metadata: {
      game: "galaga",
      score: state.score,
      stage: state.stage,
      runId: state.runId,
    },
  }).catch(() => {});
}

function loadBestScore() {
  try {
    return Number.parseInt(window.localStorage.getItem(STORAGE_KEY) || "0", 10) || 0;
  } catch {
    return 0;
  }
}

function saveBestScore() {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(state.best));
  } catch {
    // Ignore storage failures.
  }
}

function updateHud() {
  scoreDisplay.textContent = String(state.score).padStart(6, "0");
  bestDisplay.textContent = String(state.best).padStart(6, "0");
  waveDisplay.textContent = String(state.stage).padStart(2, "0");
  livesDisplay.textContent = String(state.hits);
}

function setStatus(title, copy, duration = 0) {
  statusTitle.textContent = title;
  statusCopy.textContent = copy;
  state.statusTimer = duration;
}

function setOverlay(kicker, title, copy, hidden = false) {
  overlayKicker.textContent = kicker;
  overlayTitle.textContent = title;
  overlayCopy.textContent = copy;
  overlay.classList.toggle("hidden", hidden);
}

function resizeScreenFrame() {
  if (!playfield || !screenFrame) {
    return;
  }
  const rect = playfield.getBoundingClientRect();
  const maxWidth = Math.max(0, rect.width);
  const maxHeight = Math.max(0, rect.height);
  const ratio = state.width / state.height;
  const width = Math.max(1, Math.floor(Math.min(maxWidth, maxHeight * ratio)));
  const height = Math.max(1, Math.floor(width / ratio));
  screenFrame.style.width = `${width}px`;
  screenFrame.style.height = `${height}px`;
}

function createStars() {
  state.stars = Array.from({ length: 72 }, () => ({
    x: Math.random() * state.width,
    y: Math.random() * state.height,
    speed: 18 + Math.random() * 44,
    radius: Math.random() < 0.84 ? 1 : 1.8,
    alpha: 0.2 + Math.random() * 0.8,
  }));
}

function resetPlayer() {
  state.player.x = state.width / 2;
  state.player.y = state.height - 56;
  state.player.fireCooldown = 0;
  state.player.invulnerable = 1.6;
}

function scoreValueForType(type) {
  switch (type) {
    case "boss":
      return 180;
    case "guard":
      return 120;
    default:
      return 80;
  }
}

function colorForType(type) {
  switch (type) {
    case "boss":
      return { fill: "#ffb35f", edge: "#ff5b5b", eye: "#101828" };
    case "guard":
      return { fill: "#7df9ff", edge: "#6e5dff", eye: "#101828" };
    default:
      return { fill: "#cdd7ff", edge: "#7d90ff", eye: "#101828" };
  }
}

function createFormation(stage) {
  const columns = 8;
  const rows = 5;
  const spacingX = 42;
  const spacingY = 38;
  const offsetX = (state.width - (columns - 1) * spacingX) / 2;
  const offsetY = 96;

  state.formation = {
    columns,
    rows,
    spacingX,
    spacingY,
    offsetX,
    offsetY,
    dir: 1,
    speed: 42 + Math.min(stage * 8, 220),
    bob: Math.random() * Math.PI * 2,
  };

  state.enemies = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let type = "drone";
      if (row === 0) {
        type = "boss";
      } else if (row <= 2) {
        type = "guard";
      }

      state.enemies.push({
        type,
        row,
        column,
        width: 24,
        height: 18,
        x: offsetX + column * spacingX,
        y: offsetY + row * spacingY,
        diving: false,
        returning: false,
        diveTime: 0,
        diveVX: 0,
        diveVY: 0,
        alive: true,
      });
    }
  }

  state.enemyBullets = [];
  state.bullets = [];
  state.particles = [];
  state.enemyFireCooldown = Math.max(0.16, 0.86 - Math.min(stage, 20) * 0.035);
  state.enemyFireTimer = 0.55;
  state.diveTimer = Math.max(0.28, 1.55 - Math.min(stage, 20) * 0.055);
  state.waveIntro = 1.4;
  resetPlayer();
  playWaveSound();
  setStatus(
    `Wave ${state.stage} live`,
    `Every ${KILLS_PER_SIM_DROP}th kill drops a $1 SIM coin. Rare drops are worth $10.`,
    3.4,
  );
}

function startRun() {
  state.awaitingStart = false;
  state.running = true;
  state.paused = false;
  state.score = 0;
  state.stage = 1;
  state.hits = 0;
  state.killsThisRun = 0;
  state.runId = createRunId();
  state.simCoins = [];
  state.coinSerial = 0;
  ensureAudioContext();
  createFormation(state.stage);
  updateHud();
  setOverlay("Wave 01", "Endless formation", "Every 10th kill drops $1 in SIM. Very rarely, that drop becomes $10.", false);
}

function restartRun() {
  startRun();
}

function togglePause() {
  if (state.awaitingStart) {
    return;
  }

  state.paused = !state.paused;
  if (state.paused) {
    setOverlay("Paused", "Hold your lane", "Take a breath. Press pause again or tap start to re-enter the wave.", false);
    setStatus("Run paused", "Everything stays frozen until you put the ship back under pressure.");
  } else {
    setOverlay(`Wave ${String(state.stage).padStart(2, "0")}`, "Back in it", "The formation kept its shape. You still have to crack it.", false);
    setStatus("Formation steady", "The window is open again. Shift left and pick a clean angle.", 2.2);
  }
}

function spawnPlayerBullet() {
  playLaserSound();
  state.bullets.push({
    x: state.player.x,
    y: state.player.y - 14,
    width: 4,
    height: 16,
    speed: 420,
  });
}

function spawnEnemyBullet(enemy) {
  state.enemyBullets.push({
    x: enemy.x,
    y: enemy.y + 16,
    width: 5,
    height: 15,
    speed: 220 + Math.min(state.stage * 22, 320),
  });
}

function spawnSimCoin(enemy) {
  const targetY = state.height - SIM_COIN_LAND_PADDING;
  const startX = clamp(enemy.x, 32, state.width - 32);
  const valueCents = chooseSimDropValueCents();
  const isJackpot = valueCents >= SIM_TEN_DOLLAR_VALUE_CENTS;
  state.simCoins.push({
    id: ++state.coinSerial,
    x: startX,
    y: clamp(enemy.y, 38, targetY),
    vx: clamp((state.player.x - enemy.x) * 0.045, -38, 38),
    vy: SIM_COIN_DROP_SPEED + Math.min(state.stage * 16, 190),
    targetY,
    radius: isJackpot ? 16 : 13,
    collectRadius: SIM_COIN_COLLECT_RADIUS + (isJackpot ? 5 : 0),
    landed: false,
    ttl: SIM_COIN_LANDED_TTL,
    phase: Math.random() * Math.PI * 2,
    valueCents,
    isJackpot,
  });
  playCoinDropSound();
  setStatus(
    isJackpot ? "Rare $10 SIM drop" : "$1 SIM drop",
    "Get under it. It will fall to the lower lane and wait briefly.",
    2.6,
  );
}

function spawnBurst(x, y, color, amount = 10) {
  for (let index = 0; index < amount; index += 1) {
    const angle = (Math.PI * 2 * index) / amount + Math.random() * 0.4;
    const speed = 36 + Math.random() * 90;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.25 + Math.random() * 0.35,
      color,
      radius: 1.4 + Math.random() * 2.2,
    });
  }
}

function startDive(enemy) {
  enemy.diving = true;
  enemy.returning = false;
  enemy.diveTime = 0;
  enemy.diveVX = (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 30);
  enemy.diveVY = 146 + Math.min(state.stage * 12, 220) + Math.random() * 18;
}

function moveAxis(current, target, amount) {
  if (current < target) {
    return Math.min(target, current + amount);
  }

  return Math.max(target, current - amount);
}

function rectsOverlap(a, b) {
  return (
    a.x - a.width / 2 < b.x + b.width / 2 &&
    a.x + a.width / 2 > b.x - b.width / 2 &&
    a.y - a.height / 2 < b.y + b.height / 2 &&
    a.y + a.height / 2 > b.y - b.height / 2
  );
}

function handlePlayerHit(reason = "collision") {
  if (state.player.invulnerable > 0) {
    return false;
  }

  state.hits += 1;
  playHitSound();
  spawnBurst(state.player.x, state.player.y, "#ff8c3a", 16);
  if (state.score > state.best) {
    state.best = state.score;
    saveBestScore();
  }

  resetPlayer();
  updateHud();
  if (reason === "bullet") {
    recordSimBulletHit();
    setStatus("Bullet hit: -0.01 SIM", "Endless mode keeps moving. Reset the lane before the next volley.", 2.8);
  } else if (reason === "breach") {
    setStatus("Formation breached", "The wave reset instead of ending the run. The difficulty keeps climbing.", 2.8);
  } else {
    setStatus("Ship clipped", "No game over here. Rebuild the center and keep stacking kills.", 2.8);
  }
  return true;
}

function killEnemy(enemy, bonusDive = false) {
  enemy.alive = false;
  enemy.diving = false;
  enemy.returning = false;
  const points = scoreValueForType(enemy.type) + (bonusDive ? 70 : 0);
  state.score += points;
  if (state.score > state.best) {
    state.best = state.score;
    saveBestScore();
  }
  const colors = colorForType(enemy.type);
  playExplosionSound();
  spawnBurst(enemy.x, enemy.y, colors.fill, 12);
  state.killsThisRun += 1;
  updateHud();
  if (state.killsThisRun % KILLS_PER_SIM_DROP === 0) {
    spawnSimCoin(enemy);
  }
}

function updateStars(deltaTime) {
  for (const star of state.stars) {
    star.y += star.speed * deltaTime;
    if (star.y > state.height + 4) {
      star.y = -4;
      star.x = Math.random() * state.width;
    }
  }
}

function updatePlayer(deltaTime) {
  if (state.input.pointerActive) {
    state.player.x = moveAxis(state.player.x, state.input.pointerX, state.player.speed * 1.35 * deltaTime);
  } else {
    const direction = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
    state.player.x += direction * state.player.speed * deltaTime;
  }
  state.player.x = Math.max(22, Math.min(state.width - 22, state.player.x));

  if (state.player.fireCooldown > 0) {
    state.player.fireCooldown -= deltaTime;
  }

  if (state.player.invulnerable > 0) {
    state.player.invulnerable -= deltaTime;
  }

  if (state.input.fire && state.player.fireCooldown <= 0) {
    spawnPlayerBullet();
    state.player.fireCooldown = 0.17;
  }
}

function updateFormation(deltaTime) {
  state.formation.offsetX += state.formation.dir * state.formation.speed * deltaTime;
  state.formation.bob += deltaTime * 2.4;

  const nonDivingEnemies = state.enemies.filter((enemy) => enemy.alive && !enemy.diving);
  if (nonDivingEnemies.length > 0) {
    const leftEdge = Math.min(...nonDivingEnemies.map((enemy) => state.formation.offsetX + enemy.column * state.formation.spacingX - enemy.width / 2));
    const rightEdge = Math.max(...nonDivingEnemies.map((enemy) => state.formation.offsetX + enemy.column * state.formation.spacingX + enemy.width / 2));

    if (leftEdge < 24 || rightEdge > state.width - 24) {
      state.formation.dir *= -1;
      state.formation.offsetY += 14;
    }
  }

  for (const enemy of nonDivingEnemies) {
    const baseX = state.formation.offsetX + enemy.column * state.formation.spacingX;
    const baseY = state.formation.offsetY + enemy.row * state.formation.spacingY;
    enemy.x = baseX + Math.sin(state.formation.bob + enemy.column * 0.35 + enemy.row * 0.25) * 2;
    enemy.y = baseY + Math.cos(state.formation.bob + enemy.column * 0.25) * 1.3;
  }

  if (state.formation.offsetY > state.height - 180) {
    if (handlePlayerHit("breach")) {
      createFormation(state.stage);
      updateHud();
      setOverlay(`Wave ${String(state.stage).padStart(2, "0")}`, "Formation reset", "They reached the deck, so the same wave reforms and the run stays alive.", false);
    }
  }
}

function updateDiveLogic(deltaTime) {
  state.diveTimer -= deltaTime;
  if (state.diveTimer <= 0) {
    const eligible = state.enemies.filter((enemy) => enemy.alive && !enemy.diving);
    const divingNow = state.enemies.filter((enemy) => enemy.alive && enemy.diving).length;
    const maxDivers = Math.min(7, 1 + Math.floor(state.stage / 2));
    if (eligible.length > 0 && divingNow < maxDivers) {
      startDive(eligible[Math.floor(Math.random() * eligible.length)]);
    }
    state.diveTimer = Math.max(0.24, 1.42 - Math.min(state.stage, 20) * 0.05);
  }

  for (const enemy of state.enemies) {
    if (!enemy.alive || !enemy.diving) {
      continue;
    }

    enemy.diveTime += deltaTime;
    if (!enemy.returning) {
      enemy.x += enemy.diveVX * deltaTime;
      enemy.y += enemy.diveVY * deltaTime;
      enemy.diveVX += Math.sign(state.player.x - enemy.x) * 28 * deltaTime;
      enemy.diveVX += Math.sin(enemy.diveTime * 7.4) * 34 * deltaTime;

      if (enemy.y > state.height * 0.72 || enemy.diveTime > 2.15) {
        enemy.returning = true;
      }
    } else {
      const targetX = state.formation.offsetX + enemy.column * state.formation.spacingX;
      const targetY = state.formation.offsetY + enemy.row * state.formation.spacingY;
      enemy.x = moveAxis(enemy.x, targetX, 220 * deltaTime);
      enemy.y = moveAxis(enemy.y, targetY, 250 * deltaTime);

      if (Math.abs(enemy.x - targetX) < 2 && Math.abs(enemy.y - targetY) < 2) {
        enemy.diving = false;
        enemy.returning = false;
        enemy.diveTime = 0;
      }
    }

    if (rectsOverlap(enemy, state.player)) {
      handlePlayerHit("collision");
      enemy.returning = true;
    }
  }
}

function updateBullets(deltaTime) {
  for (const bullet of state.bullets) {
    bullet.y -= bullet.speed * deltaTime;
  }
  state.bullets = state.bullets.filter((bullet) => bullet.y > -30);

  for (const bullet of state.enemyBullets) {
    bullet.y += bullet.speed * deltaTime;
    if (rectsOverlap(bullet, state.player)) {
      bullet.y = state.height + 100;
      handlePlayerHit("bullet");
    }
  }
  state.enemyBullets = state.enemyBullets.filter((bullet) => bullet.y < state.height + 24);
}

function updateEnemyFire(deltaTime) {
  state.enemyFireTimer -= deltaTime;
  if (state.enemyFireTimer > 0) {
    return;
  }

  const shooters = [];
  const byColumn = new Map();
  for (const enemy of state.enemies) {
    if (!enemy.alive) {
      continue;
    }

    const current = byColumn.get(enemy.column);
    if (!current || enemy.y > current.y) {
      byColumn.set(enemy.column, enemy);
    }
  }

  shooters.push(...byColumn.values());
  const divers = state.enemies.filter((enemy) => enemy.alive && enemy.diving && !enemy.returning);
  shooters.push(...divers.slice(0, 2));

  if (shooters.length > 0) {
    const selected = shooters[Math.floor(Math.random() * shooters.length)];
    spawnEnemyBullet(selected);
  }
  if (state.stage >= 3 && shooters.length > 2 && Math.random() > 0.5) {
    const selected = shooters[Math.floor(Math.random() * shooters.length)];
    spawnEnemyBullet(selected);
  }
  if (state.stage >= 8 && shooters.length > 3 && Math.random() > 0.62) {
    const selected = shooters[Math.floor(Math.random() * shooters.length)];
    spawnEnemyBullet(selected);
  }

  state.enemyFireTimer = state.enemyFireCooldown;
}

function updateCollisions() {
  for (const bullet of state.bullets) {
    for (const enemy of state.enemies) {
      if (!enemy.alive || !rectsOverlap(bullet, enemy)) {
        continue;
      }

      bullet.y = -100;
      killEnemy(enemy, enemy.diving && !enemy.returning);
      break;
    }
  }

  state.bullets = state.bullets.filter((bullet) => bullet.y > -30);

  if (state.enemies.every((enemy) => !enemy.alive)) {
    state.stage += 1;
    createFormation(state.stage);
    updateHud();
    setOverlay(`Wave ${String(state.stage).padStart(2, "0")}`, "Endless wave", "The field resets, but it comes back faster and meaner.", false);
  }
}

function coinOverlapsPlayer(coin) {
  return (
    Math.abs(coin.x - state.player.x) <= state.player.width / 2 + coin.collectRadius &&
    Math.abs(coin.y - state.player.y) <= state.player.height / 2 + coin.collectRadius
  );
}

function collectSimCoin(coin) {
  coin.collected = true;
  state.score += 25;
  spawnBurst(coin.x, coin.y, coin.isJackpot ? "#7df9ff" : "#ffd166", coin.isJackpot ? 22 : 14);
  playCoinPickupSound();
  updateHud();
  const valueLabel = formatSimDropValue(coin.valueCents);
  setStatus(
    `+${valueLabel} SIM caught`,
    `Drop ${coin.id} banked from ${state.killsThisRun} total kills this run.`,
    coin.isJackpot ? 3.6 : 2.8,
  );
  recordSimCoinPickup(coin);
}

function updateSimCoins(deltaTime) {
  for (const coin of state.simCoins) {
    coin.phase += deltaTime * 6;
    if (!coin.landed) {
      coin.x = clamp(coin.x + coin.vx * deltaTime, 28, state.width - 28);
      coin.y += coin.vy * deltaTime;
      coin.vx *= 0.986;
      if (coin.y >= coin.targetY) {
        coin.y = coin.targetY;
        coin.vx = 0;
        coin.vy = 0;
        coin.landed = true;
        coin.ttl = SIM_COIN_LANDED_TTL;
        spawnBurst(coin.x, coin.y, "#ffd166", 8);
      }
    } else {
      coin.ttl -= deltaTime;
    }

    if (coinOverlapsPlayer(coin)) {
      collectSimCoin(coin);
    }
  }

  state.simCoins = state.simCoins.filter((coin) => !coin.collected && coin.ttl > 0);
}

function updateParticles(deltaTime) {
  for (const particle of state.particles) {
    particle.x += particle.vx * deltaTime;
    particle.y += particle.vy * deltaTime;
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    particle.life -= deltaTime;
  }

  state.particles = state.particles.filter((particle) => particle.life > 0);
}

function update(deltaTime) {
  state.time += deltaTime;
  updateStars(deltaTime);

  if (!state.running || state.paused) {
    return;
  }

  if (state.waveIntro > 0) {
    state.waveIntro -= deltaTime;
    if (state.waveIntro <= 0) {
      setOverlay("", "", "", true);
    }
  }

  if (state.statusTimer > 0) {
    state.statusTimer -= deltaTime;
    if (state.statusTimer <= 0 && !state.paused) {
      setStatus(
        "Formation steady",
        "Pick the low guard first. The second break in the wall is where the score usually opens up.",
      );
    }
  }

  updatePlayer(deltaTime);
  updateFormation(deltaTime);
  updateDiveLogic(deltaTime);
  updateBullets(deltaTime);
  updateEnemyFire(deltaTime);
  updateCollisions();
  updateSimCoins(deltaTime);
  updateParticles(deltaTime);
}

function drawStarfield() {
  for (const star of state.stars) {
    ctx.fillStyle = `rgba(220, 235, 255, ${star.alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer() {
  const blink = state.player.invulnerable > 0 && Math.floor(state.time * 18) % 2 === 0;
  if (blink) {
    return;
  }

  ctx.save();
  ctx.translate(state.player.x, state.player.y);
  ctx.fillStyle = "#8cf4ff";
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(-15, 12);
  ctx.lineTo(-5, 8);
  ctx.lineTo(0, 2);
  ctx.lineTo(5, 8);
  ctx.lineTo(15, 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ff8c3a";
  ctx.beginPath();
  ctx.moveTo(-8, 10);
  ctx.lineTo(-2, 16);
  ctx.lineTo(0, 8);
  ctx.lineTo(2, 16);
  ctx.lineTo(8, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEnemy(enemy) {
  const colors = colorForType(enemy.type);

  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  if (enemy.diving) {
    ctx.rotate(Math.max(-0.45, Math.min(0.45, enemy.diveVX / 260)));
  }

  ctx.fillStyle = colors.fill;
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.bezierCurveTo(12, -12, 15, -4, 14, 4);
  ctx.lineTo(8, 10);
  ctx.lineTo(4, 4);
  ctx.lineTo(0, 9);
  ctx.lineTo(-4, 4);
  ctx.lineTo(-8, 10);
  ctx.lineTo(-14, 4);
  ctx.bezierCurveTo(-15, -4, -12, -12, 0, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.edge;
  ctx.beginPath();
  ctx.moveTo(-18, -1);
  ctx.lineTo(-6, -3);
  ctx.lineTo(-12, 6);
  ctx.closePath();
  ctx.moveTo(18, -1);
  ctx.lineTo(6, -3);
  ctx.lineTo(12, 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = colors.eye;
  ctx.beginPath();
  ctx.arc(-4, -2, 2, 0, Math.PI * 2);
  ctx.arc(4, -2, 2, 0, Math.PI * 2);
  ctx.fill();

  if (enemy.type === "boss") {
    ctx.fillStyle = "#fff0d4";
    ctx.fillRect(-3, -14, 6, 5);
  }

  ctx.restore();
}

function drawBullets() {
  for (const bullet of state.bullets) {
    ctx.fillStyle = "#7df9ff";
    ctx.fillRect(bullet.x - bullet.width / 2, bullet.y - bullet.height / 2, bullet.width, bullet.height);
  }

  for (const bullet of state.enemyBullets) {
    ctx.fillStyle = "#ff5370";
    ctx.fillRect(bullet.x - bullet.width / 2, bullet.y - bullet.height / 2, bullet.width, bullet.height);
  }
}

function drawSimCoin(coin) {
  const pulse = Math.sin(state.time * 7 + coin.phase);
  const displayY = coin.y + (coin.landed ? pulse * 3 : 0);
  const glowColor = coin.isJackpot ? "#7df9ff" : "#ffd166";
  const softGlow = coin.isJackpot ? "rgba(125, 249, 255, 0.24)" : "rgba(255, 209, 102, 0.24)";
  const trailColor = coin.isJackpot ? "rgba(125, 249, 255, 0.24)" : "rgba(255, 209, 102, 0.22)";
  const label = formatSimDropValue(coin.valueCents);

  ctx.save();
  if (!coin.landed) {
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 11]);
    ctx.beginPath();
    ctx.moveTo(coin.x, coin.y + 15);
    ctx.lineTo(coin.x, coin.targetY + 12);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = coin.isJackpot ? "rgba(125, 249, 255, 0.13)" : "rgba(255, 209, 102, 0.12)";
    ctx.beginPath();
    ctx.ellipse(coin.x, coin.targetY + 14, 34, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(coin.x, displayY);
  ctx.fillStyle = coin.isJackpot
    ? `rgba(125, 249, 255, ${coin.landed ? 0.16 : 0.11})`
    : `rgba(255, 209, 102, ${coin.landed ? 0.14 : 0.1})`;
  ctx.beginPath();
  ctx.arc(0, 0, coin.collectRadius + Math.max(0, pulse) * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 22;
  ctx.shadowColor = glowColor;
  ctx.fillStyle = softGlow;
  ctx.beginPath();
  ctx.arc(0, 0, coin.radius + 11, 0, Math.PI * 2);
  ctx.fill();

  ctx.scale(0.58 + Math.abs(Math.cos(state.time * 5 + coin.phase)) * 0.42, 1);
  const gradient = ctx.createRadialGradient(-4, -5, 3, 0, 0, coin.radius);
  if (coin.isJackpot) {
    gradient.addColorStop(0, "#f0fdff");
    gradient.addColorStop(0.5, "#7df9ff");
    gradient.addColorStop(1, "#1b7b8f");
  } else {
    gradient.addColorStop(0, "#fff3b0");
    gradient.addColorStop(0.52, "#ffd166");
    gradient.addColorStop(1, "#b86c16");
  }
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, coin.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 247, 190, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, coin.radius - 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#20130a";
  ctx.font = `800 ${coin.isJackpot ? 8 : 9}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 1);
  ctx.restore();
}

function drawSimCoins() {
  for (const coin of state.simCoins) {
    drawSimCoin(coin);
  }
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(0, particle.life * 1.8);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawGridGlow() {
  ctx.save();
  ctx.strokeStyle = "rgba(125, 249, 255, 0.06)";
  ctx.lineWidth = 1;
  for (let row = 1; row < 11; row += 1) {
    ctx.beginPath();
    ctx.moveTo(0, row * 58);
    ctx.lineTo(state.width, row * 58);
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, state.width, state.height);

  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, "#081126");
  gradient.addColorStop(0.6, "#050914");
  gradient.addColorStop(1, "#02040b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  drawStarfield();
  drawGridGlow();

  for (const enemy of state.enemies) {
    if (enemy.alive) {
      drawEnemy(enemy);
    }
  }

  drawBullets();
  drawSimCoins();
  drawPlayer();
  drawParticles();
}

function frame(timestamp) {
  if (!state.lastTime) {
    state.lastTime = timestamp;
  }
  const deltaTime = Math.min(0.033, (timestamp - state.lastTime) / 1000);
  state.lastTime = timestamp;

  update(deltaTime);
  render();
  window.requestAnimationFrame(frame);
}

function onKeyChange(event, pressed) {
  switch (event.key.toLowerCase()) {
    case "arrowleft":
    case "a":
      state.input.left = pressed;
      break;
    case "arrowright":
    case "d":
      state.input.right = pressed;
      break;
    case " ":
    case "arrowup":
    case "w":
      state.input.fire = pressed;
      if (pressed) {
        event.preventDefault();
      }
      break;
    case "p":
      if (pressed) {
        togglePause();
      }
      break;
    default:
      break;
  }
}

function bindKeyboard() {
  window.addEventListener("keydown", (event) => onKeyChange(event, true));
  window.addEventListener("keyup", (event) => onKeyChange(event, false));
}

function bindPointerControls() {
  const pointerXFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
    return Math.max(22, Math.min(state.width - 22, ratio * state.width));
  };

  const updatePointerAim = (event) => {
    state.input.pointerX = pointerXFromEvent(event);
  };

  const stopPointerAim = () => {
    state.input.pointerActive = false;
    state.input.fire = false;
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (state.awaitingStart) {
      startRun();
    }
    state.input.pointerActive = true;
    state.input.fire = true;
    updatePointerAim(event);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best effort; movement still works while over the canvas.
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.input.pointerActive) {
      return;
    }
    event.preventDefault();
    updatePointerAim(event);
  });
  canvas.addEventListener("pointerup", stopPointerAim);
  canvas.addEventListener("pointercancel", stopPointerAim);
  canvas.addEventListener("pointerleave", stopPointerAim);

  overlay.addEventListener("click", () => {
    if (state.awaitingStart) {
      startRun();
    }
  });

  for (const button of document.querySelectorAll("[data-control]")) {
    const control = button.getAttribute("data-control");
    const activate = (pressed) => {
      if (control === "left") {
        state.input.left = pressed;
      } else if (control === "right") {
        state.input.right = pressed;
      } else if (control === "fire") {
        state.input.fire = pressed;
      }
    };

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      activate(true);
    });
    button.addEventListener("pointerup", () => activate(false));
    button.addEventListener("pointerleave", () => activate(false));
    button.addEventListener("pointercancel", () => activate(false));
  }
}

function bindUi() {
  startButton.addEventListener("click", () => {
    if (state.awaitingStart) {
      startRun();
      return;
    }

    if (state.paused) {
      togglePause();
    }
  });

  pauseButton.addEventListener("click", () => {
    if (state.awaitingStart) {
      startRun();
      return;
    }

    togglePause();
  });

  restartButton.addEventListener("click", restartRun);
}

function init() {
  createStars();
  resizeScreenFrame();
  updateHud();
  setStatus(
    "Formation steady",
    "Every tenth enemy drops $1 in SIM. A very rare drop is worth $10.",
  );
  setOverlay("Ready", "Endless Galaga", "Every tenth kill drops $1 in SIM. Very rarely, the drop is $10.", false);
  bindKeyboard();
  bindPointerControls();
  bindUi();
  window.addEventListener("load", resizeScreenFrame);
  window.addEventListener("resize", resizeScreenFrame);
  window.addEventListener("orientationchange", () => window.setTimeout(resizeScreenFrame, 120));
  window.requestAnimationFrame(frame);
}

init();
