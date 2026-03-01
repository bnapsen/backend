const canvas = document.getElementById("poolTable");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const shotsEl = document.getElementById("shots");
const levelEl = document.getElementById("level");
const comboEl = document.getElementById("combo");
const statusEl = document.getElementById("status");
const resetBtn = document.getElementById("resetBtn");

const table = {
  x: 60,
  y: 60,
  w: 960,
  h: 520,
  pocketR: 24,
  friction: 0.992,
  rail: 34,
};

let pockets = [];

const state = {
  balls: [],
  score: 0,
  level: 1,
  shotsLeft: 10,
  combo: 1,
  aiming: false,
  pointer: { x: 0, y: 0 },
  sunkThisTurn: 0,
  scratchedThisTurn: false,
  wasMoving: false,
  gameOver: false,
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

  table.rail = Math.max(28, Math.round(Math.min(feltW, feltH) * 0.05));
  table.x = Math.round((window.innerWidth - feltW) / 2);
  table.y = Math.round((window.innerHeight - feltH) / 2);
  table.w = Math.round(feltW);
  table.h = Math.round(feltH);
  table.pocketR = Math.max(15, Math.round(Math.min(table.w, table.h) * 0.03));

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
  repositionBallsAfterResize();
}

function makeBall(x, y, color, type = "target") {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    r: Math.max(9, Math.round(Math.min(table.w, table.h) * 0.017)),
    color,
    type,
    sunk: false,
  };
}

function updateHud() {
  scoreEl.textContent = `Score: ${state.score}`;
  shotsEl.textContent = `Shots Left: ${state.shotsLeft}`;
  levelEl.textContent = `Level: ${state.level}`;
  comboEl.textContent = `Combo: x${state.combo}`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function targetBallsRemaining() {
  return state.balls.filter((b) => b.type === "target" && !b.sunk).length;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function isPositionClear(x, y, radius) {
  return !state.balls.some((b) => {
    if (b.sunk) return false;
    return Math.hypot(b.x - x, b.y - y) < b.r + radius + 5;
  });
}

function placeBallWithoutOverlap(type, color) {
  const radius = Math.max(9, Math.round(Math.min(table.w, table.h) * 0.017));
  const minX = table.x + table.rail + radius + 10;
  const maxX = table.x + table.w - table.rail - radius - 10;
  const minY = table.y + table.rail + radius + 10;
  const maxY = table.y + table.h - table.rail - radius - 10;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = randomRange(minX, maxX);
    const y = randomRange(minY, maxY);
    if (isPositionClear(x, y, radius)) {
      state.balls.push(makeBall(x, y, color, type));
      return;
    }
  }
}

function setupLevel() {
  state.balls = [];
  state.gameOver = false;

  state.balls.push(makeBall(table.x + table.w * 0.23, table.y + table.h / 2, "#ffffff", "cue"));

  const targetCount = Math.min(4 + state.level, 11);
  const blockerCount = Math.min(1 + Math.floor(state.level / 2), 5);
  const targetPalette = ["#ff4d8d", "#ffcb3d", "#53e2ff", "#8bff4f", "#be7bff", "#ff8f39"];

  for (let i = 0; i < targetCount; i += 1) {
    placeBallWithoutOverlap("target", targetPalette[i % targetPalette.length]);
  }

  for (let i = 0; i < blockerCount; i += 1) {
    placeBallWithoutOverlap("blocker", "#5c6376");
  }

  state.shotsLeft = Math.max(7, 10 - Math.floor(state.level / 2));
  state.combo = 1;
  state.sunkThisTurn = 0;
  state.scratchedThisTurn = false;
  updateHud();
  setStatus(`Level ${state.level}: Sink ${targetCount} targets in ${state.shotsLeft} shots.`);
}

function repositionBallsAfterResize() {
  if (!state.balls.length || isMoving()) return;

  const cue = state.balls.find((b) => b.type === "cue" && !b.sunk);
  if (cue) {
    cue.x = table.x + table.w * 0.23;
    cue.y = table.y + table.h / 2;
  }
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

function drawTable() {
  const railInset = table.rail;
  const feltX = table.x + railInset;
  const feltY = table.y + railInset;
  const feltW = table.w - railInset * 2;
  const feltH = table.h - railInset * 2;

  const roomGradient = ctx.createRadialGradient(
    window.innerWidth * 0.5,
    window.innerHeight * 0.4,
    50,
    window.innerWidth * 0.5,
    window.innerHeight * 0.5,
    window.innerWidth * 0.7,
  );
  roomGradient.addColorStop(0, "#2f1e54");
  roomGradient.addColorStop(1, "#050711");
  ctx.fillStyle = roomGradient;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  ctx.fillStyle = "#3e2816";
  ctx.fillRect(table.x, table.y, table.w, table.h);

  const feltGradient = ctx.createLinearGradient(feltX, feltY, feltX, feltY + feltH);
  feltGradient.addColorStop(0, "#116f7c");
  feltGradient.addColorStop(0.5, "#0d5f6b");
  feltGradient.addColorStop(1, "#094552");
  ctx.fillStyle = feltGradient;
  ctx.fillRect(feltX, feltY, feltW, feltH);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(table.x + table.w * 0.27, feltY + 10);
  ctx.lineTo(table.x + table.w * 0.27, feltY + feltH - 10);
  ctx.stroke();

  pockets.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, table.pocketR, 0, Math.PI * 2);
    const pocketGradient = ctx.createRadialGradient(p.x - 3, p.y - 3, 1, p.x, p.y, table.pocketR);
    pocketGradient.addColorStop(0, "#4f4f4f");
    pocketGradient.addColorStop(1, "#040404");
    ctx.fillStyle = pocketGradient;
    ctx.fill();
  });
}

function drawBall(ball) {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  const ballGradient = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.4, 1, ball.x, ball.y, ball.r * 1.3);
  ballGradient.addColorStop(0, "#ffffff");
  ballGradient.addColorStop(0.2, ball.type === "cue" ? "#f7f7f7" : ball.color);
  ballGradient.addColorStop(1, ball.type === "cue" ? "#d9d9d9" : shade(ball.color, -30));
  ctx.fillStyle = ballGradient;
  ctx.fill();

  if (ball.type === "target") {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fill();
  }

  if (ball.type === "blocker") {
    ctx.strokeStyle = "rgba(255, 86, 86, 0.78)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ball.x - ball.r * 0.55, ball.y - ball.r * 0.55);
    ctx.lineTo(ball.x + ball.r * 0.55, ball.y + ball.r * 0.55);
    ctx.moveTo(ball.x + ball.r * 0.55, ball.y - ball.r * 0.55);
    ctx.lineTo(ball.x - ball.r * 0.55, ball.y + ball.r * 0.55);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

function drawBalls() {
  state.balls.forEach((ball) => {
    if (!ball.sunk) {
      drawBall(ball);
    }
  });
}

function isMoving() {
  return state.balls.some((b) => !b.sunk && (Math.abs(b.vx) > 0.03 || Math.abs(b.vy) > 0.03));
}

function resolvePocket(ball) {
  if (ball.type === "cue") {
    ball.sunk = true;
    ball.vx = 0;
    ball.vy = 0;
    state.scratchedThisTurn = true;
    return;
  }

  ball.sunk = true;
  ball.vx = 0;
  ball.vy = 0;

  if (ball.type === "target") {
    state.sunkThisTurn += 1;
  } else if (ball.type === "blocker") {
    state.score = Math.max(0, state.score - 8);
    setStatus("Blocker sunk! -8 penalty.");
  }
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
        resolvePocket(b);
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

function respotCueBall() {
  const cue = state.balls.find((b) => b.type === "cue");
  if (!cue) return;

  cue.sunk = false;
  cue.vx = 0;
  cue.vy = 0;

  const startX = table.x + table.w * 0.23;
  const startY = table.y + table.h / 2;
  cue.x = startX;
  cue.y = startY;

  if (!isPositionClear(startX, startY, cue.r)) {
    for (let offset = 25; offset < table.h * 0.3; offset += 14) {
      if (isPositionClear(startX, startY - offset, cue.r)) {
        cue.y = startY - offset;
        return;
      }
      if (isPositionClear(startX, startY + offset, cue.r)) {
        cue.y = startY + offset;
        return;
      }
    }
  }
}

function finishTurnIfNeeded() {
  const moving = isMoving();
  if (state.wasMoving && !moving) {
    if (state.scratchedThisTurn) {
      state.score = Math.max(0, state.score - 6);
      respotCueBall();
      setStatus("Scratch! Cue ball reset and -6 score.");
    }

    if (state.sunkThisTurn > 0) {
      const points = state.sunkThisTurn * 10 * state.combo;
      state.score += points;
      setStatus(`Great shot! ${state.sunkThisTurn} target(s) sunk for ${points} points.`);
      state.combo += 1;
    } else if (!state.scratchedThisTurn) {
      state.combo = 1;
      setStatus("No target sunk. Combo reset.");
    } else {
      state.combo = 1;
    }

    state.sunkThisTurn = 0;
    state.scratchedThisTurn = false;

    if (targetBallsRemaining() === 0 && !state.gameOver) {
      const levelBonus = 25 + state.level * 8;
      state.score += levelBonus;
      state.level += 1;
      state.combo = 1;
      updateHud();
      setStatus(`Level cleared! +${levelBonus} bonus.`);
      setupLevel();
      return;
    }

    if (state.shotsLeft <= 0 && targetBallsRemaining() > 0) {
      state.gameOver = true;
      setStatus("Out of shots. Restart run to try again.");
    }

    updateHud();
  }
  state.wasMoving = moving;
}

function drawAimLine() {
  if (!state.aiming || isMoving() || state.gameOver) return;
  const cue = state.balls.find((b) => b.type === "cue" && !b.sunk);
  if (!cue) return;

  const dx = state.pointer.x - cue.x;
  const dy = state.pointer.y - cue.y;
  const distance = Math.min(Math.hypot(dx, dy), 180);

  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(cue.x - dx, cue.y - dy);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2.4;
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  const cueLength = Math.max(120, table.w * 0.15);
  const cueStartX = cue.x + ux * (22 + distance * 0.17);
  const cueStartY = cue.y + uy * (22 + distance * 0.17);

  ctx.beginPath();
  ctx.moveTo(cueStartX, cueStartY);
  ctx.lineTo(cueStartX + ux * cueLength, cueStartY + uy * cueLength);
  ctx.strokeStyle = "#f0b56f";
  ctx.lineWidth = Math.max(4, table.w * 0.006);
  ctx.lineCap = "round";
  ctx.stroke();

  const meterW = Math.min(190, table.w * 0.18);
  const meterX = cue.x - meterW / 2;
  const meterY = cue.y + 30;
  const power = distance / 180;

  ctx.fillStyle = "rgba(0,0,0,0.43)";
  ctx.fillRect(meterX, meterY, meterW, 10);
  ctx.fillStyle = "#59ffb0";
  ctx.fillRect(meterX, meterY, meterW * power, 10);
}

function drawOverlay() {
  if (!state.gameOver) return;

  const boxW = Math.min(460, table.w * 0.55);
  const boxH = Math.min(190, table.h * 0.35);
  const boxX = window.innerWidth / 2 - boxW / 2;
  const boxY = window.innerHeight / 2 - boxH / 2;

  ctx.fillStyle = "rgba(5,10,23,0.82)";
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "700 34px system-ui";
  ctx.fillText("Run Over", window.innerWidth / 2, boxY + 64);
  ctx.font = "600 22px system-ui";
  ctx.fillText(`Final Score: ${state.score}`, window.innerWidth / 2, boxY + 104);
  ctx.font = "500 18px system-ui";
  ctx.fillText("Press Restart Run to play again", window.innerWidth / 2, boxY + 140);
}

function animate() {
  drawTable();
  applyPhysics();
  drawBalls();
  drawAimLine();
  finishTurnIfNeeded();
  drawOverlay();

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
  if (isMoving() || state.gameOver) return;
  setPointer(event);
  state.aiming = true;
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.aiming) return;
  setPointer(event);
});

canvas.addEventListener("pointerup", (event) => {
  if (!state.aiming || isMoving() || state.gameOver) return;
  setPointer(event);
  state.aiming = false;

  const cue = state.balls.find((b) => b.type === "cue" && !b.sunk);
  if (!cue) return;

  const dx = cue.x - state.pointer.x;
  const dy = cue.y - state.pointer.y;
  const distance = Math.min(Math.hypot(dx, dy), 180);

  cue.vx = (dx / 180) * 13;
  cue.vy = (dy / 180) * 13;

  if (distance > 2) {
    state.shotsLeft -= 1;
    state.wasMoving = true;
    updateHud();
  }
});

window.addEventListener("resize", resizeCanvas);

resetBtn.addEventListener("click", () => {
  state.score = 0;
  state.level = 1;
  state.shotsLeft = 10;
  state.combo = 1;
  state.gameOver = false;
  updateHud();
  setupLevel();
});

resizeCanvas();
setupLevel();
animate();
