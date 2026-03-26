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
    openLoungeBtn: document.getElementById('openLoungeBtn'),
    shareLoungeBtn: document.getElementById('shareLoungeBtn'),
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
    aimAngle: 0,
    aimAnchorDistance: 0,
    view: {
      width: 0,
      height: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      dpr: 1,
    },
  };

  const CUE_UI = Object.freeze({
    anchorCap: 128,
    powerRange: 178,
    minPower: 0.04,
    cuePullback: 86,
    cueLength: 248,
    guideLength: 640,
    guideBounceLength: 110,
    gripRadius: 30,
  });

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

  function openArcadeLounge(autoShare) {
    if (!window.NovaArcadeLoungeBridge) {
      setStatus('Arcade Lounge bridge is not available.');
      return;
    }
    if (autoShare && !state.roomCode) {
      setStatus('Host or join a live duel before sharing it to the lounge.');
      return;
    }
    window.NovaArcadeLoungeBridge.open({
      name: ui.nameInput.value.trim().slice(0, 18) || 'Guest',
      serverUrl: currentServerUrl(),
      gameType: 'mini-pool',
      roomCode: state.roomCode,
      inviteUrl: state.roomCode ? buildInviteUrl() : '',
      note: state.roomCode ? `Join my Mini Pool Showdown duel in room ${state.roomCode}.` : '',
      autoShare: Boolean(autoShare),
    });
    setStatus(autoShare ? 'Opening Arcade Lounge with your duel ready to share.' : 'Opening Arcade Lounge in a new tab.');
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

  function feltBounds(table = activeTable()) {
    return {
      minX: table.rail,
      minY: table.rail,
      maxX: table.width - table.rail,
      maxY: table.height - table.rail,
    };
  }

  function cueDirection() {
    return {
      x: Math.cos(state.aimAngle),
      y: Math.sin(state.aimAngle),
    };
  }

  function reflectDirection(direction, normal) {
    const dot = direction.x * normal.x + direction.y * normal.y;
    return {
      x: direction.x - 2 * dot * normal.x,
      y: direction.y - 2 * dot * normal.y,
    };
  }

  function rayCircleIntersection(origin, direction, center, radius) {
    const offsetX = origin.x - center.x;
    const offsetY = origin.y - center.y;
    const projection = offsetX * direction.x + offsetY * direction.y;
    const discriminant = projection * projection - (offsetX * offsetX + offsetY * offsetY - radius * radius);
    if (discriminant < 0) {
      return null;
    }
    const distance = -projection - Math.sqrt(discriminant);
    if (distance <= 0) {
      return null;
    }
    return distance;
  }

  function projectAimGuide(cue, direction) {
    const bounds = feltBounds();
    const maxDistance = CUE_UI.guideLength;
    let bestHit = {
      type: 'open',
      distance: maxDistance,
      point: {
        x: cue.x + direction.x * maxDistance,
        y: cue.y + direction.y * maxDistance,
      },
      normal: null,
    };

    const candidates = [];
    if (direction.x > 0.0001) {
      const distance = (bounds.maxX - cue.r - cue.x) / direction.x;
      candidates.push({ distance, normal: { x: -1, y: 0 } });
    } else if (direction.x < -0.0001) {
      const distance = (bounds.minX + cue.r - cue.x) / direction.x;
      candidates.push({ distance, normal: { x: 1, y: 0 } });
    }
    if (direction.y > 0.0001) {
      const distance = (bounds.maxY - cue.r - cue.y) / direction.y;
      candidates.push({ distance, normal: { x: 0, y: -1 } });
    } else if (direction.y < -0.0001) {
      const distance = (bounds.minY + cue.r - cue.y) / direction.y;
      candidates.push({ distance, normal: { x: 0, y: 1 } });
    }

    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.distance) || candidate.distance <= 0 || candidate.distance >= bestHit.distance) {
        continue;
      }
      const hitX = cue.x + direction.x * candidate.distance;
      const hitY = cue.y + direction.y * candidate.distance;
      if (hitX < bounds.minX || hitX > bounds.maxX || hitY < bounds.minY || hitY > bounds.maxY) {
        continue;
      }
      bestHit = {
        type: 'rail',
        distance: candidate.distance,
        point: { x: hitX, y: hitY },
        normal: candidate.normal,
      };
    }

    if (!state.snapshot || !Array.isArray(state.snapshot.balls)) {
      return bestHit;
    }

    for (const ball of state.snapshot.balls) {
      if (ball.sunk || ball.kind === 'cue') {
        continue;
      }
      const distance = rayCircleIntersection(cue, direction, ball, cue.r + ball.r);
      if (!distance || distance >= bestHit.distance) {
        continue;
      }
      const cueImpact = {
        x: cue.x + direction.x * distance,
        y: cue.y + direction.y * distance,
      };
      const normalX = ball.x - cueImpact.x;
      const normalY = ball.y - cueImpact.y;
      const normalLength = Math.hypot(normalX, normalY) || 1;
      bestHit = {
        type: 'ball',
        distance,
        point: cueImpact,
        objectBall: ball,
        normal: {
          x: normalX / normalLength,
          y: normalY / normalLength,
        },
      };
    }

    return bestHit;
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
      ui.powerText.textContent = `Release to fire at ${Math.max(5, Math.round(state.power * 100))}% power. Drag farther through the shot line to load more cue speed.`;
      return;
    }
    if (!state.snapshot) {
      ui.powerText.textContent = 'Open a live table to bring the cue online.';
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
      ui.powerText.textContent = 'Click or touch the table to aim, drag farther down the shot line to load the cue, then release to shoot.';
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
      ui.turnNote.textContent = 'You have the cue. Aim on the table, drag outward to load the stick, and release to shoot.';
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
    ui.shareLoungeBtn.disabled = !state.roomCode;
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

  function drawCueAndGuide() {
    const cue = activeCue();
    if (!cue || !canShoot()) {
      return;
    }

    const direction = cueDirection();
    const guide = projectAimGuide(cue, direction);
    const power = state.aiming ? state.power : 0;
    const cueTipDistance = cue.r + 6 + power * CUE_UI.cuePullback;
    const cueTip = {
      x: cue.x - direction.x * cueTipDistance,
      y: cue.y - direction.y * cueTipDistance,
    };
    const cueButt = {
      x: cueTip.x - direction.x * CUE_UI.cueLength,
      y: cueTip.y - direction.y * CUE_UI.cueLength,
    };
    const grip = {
      x: cueButt.x + direction.x * 42,
      y: cueButt.y + direction.y * 42,
    };
    const cueGhost = {
      x: cue.x + direction.x * Math.min(guide.distance, CUE_UI.guideLength),
      y: cue.y + direction.y * Math.min(guide.distance, CUE_UI.guideLength),
    };

    ctx.beginPath();
    ctx.arc(cue.x, cue.y, cue.r + 16, 0, Math.PI * 2);
    ctx.strokeStyle = state.aiming ? 'rgba(113, 241, 209, 0.65)' : 'rgba(131, 181, 255, 0.34)';
    ctx.lineWidth = state.aiming ? 3.4 : 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(guide.point.x, guide.point.y);
    ctx.strokeStyle = state.aiming ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.58)';
    ctx.lineWidth = state.aiming ? 2.5 : 1.8;
    ctx.setLineDash(state.aiming ? [12, 8] : [8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (guide.type === 'ball' && guide.objectBall) {
      ctx.beginPath();
      ctx.arc(cueGhost.x, cueGhost.y, cue.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 1.7;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(guide.objectBall.x, guide.objectBall.y);
      ctx.lineTo(
        guide.objectBall.x + guide.normal.x * 120,
        guide.objectBall.y + guide.normal.y * 120
      );
      ctx.strokeStyle = 'rgba(255, 213, 124, 0.78)';
      ctx.lineWidth = 1.7;
      ctx.setLineDash([7, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (guide.type === 'rail' && guide.normal) {
      const bounce = reflectDirection(direction, guide.normal);
      ctx.beginPath();
      ctx.moveTo(guide.point.x, guide.point.y);
      ctx.lineTo(
        guide.point.x + bounce.x * CUE_UI.guideBounceLength,
        guide.point.y + bounce.y * CUE_UI.guideBounceLength
      );
      ctx.strokeStyle = 'rgba(113, 241, 209, 0.6)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const cueGradient = ctx.createLinearGradient(cueButt.x, cueButt.y, cueTip.x, cueTip.y);
    cueGradient.addColorStop(0, '#4c2411');
    cueGradient.addColorStop(0.24, '#24130c');
    cueGradient.addColorStop(0.62, '#e5c28c');
    cueGradient.addColorStop(0.9, '#f1ddbd');
    cueGradient.addColorStop(1, '#8cc7ff');

    ctx.beginPath();
    ctx.moveTo(cueButt.x, cueButt.y);
    ctx.lineTo(cueTip.x, cueTip.y);
    ctx.strokeStyle = cueGradient;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cueButt.x, cueButt.y);
    ctx.lineTo(grip.x, grip.y);
    ctx.strokeStyle = '#11161d';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cueTip.x, cueTip.y);
    ctx.lineTo(cueTip.x + direction.x * 14, cueTip.y + direction.y * 14);
    ctx.strokeStyle = '#eef7ff';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    if (state.aiming) {
      ctx.beginPath();
      ctx.arc(grip.x, grip.y, CUE_UI.gripRadius * (0.56 + power * 0.22), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(113, 241, 209, 0.34)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
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
    drawCueAndGuide();
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
    const cue = activeCue();
    if (!point || !cue) {
      return;
    }
    const dx = point.x - cue.x;
    const dy = point.y - cue.y;
    const distance = Math.hypot(dx, dy);
    state.aiming = true;
    state.pointerId = event.pointerId;
    state.pointer = point;
    state.aimAnchorDistance = Math.min(distance, CUE_UI.anchorCap);
    if (distance > 0.0001) {
      state.aimAngle = Math.atan2(dy, dx);
    }
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
      const dx = point.x - cue.x;
      const dy = point.y - cue.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.0001) {
        state.aimAngle = Math.atan2(dy, dx);
      }
      state.power = clamp(Math.max(0, distance - state.aimAnchorDistance) / CUE_UI.powerRange, 0, 1);
    }
    updatePowerUi();
  }

  function finishAim(event) {
    if (!state.aiming || event.pointerId !== state.pointerId) {
      return;
    }
    const point = boardPointFromClient(event.clientX, event.clientY) || state.pointer;
    const cue = activeCue();
    const power = state.power;
    state.aiming = false;
    state.pointerId = null;
    state.power = 0;

    if (!cue || !point || !canShoot()) {
      updatePowerUi();
      return;
    }

    if (power < CUE_UI.minPower) {
      updatePowerUi();
      return;
    }

    const direction = cueDirection();
    if (sendJson({
      action: 'shoot',
      vectorX: direction.x,
      vectorY: direction.y,
      power,
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
  ui.openLoungeBtn.addEventListener('click', () => openArcadeLounge(false));
  ui.shareLoungeBtn.addEventListener('click', () => openArcadeLounge(true));
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
