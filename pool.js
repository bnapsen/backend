const canvas = document.getElementById("poolTable");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const shotsEl = document.getElementById("shots");
const resetBtn = document.getElementById("resetBtn");

const table = {
  x: 40,
  y: 40,
  w: canvas.width - 80,
  h: canvas.height - 80,
  pocketR: 24,
  friction: 0.992,
};

const pockets = [
  { x: table.x, y: table.y },
  { x: table.x + table.w / 2, y: table.y },
  { x: table.x + table.w, y: table.y },
  { x: table.x, y: table.y + table.h },
  { x: table.x + table.w / 2, y: table.y + table.h },
  { x: table.x + table.w, y: table.y + table.h },
];

const state = {
  balls: [],
  score: 0,
  shots: 0,
  aiming: false,
  pointer: { x: 0, y: 0 },
};

function makeBall(x, y, color, cue = false) {
  return { x, y, vx: 0, vy: 0, r: 12, color, cue, sunk: false };
}

function rackBalls() {
  state.balls = [];
  state.score = 0;
  state.shots = 0;

  const cueBall = makeBall(table.x + table.w * 0.23, table.y + table.h / 2, "#ffffff", true);
  state.balls.push(cueBall);

  const startX = table.x + table.w * 0.72;
  const startY = table.y + table.h / 2;
  const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#f28482"];
  let index = 0;

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const x = startX + row * 24;
      const y = startY - row * 12 + col * 24;
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
  ctx.fillStyle = "#5d351a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#117a50";
  ctx.fillRect(table.x, table.y, table.w, table.h);

  ctx.fillStyle = "#121212";
  pockets.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, table.pocketR, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawBalls() {
  state.balls.forEach((b) => {
    if (b.sunk) return;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function isMoving() {
  return state.balls.some((b) => !b.sunk && (Math.abs(b.vx) > 0.03 || Math.abs(b.vy) > 0.03));
}

function applyPhysics() {
  state.balls.forEach((b) => {
    if (b.sunk) return;

    b.x += b.vx;
    b.y += b.vy;
    b.vx *= table.friction;
    b.vy *= table.friction;

    if (Math.abs(b.vx) < 0.01) b.vx = 0;
    if (Math.abs(b.vy) < 0.01) b.vy = 0;

    if (b.x - b.r < table.x) {
      b.x = table.x + b.r;
      b.vx *= -1;
    } else if (b.x + b.r > table.x + table.w) {
      b.x = table.x + table.w - b.r;
      b.vx *= -1;
    }

    if (b.y - b.r < table.y) {
      b.y = table.y + b.r;
      b.vy *= -1;
    } else if (b.y + b.r > table.y + table.h) {
      b.y = table.y + table.h - b.r;
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

  ctx.beginPath();
  ctx.moveTo(cueBall.x, cueBall.y);
  ctx.lineTo(cueBall.x - dx, cueBall.y - dy);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function animate() {
  drawTable();
  applyPhysics();
  drawBalls();
  drawAimLine();

  if (state.balls.filter((b) => !b.cue && !b.sunk).length === 0) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(table.x + 180, table.y + 180, table.w - 360, 120);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 34px system-ui";
    ctx.fillText("Rack cleared!", canvas.width / 2, canvas.height / 2 + 12);
  }

  requestAnimationFrame(animate);
}

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

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

resetBtn.addEventListener("click", rackBalls);

rackBalls();
animate();
