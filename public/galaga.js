const STORAGE_KEY = "bnapsen:galaga:best";
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

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

const state = {
  width: canvas.width,
  height: canvas.height,
  running: false,
  paused: false,
  awaitingStart: true,
  gameOver: false,
  score: 0,
  stage: 1,
  lives: 3,
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
  particles: [],
  stars: [],
  input: {
    left: false,
    right: false,
    fire: false,
  },
  enemyFireCooldown: 0.7,
  enemyFireTimer: 0.4,
  diveTimer: 1.8,
  waveIntro: 0,
  statusTimer: 0,
  time: 0,
  lastTime: 0,
};

function createRunId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function recordSimEnemyKill(killCount = 1) {
  if (!window.NovaAuth || typeof window.NovaAuth.recordEnemyKillReward !== "function") {
    return;
  }
  window.NovaAuth.recordEnemyKillReward({
    game: "galaga",
    killCount,
    score: state.score,
    runId: state.runId,
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
  livesDisplay.textContent = String(state.lives);
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
    speed: 42 + stage * 7,
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
  state.enemyFireCooldown = Math.max(0.3, 0.88 - stage * 0.05);
  state.enemyFireTimer = 0.55;
  state.diveTimer = Math.max(0.5, 1.7 - stage * 0.08);
  state.waveIntro = 1.4;
  resetPlayer();
  setStatus(
    `Wave ${state.stage} live`,
    "The center opens first. Own it before the dive-bombers decide you don't deserve it.",
    3.4,
  );
}

function startRun() {
  state.awaitingStart = false;
  state.running = true;
  state.paused = false;
  state.gameOver = false;
  state.score = 0;
  state.stage = 1;
  state.lives = 3;
  state.runId = createRunId();
  createFormation(state.stage);
  updateHud();
  setOverlay("Wave 01", "Formation live", "Break the front line before the dive angles start to stack.", false);
}

function restartRun() {
  startRun();
}

function togglePause() {
  if (state.awaitingStart || state.gameOver) {
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
    speed: 220 + state.stage * 20,
  });
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
  enemy.diveVY = 146 + state.stage * 10 + Math.random() * 18;
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

function loseLife() {
  if (state.player.invulnerable > 0 || state.gameOver) {
    return;
  }

  state.lives -= 1;
  spawnBurst(state.player.x, state.player.y, "#ff8c3a", 16);

  if (state.lives <= 0) {
    state.running = false;
    state.gameOver = true;
    if (state.score > state.best) {
      state.best = state.score;
      saveBestScore();
    }
    updateHud();
    setOverlay("Run over", "Formation wins", "Hit restart and take a cleaner first lane next time.", false);
    setStatus("Ship lost", "The dive pattern finally landed. Restart and steal back the first tempo.");
    return;
  }

  resetPlayer();
  updateHud();
  setStatus("Ship clipped", "You still have time. Stay off the walls and rebuild the center.", 2.8);
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
  spawnBurst(enemy.x, enemy.y, colors.fill, 12);
  updateHud();
  recordSimEnemyKill(1);
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
  const direction = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
  state.player.x += direction * state.player.speed * deltaTime;
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
    loseLife();
  }
}

function updateDiveLogic(deltaTime) {
  state.diveTimer -= deltaTime;
  if (state.diveTimer <= 0) {
    const eligible = state.enemies.filter((enemy) => enemy.alive && !enemy.diving);
    const divingNow = state.enemies.filter((enemy) => enemy.alive && enemy.diving).length;
    const maxDivers = Math.min(4, 1 + Math.floor(state.stage / 2));
    if (eligible.length > 0 && divingNow < maxDivers) {
      startDive(eligible[Math.floor(Math.random() * eligible.length)]);
    }
    state.diveTimer = Math.max(0.35, 1.55 - state.stage * 0.06);
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
      loseLife();
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
      loseLife();
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
    setOverlay(`Wave ${String(state.stage).padStart(2, "0")}`, "New formation", "The field resets, but it comes back faster and meaner.", false);
  }
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
    if (state.statusTimer <= 0 && !state.paused && !state.gameOver) {
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
    if (state.awaitingStart || state.gameOver) {
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

    if (state.gameOver) {
      restartRun();
      return;
    }

    togglePause();
  });

  restartButton.addEventListener("click", restartRun);
}

function init() {
  createStars();
  updateHud();
  setStatus(
    "Formation steady",
    "This cabinet likes patience. Open the lane, then punish the dive path when it shows itself.",
  );
  setOverlay("Ready", "Press Start", "Clear the formation before the sky folds in on you.", false);
  bindKeyboard();
  bindPointerControls();
  bindUi();
  window.requestAnimationFrame(frame);
}

init();
