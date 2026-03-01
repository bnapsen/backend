const canvas = document.getElementById("poolTable");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const shotsEl = document.getElementById("shots");
const comboEl = document.getElementById("combo");
const timeEl = document.getElementById("time");
const remainingEl = document.getElementById("remaining");
const resetBtn = document.getElementById("resetBtn");

const table = {
  x: 60,
  y: 60,
  w: 960,
  h: 540,
  rail: 32,
  pocketR: 22,
  friction: 0.992,
};

const state = {
  balls: [],
  score: 0,
  shots: 0,
  combo: 1,
  maxCombo: 1,
  streakSinks: 0,
  timeLeft: 60,
  playing: true,
  lastTick: performance.now(),
  aiming: false,
  pointer: { x: 0, y: 0 },
};

let pockets = [];

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function updateTableGeometry() {
  const pad = Math.max(12, Math.min(window.innerWidth, window.innerHeight) * 0.03);
  const reserve = window.innerWidth > 1180 ? 340 : 0;
  const maxW = Math.max(420, window.innerWidth - pad * 2 - reserve);
  const maxH = Math.max(300, window.innerHeight - pad * 2);
  const aspect = 16 / 9;

  let w = maxW;
  let h = w / aspect;

  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }

  table.x = Math.round((window.innerWidth - w) / 2);
  table.y = Math.round((window.innerHeight - h) / 2);
  table.w = Math.round(w);
  table.h = Math.round(h);
  table.rail = Math.max(22, Math.round(Math.min(w, h) * 0.05));
  table.pocketR = Math.max(14, Math.round(Math.min(w, h) * 0.03));

  const fx = table.x + table.rail;
  const fy = table.y + table.rail;
  const fw = table.w - table.rail * 2;
  const fh = table.h - table.rail * 2;

  pockets = [
    { x: fx, y: fy },
    { x: fx + fw / 2, y: fy },
    { x: fx + fw, y: fy },
    { x: fx, y: fy + fh },
    { x: fx + fw / 2, y: fy + fh },
    { x: fx + fw, y: fy + fh },
  ];
}

function makeBall(x, y, color, cue = false) {
  const r = Math.max(8, Math.round(Math.min(table.w, table.h) * 0.016));
  return { x, y, vx: 0, vy: 0, r, color, cue, sunk: false };
}

function setupRun() {
  state.score = 0;
  state.shots = 0;
  state.combo = 1;
  state.maxCombo = 1;
  state.streakSinks = 0;
  state.timeLeft = 60;
  state.playing = true;
  state.aiming = false;

  state.balls = [];
  const cue = makeBall(table.x + table.w * 0.24, table.y + table.h / 2, "#ffffff", true);
  state.balls.push(cue);

  const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#ff9f1c", "#00c2a8"];
  const startX = table.x + table.w * 0.72;
  const startY = table.y + table.h / 2;
  const spacing = cue.r * 2.08;
  let i = 0;

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const x = startX + row * spacing;
      const y = startY - (row * spacing) / 2 + col * spacing;
      state.balls.push(makeBall(x, y, colors[i % colors.length]));
      i += 1;
    }
  }

  updateHud();
}

function updateHud() {
  const remaining = state.balls.filter((b) => !b.cue && !b.sunk).length;
  scoreEl.textContent = `Score: ${state.score}`;
  shotsEl.textContent = `Shots: ${state.shots}`;
  comboEl.textContent = `Combo: x${state.combo}`;
  timeEl.textContent = `Time: ${Math.ceil(state.timeLeft)}`;
  remainingEl.textContent = `Targets: ${remaining}`;
}

function isMoving() {
  return state.balls.some((b) => !b.sunk && (Math.abs(b.vx) > 0.03 || Math.abs(b.vy) > 0.03));
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateTableGeometry();
  if (!isMoving()) setupRun();
}

function drawBackground() {
  const room = ctx.createRadialGradient(
    window.innerWidth / 2,
    window.innerHeight / 2,
    40,
    window.innerWidth / 2,
    window.innerHeight / 2,
    window.innerWidth * 0.7,
  );
  room.addColorStop(0, "#18223a");
  room.addColorStop(1, "#05070d");
  ctx.fillStyle = room;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

function drawTable() {
  drawBackground();

  const fx = table.x + table.rail;
  const fy = table.y + table.rail;
  const fw = table.w - table.rail * 2;
  const fh = table.h - table.rail * 2;

  ctx.fillStyle = "#4a2915";
  ctx.fillRect(table.x, table.y, table.w, table.h);

  ctx.strokeStyle = "rgba(255,218,170,0.3)";
  ctx.lineWidth = 4;
  ctx.strokeRect(table.x + 2, table.y + 2, table.w - 4, table.h - 4);

  const felt = ctx.createLinearGradient(fx, fy, fx, fy + fh);
  felt.addColorStop(0, "#169064");
  felt.addColorStop(0.5, "#0d7653");
  felt.addColorStop(1, "#0a6244");
  ctx.fillStyle = felt;
  ctx.fillRect(fx, fy, fw, fh);

  const lineX = fx + fw * 0.28;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(lineX, fy + 10);
  ctx.lineTo(lineX, fy + fh - 10);
  ctx.stroke();

  pockets.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, table.pocketR, 0, Math.PI * 2);
    const pg = ctx.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, table.pocketR);
    pg.addColorStop(0, "#444");
    pg.addColorStop(1, "#050505");
    ctx.fillStyle = pg;
    ctx.fill();
  });
}

function shade(hex, pct) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * pct);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `#${(0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function drawBall(ball) {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(ball.x - ball.r * 0.4, ball.y - ball.r * 0.4, 1, ball.x, ball.y, ball.r * 1.25);
  g.addColorStop(0, "#fff");
  g.addColorStop(0.2, ball.cue ? "#fff" : ball.color);
  g.addColorStop(1, ball.cue ? "#d0d0d0" : shade(ball.color, -24));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.stroke();

  if (!ball.cue) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fill();
  }
}

function applyPhysics() {
  const minX = table.x + table.rail;
  const maxX = table.x + table.w - table.rail;
  const minY = table.y + table.rail;
  const maxY = table.y + table.h - table.rail;

  let sunkThisFrame = 0;

  state.balls.forEach((b) => {
    if (b.sunk) return;

    b.x += b.vx;
    b.y += b.vy;
    b.vx *= table.friction;
    b.vy *= table.friction;

    if (Math.abs(b.vx) < 0.01) b.vx = 0;
    if (Math.abs(b.vy) < 0.01) b.vy = 0;

    if (b.x - b.r < minX) {
      b.x = minX + b.r;
      b.vx *= -1;
    } else if (b.x + b.r > maxX) {
      b.x = maxX - b.r;
      b.vx *= -1;
    }

    if (b.y - b.r < minY) {
      b.y = minY + b.r;
      b.vy *= -1;
    } else if (b.y + b.r > maxY) {
      b.y = maxY - b.r;
      b.vy *= -1;
    }

    pockets.forEach((p) => {
      if (b.sunk) return;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < table.pocketR - b.r * 0.35) {
        if (b.cue) {
          b.x = table.x + table.w * 0.24;
          b.y = table.y + table.h / 2;
          b.vx = 0;
          b.vy = 0;
          state.combo = 1;
          state.streakSinks = 0;
        } else {
          b.sunk = true;
          b.vx = 0;
          b.vy = 0;
          sunkThisFrame += 1;
        }
      }
    });
  });

  for (let i = 0; i < state.balls.length; i += 1) {
    for (let j = i + 1; j < state.balls.length; j += 1) {
      const a = state.balls[i];
      const b = state.balls[j];
      if (a.sunk || b.sunk) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.r + b.r;
      if (dist > 0 && dist < minDist) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;

        a.x -= (overlap * nx) / 2;
        a.y -= (overlap * ny) / 2;
        b.x += (overlap * nx) / 2;
        b.y += (overlap * ny) / 2;

        const tx = -ny;
        const ty = nx;
        const aTan = a.vx * tx + a.vy * ty;
        const bTan = b.vx * tx + b.vy * ty;
        const aNorm = a.vx * nx + a.vy * ny;
        const bNorm = b.vx * nx + b.vy * ny;

        a.vx = tx * aTan + nx * bNorm;
        a.vy = ty * aTan + ny * bNorm;
        b.vx = tx * bTan + nx * aNorm;
        b.vy = ty * bTan + ny * aNorm;
      }
    }
  }

  if (sunkThisFrame > 0) {
    state.streakSinks += sunkThisFrame;
    state.combo = Math.min(6, 1 + Math.floor(state.streakSinks / 2));
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.score += sunkThisFrame * 100 * state.combo;
    state.timeLeft += sunkThisFrame * 1.5;
    updateHud();
  }

  if (!isMoving() && state.streakSinks > 0) {
    state.streakSinks = 0;
    state.combo = 1;
    updateHud();
  }
}

function drawAimAssist() {
  if (!state.aiming || isMoving() || !state.playing) return;

  const cue = state.balls.find((b) => b.cue && !b.sunk);
  if (!cue) return;

  const dx = state.pointer.x - cue.x;
  const dy = state.pointer.y - cue.y;
  const dist = Math.hypot(dx, dy);
  const power = clamp(dist / 180, 0, 1);

  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(cue.x - dx, cue.y - dy);
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.stroke();
  ctx.setLineDash([]);

  const ux = dx / (dist || 1);
  const uy = dy / (dist || 1);
  const cueLen = Math.max(120, table.w * 0.16);

  const sx = cue.x + ux * (20 + power * 35);
  const sy = cue.y + uy * (20 + power * 35);
  const ex = sx + ux * cueLen;
  const ey = sy + uy * cueLen;

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(4, table.w * 0.0058);
  ctx.strokeStyle = "#cc9f66";
  ctx.stroke();

  const mx = cue.x - 90;
  const my = cue.y + 28;
  const mw = 180;
  const mh = 10;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(mx, my, mw, mh);
  ctx.fillStyle = "#ffd466";
  ctx.fillRect(mx, my, mw * power, mh);
}

function drawBalls() {
  state.balls.forEach((b) => {
    if (!b.sunk) drawBall(b);
  });
}

function drawEndOverlay() {
  if (state.playing) return;

  const targetsLeft = state.balls.filter((b) => !b.cue && !b.sunk).length;
  const won = targetsLeft === 0;

  const w = Math.min(460, table.w * 0.56);
  const h = 180;
  const x = window.innerWidth / 2 - w / 2;
  const y = window.innerHeight / 2 - h / 2;

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "700 32px system-ui";
  ctx.fillText(won ? "You cleared the table!" : "Time up!", window.innerWidth / 2, y + 52);

  ctx.font = "600 20px system-ui";
  ctx.fillText(`Final Score: ${state.score}`, window.innerWidth / 2, y + 92);
  ctx.fillText(`Best Combo: x${state.maxCombo}`, window.innerWidth / 2, y + 124);
  ctx.font = "500 16px system-ui";
  ctx.fillText("Press New Run to play again", window.innerWidth / 2, y + 152);
}

function setPointer(ev) {
  const rect = canvas.getBoundingClientRect();
  const sx = window.innerWidth / rect.width;
  const sy = window.innerHeight / rect.height;
  state.pointer.x = (ev.clientX - rect.left) * sx;
  state.pointer.y = (ev.clientY - rect.top) * sy;
}

canvas.addEventListener("pointerdown", (ev) => {
  if (isMoving() || !state.playing) return;
  setPointer(ev);
  state.aiming = true;
});

canvas.addEventListener("pointermove", (ev) => {
  if (!state.aiming) return;
  setPointer(ev);
});

canvas.addEventListener("pointerup", (ev) => {
  if (!state.aiming || isMoving() || !state.playing) return;
  setPointer(ev);
  state.aiming = false;

  const cue = state.balls.find((b) => b.cue && !b.sunk);
  if (!cue) return;

  const dx = cue.x - state.pointer.x;
  const dy = cue.y - state.pointer.y;
  const dist = clamp(Math.hypot(dx, dy), 0, 180);

  cue.vx = (dx / 180) * 13;
  cue.vy = (dy / 180) * 13;

  if (dist > 2) {
    state.shots += 1;
    state.combo = 1;
    state.streakSinks = 0;
    updateHud();
  }
});

canvas.addEventListener("pointercancel", () => {
  state.aiming = false;
});

canvas.addEventListener("pointerleave", () => {
  state.aiming = false;
});

function stepTimer(now) {
  const dt = Math.min((now - state.lastTick) / 1000, 0.05);
  state.lastTick = now;
  if (!state.playing) return;

  const left = state.balls.filter((b) => !b.cue && !b.sunk).length;
  if (left === 0) {
    state.playing = false;
    updateHud();
    return;
  }

  state.timeLeft -= dt;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    state.playing = false;
  }
  updateHud();
}

function animate(now = performance.now()) {
  stepTimer(now);
  drawTable();
  applyPhysics();
  drawBalls();
  drawAimAssist();
  drawEndOverlay();
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resizeCanvas);
resetBtn.addEventListener("click", setupRun);

resizeCanvas();
state.lastTick = performance.now();
animate();
