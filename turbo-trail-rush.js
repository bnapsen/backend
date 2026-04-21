const STORAGE_KEY = "bnapsen:turbo-trail-rush:best-time";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const lapDisplay = document.getElementById("lap-display");
const speedDisplay = document.getElementById("speed-display");
const heatDisplay = document.getElementById("heat-display");
const timeDisplay = document.getElementById("time-display");
const bestDisplay = document.getElementById("best-display");
const statusTitle = document.getElementById("status-title");
const statusCopy = document.getElementById("status-copy");
const overlay = document.getElementById("screen-overlay");
const overlayKicker = document.getElementById("overlay-kicker");
const overlayTitle = document.getElementById("overlay-title");
const overlayCopy = document.getElementById("overlay-copy");
const startButton = document.getElementById("start-button");
const pauseButton = document.getElementById("pause-button");
const restartButton = document.getElementById("restart-button");

const CONFIG = {
  totalLaps: 3,
  trackLength: 2200,
  playerScreenX: 250,
  baseline: 300,
  horizontalScale: 2.6,
  verticalScale: 2.2,
  laneStep: 22,
  gravity: 360,
  maxSpeed: 176,
  maxBoostSpeed: 220,
  visibleRange: canvas.width / 2.6,
};

const TRACK_FEATURES = [
  { kind: "mound", x: 120, width: 150, height: 26 },
  { kind: "ramp", x: 360, width: 140, height: 54 },
  { kind: "rollers", x: 640, width: 180, height: 18 },
  { kind: "ramp", x: 900, width: 128, height: 64 },
  { kind: "mound", x: 1160, width: 210, height: 30 },
  { kind: "rollers", x: 1490, width: 190, height: 22 },
  { kind: "ramp", x: 1780, width: 150, height: 58 },
  { kind: "mound", x: 2030, width: 120, height: 24 },
];

const SKY_STARS = Array.from({ length: 56 }, (_, index) => ({
  x: ((index * 163) % canvas.width) + Math.random() * 18,
  y: ((index * 97) % 170) + Math.random() * 18,
  r: index % 5 === 0 ? 2 : 1.2,
}));

const state = {
  running: false,
  paused: false,
  awaitingStart: true,
  finished: false,
  bestTime: loadBestTime(),
  time: 0,
  lastTime: 0,
  statusTimer: 0,
  trackDust: [],
  player: null,
  rivals: [],
  input: {
    throttle: false,
    brake: false,
    turbo: false,
    leftHeld: false,
    rightHeld: false,
  },
};

function loadBestTime() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveBestTime(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures.
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mod(value, length) {
  return ((value % length) + length) % length;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function normalizeAngle(angle) {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function mixAngle(from, to, amount) {
  const delta = normalizeAngle(to - from);
  return from + delta * amount;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "--:--.--";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds - Math.floor(seconds)) * 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function setOverlay(kicker, title, copy, hidden = false) {
  overlayKicker.textContent = kicker;
  overlayTitle.textContent = title;
  overlayCopy.textContent = copy;
  overlay.classList.toggle("hidden", hidden);
}

function setStatus(title, copy, duration = 0) {
  statusTitle.textContent = title;
  statusCopy.textContent = copy;
  state.statusTimer = duration;
}

function featureContribution(feature, x) {
  const local = x - feature.x;
  if (local < 0 || local > feature.width) {
    return 0;
  }

  const t = local / feature.width;

  if (feature.kind === "mound") {
    return Math.sin(Math.PI * t) * feature.height;
  }

  if (feature.kind === "rollers") {
    return Math.sin(Math.PI * t * 3) * feature.height * (1 - Math.abs(t - 0.5) * 0.35);
  }

  if (feature.kind === "ramp") {
    if (t < 0.72) {
      return (t / 0.72) * feature.height;
    }
    const fall = (t - 0.72) / 0.28;
    return feature.height - fall * (feature.height + 10);
  }

  return 0;
}

function groundHeightAt(distance) {
  const x = mod(distance, CONFIG.trackLength);
  let height =
    12 +
    Math.sin((x / CONFIG.trackLength) * Math.PI * 2 * 1.8) * 12 +
    Math.sin((x / CONFIG.trackLength) * Math.PI * 2 * 4.8) * 5;

  for (const feature of TRACK_FEATURES) {
    height += featureContribution(feature, x);
  }

  return height;
}

function groundSlopeAt(distance) {
  const sample = 2;
  return (groundHeightAt(distance + sample) - groundHeightAt(distance - sample)) / (sample * 2);
}

function crossedMark(previousDistance, currentDistance, mark) {
  const prev = mod(previousDistance, CONFIG.trackLength);
  const current = mod(currentDistance, CONFIG.trackLength);

  if (current >= prev) {
    return prev < mark && current >= mark;
  }

  return prev < mark || current >= mark;
}

function createPlayer() {
  return {
    distance: 0,
    lane: 1,
    laneTarget: 1,
    speed: 0,
    y: groundHeightAt(0),
    vy: 0,
    grounded: true,
    rotation: 0,
    angularVelocity: 0,
    heat: 0,
    boostLocked: false,
    recovery: 0,
    lapsCompleted: 0,
    finishTime: null,
    airTime: 0,
    bestJump: 0,
  };
}

function pickRivalColors(index) {
  const palettes = [
    { frame: "#9dfdff", accent: "#3ccdf0", rider: "#ffb662", visor: "#131927" },
    { frame: "#ffd773", accent: "#ff8d3a", rider: "#ff5c52", visor: "#131927" },
    { frame: "#c8d1ff", accent: "#7f7cff", rider: "#9bffaf", visor: "#131927" },
    { frame: "#ffb1c9", accent: "#ff6b79", rider: "#8effef", visor: "#131927" },
  ];
  return palettes[index % palettes.length];
}

function createRival(index) {
  const baseDistance = 220 + index * 120;
  const lane = index % 4;
  return {
    distance: baseDistance,
    lane,
    laneTarget: lane,
    speed: 120 + index * 7,
    y: groundHeightAt(baseDistance),
    vy: 0,
    grounded: true,
    rotation: 0,
    angularVelocity: 0,
    baseSpeed: 116 + index * 8,
    boostBurst: Math.random() * 2,
    laneCooldown: 0.7 + Math.random() * 1.2,
    recovery: 0,
    colors: pickRivalColors(index),
  };
}

function resetRace(startImmediately = false) {
  state.player = createPlayer();
  state.rivals = Array.from({ length: 7 }, (_, index) => createRival(index));
  state.trackDust = [];
  state.time = 0;
  state.finished = false;
  state.awaitingStart = !startImmediately;
  state.running = startImmediately;
  state.paused = false;
  startButton.textContent = startImmediately ? "Running" : "Start heat";
  pauseButton.textContent = "Pause";
  pauseButton.disabled = false;
  updateHud();

  if (startImmediately) {
    setOverlay("", "", "", true);
    setStatus("Grid is live", "Punch out of lap one clean, then start abusing the turbo.", 1.2);
  } else {
    setOverlay("Ready", "Start the heat", "Three laps, hot boost, and a track that wants the bike upside down.");
    setStatus("Grid is live", "Stay smooth through lap one. The pack crowds the finish line harder than the ramps do.");
  }
}

function updateHud() {
  const lap = Math.min(CONFIG.totalLaps, state.player ? state.player.lapsCompleted + 1 : 1);
  lapDisplay.textContent = `${lap} / ${CONFIG.totalLaps}`;
  speedDisplay.textContent = String(Math.round(state.player?.speed || 0)).padStart(3, "0");
  heatDisplay.textContent = `${String(Math.round(state.player?.heat || 0)).padStart(3, "0")}%`;
  timeDisplay.textContent = formatTime(state.time);
  bestDisplay.textContent = formatTime(state.bestTime);
}

function startHeat() {
  if (state.finished || state.awaitingStart) {
    resetRace(true);
    return;
  }

  if (!state.running) {
    state.running = true;
    state.paused = false;
    pauseButton.textContent = "Pause";
    setOverlay("", "", "", true);
    setStatus("Heat resumed", "The track is already trying to throw the bike away.", 1.1);
    startButton.textContent = "Running";
  }
}

function togglePause() {
  if (state.awaitingStart || state.finished) {
    return;
  }
  state.paused = !state.paused;
  state.running = !state.paused;
  pauseButton.textContent = state.paused ? "Resume" : "Pause";
  startButton.textContent = state.paused ? "Resume heat" : "Running";

  if (state.paused) {
    setOverlay("Paused", "Take a breath", "Turbo Trail Rush is frozen. Resume when you're ready.");
  } else {
    setOverlay("", "", "", true);
    setStatus("Heat resumed", "Back on the throttle.", 0.9);
  }
}

function getHorizontalInput() {
  return (state.input.rightHeld ? 1 : 0) - (state.input.leftHeld ? 1 : 0);
}

function nudgeLane(direction) {
  if (!state.player || state.finished) {
    return;
  }
  state.player.laneTarget = clamp(Math.round(state.player.laneTarget + direction), 0, 3);
}

function maybeLaunchRider(rider, previousDistance) {
  const currentDistance = rider.distance;
  for (const feature of TRACK_FEATURES) {
    if (feature.kind !== "ramp") {
      continue;
    }
    const takeoffMark = feature.x + feature.width * 0.74;
    if (crossedMark(previousDistance, currentDistance, takeoffMark) && rider.speed > 86) {
      rider.grounded = false;
      rider.y = groundHeightAt(rider.distance) + 2;
      rider.vy = 78 + rider.speed * 0.52 + feature.height * 1.1;
      rider.angularVelocity += (rider.laneTarget - rider.lane) * 1.4;
      return true;
    }
  }
  return false;
}

function landRider(rider, isPlayer) {
  const ground = groundHeightAt(rider.distance);
  const targetAngle = Math.atan2(groundSlopeAt(rider.distance), 1) * 0.95;
  const angleOff = Math.abs(normalizeAngle(rider.rotation - targetAngle));
  const landingHard = Math.abs(rider.vy) > 190;

  if (isPlayer && (angleOff > 1.05 || landingHard)) {
    crashPlayer("Bike down", "You lost the landing. Flatten the chassis before the tires touch.");
    return;
  }

  rider.grounded = true;
  rider.y = ground;
  rider.vy = 0;
  rider.rotation = targetAngle;
  rider.angularVelocity = 0;

  if (isPlayer && rider.airTime > 0.75) {
    const bonus = Math.round(rider.airTime * 20);
    state.player.bestJump = Math.max(state.player.bestJump, rider.airTime);
    setStatus("Clean landing", `Jump bonus locked in. Longest air: ${bonus}m feel.`, 1.2);
  }
}

function crashPlayer(title, copy) {
  const rider = state.player;
  if (rider.recovery > 0 || state.finished) {
    return;
  }

  rider.recovery = 1.4;
  rider.grounded = true;
  rider.y = groundHeightAt(rider.distance);
  rider.vy = 0;
  rider.speed = Math.max(24, rider.speed * 0.28);
  rider.rotation = 0;
  rider.angularVelocity = 0;
  rider.heat = Math.max(0, rider.heat - 22);
  rider.boostLocked = false;
  rider.laneTarget = Math.round(rider.lane);
  setStatus(title, copy, 1.7);
  spawnDust(rider.distance, rider.lane, 16, "#ffd0a1");
}

function updatePlayer(dt) {
  const rider = state.player;
  const previousDistance = rider.distance;

  rider.lane += (rider.laneTarget - rider.lane) * Math.min(1, dt * 7);

  if (rider.recovery > 0) {
    rider.recovery = Math.max(0, rider.recovery - dt);
    rider.speed = Math.max(18, rider.speed - 40 * dt);
    rider.distance += rider.speed * dt;
    rider.y = groundHeightAt(rider.distance);
    rider.rotation = mixAngle(rider.rotation, 0, Math.min(1, dt * 10));
    return;
  }

  const throttle = state.input.throttle;
  const brake = state.input.brake;
  const turbo = throttle && state.input.turbo && !rider.boostLocked;
  const horizontal = getHorizontalInput();

  let acceleration = throttle ? 112 : 0;
  if (turbo) {
    acceleration += 78;
  }
  if (brake) {
    acceleration -= 160;
  }
  if (!throttle) {
    acceleration -= 28;
  }

  acceleration -= rider.speed * 0.14;
  if (rider.grounded) {
    acceleration -= groundSlopeAt(rider.distance) * 26;
  }

  const speedCap = turbo ? CONFIG.maxBoostSpeed : CONFIG.maxSpeed;
  rider.speed = clamp(rider.speed + acceleration * dt, 0, speedCap);

  if (turbo) {
    rider.heat = Math.min(100, rider.heat + 28 * dt);
  } else {
    rider.heat = Math.max(0, rider.heat - 18 * dt);
  }

  if (rider.heat >= 100) {
    rider.boostLocked = true;
    setStatus("Engine cooked", "The turbo is overheated. Ride it out and let the heat drop.", 1.4);
  } else if (rider.boostLocked && rider.heat <= 34) {
    rider.boostLocked = false;
    setStatus("Turbo cooled", "Boost is back online. Use it where the lane is clean.", 1.2);
  }

  rider.distance += rider.speed * dt;

  if (rider.grounded) {
    rider.y = groundHeightAt(rider.distance);
    const groundAngle = Math.atan2(groundSlopeAt(rider.distance), 1) * 0.95 + horizontal * 0.06;
    rider.rotation = mixAngle(rider.rotation, groundAngle, Math.min(1, dt * 10));
    maybeLaunchRider(rider, previousDistance);
  } else {
    rider.angularVelocity += horizontal * 3.2 * dt;
    rider.angularVelocity *= 0.985;
    rider.rotation += rider.angularVelocity * dt;
    rider.vy -= CONFIG.gravity * dt;
    rider.y += rider.vy * dt;
    rider.airTime += dt;
    if (rider.y <= groundHeightAt(rider.distance)) {
      landRider(rider, true);
      rider.airTime = 0;
    }
  }

  if (rider.grounded) {
    rider.airTime = 0;
  }

  const lapsCompletedNow = Math.floor(rider.distance / CONFIG.trackLength);
  if (lapsCompletedNow > rider.lapsCompleted) {
    rider.lapsCompleted = lapsCompletedNow;
    if (rider.lapsCompleted < CONFIG.totalLaps) {
      setStatus("Lap clear", `Lap ${rider.lapsCompleted} is down. The next straight is hotter.`, 1.5);
    }
  }

  if (turbo && rider.speed > 120) {
    spawnDust(rider.distance - 16, rider.lane, 2, "#ffb26d");
  } else if (rider.grounded && rider.speed > 40) {
    spawnDust(rider.distance - 12, rider.lane, 1, "#b88252");
  }

  if (!state.finished && rider.distance >= CONFIG.trackLength * CONFIG.totalLaps) {
    finishRace();
  }
}

function updateRivals(dt) {
  for (const rider of state.rivals) {
    rider.lane += (rider.laneTarget - rider.lane) * Math.min(1, dt * 5.5);

    if (rider.recovery > 0) {
      rider.recovery = Math.max(0, rider.recovery - dt);
      rider.speed = Math.max(28, rider.speed - 26 * dt);
      rider.distance += rider.speed * dt;
      rider.y = groundHeightAt(rider.distance);
      rider.rotation = mixAngle(rider.rotation, 0, Math.min(1, dt * 7));
      continue;
    }

    rider.laneCooldown -= dt;
    if (rider.laneCooldown <= 0) {
      rider.laneCooldown = 0.9 + Math.random() * 1.5;
      if (Math.abs(rider.distance - state.player.distance) < 180 && Math.round(state.player.lane) === Math.round(rider.laneTarget)) {
        rider.laneTarget = clamp(rider.laneTarget + (Math.random() > 0.5 ? 1 : -1), 0, 3);
      } else if (Math.random() > 0.58) {
        rider.laneTarget = clamp(rider.laneTarget + (Math.random() > 0.5 ? 1 : -1), 0, 3);
      }
    }

    rider.boostBurst -= dt;
    const burstActive = rider.boostBurst <= 0 && rider.boostBurst > -0.55;
    if (rider.boostBurst <= -0.55) {
      rider.boostBurst = 2.1 + Math.random() * 2.6;
    }

    let acceleration = (rider.baseSpeed - rider.speed) * 0.65;
    if (burstActive) {
      acceleration += 32;
    }
    if (rider.grounded) {
      acceleration -= groundSlopeAt(rider.distance) * 20;
    }

    rider.speed = clamp(rider.speed + acceleration * dt, 48, 198);
    const previousDistance = rider.distance;
    rider.distance += rider.speed * dt;

    if (rider.grounded) {
      rider.y = groundHeightAt(rider.distance);
      const angle = Math.atan2(groundSlopeAt(rider.distance), 1) * 0.92;
      rider.rotation = mixAngle(rider.rotation, angle, Math.min(1, dt * 7));
      maybeLaunchRider(rider, previousDistance);
    } else {
      rider.angularVelocity *= 0.986;
      rider.rotation += rider.angularVelocity * dt;
      rider.vy -= CONFIG.gravity * dt;
      rider.y += rider.vy * dt;
      if (rider.y <= groundHeightAt(rider.distance)) {
        rider.grounded = true;
        rider.y = groundHeightAt(rider.distance);
        rider.vy = 0;
        rider.rotation = Math.atan2(groundSlopeAt(rider.distance), 1) * 0.92;
        rider.angularVelocity = 0;
      }
    }

    if (rider.distance < state.player.distance - 320) {
      rider.distance += CONFIG.trackLength + Math.random() * 180;
      rider.lane = clamp(Math.round(Math.random() * 3), 0, 3);
      rider.laneTarget = rider.lane;
      rider.speed = rider.baseSpeed;
      rider.grounded = true;
      rider.y = groundHeightAt(rider.distance);
    }

    if (rider.grounded && rider.speed > 72 && Math.random() > 0.78) {
      spawnDust(rider.distance - 8, rider.lane, 1, "#a96e3f");
    }
  }
}

function updateCollisions() {
  const player = state.player;
  if (player.recovery > 0 || state.finished) {
    return;
  }

  for (const rival of state.rivals) {
    const distanceGap = Math.abs(rival.distance - player.distance);
    if (distanceGap > 24) {
      continue;
    }
    if (Math.abs(rival.lane - player.lane) > 0.56) {
      continue;
    }
    if (Math.abs(rival.y - player.y) > 18) {
      continue;
    }

    crashPlayer("Rider tangle", "You clipped the pack. Change lanes earlier before the ramp traffic closes.");
    rival.recovery = 0.7;
    rival.speed = Math.max(36, rival.speed * 0.7);
    rival.laneTarget = clamp(rival.laneTarget + (Math.random() > 0.5 ? 1 : -1), 0, 3);
    return;
  }
}

function finishRace() {
  state.finished = true;
  state.running = false;
  state.paused = false;
  state.awaitingStart = false;
  state.player.finishTime = state.time;
  startButton.textContent = "Run again";
  pauseButton.textContent = "Pause";
  pauseButton.disabled = true;

  let copy = `Final time ${formatTime(state.time)}.`;
  if (state.bestTime === null || state.time < state.bestTime) {
    state.bestTime = state.time;
    saveBestTime(state.time);
    copy += " New personal best locked in.";
  }

  setOverlay("Finish", "Heat cleared", `${copy} Hit start to run the track again.`);
  setStatus("Heat cleared", copy);
  updateHud();
}

function spawnDust(distance, lane, count, color) {
  for (let index = 0; index < count; index += 1) {
    state.trackDust.push({
      distance: distance - Math.random() * 8,
      lane: lane + (Math.random() - 0.5) * 0.16,
      y: groundHeightAt(distance) + Math.random() * 4,
      vx: -20 - Math.random() * 30,
      vy: 20 + Math.random() * 28,
      life: 0.35 + Math.random() * 0.35,
      radius: 2 + Math.random() * 4,
      color,
    });
  }
}

function updateDust(dt) {
  state.trackDust = state.trackDust.filter((particle) => {
    particle.distance += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy -= 46 * dt;
    particle.life -= dt;
    return particle.life > 0;
  });
}

function updateStatus(dt) {
  if (state.statusTimer > 0) {
    state.statusTimer = Math.max(0, state.statusTimer - dt);
    return;
  }

  if (state.finished) {
    setStatus("Heat cleared", `Final time ${formatTime(state.time)}. Hit start to run again.`);
    return;
  }

  if (state.awaitingStart) {
    setStatus("Grid is live", "Stay smooth through lap one. The pack crowds the finish line harder than the ramps do.");
    return;
  }

  if (state.paused) {
    setStatus("Heat paused", "Catch your breath. The next ramp is still waiting.");
    return;
  }

  if (state.player.boostLocked) {
    setStatus("Engine cooked", "Turbo is offline until the heat drops back into the safe zone.");
    return;
  }

  if (!state.player.grounded) {
    setStatus("Hold it flat", "Keep the bike almost parallel to the dirt before you land.");
    return;
  }

  if (state.player.speed < 60) {
    setStatus("Get on throttle", "You need more speed before the next ramp window means anything.");
    return;
  }

  if (state.player.speed > 170) {
    setStatus("Track is moving", "This is the hot zone. Keep the lane clean and don't clip traffic.");
    return;
  }

  setStatus("Grid is live", "Use lane cuts to stay off the back wheel of the pack.");
}

function screenXOf(distance) {
  return CONFIG.playerScreenX + (distance - state.player.distance) * CONFIG.horizontalScale;
}

function groundScreenYAt(distance) {
  return CONFIG.baseline + (groundHeightAt(distance) - groundHeightAt(state.player.distance)) * CONFIG.verticalScale;
}

function riderScreenY(rider) {
  const ground = groundHeightAt(rider.distance);
  return groundScreenYAt(rider.distance) + rider.lane * CONFIG.laneStep - (rider.y - ground) * CONFIG.verticalScale;
}

function drawSky() {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#1b365f");
  gradient.addColorStop(0.48, "#4f345d");
  gradient.addColorStop(1, "#11131c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sunGradient = ctx.createRadialGradient(canvas.width - 190, 96, 10, canvas.width - 190, 96, 130);
  sunGradient.addColorStop(0, "rgba(255, 232, 175, 0.95)");
  sunGradient.addColorStop(0.6, "rgba(255, 145, 65, 0.65)");
  sunGradient.addColorStop(1, "rgba(255, 145, 65, 0)");
  ctx.fillStyle = sunGradient;
  ctx.beginPath();
  ctx.arc(canvas.width - 190, 96, 130, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  for (const star of SKY_STARS) {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMountainBand(0.18, 330, "#1d2236", 26, 110);
  drawMountainBand(0.28, 370, "#2a2c3f", 32, 140);
}

function drawMountainBand(parallax, baseline, color, amplitude, span) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height);
  for (let x = 0; x <= canvas.width + 10; x += 16) {
    const world = (state.player.distance * parallax + x * 0.8) / span;
    const y =
      baseline +
      Math.sin(world * 1.3) * amplitude +
      Math.sin(world * 2.8 + 0.8) * amplitude * 0.4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(canvas.width, canvas.height);
  ctx.closePath();
  ctx.fill();
}

function drawTrack() {
  const samples = [];
  for (let x = 0; x <= canvas.width + 8; x += 8) {
    const worldDistance = state.player.distance + (x - CONFIG.playerScreenX) / CONFIG.horizontalScale;
    samples.push({
      x,
      topY: groundScreenYAt(worldDistance),
    });
  }

  ctx.beginPath();
  ctx.moveTo(samples[0].x, canvas.height);
  for (const sample of samples) {
    ctx.lineTo(sample.x, sample.topY);
  }
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    ctx.lineTo(sample.x, sample.topY + CONFIG.laneStep * 3 + 110);
  }
  ctx.closePath();
  const dirtGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  dirtGradient.addColorStop(0, "#dc8d47");
  dirtGradient.addColorStop(0.45, "#9c5529");
  dirtGradient.addColorStop(1, "#462011");
  ctx.fillStyle = dirtGradient;
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 227, 185, 0.92)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const sample of samples) {
    if (sample.x === 0) {
      ctx.moveTo(sample.x, sample.topY);
    } else {
      ctx.lineTo(sample.x, sample.topY);
    }
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 232, 205, 0.25)";
  ctx.lineWidth = 3;
  for (let lane = 1; lane <= 3; lane += 1) {
    ctx.beginPath();
    for (const sample of samples) {
      const lineY = sample.topY + lane * CONFIG.laneStep;
      if (sample.x === 0) {
        ctx.moveTo(sample.x, lineY);
      } else {
        ctx.lineTo(sample.x, lineY);
      }
    }
    ctx.stroke();
  }

  drawFinishLine();
}

function drawFinishLine() {
  const currentLapBase = Math.floor(state.player.distance / CONFIG.trackLength);
  for (let lapCopy = currentLapBase - 1; lapCopy <= currentLapBase + 2; lapCopy += 1) {
    const finishDistance = lapCopy * CONFIG.trackLength;
    const screenX = screenXOf(finishDistance);
    if (screenX < -40 || screenX > canvas.width + 40) {
      continue;
    }

    const top = groundScreenYAt(finishDistance) - 66;
    const bottom = groundScreenYAt(finishDistance) + CONFIG.laneStep * 3 + 36;
    ctx.strokeStyle = "#fff4d0";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(screenX, top);
    ctx.lineTo(screenX, bottom);
    ctx.moveTo(screenX + 24, top);
    ctx.lineTo(screenX + 24, bottom);
    ctx.stroke();

    ctx.fillStyle = "rgba(15, 20, 35, 0.88)";
    ctx.fillRect(screenX, top - 22, 24, 22);
    ctx.fillStyle = "#f5f8ff";
    ctx.font = "700 12px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText("FIN", screenX + 2, top - 7);
  }
}

function drawBike(screenX, screenY, rotation, palette, wheelSpin, recovering = false, scale = 1) {
  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.globalAlpha = recovering ? 0.58 + Math.sin(state.time * 18) * 0.2 : 1;

  const wheelOffsetY = 18;
  const rearWheelX = -26;
  const frontWheelX = 28;

  drawWheel(rearWheelX, wheelOffsetY, 16, wheelSpin);
  drawWheel(frontWheelX, wheelOffsetY + 2, 17, wheelSpin);

  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(rearWheelX + 6, wheelOffsetY - 14);
  ctx.lineTo(-6, -2);
  ctx.lineTo(frontWheelX - 2, wheelOffsetY - 12);
  ctx.lineTo(12, -10);
  ctx.lineTo(-8, -8);
  ctx.lineTo(rearWheelX + 4, wheelOffsetY - 10);
  ctx.stroke();

  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-8, -8);
  ctx.lineTo(16, -8);
  ctx.lineTo(34, 4);
  ctx.stroke();

  ctx.strokeStyle = "#ffe5ba";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(28, 4);
  ctx.lineTo(46, -4);
  ctx.stroke();

  ctx.fillStyle = palette.rider;
  ctx.beginPath();
  ctx.moveTo(-6, -34);
  ctx.quadraticCurveTo(18, -52, 32, -26);
  ctx.lineTo(12, -2);
  ctx.lineTo(-8, -18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.visor;
  ctx.beginPath();
  ctx.arc(14, -24, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = palette.visor;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-4, -12);
  ctx.lineTo(12, 2);
  ctx.lineTo(28, 14);
  ctx.stroke();

  ctx.restore();
}

function drawWheel(x, y, radius, wheelSpin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#1b2231";
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#c7e8ff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.rotate(wheelSpin);
  ctx.strokeStyle = "#7fd7ff";
  ctx.lineWidth = 2;
  for (let spoke = 0; spoke < 4; spoke += 1) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius - 4, 0);
    ctx.stroke();
    ctx.rotate(Math.PI / 2);
  }
  ctx.restore();
}

function drawRiders() {
  const visibleRiders = state.rivals
    .filter((rider) => Math.abs(rider.distance - state.player.distance) < CONFIG.visibleRange * 0.8)
    .sort((a, b) => a.lane - b.lane || a.distance - b.distance);

  for (const rival of visibleRiders) {
    drawBike(
      screenXOf(rival.distance),
      riderScreenY(rival),
      rival.rotation,
      rival.colors,
      rival.distance * 0.08,
      rival.recovery > 0,
      0.92
    );
  }

  drawBike(
    CONFIG.playerScreenX,
    riderScreenY(state.player),
    state.player.rotation,
    { frame: "#9efff3", accent: "#ff8d3a", rider: "#ff6c4c", visor: "#111726" },
    state.player.distance * 0.09,
    state.player.recovery > 0,
    1
  );
}

function drawDust() {
  for (const particle of state.trackDust) {
    const x = screenXOf(particle.distance);
    if (x < -40 || x > canvas.width + 40) {
      continue;
    }
    const ground = groundHeightAt(particle.distance);
    const y =
      groundScreenYAt(particle.distance) +
      particle.lane * CONFIG.laneStep -
      (particle.y - ground) * CONFIG.verticalScale;

    ctx.globalAlpha = clamp(particle.life / 0.7, 0, 1) * 0.8;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(x, y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSky();
  drawTrack();
  drawDust();
  drawRiders();
  drawDebugHud();
}

function drawDebugHud() {
  ctx.save();
  ctx.fillStyle = "rgba(7, 11, 20, 0.6)";
  ctx.fillRect(20, canvas.height - 54, 300, 34);
  ctx.fillStyle = "#d7e5ff";
  ctx.font = "600 15px 'Trebuchet MS', 'Segoe UI', sans-serif";
  const turboState = state.player.boostLocked ? "COOLING" : state.input.turbo ? "BOOSTING" : "READY";
  ctx.fillText(`Turbo ${turboState}  |  Longest jump ${Math.max(0, state.player.bestJump * 26).toFixed(0)}m`, 32, canvas.height - 31);
  ctx.restore();
}

function loop(timestamp) {
  if (!state.lastTime) {
    state.lastTime = timestamp;
  }
  const dt = Math.min((timestamp - state.lastTime) / 1000, 0.033);
  state.lastTime = timestamp;

  if (state.running && !state.paused) {
    state.time += dt;
    updatePlayer(dt);
    updateRivals(dt);
    updateCollisions();
    updateDust(dt);
  } else {
    updateDust(dt);
  }

  updateStatus(dt);
  updateHud();
  render();
  window.requestAnimationFrame(loop);
}

function bindKeyboard() {
  window.addEventListener("keydown", (event) => {
    const code = event.code;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
      event.preventDefault();
    }

    if (code === "ArrowUp" || code === "KeyW") {
      state.input.throttle = true;
    } else if (code === "ArrowDown" || code === "KeyS") {
      state.input.brake = true;
    } else if (code === "ShiftLeft" || code === "ShiftRight" || code === "KeyX") {
      state.input.turbo = true;
    } else if (code === "ArrowLeft" || code === "KeyA") {
      state.input.leftHeld = true;
      if (!event.repeat) {
        nudgeLane(-1);
      }
    } else if (code === "ArrowRight" || code === "KeyD") {
      state.input.rightHeld = true;
      if (!event.repeat) {
        nudgeLane(1);
      }
    } else if (code === "KeyP") {
      togglePause();
    } else if (code === "Enter" || code === "Space") {
      if (state.awaitingStart || state.finished || !state.running) {
        startHeat();
      }
    }
  });

  window.addEventListener("keyup", (event) => {
    const code = event.code;
    if (code === "ArrowUp" || code === "KeyW") {
      state.input.throttle = false;
    } else if (code === "ArrowDown" || code === "KeyS") {
      state.input.brake = false;
    } else if (code === "ShiftLeft" || code === "ShiftRight" || code === "KeyX") {
      state.input.turbo = false;
    } else if (code === "ArrowLeft" || code === "KeyA") {
      state.input.leftHeld = false;
    } else if (code === "ArrowRight" || code === "KeyD") {
      state.input.rightHeld = false;
    }
  });
}

function bindTouchControls() {
  const controls = document.querySelectorAll("[data-control]");
  controls.forEach((button) => {
    const control = button.dataset.control;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      if (control === "left") {
        state.input.leftHeld = true;
        nudgeLane(-1);
      } else if (control === "right") {
        state.input.rightHeld = true;
        nudgeLane(1);
      } else {
        state.input[control] = true;
      }
    });

    const clearControl = () => {
      if (control === "left") {
        state.input.leftHeld = false;
      } else if (control === "right") {
        state.input.rightHeld = false;
      } else {
        state.input[control] = false;
      }
    };

    button.addEventListener("pointerup", clearControl);
    button.addEventListener("pointercancel", clearControl);
    button.addEventListener("pointerleave", clearControl);
  });
}

function bindUi() {
  startButton.addEventListener("click", () => startHeat());
  pauseButton.addEventListener("click", () => togglePause());
  restartButton.addEventListener("click", () => resetRace(true));
}

function init() {
  bindKeyboard();
  bindTouchControls();
  bindUi();
  resetRace(false);
  window.requestAnimationFrame(loop);
}

init();
