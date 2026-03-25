(() => {
  'use strict';

  const STORAGE_KEY = 'starSprint.serverUrl';
  const query = new URLSearchParams(window.location.search);
  const BOARD_SIZE = 12;
  const PROD_SERVER_URL = 'wss://star-sprint-backend.onrender.com';
  const state = {
    roomCode: '',
    playerId: '',
    socket: null,
    snapshot: null,
    serverUrl: '',
  };

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    statusText: document.getElementById('statusText'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    scoreboard: document.getElementById('scoreboard'),
    arena: document.getElementById('arena'),
    winnerText: document.getElementById('winnerText'),
    networkStatus: document.getElementById('networkStatus'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    copyBtn: document.getElementById('copyBtn'),
    resetBtn: document.getElementById('resetBtn'),
  };

  function setStatus(message) {
    ui.statusText.textContent = message;
  }

  function setNetworkStatus(message) {
    ui.networkStatus.textContent = message;
  }

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'PUBLIC';
  }

  function sanitizeServerUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return state.serverUrl;
    if (/^wss?:\/\//i.test(trimmed)) return trimmed;
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function send(payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    state.socket.send(JSON.stringify(payload));
  }

  function render(snapshot) {
    state.snapshot = snapshot;
    ui.roomCodeLabel.textContent = snapshot.roomCode;
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
          cell.classList.add('player');
          cell.style.setProperty('--player-color', player.color);
          cell.title = `${player.name}: ${player.score}`;
          if (player.id === state.playerId) {
            cell.classList.add('you');
          }
        }

        ui.arena.appendChild(cell);
      }
    }

    const players = [...snapshot.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    ui.scoreboard.innerHTML = '';
    for (const player of players) {
      const item = document.createElement('li');
      item.innerHTML = `
        <span class="player-badge">
          <span class="player-dot" style="background:${player.color}"></span>
          <span>${player.name}${player.id === state.playerId ? ' (you)' : ''}</span>
        </span>
        <strong>${player.score}</strong>
      `;
      ui.scoreboard.appendChild(item);
    }

    if (snapshot.winnerName) {
      ui.winnerText.textContent = `${snapshot.winnerName} wins the round. Start a new round to keep going.`;
    } else if (snapshot.players.length < 2) {
      ui.winnerText.textContent = 'Waiting for more players to join this room.';
    } else {
      ui.winnerText.textContent = 'Collect five stars before anyone else.';
    }
  }

  function connect(mode) {
    const room = sanitizeRoomCode(ui.roomInput.value);
    const name = (ui.nameInput.value || 'Player').trim().slice(0, 18);
    const serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);

    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }

    ui.roomInput.value = room;
    ui.serverUrlInput.value = serverUrl;
    state.serverUrl = serverUrl;
    window.localStorage.setItem(STORAGE_KEY, serverUrl);
    setStatus(`Connecting to ${room}...`);
    setNetworkStatus('Connecting...');

    const socket = new WebSocket(serverUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      send({ type: 'join', room, name, mode });
    });

    socket.addEventListener('message', (event) => {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (message.type === 'welcome') {
        state.playerId = message.playerId;
        state.roomCode = message.roomCode;
        render(message.state);
        setStatus(message.message || 'Connected.');
        setNetworkStatus(`Online ${message.roomCode}`);
        return;
      }

      if (message.type === 'state') {
        render(message.state);
        return;
      }

      if (message.type === 'error') {
        setStatus(message.message || 'Something went wrong.');
      }
    });

    socket.addEventListener('close', () => {
      setNetworkStatus('Offline');
      setStatus('Disconnected from the game server.');
    });

    socket.addEventListener('error', () => {
      setStatus('Could not reach the game server. Check the server URL.');
    });
  }

  function move(direction) {
    send({ type: 'move', direction });
  }

  ui.hostBtn.addEventListener('click', () => connect('host'));
  ui.joinBtn.addEventListener('click', () => connect('join'));
  ui.resetBtn.addEventListener('click', () => send({ type: 'reset' }));
  ui.copyBtn.addEventListener('click', async () => {
    const room = sanitizeRoomCode(ui.roomInput.value || state.roomCode);
    const serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    const invite = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room)}&server=${encodeURIComponent(serverUrl)}`;
    await navigator.clipboard.writeText(invite);
    setStatus('Invite link copied to the clipboard.');
  });

  document.querySelectorAll('[data-direction]').forEach((button) => {
    button.addEventListener('click', () => move(button.dataset.direction));
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
    move(direction);
  });

  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const defaultServerUrl = isLocal
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname || 'localhost'}:8081`
    : PROD_SERVER_URL;
  const rememberedServer = window.localStorage.getItem(STORAGE_KEY) || '';
  state.serverUrl = sanitizeServerUrl(query.get('server') || rememberedServer || defaultServerUrl);

  ui.roomInput.value = sanitizeRoomCode(query.get('room') || 'PUBLIC');
  ui.serverUrlInput.value = state.serverUrl;
  ui.arena.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, minmax(0, 1fr))`;
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    ui.arena.appendChild(cell);
  }
})();
