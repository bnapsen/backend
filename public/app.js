const state = {
  roomCode: "",
  playerId: "",
  snapshot: null,
  pollTimer: null,
  busyMove: false,
};

const setupPanel = document.getElementById("setup-panel");
const gamePanel = document.getElementById("game-panel");
const nameInput = document.getElementById("name-input");
const roomInput = document.getElementById("room-input");
const statusText = document.getElementById("status-text");
const roomCodeText = document.getElementById("room-code");
const scoreboard = document.getElementById("scoreboard");
const arena = document.getElementById("arena");
const winnerText = document.getElementById("winner-text");

async function postJson(url, body) {
  const response = await fetch(url, {
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

function setStatus(message) {
  statusText.textContent = message || "";
}

function showGame() {
  setupPanel.classList.add("hidden");
  gamePanel.classList.remove("hidden");
}

function showSetup() {
  gamePanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
}

function render(snapshot) {
  state.snapshot = snapshot;
  roomCodeText.textContent = snapshot.roomCode;

  arena.style.gridTemplateColumns = `repeat(${snapshot.width}, minmax(0, 1fr))`;
  arena.innerHTML = "";

  for (let y = 0; y < snapshot.height; y += 1) {
    for (let x = 0; x < snapshot.width; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";

      if (snapshot.star.x === x && snapshot.star.y === y) {
        cell.classList.add("star");
      }

      const player = snapshot.players.find((entry) => entry.x === x && entry.y === y);
      if (player) {
        cell.classList.add("player");
        cell.style.setProperty("--player-color", player.color);
        cell.title = `${player.name}: ${player.score}`;
        if (player.isYou) {
          cell.classList.add("you");
        }
      }

      arena.appendChild(cell);
    }
  }

  const sortedPlayers = [...snapshot.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
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
    scoreboard.appendChild(li);
  }

  if (snapshot.winnerName) {
    winnerText.textContent = `${snapshot.winnerName} wins the round. Hit "New round" to play again.`;
  } else if (snapshot.players.length < 2) {
    winnerText.textContent = "Waiting for another player to join the room.";
  } else {
    winnerText.textContent = "Race to the glowing star and block your rivals.";
  }
}

async function refreshState() {
  if (!state.roomCode || !state.playerId) {
    return;
  }

  try {
    const response = await fetch(`/api/state?roomCode=${encodeURIComponent(state.roomCode)}&playerId=${encodeURIComponent(state.playerId)}`);
    const snapshot = await response.json();
    if (!response.ok) {
      throw new Error(snapshot.error || "Unable to refresh game state.");
    }
    render(snapshot);
  } catch (error) {
    setStatus(error.message);
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(refreshState, 700);
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
  try {
    const payload = await postJson("/api/create-room", { name: getPlayerName() });
    state.roomCode = payload.roomCode;
    state.playerId = payload.playerId;
    render(payload.state);
    showGame();
    startPolling();
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
}

async function joinRoom() {
  setStatus("Joining room...");
  try {
    const payload = await postJson("/api/join-room", {
      name: getPlayerName(),
      roomCode: roomInput.value.trim().toUpperCase(),
    });
    state.roomCode = payload.roomCode;
    state.playerId = payload.playerId;
    render(payload.state);
    showGame();
    startPolling();
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
}

async function move(direction) {
  if (!state.roomCode || !state.playerId || state.busyMove) {
    return;
  }

  state.busyMove = true;
  try {
    const snapshot = await postJson("/api/move", {
      roomCode: state.roomCode,
      playerId: state.playerId,
      direction,
    });
    render(snapshot);
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

  try {
    const snapshot = await postJson("/api/reset-room", {
      roomCode: state.roomCode,
      playerId: state.playerId,
    });
    render(snapshot);
  } catch (error) {
    setStatus(error.message);
  }
}

document.getElementById("create-button").addEventListener("click", createRoom);
document.getElementById("join-button").addEventListener("click", joinRoom);
document.getElementById("reset-button").addEventListener("click", resetRoom);
document.getElementById("copy-button").addEventListener("click", async () => {
  if (!state.roomCode) {
    return;
  }
  await navigator.clipboard.writeText(state.roomCode);
  winnerText.textContent = "Room code copied to the clipboard.";
});

document.querySelectorAll("[data-direction]").forEach((button) => {
  button.addEventListener("click", () => move(button.dataset.direction));
});

window.addEventListener("keydown", (event) => {
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

  const direction = mapping[event.key];
  if (!direction) {
    return;
  }

  event.preventDefault();
  move(direction);
});

roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
});

showSetup();

