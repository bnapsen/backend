const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText = document.getElementById('overlayText');
const startBtn = document.getElementById('startBtn');
const distanceLabel = document.getElementById('distance');
const scoreLabel = document.getElementById('score');
const bestLabel = document.getElementById('best');

const keys = new Set();
let running = false;
let crashed = false;
let score = 0;
let best = Number(localStorage.getItem('motoRushBest') || 0);
let time = 0;
let lastFrame = performance.now();
bestLabel.textContent = best;

const world = {
  offsetX: 0,
  gravity: 1800,
  terrainStep: 80,
  baseY: 490,
  points: [],
  obstacles: [],
  particles: []
};

const rider = {
  x: 250,
  y: 350,
  vx: 0,
  vy: 0,
  angle: -0.08,
  av: 0,
  wheelBase: 104,
  wheelRadius: 18,
  grounded: false,
  airtime: 0
};

function terrainHeightAt(x) {
  const noise = Math.sin(x * 0.0022) * 72 + Math.sin(x * 0.007) * 26 + Math.sin(x * 0.0009) * 90;
  return world.baseY + noise;
}

function ensureTerrain(startX, endX) {
  if (world.points.length === 0) {
    for (let x = startX - 800; x < endX + 800; x += world.terrainStep) {
      world.points.push({ x, y: terrainHeightAt(x) });
    }
    return;
  }

  let lastX = world.points[world.points.length - 1].x;
  while (lastX < endX + 1000) {
    lastX += world.terrainStep;
    let y = terrainHeightAt(lastX);
    if (Math.random() < 0.13) {
      y -= 80 + Math.random() * 70;
    }
    world.points.push({ x: lastX, y });
    if (Math.random() < 0.08) {
      world.obstacles.push({
        x: lastX + 60,
        width: 35 + Math.random() * 45,
        height: 24 + Math.random() * 34,
        glow: Math.random() * 360
      });
    }
  }

  const firstSafeX = startX - 1000;
  world.points = world.points.filter((p) => p.x >= firstSafeX);
  world.obstacles = world.obstacles.filter((o) => o.x >= firstSafeX - 200);
}

function getGroundAt(x) {
  for (let i = 0; i < world.points.length - 1; i++) {
    const p1 = world.points[i];
    const p2 = world.points[i + 1];
    if (x >= p1.x && x <= p2.x) {
      const t = (x - p1.x) / (p2.x - p1.x);
      return p1.y + (p2.y - p1.y) * t;
    }
  }
  return world.baseY;
}

function spawnDust(x, y, color = 'rgba(151,210,255,0.8)', scale = 1) {
  for (let i = 0; i < 5; i++) {
    world.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 150 * scale,
      vy: -Math.random() * 120 * scale,
      life: 0.35 + Math.random() * 0.28,
      size: 2 + Math.random() * 4 * scale,
      color
    });
  }
}

function resetRide() {
  world.offsetX = 0;
  world.points = [];
  world.obstacles = [];
  world.particles = [];
  rider.x = 250;
  rider.y = 330;
  rider.vx = 0;
  rider.vy = 0;
  rider.angle = -0.04;
  rider.av = 0;
  rider.grounded = false;
  rider.airtime = 0;
  score = 0;
  crashed = false;
  time = 0;
  ensureTerrain(-500, canvas.width + 1200);
}

function update(dt) {
  time += dt;
  const accel = keys.has('KeyW') || keys.has('ArrowUp') ? 860 : 0;
  const brake = keys.has('KeyS') || keys.has('ArrowDown') ? 620 : 0;
  const tilt = (keys.has('KeyA') || keys.has('ArrowLeft') ? -1 : 0) + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);

  rider.vx += accel * dt;
  rider.vx -= brake * dt;
  rider.vx *= rider.grounded ? 0.988 : 0.996;
  rider.vx = Math.max(80, Math.min(rider.vx, 1500));

  rider.av += tilt * (rider.grounded ? 2.6 : 4.8) * dt;
  rider.av *= 0.985;
  rider.angle += rider.av * dt;

  rider.vy += world.gravity * dt;
  rider.x += rider.vx * dt;
  rider.y += rider.vy * dt;

  const frontX = rider.x + Math.cos(rider.angle) * (rider.wheelBase / 2);
  const backX = rider.x - Math.cos(rider.angle) * (rider.wheelBase / 2);
  const frontGround = getGroundAt(frontX);
  const backGround = getGroundAt(backX);
  const frontY = rider.y + Math.sin(rider.angle) * (rider.wheelBase / 2);
  const backY = rider.y - Math.sin(rider.angle) * (rider.wheelBase / 2);

  rider.grounded = false;

  const frontPen = frontY + rider.wheelRadius - frontGround;
  const backPen = backY + rider.wheelRadius - backGround;
  if (frontPen > 0 || backPen > 0) {
    const lift = Math.max(frontPen, backPen);
    rider.y -= lift;
    rider.vy = Math.min(0, rider.vy * -0.1);
    rider.grounded = true;

    const slope = Math.atan2(frontGround - backGround, frontX - backX);
    rider.angle += (slope - rider.angle) * 0.18;

    if (Math.abs(rider.vx) > 250) {
      spawnDust(backX - world.offsetX, backGround - rider.wheelRadius + 8, 'rgba(255,153,84,0.8)', 0.65);
    }
  }

  if (!rider.grounded) {
    rider.airtime += dt;
    if (rider.airtime > 0.32) {
      score += Math.floor(10 * dt * 60);
    }
  } else if (rider.airtime > 0.42) {
    score += Math.floor(rider.airtime * 120);
    rider.airtime = 0;
  } else {
    rider.airtime = 0;
  }

  score += Math.floor((rider.vx * dt) / 16);

  for (const obstacle of world.obstacles) {
    const ox = obstacle.x;
    const oy = getGroundAt(ox);
    const hitX = Math.abs(rider.x - ox) < obstacle.width * 0.65;
    const hitY = rider.y + 15 > oy - obstacle.height;
    if (hitX && hitY && rider.vx > 130) {
      crash('Slammed into an obstacle.');
      break;
    }
  }

  if (Math.abs(rider.angle) > 1.65) {
    crash('Bad landing angle.');
  }

  world.offsetX = rider.x - 260;
  ensureTerrain(world.offsetX - 400, world.offsetX + canvas.width + 1200);

  world.particles = world.particles.filter((p) => p.life > 0);
  for (const p of world.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 200 * dt;
    p.vx *= 0.98;
  }

  distanceLabel.textContent = `${Math.floor(rider.x / 10)}m`;
  scoreLabel.textContent = score;
}

function crash(reason) {
  crashed = true;
  running = false;
  overlay.classList.remove('hidden');
  overlayTitle.textContent = 'Crash!';
  overlayText.textContent = `${reason} Final score: ${score}. Press Space or Start Race to go again.`;
  startBtn.textContent = 'Restart Race';
  if (score > best) {
    best = score;
    localStorage.setItem('motoRushBest', String(best));
    bestLabel.textContent = best;
  }
  spawnDust(rider.x - world.offsetX, rider.y, 'rgba(255,82,120,0.95)', 1.9);
}

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#1a2b69');
  grad.addColorStop(0.45, '#301848');
  grad.addColorStop(1, '#060510');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = ['rgba(73,117,255,0.2)', 'rgba(102,58,176,0.24)', 'rgba(20,18,53,0.55)'][layer];
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    const shift = world.offsetX * (0.1 + layer * 0.12);
    for (let x = 0; x <= canvas.width; x += 18) {
      const y = 420 + layer * 70 + Math.sin((x + shift) * 0.006 * (layer + 1)) * (50 - layer * 10);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 35; i++) {
    const sx = (i * 180 - world.offsetX * 0.35) % (canvas.width + 260) - 130;
    const sy = 70 + ((i * 97) % 200);
    const r = 1 + (i % 3);
    ctx.fillStyle = `rgba(214,235,255,${0.28 + (i % 4) * 0.1})`;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerrain() {
  ctx.beginPath();
  const start = world.points[0];
  ctx.moveTo(start.x - world.offsetX, canvas.height);
  for (const p of world.points) {
    ctx.lineTo(p.x - world.offsetX, p.y);
  }
  ctx.lineTo(world.points[world.points.length - 1].x - world.offsetX, canvas.height);
  ctx.closePath();

  const dirt = ctx.createLinearGradient(0, 360, 0, canvas.height);
  dirt.addColorStop(0, '#603015');
  dirt.addColorStop(1, '#1f100a');
  ctx.fillStyle = dirt;
  ctx.fill();

  ctx.strokeStyle = '#ffc370';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < world.points.length; i++) {
    const p = world.points[i];
    if (i === 0) ctx.moveTo(p.x - world.offsetX, p.y);
    else ctx.lineTo(p.x - world.offsetX, p.y);
  }
  ctx.stroke();

  for (const obstacle of world.obstacles) {
    const x = obstacle.x - world.offsetX;
    const ground = getGroundAt(obstacle.x);
    const y = ground - obstacle.height;
    const obsGrad = ctx.createLinearGradient(x, y, x, y + obstacle.height);
    obsGrad.addColorStop(0, `hsla(${obstacle.glow},95%,70%,1)`);
    obsGrad.addColorStop(1, 'rgba(36,19,14,1)');
    ctx.fillStyle = obsGrad;
    ctx.fillRect(x - obstacle.width / 2, y, obstacle.width, obstacle.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeRect(x - obstacle.width / 2, y, obstacle.width, obstacle.height);
  }
}

function drawBike() {
  const x = rider.x - world.offsetX;
  const y = rider.y;
  const wb = rider.wheelBase;
  const wr = rider.wheelRadius;

  const fx = x + Math.cos(rider.angle) * (wb / 2);
  const fy = y + Math.sin(rider.angle) * (wb / 2);
  const bx = x - Math.cos(rider.angle) * (wb / 2);
  const by = y - Math.sin(rider.angle) * (wb / 2);

  ctx.lineWidth = 6;
  ctx.strokeStyle = '#9ee7ff';
  ctx.beginPath();
  ctx.moveTo(bx, by - 18);
  ctx.lineTo((bx + fx) / 2, y - 50);
  ctx.lineTo(fx, fy - 14);
  ctx.stroke();

  ctx.strokeStyle = '#4fdcff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(bx, by - 18);
  ctx.lineTo(fx, fy - 14);
  ctx.stroke();

  ctx.fillStyle = '#f5d2ff';
  ctx.fillRect((bx + fx) / 2 - 6, y - 64, 12, 14);

  ctx.strokeStyle = '#101924';
  ctx.fillStyle = '#131f2f';
  for (const [wx, wy] of [[bx, by], [fx, fy]]) {
    ctx.beginPath();
    ctx.arc(wx, wy, wr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(112,225,255,0.9)';
    ctx.beginPath();
    ctx.arc(wx, wy, wr - 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#101924';
  }

  const flameLen = Math.max(0, (rider.vx - 220) * 0.09);
  if (keys.has('KeyW') || keys.has('ArrowUp')) {
    ctx.fillStyle = 'rgba(255,129,43,0.85)';
    ctx.beginPath();
    ctx.moveTo(bx - 8, by - 6);
    ctx.lineTo(bx - 24 - flameLen, by - 2 + (Math.random() - 0.5) * 8);
    ctx.lineTo(bx - 8, by + 4);
    ctx.closePath();
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of world.particles) {
    ctx.globalAlpha = Math.max(0, p.life * 1.7);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function frame(now) {
  const dt = Math.min(0.033, (now - lastFrame) / 1000);
  lastFrame = now;

  if (running) {
    update(dt);
  }

  drawBackground();
  drawTerrain();
  drawBike();
  drawParticles();

  requestAnimationFrame(frame);
}

startBtn.addEventListener('click', () => {
  overlay.classList.add('hidden');
  running = true;
  if (crashed || score === 0) {
    resetRide();
  }
});

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space' && !running) {
    overlay.classList.add('hidden');
    resetRide();
    running = true;
  }
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

resetRide();
requestAnimationFrame(frame);
