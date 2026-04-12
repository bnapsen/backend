const SOUND_STORAGE_KEY = "star-sprint:sound-enabled";
const POLL_INTERVAL_MS = 450;
const TEMP_MESSAGE_MS = 1800;
const ARENA_FEEDBACK_CLASSES = [
  "feedback-move",
  "feedback-blocked",
  "feedback-score",
  "feedback-win",
  "feedback-reset",
  "feedback-join",
];

const state = {
  roomCode: "",
  playerId: "",
  snapshot: null,
  pollTimer: null,
  busyMove: false,
  queuedMove: null,
  soundEnabled: loadSoundPreference(),
  audioContext: null,
  feedbackTimer: null,
  activityTimer: null,
};

const setupPanel = document.getElementById("setup-panel");
const gamePanel = document.getElementById("game-panel");
const nameInput = document.getElementById("name-input");
const roomInput = document.getElementById("room-input");
const statusText = document.getElementById("status-text");
const roomCodeText = document.getElementById("room-code");
const scoreboard = document.getElementById("scoreboard");
const arena = document.getElementById("arena");
const goalText = document.getElementById("goal-text");
const yourProgress = document.getElementById("your-progress");
const winnerText = document.getElementById("winner-text");
const activityText = document.getElementById("activity-text");
const soundButton = document.getElementById("sound-button");
const copyButton = document.getElementById("copy-button");
const API_BASE = getApiBase();

function normalizeApiBase(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }

  return value.replace(/\/+$/, "");
}

function getApiBase() {
  const override = normalizeApiBase(window.STAR_SPRINT_API_BASE);
  if (override) {
    return override;
  }

  const host = window.location.hostname.toLowerCase();
  if (host === "bnapsen.com" || host === "www.bnapsen.com" || host.endsWith(".github.io")) {
    return "https://api.bnapsen.com";
  }

  return "";
}

function resolveApiUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
}

function loadSoundPreference() {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveSoundPreference(enabled) {
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Ignore storage failures in private browsing or restrictive environments.
  }
}

function updateSoundButton() {
  soundButton.textContent = state.soundEnabled ? "Sound: On" : "Sound: Off";
  soundButton.setAttribute("aria-pressed", String(state.soundEnabled));
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function getCurrentPlayer(snapshot) {
  return snapshot?.players.find((player) => player.isYou) || null;
}

function getSortedPlayers(snapshot) {
  return [...snapshot.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function getDefaultActivity(snapshot) {
  if (!snapshot) {
    return "Share a room code to get the race started.";
  }

  if (snapshot.winnerName) {
    return "Round over. Hit New round when everyone is ready.";
  }

  if (snapshot.players.length < 2) {
    return "Share the room code to bring in another player.";
  }

  const you = getCurrentPlayer(snapshot);
  const leader = getSortedPlayers(snapshot)[0];
  if (!you || !leader) {
    return "Race to the glowing star and cut off your rivals.";
  }

  if (leader.score === 0) {
    return "First star sets the pace. Move fast and protect open lanes.";
  }

  if (leader.id === you.id) {
    const remaining = Math.max(snapshot.goal - you.score, 0);
    return `You lead. ${remaining} ${pluralize("star", remaining)} to win.`;
  }

  if (leader.score === you.score) {
    return `It's tied at ${you.score}. Beat the field to the next spawn.`;
  }

  return `${leader.name} leads by ${leader.score - you.score}. Take the short route to the next star.`;
}

function setActivity(message, options = {}) {
  const fallback = getDefaultActivity(state.snapshot);
  activityText.textContent = message || fallback;

  if (state.activityTimer) {
    window.clearTimeout(state.activityTimer);
    state.activityTimer = null;
  }

  if (options.temporary) {
    const duration = options.duration ?? TEMP_MESSAGE_MS;
    state.activityTimer = window.setTimeout(() => {
      activityText.textContent = getDefaultActivity(state.snapshot);
      state.activityTimer = null;
    }, duration);
  }
}

function setStatus(message) {
  statusText.textContent = message || "";
  if (message && !gamePanel.classList.contains("hidden")) {
    setActivity(message, { temporary: true });
  }
}

function showGame() {
  setupPanel.classList.add("hidden");
  gamePanel.classList.remove("hidden");
}

function showSetup() {
  gamePanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
}

async function postJson(url, body) {
  const response = await fetch(resolveApiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
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
  if (!state.soundEnabled) {
    return;
  }

  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== "suspended") {
    return;
  }

  try {
    await audioContext.resume();
  } catch {
    // Ignore browser autoplay restrictions until the next user gesture.
  }
}

function playTone(audioContext, startTime, options) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const duration = options.duration ?? 0.12;
  const volume = options.volume ?? 0.04;
  const attack = options.attack ?? 0.01;
  const release = options.release ?? 0.08;
  const endTime = startTime + duration;

  oscillator.type = options.type ?? "triangle";
  oscillator.frequency.setValueAtTime(options.frequency, startTime);
  if (options.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, endTime);
  }

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.exponentialRampToValueAtTime(volume, startTime + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime + release);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime + release + 0.02);
}

function playSound(effect) {
  if (!state.soundEnabled) {
    return;
  }

  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const start = audioContext.currentTime + 0.01;

  switch (effect) {
    case "move":
      playTone(audioContext, start, {
        frequency: 320,
        endFrequency: 260,
        duration: 0.08,
        volume: 0.028,
      });
      break;
    case "blocked":
      playTone(audioContext, start, {
        frequency: 180,
        endFrequency: 120,
        duration: 0.11,
        volume: 0.03,
        type: "square",
      });
      break;
    case "score":
      playTone(audioContext, start, {
        frequency: 520,
        endFrequency: 700,
        duration: 0.09,
        volume: 0.03,
      });
      playTone(audioContext, start + 0.08, {
        frequency: 820,
        endFrequency: 1120,
        duration: 0.15,
        volume: 0.035,
      });
      break;
    case "win":
      playTone(audioContext, start, {
        frequency: 392,
        endFrequency: 523,
        duration: 0.14,
        volume: 0.03,
      });
      playTone(audioContext, start + 0.12, {
        frequency: 523,
        endFrequency: 659,
        duration: 0.18,
        volume: 0.032,
      });
      playTone(audioContext, start + 0.26, {
        frequency: 784,
        endFrequency: 1047,
        duration: 0.3,
        volume: 0.04,
      });
      break;
    case "join":
      playTone(audioContext, start, {
        frequency: 440,
        endFrequency: 554,
        duration: 0.11,
        volume: 0.026,
      });
      playTone(audioContext, start + 0.1, {
        frequency: 660,
        endFrequency: 830,
        duration: 0.16,
        volume: 0.03,
      });
      break;
    case "reset":
      playTone(audioContext, start, {
        frequency: 340,
        endFrequency: 450,
        duration: 0.1,
        volume: 0.025,
      });
      playTone(audioContext, start + 0.08, {
        frequency: 480,
        endFrequency: 620,
        duration: 0.14,
        volume: 0.028,
      });
      break;
    case "ui":
      playTone(audioContext, start, {
        frequency: 760,
        endFrequency: 900,
        duration: 0.07,
        volume: 0.02,
      });
      break;
    default:
      break;
  }
}

function flashArena(kind) {
  arena.classList.remove(...ARENA_FEEDBACK_CLASSES);

  if (state.feedbackTimer) {
    window.clearTimeout(state.feedbackTimer);
    state.feedbackTimer = null;
  }

  if (!kind) {
    return;
  }

  const className = `feedback-${kind}`;
  void arena.offsetWidth;
  arena.classList.add(className);

  state.feedbackTimer = window.setTimeout(() => {
    arena.classList.remove(className);
    state.feedbackTimer = null;
  }, 700);
}

function flashButtonLabel(button, label, duration = 1200) {
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }

  if (button._labelTimer) {
    window.clearTimeout(button._labelTimer);
  }

  button.textContent = label;
  button._labelTimer = window.setTimeout(() => {
    button.textContent = button.dataset.defaultLabel;
    button._labelTimer = null;
  }, duration);
}

function analyzeTransition(previous, snapshot, meta = {}) {
  const reason = meta.reason || "refresh";

  if (!previous) {
    if (reason === "create") {
      return {
        message: "Room ready. Share the code and start moving.",
        sound: "join",
        feedback: "join",
        temporary: true,
      };
    }

    if (reason === "join") {
      return {
        message: snapshot.players.length < 2 ? "You're in. Waiting for another player." : "You're in. Chase the next star.",
        sound: "join",
        feedback: "join",
        temporary: true,
      };
    }

    return {};
  }

  const previousPlayers = new Map(previous.players.map((player) => [player.id, player]));
  const joinedPlayers = snapshot.players.filter((player) => !previousPlayers.has(player.id));
  const scoringPlayers = snapshot.players.filter((player) => player.score > (previousPlayers.get(player.id)?.score ?? 0));
  const winnerJustSet = snapshot.winnerId && snapshot.winnerId !== previous.winnerId;
  const resetHappened =
    reason === "reset" ||
    (previous.players.some((player) => player.score > 0) &&
      snapshot.players.every((player) => player.score === 0) &&
      !snapshot.winnerId);

  if (resetHappened) {
    return {
      message: `Fresh round. First to ${snapshot.goal} ${pluralize("star", snapshot.goal)} wins.`,
      sound: "reset",
      feedback: "reset",
      temporary: true,
    };
  }

  if (winnerJustSet) {
    return {
      message: `${snapshot.winnerName} wins the round!`,
      sound: "win",
      feedback: "win",
      temporary: false,
    };
  }

  if (scoringPlayers.length > 0) {
    const scorer = scoringPlayers[0];
    const remaining = Math.max(snapshot.goal - scorer.score, 0);

    return {
      message: scorer.isYou
        ? `Star secured. ${remaining} ${pluralize("star", remaining)} left.`
        : `${scorer.name} grabbed a star.`,
      sound: "score",
      feedback: "score",
      temporary: true,
    };
  }

  if (joinedPlayers.length > 0) {
    return {
      message: `${joinedPlayers[0].name} joined the room.`,
      sound: "join",
      feedback: "join",
      temporary: true,
    };
  }

  if (reason === "move") {
    const you = getCurrentPlayer(snapshot);
    const previousYou = you ? previousPlayers.get(you.id) : null;

    if (you && previousYou) {
      const moved = you.x !== previousYou.x || you.y !== previousYou.y;
      if (moved) {
        return {
          sound: "move",
          feedback: "move",
        };
      }

      if (!snapshot.winnerId) {
        return {
          message: "Blocked. Try another route.",
          sound: "blocked",
          feedback: "blocked",
          temporary: true,
        };
      }
    }
  }

  return {};
}

function renderArena(snapshot, previous) {
  const previousPlayers = new Map((previous?.players || []).map((player) => [player.id, player]));
  const playersByPosition = new Map(snapshot.players.map((player) => [`${player.x},${player.y}`, player]));
  const starMoved = Boolean(previous) && (previous.star.x !== snapshot.star.x || previous.star.y !== snapshot.star.y);

  arena.style.gridTemplateColumns = `repeat(${snapshot.width}, minmax(0, 1fr))`;
  arena.innerHTML = "";

  for (let y = 0; y < snapshot.height; y += 1) {
    for (let x = 0; x < snapshot.width; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";

      if (snapshot.star.x === x && snapshot.star.y === y) {
        cell.classList.add("star");
        if (starMoved) {
          cell.classList.add("star-fresh");
        }
      }

      const player = playersByPosition.get(`${x},${y}`);
      if (player) {
        const previousPlayer = previousPlayers.get(player.id);
        const moved = previousPlayer && (previousPlayer.x !== player.x || previousPlayer.y !== player.y);

        cell.classList.add("player");
        cell.style.setProperty("--player-color", player.color);
        cell.title = `${player.name}: ${player.score}`;

        if (player.isYou) {
          cell.classList.add("you");
        }

        if (moved) {
          cell.classList.add("player-shifted");
        }
      }

      arena.appendChild(cell);
    }
  }
}

function renderScoreboard(snapshot) {
  const sortedPlayers = getSortedPlayers(snapshot);
  const leaderScore = sortedPlayers[0]?.score ?? 0;

  scoreboard.innerHTML = "";
  for (const player of sortedPlayers) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="player-badge">
        <span class="player-dot" style="background:${player.color}"></span>
        <span>${player.name}${player.isYou ? " (you)" : ""}</span>
      </span>
      <strong>${player.score}</strong>
    `;

    if (player.isYou) {
      li.classList.add("you-row");
    }

    if (leaderScore > 0 && player.score === leaderScore) {
      li.classList.add("leading");
    }

    scoreboard.appendChild(li);
  }
}

function render(snapshot, meta = {}) {
  const previous = state.snapshot;
  const transition = analyzeTransition(previous, snapshot, meta);
  const you = getCurrentPlayer(snapshot);
  const leader = getSortedPlayers(snapshot)[0];

  state.snapshot = snapshot;
  roomCodeText.textContent = snapshot.roomCode;
  goalText.textContent = `First to ${snapshot.goal} ${pluralize("star", snapshot.goal)} wins.`;
  yourProgress.textContent = you
    ? `You are at ${you.score} / ${snapshot.goal}.${leader && leader.score > you.score ? ` ${leader.name} leads.` : " Keep the pressure on."}`
    : "Join the race to start scoring.";

  renderArena(snapshot, previous);
  renderScoreboard(snapshot);

  if (snapshot.winnerName) {
    winnerText.textContent = `${snapshot.winnerName} wins the round. Hit "New round" to play again.`;
  } else if (snapshot.players.length < 2) {
    winnerText.textContent = "Waiting for another player to join the room.";
  } else {
    winnerText.textContent = "Race to the glowing star and cut off your rivals.";
  }

  if (transition.feedback) {
    flashArena(transition.feedback);
  }

  if (transition.sound) {
    playSound(transition.sound);
  }

  if (transition.message) {
    setActivity(transition.message, { temporary: transition.temporary });
  } else if (!state.activityTimer) {
    setActivity(getDefaultActivity(snapshot));
  }
}

async function refreshState() {
  if (!state.roomCode || !state.playerId) {
    return;
  }

  try {
    const response = await fetch(
      resolveApiUrl(`/api/state?roomCode=${encodeURIComponent(state.roomCode)}&playerId=${encodeURIComponent(state.playerId)}`)
    );
    const snapshot = await response.json();
    if (!response.ok) {
      throw new Error(snapshot.error || "Unable to refresh game state.");
    }

    render(snapshot, { reason: "refresh" });
  } catch (error) {
    setStatus(error.message);
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(refreshState, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function getPlayerName() {
  return nameInput.value.trim() || "Player";
}

async function createRoom() {
  setStatus("Creating room...");
  await primeAudio();

  try {
    const payload = await postJson("/api/create-room", { name: getPlayerName() });
    state.roomCode = payload.roomCode;
    state.playerId = payload.playerId;
    render(payload.state, { reason: "create" });
    showGame();
    startPolling();
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
}

async function joinRoom() {
  setStatus("Joining room...");
  await primeAudio();

  try {
    const payload = await postJson("/api/join-room", {
      name: getPlayerName(),
      roomCode: roomInput.value.trim().toUpperCase(),
    });
    state.roomCode = payload.roomCode;
    state.playerId = payload.playerId;
    render(payload.state, { reason: "join" });
    showGame();
    startPolling();
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
}

async function move(direction) {
  if (!state.roomCode || !state.playerId) {
    return;
  }

  state.queuedMove = direction;
  if (state.busyMove) {
    return;
  }

  state.busyMove = true;
  await primeAudio();

  try {
    while (state.queuedMove) {
      const nextDirection = state.queuedMove;
      state.queuedMove = null;

      const snapshot = await postJson("/api/move", {
        roomCode: state.roomCode,
        playerId: state.playerId,
        direction: nextDirection,
      });

      render(snapshot, { reason: "move", direction: nextDirection });
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    state.busyMove = false;
  }
}

async function resetRoom() {
  if (!state.roomCode) {
    return;
  }

  await primeAudio();

  try {
    const snapshot = await postJson("/api/reset-room", {
      roomCode: state.roomCode,
      playerId: state.playerId,
    });
    render(snapshot, { reason: "reset" });
  } catch (error) {
    setStatus(error.message);
  }
}

document.getElementById("create-button").addEventListener("click", createRoom);
document.getElementById("join-button").addEventListener("click", joinRoom);
document.getElementById("reset-button").addEventListener("click", resetRoom);

copyButton.addEventListener("click", async () => {
  if (!state.roomCode) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.roomCode);
    await primeAudio();
    playSound("ui");
    flashButtonLabel(copyButton, "Copied");
    setActivity("Room code copied to the clipboard.", { temporary: true });
  } catch {
    setStatus("Unable to copy the room code on this device.");
  }
});

soundButton.addEventListener("click", async () => {
  state.soundEnabled = !state.soundEnabled;
  saveSoundPreference(state.soundEnabled);
  updateSoundButton();

  if (state.soundEnabled) {
    await primeAudio();
    playSound("ui");
    setActivity("Sound effects enabled.", { temporary: true });
  } else {
    setActivity("Sound effects muted.", { temporary: true });
  }
});

document.querySelectorAll("[data-direction]").forEach((button) => {
  button.addEventListener("click", () => move(button.dataset.direction));
});

window.addEventListener("keydown", (event) => {
  if (gamePanel.classList.contains("hidden")) {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
    return;
  }

  const mapping = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    a: "left",
    s: "down",
    d: "right",
  };

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const direction = mapping[key];
  if (!direction) {
    return;
  }

  event.preventDefault();
  move(direction);
});

nameInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  if (roomInput.value.trim()) {
    joinRoom();
  } else {
    createRoom();
  }
});

roomInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  joinRoom();
});

roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshState();
  }
});

window.addEventListener("beforeunload", stopPolling);

updateSoundButton();
showSetup();
nameInput.focus();
