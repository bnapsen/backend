const canvas = document.getElementById("poolTable");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const shotsEl = document.getElementById("shots");
const resetBtn = document.getElementById("resetBtn");

const table = {
  x: 60,
  y: 60,
  w: 960,
  h: 520,
  pocketR: 24,
  friction: 0.992,
  lineX: 0,
};

let pockets = [];

const state = {
  balls: [],
  score: 0,
  shots: 0,
  aiming: false,
  pointer: { x: 0, y: 0 },
};

function updateTableGeometry() {
  const pad = Math.min(window.innerWidth, window.innerHeight) * 0.06;
  const maxW = window.innerWidth - pad * 2;
  const maxH = window.innerHeight - pad * 2;
  const aspect = 16 / 9;

  let feltW = maxW;
  let feltH = feltW / aspect;

  if (feltH > maxH) {
    feltH = maxH;
    feltW = feltH * aspect;
  }

  const rail = Math.max(28, Math.round(Math.min(feltW, feltH) * 0.05));

  table.x = Math.round((window.innerWidth - feltW) / 2);
  table.y = Math.round((window.innerHeight - feltH) / 2);
  table.w = Math.round(feltW);
  table.h = Math.round(feltH);
  table.pocketR = Math.max(15, Math.round(Math.min(table.w, table.h) * 0.03));
  table.rail = rail;
  table.lineX = table.x + table.w * 0.28;

  pockets = [
    { x: table.x, y: table.y },
    { x: table.x + table.w / 2, y: table.y },
    { x: table.x + table.w, y: table.y },
    { x: table.x, y: table.y + table.h },
    { x: table.x + table.w / 2, y: table.y + table.h },
    { x: table.x + table.w, y: table.y + table.h },
  ];
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateTableGeometry();

  const cueBall = state.balls.find((b) => b.cue && !b.sunk);
  if (cueBall && !isMoving()) {
    cueBall.x = table.x + table.w * 0.23;
    cueBall.y = table.y + table.h / 2;
  }
}

function makeBall(x, y, color, cue = false) {
  return { x, y, vx: 0, vy: 0, r: Math.max(9, Math.round(Math.min(table.w, table.h) * 0.017)), color, cue, sunk: false };
}

function rackBalls() {
  state.balls = [];
  state.score = 0;
  state.shots = 0;

  const cueBall = makeBall(table.x + table.w * 0.23, table.y + table.h / 2, "#ffffff", true);
  state.balls.push(cueBall);

  const startX = table.x + table.w * 0.72;
  const startY = table.y + table.h / 2;
  const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#ff9f1c"];
  let index = 0;
  const spacing = cueBall.r * 2.1;

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const x = startX + row * spacing;
      const y = startY - (row * spacing) / 2 + col * spacing;
      state.balls.push(makeBall(x, y, colors[index % colors.length]));
      index += 1;
    }
  }
  updateHud();
}

function updateHud() {
  scoreEl.textContent = `Score: ${state.score}`;
  shotsEl.textContent = `Shots: ${state.shots}`;
}

function drawTable() {
  const railInset = table.rail;
  const feltX = table.x + railInset;
  const feltY = table.y + railInset;
  const feltW = table.w - railInset * 2;
  const feltH = table.h - railInset * 2;

  const roomGradient = ctx.createRadialGradient(
    window.innerWidth / 2,
    window.innerHeight / 2,
    50,
    window.innerWidth / 2,
    window.innerHeight / 2,
    window.innerWidth * 0.7,
  );
  roomGradient.addColorStop(0, "#141b2e");
  roomGradient.addColorStop(1, "#06070c");
  ctx.fillStyle = roomGradient;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  ctx.fillStyle = "#4c2a14";
  ctx.fillRect(table.x, table.y, table.w, table.h);
  ctx.strokeStyle = "rgba(255, 206, 150, 0.3)";
  ctx.lineWidth = 4;
  ctx.strokeRect(table.x + 2, table.y + 2, table.w - 4, table.h - 4);

  const feltGradient = ctx.createLinearGradient(feltX, feltY, feltX, feltY + feltH);
  feltGradient.addColorStop(0, "#17885d");
  feltGradient.addColorStop(0.45, "#0f6f4d");
  feltGradient.addColorStop(1, "#0a5c3f");
  ctx.fillStyle = feltGradient;
  ctx.fillRect(feltX, feltY, feltW, feltH);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(table.lineX, feltY + 8);
  ctx.lineTo(table.lineX, feltY + feltH - 8);
  ctx.stroke();

  const spotX = table.lineX + (feltW * 0.22);
  const spotY = feltY + feltH / 2;
  ctx.beginPath();
  ctx.arc(spotX, spotY, Math.max(2.5, table.w * 0.003), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(250,250,250,0.85)";
  ctx.fill();

  pockets.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, table.pocketR, 0, Math.PI * 2);
    const pocketGradient = ctx.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, table.pocketR);
    pocketGradient.addColorStop(0, "#3b3b3b");
    pocketGradient.addColorStop(1, "#060606");
    ctx.fillStyle = pocketGradient;
    ctx.fill();
  });
}

function drawBall(b) {
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  const ballGradient = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, 1, b.x, b.y, b.r * 1.2);
  ballGradient.addColorStop(0, "#ffffff");
  ballGradient.addColorStop(0.14, b.cue ? "#ffffff" : b.color);
  ballGradient.addColorStop(1, b.cue ? "#d6d6d6" : shade(b.color, -26));
  ctx.fillStyle = ballGradient;
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (!b.cue) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.21, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
}

function drawBalls() {
  state.balls.forEach((b) => {
    if (b.sunk) return;
    drawBall(b);
  });
}

function shade(hex, percent) {
  const value = hex.replace("#", "");
  const num = Number.parseInt(value, 16);
  const amt = Math.round(2.55 * percent);
  const r = (num >> 16) + amt;
  const g = ((num >> 8) & 0x00ff) + amt;
  const b = (num & 0x0000ff) + amt;
  return `#${(0x1000000 + (Math.min(255, Math.max(0, r)) << 16) + (Math.min(255, Math.max(0, g)) << 8) + Math.min(255, Math.max(0, b))).toString(16).slice(1)}`;
}

function isMoving() {
  return state.balls.some((b) => !b.sunk && (Math.abs(b.vx) > 0.03 || Math.abs(b.vy) > 0.03));
}

function applyPhysics() {
  const railInset = table.rail;
  const minX = table.x + railInset;
  const maxX = table.x + table.w - railInset;
  const minY = table.y + railInset;
  const maxY = table.y + table.h - railInset;

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
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (Math.hypot(dx, dy) < table.pocketR - 3) {
        if (b.cue) {
          b.x = table.x + table.w * 0.23;
          b.y = table.y + table.h / 2;
          b.vx = 0;
          b.vy = 0;
        } else {
          b.sunk = true;
          b.vx = 0;
          b.vy = 0;
          state.score += 1;
          updateHud();
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

        const dpTanA = a.vx * tx + a.vy * ty;
        const dpTanB = b.vx * tx + b.vy * ty;
        const dpNormA = a.vx * nx + a.vy * ny;
        const dpNormB = b.vx * nx + b.vy * ny;

        a.vx = tx * dpTanA + nx * dpNormB;
        a.vy = ty * dpTanA + ny * dpNormB;
        b.vx = tx * dpTanB + nx * dpNormA;
        b.vy = ty * dpTanB + ny * dpNormA;
      }
    }
  }
}

function drawAimLine() {
  if (!state.aiming || isMoving()) return;
  const cueBall = state.balls.find((b) => b.cue);
  const dx = state.pointer.x - cueBall.x;
  const dy = state.pointer.y - cueBall.y;
  const distance = Math.min(Math.hypot(dx, dy), 170);

  ctx.beginPath();
  ctx.moveTo(cueBall.x, cueBall.y);
  ctx.lineTo(cueBall.x - dx, cueBall.y - dy);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 7]);
  ctx.stroke();
  ctx.setLineDash([]);

  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  const cueLength = Math.max(130, table.w * 0.16);
  const cueStartX = cueBall.x + ux * (20 + distance * 0.18);
  const cueStartY = cueBall.y + uy * (20 + distance * 0.18);
  const cueEndX = cueStartX + ux * cueLength;
  const cueEndY = cueStartY + uy * cueLength;

  ctx.beginPath();
  ctx.moveTo(cueStartX, cueStartY);
  ctx.lineTo(cueEndX, cueEndY);
  ctx.strokeStyle = "#c89d67";
  ctx.lineWidth = Math.max(4, table.w * 0.006);
  ctx.lineCap = "round";
  ctx.stroke();

  const meterW = Math.min(190, table.w * 0.18);
  const meterH = 10;
  const meterX = cueBall.x - meterW / 2;
  const meterY = cueBall.y + 28;
  const power = distance / 170;

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(meterX, meterY, meterW, meterH);
  ctx.fillStyle = "#ffcc57";
  ctx.fillRect(meterX, meterY, meterW * power, meterH);
}

function animate() {
  drawTable();
  applyPhysics();
  drawBalls();
  drawAimLine();

  if (state.balls.filter((b) => !b.cue && !b.sunk).length === 0) {
    const boxW = Math.min(420, table.w * 0.5);
    const boxH = Math.min(130, table.h * 0.25);
    const boxX = window.innerWidth / 2 - boxW / 2;
    const boxY = window.innerHeight / 2 - boxH / 2;

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 34px system-ui";
    ctx.fillText("Rack cleared!", window.innerWidth / 2, window.innerHeight / 2 + 12);
  }

  requestAnimationFrame(animate);
}

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = window.innerWidth / rect.width;
  const scaleY = window.innerHeight / rect.height;

  state.pointer.x = (event.clientX - rect.left) * scaleX;
  state.pointer.y = (event.clientY - rect.top) * scaleY;
}

canvas.addEventListener("pointerdown", (event) => {
  if (isMoving()) return;
  setPointer(event);
  state.aiming = true;
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.aiming) return;
  setPointer(event);
});

canvas.addEventListener("pointerup", (event) => {
  if (!state.aiming || isMoving()) return;
  setPointer(event);
  state.aiming = false;

  const cueBall = state.balls.find((b) => b.cue);
  const dx = cueBall.x - state.pointer.x;
  const dy = cueBall.y - state.pointer.y;
  const distance = Math.min(Math.hypot(dx, dy), 170);

  cueBall.vx = (dx / 170) * 12;
  cueBall.vy = (dy / 170) * 12;

  if (distance > 2) {
    state.shots += 1;
    updateHud();
  }
});

window.addEventListener("resize", () => {
  resizeCanvas();
  if (!isMoving()) rackBalls();
});

resetBtn.addEventListener("click", rackBalls);

resizeCanvas();
rackBalls();
animate();
