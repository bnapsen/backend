(() => {
  'use strict';

  const STORAGE_KEYS = {
    serverUrl: 'starSprint.serverUrl',
    name: 'starSprint.playerName',
  };
  const BOARD_SIZE = 12;
  const GOAL = 5;
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const query = new URLSearchParams(window.location.search);

  const state = {
    roomCode: '',
    playerId: '',
    socket: null,
    snapshot: null,
    serverUrl: '',
    isHost: false,
    localMode: false,
    botTimer: null,
    toastTimer: null,
  };

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    goalText: document.getElementById('goalText'),
    presenceText: document.getElementById('presenceText'),
    scoreboard: document.getElementById('scoreboard'),
    raceSummary: document.getElementById('raceSummary'),
    arena: document.getElementById('arena'),
    winnerText: document.getElementById('winnerText'),
    networkStatus: document.getElementById('networkStatus'),
    playerCountPill: document.getElementById('playerCountPill'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    soloBtn: document.getElementById('soloBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    resetBtn: document.getElementById('resetBtn'),
    toast: document.getElementById('toast'),
    stepHost: document.getElementById('stepHost'),
    stepShare: document.getElementById('stepShare'),
    stepJoin: document.getElementById('stepJoin'),
  };

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function sanitizeServerUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return state.serverUrl;
    if (/^wss?:\/\//i.test(trimmed)) return trimmed;
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function generateRoomCode(length = 6) {
    let output = '';
    for (let index = 0; index < length; index += 1) {
      output += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    }
    return output;
  }

  function getCurrentName() {
    const name = (ui.nameInput.value || '').trim().slice(0, 18);
    return name || 'Player';
  }

  function getCurrentRoom({ host = false } = {}) {
    const typed = sanitizeRoomCode(ui.roomInput.value);
    if (typed) return typed;
    if (host) return generateRoomCode();
    return '';
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove('visible');
    }, 2200);
  }

  function setStatus(message) {
    ui.statusText.textContent = message;
  }

  function setConnectionState(label, tone) {
    ui.networkStatus.textContent = label;
    ui.networkStatus.dataset.tone = tone;
  }

  function setBusy(isBusy) {
    ui.hostBtn.disabled = isBusy;
    ui.joinBtn.disabled = isBusy;
    ui.soloBtn.disabled = isBusy;
  }

  function updateInviteLink() {
    if (state.localMode) {
      ui.inviteInput.value = 'Solo mode does not use invite links.';
      return '';
    }
    const room = sanitizeRoomCode(ui.roomInput.value || state.roomCode);
    const server = sanitizeServerUrl(ui.serverUrlInput.value || state.serverUrl);
    const invite = room
      ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room)}&server=${encodeURIComponent(server)}`
      : '';
    ui.inviteInput.value = invite;
    return invite;
  }

  function updateStepStrip() {
    if (state.localMode) {
      ui.stepHost.classList.remove('active');
      ui.stepShare.classList.remove('active');
      ui.stepJoin.classList.add('active');
      return;
    }
    const hasRoom = Boolean(state.roomCode || sanitizeRoomCode(ui.roomInput.value));
    const playerCount = state.snapshot?.players?.length || 0;
    ui.stepHost.classList.toggle('active', !state.snapshot && !hasRoom);
    ui.stepShare.classList.toggle('active', hasRoom && playerCount < 2);
    ui.stepJoin.classList.toggle('active', playerCount >= 2);
  }

  function updateHeaderStats(snapshot = state.snapshot) {
    const count = snapshot?.playerCount || snapshot?.players?.length || 0;
    const maxPlayers = snapshot?.maxPlayers || 6;
    ui.playerCountPill.textContent = `${count} / ${maxPlayers} racers`;

    if (!snapshot) {
      ui.presenceText.textContent = 'Waiting for racers...';
      ui.goalText.textContent = `First to ${GOAL} stars`;
      ui.raceSummary.textContent = 'No racers connected yet.';
      return;
    }

    if (state.localMode) {
      ui.presenceText.textContent = 'Solo race vs bot';
      ui.goalText.textContent = 'Beat the bot to 5 stars';
      ui.raceSummary.textContent = 'Solo mode live.';
      return;
    }

    ui.presenceText.textContent = count < 2 ? `${count} racer connected` : `${count} racers connected`;

    const leader = snapshot.players
      .slice()
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))[0];

    if (leader) {
      const starsNeeded = Math.max(0, snapshot.goal - leader.score);
      ui.goalText.textContent = starsNeeded === 0
        ? `${leader.name} reached the goal`
        : `${leader.name} leads, ${starsNeeded} to win`;
      ui.raceSummary.textContent = `${leader.name} leads on ${leader.score} star${leader.score === 1 ? '' : 's'}.`;
    }
  }

  function render(snapshot) {
    state.snapshot = snapshot;
    state.roomCode = snapshot.roomCode;
    ui.roomCodeLabel.textContent = snapshot.roomCode;
    ui.roomInput.value = snapshot.roomCode;
    updateInviteLink();
    updateHeaderStats(snapshot);
    updateStepStrip();

    ui.arena.style.gridTemplateColumns = `repeat(${snapshot.width}, minmax(0, 1fr))`;
    ui.arena.innerHTML = '';

    for (let y = 0; y < snapshot.height; y += 1) {
      for (let x = 0; x < snapshot.width; x += 1) {
        const cell = document.createElement('div');
        cell.className = 'cell';

        if (snapshot.star.x === x && snapshot.star.y === y) {
          cell.classList.add('star');
        }

        const player = snapshot.players.find((entry) => entry.x === x && entry.y === y);
        if (player) {
          if (player.id === state.playerId) {
            cell.classList.add('you');
          }

          const token = document.createElement('div');
          token.className = 'token';
          token.style.background = player.color;
          token.textContent = player.name.slice(0, 1).toUpperCase();
          token.title = `${player.name}: ${player.score}`;
          cell.appendChild(token);
        }

        ui.arena.appendChild(cell);
      }
    }

    const players = [...snapshot.players].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    ui.scoreboard.innerHTML = '';

    if (!players.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No racers connected.';
      ui.scoreboard.appendChild(empty);
    }

    const leaderId = players[0]?.id || '';
    for (const player of players) {
      const item = document.createElement('li');
      const progress = Math.min(100, (player.score / snapshot.goal) * 100);
      const starsNeeded = Math.max(0, snapshot.goal - player.score);

      if (player.id === state.playerId) {
        item.classList.add('you-card');
      }
      if (player.id === leaderId) {
        item.classList.add('leading-card');
      }

      item.innerHTML = `
        <div class="player-row">
          <span class="player-badge">
            <span class="player-dot" style="background:${player.color}"></span>
            <span class="player-name-block">
              <span class="player-name">${player.name}${player.id === state.playerId ? ' (you)' : ''}</span>
              <span class="player-subline">${starsNeeded === 0 ? 'Goal reached' : `${starsNeeded} star${starsNeeded === 1 ? '' : 's'} to win`}</span>
            </span>
          </span>
          <span class="score-pill">${player.score}</span>
        </div>
        <div class="progress-track">
          <div class="progress-bar" style="width:${progress}%"></div>
        </div>
      `;
      ui.scoreboard.appendChild(item);
    }

    if (snapshot.winnerName) {
      ui.winnerText.textContent = `${snapshot.winnerName} wins the round. Hit New round for an instant rematch.`;
    } else if (state.localMode) {
      ui.winnerText.textContent = 'Solo mode live. Race the bot to five stars and cut it off from the next spawn.';
    } else if (snapshot.playerCount < 2) {
      ui.winnerText.textContent = state.isHost
        ? 'Your room is live. Copy the invite link and send it to the second player.'
        : 'Connected. Waiting for another racer to join the room.';
    } else {
      ui.winnerText.textContent = 'Live race active. Block routes, cut corners, and grab the next star first.';
    }
  }

  function send(payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    state.socket.send(JSON.stringify(payload));
  }

  function stopBotLoop() {
    if (state.botTimer) {
      window.clearInterval(state.botTimer);
      state.botTimer = null;
    }
  }

  function leaveCurrentSession() {
    stopBotLoop();
    state.localMode = false;
    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }
  }

  function getRandomOpenCell(snapshot, excluded = new Set()) {
    const occupied = new Set(excluded);
    for (const player of snapshot.players) {
      occupied.add(`${player.x},${player.y}`);
    }

    const cells = [];
    for (let y = 0; y < snapshot.height; y += 1) {
      for (let x = 0; x < snapshot.width; x += 1) {
        cells.push({ x, y });
      }
    }

    for (let index = cells.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      const temp = cells[index];
      cells[index] = cells[swap];
      cells[swap] = temp;
    }

    return cells.find((cell) => !occupied.has(`${cell.x},${cell.y}`)) || { x: 0, y: 0 };
  }

  function createSoloSnapshot(name) {
    const snapshot = {
      roomCode: 'SOLO',
      width: BOARD_SIZE,
      height: BOARD_SIZE,
      goal: GOAL,
      maxPlayers: 2,
      playerCount: 2,
      leaderId: null,
      leaderName: null,
      winnerId: null,
      winnerName: null,
      star: { x: 0, y: 0 },
      players: [],
    };

    const you = {
      id: 'solo-player',
      name,
      x: 0,
      y: 0,
      score: 0,
      color: '#68d9ff',
    };
    snapshot.players.push(you);

    const botCell = getRandomOpenCell(snapshot);
    const bot = {
      id: 'solo-bot',
      name: 'Comet Bot',
      x: botCell.x,
      y: botCell.y,
      score: 0,
      color: '#ff7c57',
    };
    snapshot.players.push(bot);

    const starCell = getRandomOpenCell(snapshot);
    snapshot.star = starCell;
    return snapshot;
  }

  function refreshSoloMeta() {
    if (!state.snapshot) return;
    state.snapshot.playerCount = state.snapshot.players.length;
    const leader = state.snapshot.players
      .slice()
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))[0] || null;
    state.snapshot.leaderId = leader?.id || null;
    state.snapshot.leaderName = leader?.name || null;
  }

  function applySoloMove(playerId, direction) {
    if (!state.localMode || !state.snapshot || state.snapshot.winnerId) return false;
    const player = state.snapshot.players.find((entry) => entry.id === playerId);
    if (!player) return false;

    let nextX = player.x;
    let nextY = player.y;
    if (direction === 'up') nextY -= 1;
    if (direction === 'down') nextY += 1;
    if (direction === 'left') nextX -= 1;
    if (direction === 'right') nextX += 1;

    if (nextX < 0 || nextY < 0 || nextX >= state.snapshot.width || nextY >= state.snapshot.height) {
      return false;
    }

    const occupied = state.snapshot.players.some(
      (other) => other.id !== playerId && other.x === nextX && other.y === nextY
    );
    if (occupied) return false;

    player.x = nextX;
    player.y = nextY;

    if (state.snapshot.star.x === player.x && state.snapshot.star.y === player.y) {
      player.score += 1;
      if (player.score >= state.snapshot.goal) {
        state.snapshot.winnerId = player.id;
        state.snapshot.winnerName = player.name;
        stopBotLoop();
      } else {
        state.snapshot.star = getRandomOpenCell(state.snapshot);
      }
    }

    refreshSoloMeta();
    render(state.snapshot);
    return true;
  }

  function getBotDirection() {
    const snapshot = state.snapshot;
    const bot = snapshot.players.find((entry) => entry.id === 'solo-bot');
    const human = snapshot.players.find((entry) => entry.id === state.playerId);
    if (!bot || !human) return null;

    const candidates = [];
    if (snapshot.star.x < bot.x) candidates.push('left');
    if (snapshot.star.x > bot.x) candidates.push('right');
    if (snapshot.star.y < bot.y) candidates.push('up');
    if (snapshot.star.y > bot.y) candidates.push('down');

    const fallback = ['up', 'down', 'left', 'right'];
    for (const direction of fallback) {
      if (!candidates.includes(direction)) candidates.push(direction);
    }

    for (const direction of candidates) {
      let nextX = bot.x;
      let nextY = bot.y;
      if (direction === 'up') nextY -= 1;
      if (direction === 'down') nextY += 1;
      if (direction === 'left') nextX -= 1;
      if (direction === 'right') nextX += 1;
      if (nextX < 0 || nextY < 0 || nextX >= snapshot.width || nextY >= snapshot.height) continue;
      if (nextX === human.x && nextY === human.y) continue;
      return direction;
    }

    return null;
  }

  function startBotLoop() {
    stopBotLoop();
    state.botTimer = window.setInterval(() => {
      if (!state.localMode || !state.snapshot || state.snapshot.winnerId) return;
      const direction = getBotDirection();
      if (direction) {
        applySoloMove('solo-bot', direction);
      }
    }, 520);
  }

  function startSoloGame() {
    const name = getCurrentName();
    leaveCurrentSession();
    state.localMode = true;
    state.isHost = false;
    state.playerId = 'solo-player';
    state.roomCode = 'SOLO';
    ui.roomInput.value = 'SOLO';
    updateInviteLink();
    setBusy(false);
    setConnectionState('Solo mode', 'online');
    setStatus('Solo mode started. Race Comet Bot to five stars.');
    state.snapshot = createSoloSnapshot(name);
    refreshSoloMeta();
    render(state.snapshot);
    startBotLoop();
    showToast('Solo race started.');
  }

  function connect(mode) {
    const name = getCurrentName();
    const room = getCurrentRoom({ host: mode === 'host' });
    const serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);

    if (!room) {
      setStatus('Enter a room code to join, or host a new room to generate one.');
      setConnectionState('Needs room', 'error');
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.name, name);
    window.localStorage.setItem(STORAGE_KEYS.serverUrl, serverUrl);

    leaveCurrentSession();

    state.isHost = mode === 'host';
    state.roomCode = room;
    state.snapshot = null;
    ui.roomInput.value = room;
    ui.serverUrlInput.value = serverUrl;
    updateInviteLink();
    updateStepStrip();
    setBusy(true);
    setStatus(mode === 'host' ? `Creating room ${room}...` : `Joining room ${room}...`);
    setConnectionState('Connecting...', 'connecting');

    const socket = new WebSocket(serverUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      if (state.socket !== socket) return;
      send({ type: 'join', room, name, mode });
    });

    socket.addEventListener('message', (event) => {
      if (state.socket !== socket) return;
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (message.type === 'welcome') {
        state.playerId = message.playerId;
        state.roomCode = message.roomCode;
        setBusy(false);
        setConnectionState(`Live in ${message.roomCode}`, 'online');
        setStatus(message.message || 'Connected.');
        render(message.state);
        if (state.isHost) {
          showToast('Room live. Copy the invite and send it.');
        }
        return;
      }

      if (message.type === 'state') {
        render(message.state);
        setConnectionState(`Live in ${message.state.roomCode}`, 'online');
        setBusy(false);
        return;
      }

      if (message.type === 'error') {
        setBusy(false);
        setConnectionState('Connection issue', 'error');
        setStatus(message.message || 'Something went wrong.');
        showToast(message.message || 'Something went wrong.');
      }
    });

    socket.addEventListener('close', () => {
      if (state.socket !== socket) return;
      setBusy(false);
      setConnectionState('Offline', 'offline');
      setStatus('Disconnected from the game server.');
    });

    socket.addEventListener('error', () => {
      if (state.socket !== socket) return;
      setBusy(false);
      setConnectionState('Connection issue', 'error');
      setStatus('Could not reach the game server. Check the connection settings.');
    });
  }

  async function copyText(text, successMessage, emptyMessage) {
    if (!text) {
      showToast(emptyMessage);
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage);
    } catch (_) {
      showToast('Clipboard access was blocked in this browser.');
    }
  }

  ui.hostBtn.addEventListener('click', () => connect('host'));
  ui.joinBtn.addEventListener('click', () => connect('join'));
  ui.soloBtn.addEventListener('click', startSoloGame);
  ui.resetBtn.addEventListener('click', () => {
    if (state.localMode) {
      startSoloGame();
      return;
    }
    send({ type: 'reset' });
  });
  ui.copyBtn.addEventListener('click', async () => {
    await copyText(updateInviteLink(), 'Invite link copied.', 'Host or join a room first.');
  });
  ui.copyCodeBtn.addEventListener('click', async () => {
    const room = state.roomCode || sanitizeRoomCode(ui.roomInput.value);
    await copyText(room, `Room code ${room} copied.`, 'No room code yet.');
  });

  ui.nameInput.addEventListener('input', () => {
    window.localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim().slice(0, 18));
  });

  ui.roomInput.addEventListener('input', () => {
    ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
    updateInviteLink();
    updateStepStrip();
  });

  document.querySelectorAll('[data-direction]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.localMode) {
        applySoloMove(state.playerId, button.dataset.direction);
        return;
      }
      send({ type: 'move', direction: button.dataset.direction });
    });
  });

  window.addEventListener('keydown', (event) => {
    const mapping = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      a: 'left',
      s: 'down',
      d: 'right',
    };

    const direction = mapping[event.key];
    if (!direction) return;
    event.preventDefault();
    if (state.localMode) {
      applySoloMove(state.playerId, direction);
      return;
    }
    send({ type: 'move', direction });
  });

  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const rememberedName = window.localStorage.getItem(STORAGE_KEYS.name) || '';
  const rememberedServer = window.localStorage.getItem(STORAGE_KEYS.serverUrl) || '';
  const defaultServerUrl = isLocal
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname || 'localhost'}:8081`
    : PROD_SERVER_URL;

  state.serverUrl = sanitizeServerUrl(query.get('server') || rememberedServer || defaultServerUrl);

  ui.nameInput.value = rememberedName;
  ui.roomInput.value = sanitizeRoomCode(query.get('room') || '');
  ui.serverUrlInput.value = state.serverUrl;
  updateInviteLink();
  updateHeaderStats();
  updateStepStrip();
  setConnectionState('Offline', 'offline');

  if (query.get('room')) {
    setStatus(`Invite loaded for room ${ui.roomInput.value}. Enter a name, then press Join existing room.`);
  }

  ui.arena.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, minmax(0, 1fr))`;
  for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    ui.arena.appendChild(cell);
  }
})();
