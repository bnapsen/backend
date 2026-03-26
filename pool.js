(() => {
  'use strict';

  const STORAGE_KEYS = {
    name: 'miniPoolShowdown.name',
    serverUrl: 'miniPoolShowdown.serverUrl',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const query = new URLSearchParams(window.location.search);

  const canvas = document.getElementById('poolTable');
  const ctx = canvas.getContext('2d');

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    rackLabel: document.getElementById('rackLabel'),
    turnLabel: document.getElementById('turnLabel'),
    phaseLabel: document.getElementById('phaseLabel'),
    whiteScore: document.getElementById('whiteScore'),
    blackScore: document.getElementById('blackScore'),
    whiteMeta: document.getElementById('whiteMeta'),
    blackMeta: document.getElementById('blackMeta'),
    whiteCard: document.getElementById('whiteCard'),
    blackCard: document.getElementById('blackCard'),
    shotCount: document.getElementById('shotCount'),
    matchMeta: document.getElementById('matchMeta'),
    turnNote: document.getElementById('turnNote'),
    restartBtn: document.getElementById('restartBtn'),
    playerList: document.getElementById('playerList'),
    presenceText: document.getElementById('presenceText'),
    eventList: document.getElementById('eventList'),
    eventSummary: document.getElementById('eventSummary'),
    powerFill: document.getElementById('powerFill'),
    powerText: document.getElementById('powerText'),
    tableStage: document.getElementById('tableStage'),
  };

  const state = {
    socket: null,
    snapshot: null,
    yourColor: null,
    roomCode: '',
    playerId: '',
    serverUrl: '',
    statusMessage: '',
    aiming: false,
    pointerId: null,
    pointer: { x: 0, y: 0 },
    power: 0,
    view: {
      width: 0,
      height: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      dpr: 1,
    },
  };

  function capitalize(value) {
    return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sanitizeRoomCode(raw) {
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);
  }

  function normalizeServerUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) {
      return defaultServerUrl();
    }
    if (/^wss?:\/\//i.test(value)) {
      return value;
    }
    if (/^https?:\/\//i.test(value)) {
      return value.replace(/^http/i, 'ws');
    }
    return value;
  }

  function defaultServerUrl() {
    const explicit = query.get('server');
    if (explicit) {
      return normalizeServerUrl(explicit);
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'ws://127.0.0.1:8081';
    }
    return PROD_SERVER_URL;
  }

  function currentServerUrl() {
    const value = normalizeServerUrl(ui.serverUrlInput.value || state.serverUrl || defaultServerUrl());
    state.serverUrl = value;
    return value;
  }

  function activeTable() {
    return state.snapshot && state.snapshot.table
      ? state.snapshot.table
      : { width: 1000, height: 560, rail: 46, pocketR: 28 };
  }

  function isConnected() {
    return Boolean(state.socket && state.socket.readyState === WebSocket.OPEN);
  }

  function canShoot() {
    if (!state.snapshot || !state.yourColor || !isConnected()) {
      return false;
    }
    if (state.snapshot.winner || state.snapshot.drawReason) {
      return false;
    }
    if (state.snapshot.moving) {
      return false;
    }
    const players = Array.isArray(state.snapshot.players) ? state.snapshot.players : [];
    if (players.length < 2) {
      return false;
    }
    return state.snapshot.turn === state.yourColor;
  }

  function setNetworkStatus(tone, text) {
    ui.networkStatus.dataset.tone = tone;
    ui.networkStatus.textContent = text;
  }

  function setStatus(message) {
    state.statusMessage = message || 'Host a duel or join by room code. The first player to arrive waits at the live table for a challenger.';
    ui.statusText.textContent = state.statusMessage;
  }

  function savePrefs() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim().slice(0, 18));
    localStorage.setItem(STORAGE_KEYS.serverUrl, currentServerUrl());
  }

  function copyToClipboard(value, successMessage) {
    const text = String(value || '').trim();
    if (!text) {
      setStatus('There is nothing to copy yet.');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => setStatus(successMessage))
        .catch(() => setStatus('Copy failed. You can still select the text manually.'));
      return;
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    try {
      document.execCommand('copy');
      setStatus(successMessage);
    } catch (error) {
      setStatus('Copy failed. You can still select the text manually.');
    }
    helper.remove();
  }

  function buildInviteUrl() {
    if (!state.roomCode) {
      return '';
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomCode);
    const serverUrl = currentServerUrl();
    if (serverUrl !== defaultServerUrl()) {
      url.searchParams.set('server', serverUrl);
    } else {
      url.searchParams.delete('server');
    }
    return url.toString();
  }

  function sendJson(payload) {
    if (!isConnected()) {
      setStatus('Connect to a live table first.');
      return false;
    }
    state.socket.send(JSON.stringify(payload));
    return true;
  }

  function activeCue() {
    if (!state.snapshot || !Array.isArray(state.snapshot.balls)) {
      return null;
    }
    return state.snapshot.balls.find((ball) => ball.kind === 'cue' && !ball.sunk) || null;
  }

  function resizeCanvas() {
    const stageRect = ui.tableStage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const rect = canvasRect.width > 0 && canvasRect.height > 0 ? canvasRect : stageRect;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = '';
    canvas.style.height = '';

    const table = activeTable();
    const scale = Math.min(rect.width / table.width, rect.height / table.height);
    state.view = {
      width: rect.width,
      height: rect.height,
      scale,
      offsetX: (rect.width - table.width * scale) / 2,
      offsetY: (rect.height - table.height * scale) / 2,
      dpr,
    };
  }

  function boardPointFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const table = activeTable();
    const x = (clientX - rect.left - state.view.offsetX) / state.view.scale;
    const y = (clientY - rect.top - state.view.offsetY) / state.view.scale;
    if (x < 0 || x > table.width || y < 0 || y > table.height) {
      return null;
    }
    return { x, y };
  }

  function updatePowerUi() {
    ui.powerFill.style.width = `${Math.round(state.power * 100)}%`;
    if (state.aiming && canShoot()) {
      ui.powerText.textContent = `Release to shoot at ${Math.max(5, Math.round(state.power * 100))}% power.`;
      return;
    }
    if (!state.snapshot) {
      ui.powerText.textContent = 'Open a live table to aim the cue.';
      return;
    }
    if (state.snapshot.winner || state.snapshot.drawReason) {
      ui.powerText.textContent = 'This match is finished. Start a new one for another race.';
      return;
    }
    if (state.snapshot.moving) {
      ui.powerText.textContent = 'Balls are still rolling. Wait for the table to settle.';
      return;
    }
    if (canShoot()) {
      ui.powerText.textContent = 'Drag back from the cue ball, then release to shoot.';
      return;
    }
    ui.powerText.textContent = 'Watch the live table until it is your turn.';
  }

  function renderPlayers() {
    const players = Array.isArray(state.snapshot && state.snapshot.players)
      ? state.snapshot.players
      : [];
    ui.presenceText.textContent = `${players.length}/2 seats filled`;
    if (!players.length) {
      ui.playerList.innerHTML = '<div class="empty-state">Host a duel and the live seats will appear here.</div>';
      return;
    }

    ui.playerList.innerHTML = ['white', 'black'].map((color) => {
      const player = players.find((entry) => entry.color === color);
      if (!player) {
        return `
          <article class="player-card">
            <strong>${capitalize(color)} seat open</strong>
            <p>Waiting for a challenger to take the ${color} cue.</p>
            <div class="chips"><span class="chip">Open seat</span></div>
          </article>
        `;
      }
      const chips = [
        player.id === state.playerId ? '<span class="chip">You</span>' : '',
        state.snapshot && state.snapshot.turn === color && !state.snapshot.winner && !state.snapshot.drawReason
          ? '<span class="chip">At table</span>'
          : '',
      ].filter(Boolean).join('');
      return `
        <article class="player-card">
          <strong>${player.name}</strong>
          <p>${capitalize(color)} cue</p>
          <div class="chips">${chips || '<span class="chip">Ready</span>'}</div>
        </article>
      `;
    }).join('');
  }

  function renderEvents() {
    const events = Array.isArray(state.snapshot && state.snapshot.events) ? state.snapshot.events : [];
    ui.eventSummary.textContent = events.length
      ? 'Latest rack and shot summaries from the shared table.'
      : 'The latest racks and shot results will show here.';
    if (!events.length) {
      ui.eventList.innerHTML = '<div class="empty-state">Break the first rack and the table feed will start updating.</div>';
      return;
    }
    ui.eventList.innerHTML = events.map((event) => `
      <article class="event-item">
        <strong>${event.text}</strong>
      </article>
    `).join('');
  }

  function renderSummary() {
    const snapshot = state.snapshot;
    const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
    const byColor = new Map(players.map((player) => [player.color, player]));

    ui.roomCodeLabel.textContent = state.roomCode || '-';
    ui.rackLabel.textContent = snapshot ? `${snapshot.rackNumber} / ${snapshot.maxRacks}` : '1 / 3';
    ui.turnLabel.textContent = snapshot
      ? snapshot.winner
        ? `${capitalize(snapshot.winner)} wins`
        : snapshot.drawReason
          ? 'Match drawn'
          : `${capitalize(snapshot.turn)} to shoot`
      : 'Waiting to start';
    ui.phaseLabel.textContent = snapshot
      ? snapshot.status
      : 'Open a table to begin.';

    ui.whiteScore.textContent = snapshot ? String(snapshot.scores.white) : '0';
    ui.blackScore.textContent = snapshot ? String(snapshot.scores.black) : '0';
    ui.whiteMeta.textContent = byColor.get('white')
      ? `${byColor.get('white').name}${byColor.get('white').id === state.playerId ? ' • You' : ''}`
      : 'Waiting for seat';
    ui.blackMeta.textContent = byColor.get('black')
      ? `${byColor.get('black').name}${byColor.get('black').id === state.playerId ? ' • You' : ''}`
      : 'Waiting for seat';
    ui.whiteCard.classList.toggle('active', Boolean(snapshot && snapshot.turn === 'white' && !snapshot.winner && !snapshot.drawReason));
    ui.blackCard.classList.toggle('active', Boolean(snapshot && snapshot.turn === 'black' && !snapshot.winner && !snapshot.drawReason));

    ui.shotCount.textContent = snapshot ? `${snapshot.shotCount} shot${snapshot.shotCount === 1 ? '' : 's'}` : '0 shots';
    ui.matchMeta.textContent = snapshot
      ? snapshot.winner
        ? `Final score ${snapshot.scores.white}-${snapshot.scores.black}`
        : snapshot.drawReason
          ? `Drawn ${snapshot.scores.white}-${snapshot.scores.black}`
          : 'Three-rack showdown'
      : 'Three-rack showdown';

    if (!snapshot) {
      ui.turnNote.textContent = 'Pocket a scoring ball to stay at the table. Scratches and jammers pass control.';
      ui.modePill.textContent = 'No table running';
      return;
    }

    if (snapshot.winner) {
      ui.turnNote.textContent = `${capitalize(snapshot.winner)} wins the showdown ${snapshot.scores.white}-${snapshot.scores.black}.`;
      ui.modePill.textContent = 'Match finished';
    } else if (snapshot.drawReason) {
      ui.turnNote.textContent = `The showdown ends level at ${snapshot.scores.white}-${snapshot.scores.black}.`;
      ui.modePill.textContent = 'Match drawn';
    } else if (snapshot.moving) {
      ui.turnNote.textContent = 'Balls are live. Wait for the table to settle before the next shot.';
      ui.modePill.textContent = 'Balls in motion';
    } else if (players.length < 2) {
      ui.turnNote.textContent = 'One player is at the table. Share the invite to bring in a second cue.';
      ui.modePill.textContent = 'Waiting for opponent';
    } else if (canShoot()) {
      ui.turnNote.textContent = 'You have the cue. Pull back on the canvas and release to shoot.';
      ui.modePill.textContent = 'Your turn';
    } else {
      ui.turnNote.textContent = `${capitalize(snapshot.turn)} is lining up the next shot.`;
      ui.modePill.textContent = 'Live duel';
    }
  }

  function renderUi() {
    ui.inviteInput.value = state.roomCode ? buildInviteUrl() : '';
    ui.copyBtn.disabled = !state.roomCode;
    ui.copyCodeBtn.disabled = !state.roomCode;
    ui.restartBtn.disabled = !isConnected();
    renderSummary();
    renderPlayers();
    renderEvents();
    updatePowerUi();
  }

  function setDrawTransform() {
    const { dpr, scale, offsetX, offsetY } = state.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.view.width, state.view.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr, offsetY * dpr);
  }

  function drawTable() {
    const table = activeTable();
    const feltX = table.rail;
    const feltY = table.rail;
    const feltW = table.width - table.rail * 2;
    const feltH = table.height - table.rail * 2;
    const breakX = feltX + feltW * 0.27;

    ctx.fillStyle = '#3e2817';
    ctx.fillRect(0, 0, table.width, table.height);

    const woodGradient = ctx.createLinearGradient(0, 0, table.width, table.height);
    woodGradient.addColorStop(0, '#5e3d22');
    woodGradient.addColorStop(0.5, '#2c1b10');
    woodGradient.addColorStop(1, '#654327');
    ctx.fillStyle = woodGradient;
    ctx.fillRect(0, 0, table.width, table.height);

    const feltGradient = ctx.createLinearGradient(feltX, feltY, feltX, feltY + feltH);
    feltGradient.addColorStop(0, '#138b93');
    feltGradient.addColorStop(0.5, '#0f6470');
    feltGradient.addColorStop(1, '#0a4551');
    ctx.fillStyle = feltGradient;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    const sheen = ctx.createRadialGradient(table.width * 0.45, table.height * 0.2, 40, table.width * 0.45, table.height * 0.3, table.width * 0.5);
    sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    ctx.strokeStyle = 'rgba(244, 246, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(breakX, feltY + 14);
    ctx.lineTo(breakX, feltY + feltH - 14);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(breakX, table.height / 2, 62, Math.PI / 2, -Math.PI / 2, true);
    ctx.stroke();

    for (const pocket of pocketCoords(table)) {
      const pocketGradient = ctx.createRadialGradient(pocket.x - 4, pocket.y - 4, 1, pocket.x, pocket.y, table.pocketR);
      pocketGradient.addColorStop(0, '#505050');
      pocketGradient.addColorStop(1, '#050505');
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, table.pocketR, 0, Math.PI * 2);
      ctx.fillStyle = pocketGradient;
      ctx.fill();
    }
  }

  function pocketCoords(table = activeTable()) {
    const minX = table.rail;
    const minY = table.rail;
    const maxX = table.width - table.rail;
    const maxY = table.height - table.rail;
    return [
      { x: minX, y: minY },
      { x: (minX + maxX) / 2, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: (minX + maxX) / 2, y: maxY },
      { x: maxX, y: maxY },
    ];
  }

  function shade(hex, percent) {
    const value = hex.replace('#', '');
    const num = Number.parseInt(value, 16);
    const amt = Math.round(2.55 * percent);
    const r = clamp((num >> 16) + amt, 0, 255);
    const g = clamp(((num >> 8) & 0x00ff) + amt, 0, 255);
    const b = clamp((num & 0x0000ff) + amt, 0, 255);
    return `#${(0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  function drawBall(ball) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.4, 1, ball.x, ball.y, ball.r * 1.35);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.22, ball.kind === 'cue' ? '#f7f7f7' : ball.color);
    gradient.addColorStop(1, ball.kind === 'cue' ? '#dbdbdb' : shade(ball.color, -30));
    ctx.fillStyle = gradient;
    ctx.fill();

    if (ball.kind === 'target' || ball.kind === 'crown') {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = ball.kind === 'crown' ? 'rgba(32, 22, 6, 0.85)' : 'rgba(255,255,255,0.9)';
      ctx.fill();
    }

    if (ball.kind === 'blocker') {
      ctx.strokeStyle = 'rgba(255, 106, 106, 0.88)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ball.x - ball.r * 0.55, ball.y - ball.r * 0.55);
      ctx.lineTo(ball.x + ball.r * 0.55, ball.y + ball.r * 0.55);
      ctx.moveTo(ball.x + ball.r * 0.55, ball.y - ball.r * 0.55);
      ctx.lineTo(ball.x - ball.r * 0.55, ball.y + ball.r * 0.55);
      ctx.stroke();
    }

    if (ball.label) {
      ctx.fillStyle = ball.kind === 'crown' ? '#ffeaa8' : '#0f1822';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(10, Math.round(ball.r * 0.95))}px system-ui`;
      ctx.fillText(ball.label, ball.x, ball.y + 0.5);
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function drawBalls() {
    if (!state.snapshot || !Array.isArray(state.snapshot.balls)) {
      return;
    }
    for (const ball of state.snapshot.balls) {
      if (!ball.sunk) {
        drawBall(ball);
      }
    }
  }

  function drawAimLine() {
    if (!state.aiming || !canShoot()) {
      return;
    }
    const cue = activeCue();
    if (!cue) {
      return;
    }
    const dx = state.pointer.x - cue.x;
    const dy = state.pointer.y - cue.y;
    const distance = Math.min(Math.hypot(dx, dy), 220);
    if (distance < 2) {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(cue.x - dx, cue.y - dy);
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([9, 7]);
    ctx.stroke();
    ctx.setLineDash([]);

    const magnitude = Math.hypot(dx, dy) || 1;
    const ux = dx / magnitude;
    const uy = dy / magnitude;
    const cueLength = 158;
    const cueStartX = cue.x + ux * (24 + distance * 0.15);
    const cueStartY = cue.y + uy * (24 + distance * 0.15);

    ctx.beginPath();
    ctx.moveTo(cueStartX, cueStartY);
    ctx.lineTo(cueStartX + ux * cueLength, cueStartY + uy * cueLength);
    ctx.strokeStyle = '#f0b870';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawOverlay() {
    const snapshot = state.snapshot;
    const table = activeTable();
    let title = '';
    let subtitle = '';

    if (!snapshot) {
      title = 'Mini Pool Showdown';
      subtitle = 'Open a live table to start playing.';
    } else if (snapshot.winner) {
      title = `${capitalize(snapshot.winner)} wins`;
      subtitle = `Final score ${snapshot.scores.white} - ${snapshot.scores.black}`;
    } else if (snapshot.drawReason) {
      title = 'Match drawn';
      subtitle = `Final score ${snapshot.scores.white} - ${snapshot.scores.black}`;
    } else if ((snapshot.players || []).length < 2) {
      title = 'Waiting for challenger';
      subtitle = 'Share the invite link to fill the second seat.';
    }

    if (!title) {
      return;
    }

    const boxW = 360;
    const boxH = 132;
    const boxX = table.width / 2 - boxW / 2;
    const boxY = table.height / 2 - boxH / 2;

    ctx.fillStyle = 'rgba(4, 9, 16, 0.72)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = '#f5f8ff';
    ctx.textAlign = 'center';
    ctx.font = '700 28px "Space Grotesk", sans-serif';
    ctx.fillText(title, table.width / 2, boxY + 48);
    ctx.font = '500 17px Inter, sans-serif';
    ctx.fillStyle = 'rgba(238,245,255,0.8)';
    ctx.fillText(subtitle, table.width / 2, boxY + 84);
  }

  function drawFrame() {
    resizeCanvas();
    setDrawTransform();
    drawTable();
    drawBalls();
    drawAimLine();
    drawOverlay();
    requestAnimationFrame(drawFrame);
  }

  function handleSnapshot(payload) {
    state.snapshot = payload.snapshot || null;
    if (state.snapshot && state.snapshot.roomCode) {
      state.roomCode = sanitizeRoomCode(state.snapshot.roomCode);
      ui.roomInput.value = state.roomCode;
    }
    setNetworkStatus('online', 'Online');
    setStatus(payload.message || (state.snapshot && state.snapshot.status) || 'Connected to the live table.');
    renderUi();
  }

  function connect(mode) {
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (mode === 'join' && !roomCode) {
      setStatus('Enter a room code before joining.');
      return;
    }

    savePrefs();
    const socket = new WebSocket(currentServerUrl());
    const previous = state.socket;
    if (previous && previous.readyState < WebSocket.CLOSING) {
      previous.close();
    }

    state.socket = socket;
    state.snapshot = null;
    state.playerId = '';
    state.yourColor = null;
    if (mode === 'host') {
      state.roomCode = roomCode;
    }
    setNetworkStatus('connecting', 'Connecting');
    setStatus(`${mode === 'host' ? 'Hosting' : 'Joining'} a live table...`);
    renderUi();

    socket.addEventListener('open', () => {
      if (state.socket !== socket) {
        return;
      }
      socket.send(JSON.stringify({
        action: 'join',
        game: 'mini-pool',
        mode,
        roomCode,
        name: ui.nameInput.value.trim().slice(0, 18) || 'Guest',
      }));
    });

    socket.addEventListener('message', (event) => {
      if (state.socket !== socket) {
        return;
      }
      let payload;
      try {
        payload = JSON.parse(String(event.data));
      } catch (error) {
        setStatus('The table sent back an unreadable update.');
        return;
      }

      if (payload.type === 'welcome') {
        state.playerId = payload.playerId || '';
        state.yourColor = payload.color || null;
        state.roomCode = sanitizeRoomCode(payload.roomCode || roomCode);
        ui.roomInput.value = state.roomCode;
        renderUi();
        return;
      }

      if (payload.type === 'state') {
        handleSnapshot(payload);
        return;
      }

      if (payload.type === 'error') {
        setStatus(payload.message || 'The table rejected that action.');
      }
    });

    socket.addEventListener('close', () => {
      if (state.socket !== socket) {
        return;
      }
      state.socket = null;
      setNetworkStatus('offline', 'Offline');
      setStatus('The live table disconnected. Rejoin when you are ready.');
      renderUi();
    });

    socket.addEventListener('error', () => {
      if (state.socket !== socket) {
        return;
      }
      setStatus('The live table hit a network error.');
    });
  }

  function beginAim(event) {
    if (!canShoot()) {
      return;
    }
    const point = boardPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    state.aiming = true;
    state.pointerId = event.pointerId;
    state.pointer = point;
    state.power = 0;
    updatePowerUi();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore pointer capture issues.
    }
  }

  function moveAim(event) {
    if (!state.aiming || event.pointerId !== state.pointerId) {
      return;
    }
    const point = boardPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    state.pointer = point;
    const cue = activeCue();
    if (cue) {
      state.power = clamp(Math.hypot(cue.x - point.x, cue.y - point.y) / 220, 0, 1);
    }
    updatePowerUi();
  }

  function finishAim(event) {
    if (!state.aiming || event.pointerId !== state.pointerId) {
      return;
    }
    const point = boardPointFromClient(event.clientX, event.clientY);
    const cue = activeCue();
    state.aiming = false;
    state.pointerId = null;
    state.power = 0;

    if (!cue || !point || !canShoot()) {
      updatePowerUi();
      return;
    }

    const vectorX = cue.x - point.x;
    const vectorY = cue.y - point.y;
    if (Math.hypot(vectorX, vectorY) < 6) {
      updatePowerUi();
      return;
    }

    if (sendJson({
      action: 'shoot',
      vectorX,
      vectorY,
    })) {
      setStatus('Shot sent. Waiting for the table physics to resolve.');
    }
    updatePowerUi();
  }

  function hydrate() {
    ui.nameInput.value = (localStorage.getItem(STORAGE_KEYS.name) || '').slice(0, 18);
    ui.serverUrlInput.value = normalizeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || defaultServerUrl());
    ui.roomInput.value = sanitizeRoomCode(query.get('room') || '');
    state.serverUrl = ui.serverUrlInput.value;
    state.roomCode = sanitizeRoomCode(ui.roomInput.value);
    setNetworkStatus('offline', 'Offline');
    setStatus('Host a duel or join by room code. The first player to arrive waits at the live table for a challenger.');
    renderUi();
  }

  ui.hostBtn.addEventListener('click', () => connect('host'));
  ui.joinBtn.addEventListener('click', () => connect('join'));
  ui.copyBtn.addEventListener('click', () => copyToClipboard(ui.inviteInput.value, 'Invite link copied.'));
  ui.copyCodeBtn.addEventListener('click', () => copyToClipboard(state.roomCode, 'Room code copied.'));
  ui.restartBtn.addEventListener('click', () => {
    sendJson({ action: 'restart' });
  });
  ui.nameInput.addEventListener('change', savePrefs);
  ui.serverUrlInput.addEventListener('change', () => {
    ui.serverUrlInput.value = normalizeServerUrl(ui.serverUrlInput.value);
    savePrefs();
    renderUi();
  });
  ui.roomInput.addEventListener('input', () => {
    ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
    state.roomCode = sanitizeRoomCode(ui.roomInput.value);
    renderUi();
  });

  canvas.addEventListener('pointerdown', beginAim);
  canvas.addEventListener('pointermove', moveAim);
  canvas.addEventListener('pointerup', finishAim);
  canvas.addEventListener('pointercancel', finishAim);
  window.addEventListener('resize', resizeCanvas);

  hydrate();
  drawFrame();

  if (state.roomCode) {
    connect('join');
  }
})();
