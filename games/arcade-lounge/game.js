(() => {
  'use strict';

  const STORAGE_KEYS = {
    name: 'novaArcadeLounge.name',
    serverUrl: 'novaArcadeLounge.serverUrl',
    roomCode: 'novaArcadeLounge.roomCode',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const PUBLIC_ROOM_CODE = 'ARCADECHAT';
  const GAME_LINKS = {
    chess: {
      title: 'Neon Crown Chess',
      path: 'games/star-sprint/',
    },
    backgammon: {
      title: 'Neon Backgammon Blitz',
      path: 'backgammon.html',
    },
    'mini-pool': {
      title: 'Mini Pool Showdown',
      path: 'pool.html',
    },
    'space-shooter': {
      title: 'Starline Defense Co-Op',
      path: 'space-shooter.html',
    },
    'car-soccer': {
      title: 'Car Soccer Mini - Turbo Arena Live',
      path: 'games/car-soccer-mini/',
    },
    blackjack: {
      title: 'Royal SuperSplash Blackjack Live',
      path: 'blackjack.html',
    },
    poker: {
      title: 'Orbit Holdem Live',
      path: 'poker.html',
    },
  };
  const query = new URLSearchParams(window.location.search);
  const state = {
    socket: null,
    snapshot: null,
    roomCode: '',
    playerId: '',
    serverUrl: '',
    lastMessageCount: 0,
    pendingShare: null,
    autoShareDone: false,
  };

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    publicBtn: document.getElementById('publicBtn'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    copyInviteBtn: document.getElementById('copyInviteBtn'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    networkStatus: document.getElementById('networkStatus'),
    roomPill: document.getElementById('roomPill'),
    roomHeadline: document.getElementById('roomHeadline'),
    roomSummary: document.getElementById('roomSummary'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    playerCount: document.getElementById('playerCount'),
    inviteCount: document.getElementById('inviteCount'),
    feedStatus: document.getElementById('feedStatus'),
    messageList: document.getElementById('messageList'),
    composerForm: document.getElementById('composerForm'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    composerHint: document.getElementById('composerHint'),
    gameSelect: document.getElementById('gameSelect'),
    gameRoomInput: document.getElementById('gameRoomInput'),
    inviteNoteInput: document.getElementById('inviteNoteInput'),
    gameLinkPreview: document.getElementById('gameLinkPreview'),
    copyGameLinkBtn: document.getElementById('copyGameLinkBtn'),
    shareInviteBtn: document.getElementById('shareInviteBtn'),
    playerList: document.getElementById('playerList'),
    presenceText: document.getElementById('presenceText'),
    inviteList: document.getElementById('inviteList'),
    inviteStatus: document.getElementById('inviteStatus'),
  };

  function sanitizeRoomCode(raw) {
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);
  }

  function sanitizeText(raw, maxLength) {
    return String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function defaultServerUrl() {
    const explicit = query.get('server');
    if (explicit) {
      return normalizeServerUrl(explicit);
    }
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ws://127.0.0.1:8081';
    }
    return PROD_SERVER_URL;
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

  function currentServerUrl() {
    const value = normalizeServerUrl(ui.serverUrlInput.value || state.serverUrl || defaultServerUrl());
    state.serverUrl = value;
    return value;
  }

  function isPublicRoom(code) {
    return sanitizeRoomCode(code) === PUBLIC_ROOM_CODE;
  }

  function activeRoomCode() {
    return sanitizeRoomCode(state.roomCode || ui.roomInput.value) || PUBLIC_ROOM_CODE;
  }

  function roomLabel(code) {
    return isPublicRoom(code) ? 'Public Arcade Lounge' : `Private Lounge ${code}`;
  }

  function buildLoungeInviteUrl(roomCode) {
    const url = new URL('arcade-lounge.html', window.location.href);
    const normalized = sanitizeRoomCode(roomCode);
    if (normalized && !isPublicRoom(normalized)) {
      url.searchParams.set('room', normalized);
    } else {
      url.searchParams.delete('room');
    }
    const serverUrl = currentServerUrl();
    if (serverUrl !== defaultServerUrl()) {
      url.searchParams.set('server', serverUrl);
    } else {
      url.searchParams.delete('server');
    }
    return url.toString();
  }

  function buildGameInviteUrl(gameId, roomCode) {
    const normalizedRoom = sanitizeRoomCode(roomCode);
    const game = GAME_LINKS[gameId];
    if (!game || !normalizedRoom) {
      return '';
    }
    const url = new URL(game.path, window.location.href);
    url.searchParams.set('room', normalizedRoom);
    const serverUrl = currentServerUrl();
    if (serverUrl !== defaultServerUrl()) {
      url.searchParams.set('server', serverUrl);
    }
    return url.toString();
  }

  function savePrefs() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim().slice(0, 18));
    localStorage.setItem(STORAGE_KEYS.serverUrl, currentServerUrl());
    localStorage.setItem(STORAGE_KEYS.roomCode, sanitizeRoomCode(ui.roomInput.value));
  }

  function setNetworkStatus(tone, text) {
    ui.networkStatus.dataset.tone = tone;
    ui.networkStatus.textContent = text;
  }

  function setStatus(message) {
    ui.statusText.textContent = message || 'Open the public lounge to meet players, or use a private room code for a side chat.';
  }

  function copyToClipboard(text, successMessage) {
    const value = String(text || '').trim();
    if (!value) {
      setStatus('There is nothing to copy yet.');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value)
        .then(() => {
          setStatus(successMessage);
        })
        .catch(() => {
          setStatus('Copy failed. You can still select the text manually.');
        });
      return;
    }
    const helper = document.createElement('textarea');
    helper.value = value;
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

  function sendJson(payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      setStatus('Open a lounge room first so the message has somewhere to go.');
      return false;
    }
    state.socket.send(JSON.stringify(payload));
    return true;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkifyText(value) {
    return escapeHtml(value).replace(/(https?:\/\/[^\s<]+)/g, (url) => (
      `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`
    ));
  }

  function formatClock(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function isFeedPinned() {
    const remaining = ui.messageList.scrollHeight - ui.messageList.scrollTop - ui.messageList.clientHeight;
    return remaining < 64;
  }

  function inviteCardMarkup(invite) {
    const roomChip = invite.roomCode
      ? `<span class="chip room-chip">${escapeHtml(invite.roomCode)}</span>`
      : '';
    const note = invite.note
      ? `<p class="invite-card-note">${escapeHtml(invite.note)}</p>`
      : '';
    return `
      <article class="invite-card">
        <div class="invite-card-head">
          <div>
            <strong>${escapeHtml(invite.gameTitle || GAME_LINKS[invite.gameType]?.title || 'Game room')}</strong>
            <p class="invite-card-meta">Shared by ${escapeHtml(invite.playerName || 'Guest')} at ${escapeHtml(formatClock(invite.createdAt))}</p>
          </div>
          ${roomChip}
        </div>
        ${note}
        <div class="invite-card-actions">
          <a href="${escapeHtml(invite.url)}" target="_blank" rel="noreferrer">Open invite</a>
        </div>
      </article>
    `;
  }

  function messageMarkup(message) {
    if (message.kind === 'system') {
      return `
        <article class="message system">
          <div class="message-bubble">${escapeHtml(message.text)}</div>
        </article>
      `;
    }

    const self = message.playerId && message.playerId === state.playerId;
    const head = `
      <div class="message-head">
        <strong class="message-author">${escapeHtml(message.playerName || 'Guest')}</strong>
        <span class="message-time">${escapeHtml(formatClock(message.createdAt))}</span>
      </div>
    `;

    if (message.kind === 'invite') {
      return `
        <article class="message invite${self ? ' self' : ''}">
          ${head}
          ${inviteCardMarkup(message)}
        </article>
      `;
    }

    return `
      <article class="message chat${self ? ' self' : ''}">
        ${head}
        <div class="message-bubble"><p>${linkifyText(message.text)}</p></div>
      </article>
    `;
  }

  function renderMessages() {
    const messages = Array.isArray(state.snapshot && state.snapshot.messages)
      ? state.snapshot.messages
      : [];
    const shouldStick = isFeedPinned();
    if (!messages.length) {
      ui.messageList.innerHTML = '<div class="message-empty">No messages yet. Open the public lounge and say hello.</div>';
      state.lastMessageCount = 0;
      return;
    }
    ui.messageList.innerHTML = messages.map(messageMarkup).join('');
    if (shouldStick || messages.length > state.lastMessageCount) {
      ui.messageList.scrollTop = ui.messageList.scrollHeight;
    }
    state.lastMessageCount = messages.length;
  }

  function renderPlayers() {
    const players = Array.isArray(state.snapshot && state.snapshot.players)
      ? state.snapshot.players
      : [];
    ui.playerCount.textContent = String(players.length);
    ui.presenceText.textContent = players.length
      ? `${players.length} player${players.length === 1 ? '' : 's'} in this lounge`
      : 'Nobody is connected yet.';
    if (!players.length) {
      ui.playerList.innerHTML = '<div class="player-empty">Open the public lounge and you will appear here instantly.</div>';
      return;
    }
    ui.playerList.innerHTML = players.map((player) => {
      const chips = [
        player.id === state.playerId ? '<span class="chip">You</span>' : '',
      ].filter(Boolean).join('');
      return `
        <article class="player-card">
          <strong>${escapeHtml(player.name || 'Guest')}</strong>
          <p>${player.id === state.playerId ? 'Connected from this browser.' : 'Live in this lounge right now.'}</p>
          <div class="player-meta">${chips}</div>
        </article>
      `;
    }).join('');
  }

  function renderInvites() {
    const invites = Array.isArray(state.snapshot && state.snapshot.invites)
      ? state.snapshot.invites
      : [];
    ui.inviteCount.textContent = String(invites.length);
    ui.inviteStatus.textContent = invites.length
      ? `${invites.length} live invite${invites.length === 1 ? '' : 's'} ready to open.`
      : 'Shared room links will appear here.';
    if (!invites.length) {
      ui.inviteList.innerHTML = '<div class="invite-empty">No active invites yet. Share one from the composer below the chat feed.</div>';
      return;
    }
    ui.inviteList.innerHTML = invites.map(inviteCardMarkup).join('');
  }

  function renderOverview() {
    const code = activeRoomCode();
    const snapshot = state.snapshot;
    const playerTotal = Array.isArray(snapshot && snapshot.players) ? snapshot.players.length : 0;
    const playerLabel = `${playerTotal} player${playerTotal === 1 ? '' : 's'}`;
    ui.roomCodeLabel.textContent = snapshot ? snapshot.roomCode : (isPublicRoom(code) ? 'PUBLIC' : code || '-');
    ui.roomHeadline.textContent = roomLabel(snapshot ? snapshot.roomCode : code);
    ui.roomSummary.textContent = snapshot
      ? snapshot.status || 'Players are active in this lounge.'
      : isPublicRoom(code)
        ? 'A shared place to trade invite links, coordinate rematches, and point people at the right multiplayer game.'
        : 'Private side room ready. Host it or join it once everyone has the code.';
    ui.roomPill.textContent = snapshot
      ? roomLabel(snapshot.roomCode)
      : isPublicRoom(code)
        ? 'Public lounge ready'
        : `Private room ${code}`;
    ui.feedStatus.textContent = snapshot
      ? `${playerLabel} live in ${roomLabel(snapshot.roomCode).toLowerCase()}.`
      : 'Join a lounge to start chatting.';
  }

  function updateInvitePreview() {
    const preview = buildGameInviteUrl(ui.gameSelect.value, ui.gameRoomInput.value);
    ui.gameLinkPreview.value = preview;
    ui.copyGameLinkBtn.disabled = !preview;
    ui.shareInviteBtn.disabled = !preview || !state.snapshot;
  }

  function buildSharePayload(override) {
    const gameType = String(override && override.gameType || ui.gameSelect.value || '').trim();
    const roomCode = sanitizeRoomCode(override && override.roomCode || ui.gameRoomInput.value);
    const preview = buildGameInviteUrl(gameType, roomCode) || String(override && override.url || '').trim();
    if (!preview || !gameType || !roomCode) {
      return null;
    }
    return {
      action: 'share-invite',
      gameType,
      roomCode,
      url: preview,
      note: sanitizeText(override && override.note !== undefined ? override.note : ui.inviteNoteInput.value, 140),
    };
  }

  function updateLoungeInviteUi() {
    const code = activeRoomCode();
    ui.inviteInput.value = buildLoungeInviteUrl(code);
    ui.copyInviteBtn.disabled = !code;
  }

  function updateControlState() {
    const connected = Boolean(state.socket && state.socket.readyState === WebSocket.OPEN && state.snapshot);
    ui.messageInput.disabled = !connected;
    ui.sendBtn.disabled = !connected;
    ui.gameSelect.disabled = !connected;
    ui.gameRoomInput.disabled = !connected;
    ui.inviteNoteInput.disabled = !connected;
    updateInvitePreview();
  }

  function render() {
    renderOverview();
    renderMessages();
    renderPlayers();
    renderInvites();
    updateLoungeInviteUi();
    updateControlState();
  }

  function handleSocketStatePayload(payload) {
    state.snapshot = payload.snapshot || null;
    if (state.snapshot && state.snapshot.roomCode) {
      state.roomCode = sanitizeRoomCode(state.snapshot.roomCode);
      ui.roomInput.value = isPublicRoom(state.roomCode) ? '' : state.roomCode;
    }
    setNetworkStatus('online', 'Online');
    setStatus(payload.message || (state.snapshot && state.snapshot.status) || 'Connected to the lounge.');
    render();
    tryAutoShareDraft();
  }

  function connect(mode, roomCode) {
    const name = ui.nameInput.value.trim().slice(0, 18) || 'Guest';
    const normalizedRoom = sanitizeRoomCode(roomCode);
    const connectLabel = normalizedRoom
      ? roomLabel(normalizedRoom).toLowerCase()
      : 'a fresh private lounge';
    savePrefs();

    const socket = new WebSocket(currentServerUrl());
    const previous = state.socket;
    if (previous && previous.readyState < WebSocket.CLOSING) {
      previous.close();
    }
    state.socket = socket;
    state.snapshot = null;
    state.playerId = '';
    state.roomCode = normalizedRoom;
    setNetworkStatus('connecting', 'Connecting');
    setStatus(`Connecting to ${connectLabel}...`);
    render();

    socket.addEventListener('open', () => {
      if (state.socket !== socket) {
        return;
      }
      socket.send(JSON.stringify({
        action: 'join',
        game: 'arcade-chat',
        mode,
        roomCode: normalizedRoom,
        name,
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
        setStatus('A lounge update could not be read.');
        return;
      }

      if (payload.type === 'welcome') {
        state.playerId = payload.playerId || '';
        state.roomCode = sanitizeRoomCode(payload.roomCode || normalizedRoom);
        render();
        return;
      }

      if (payload.type === 'state') {
        handleSocketStatePayload(payload);
        return;
      }

      if (payload.type === 'error') {
        setStatus(payload.message || 'The lounge rejected that action.');
      }
    });

    socket.addEventListener('close', () => {
      if (state.socket !== socket) {
        return;
      }
      state.socket = null;
      setNetworkStatus('offline', 'Offline');
      setStatus('The lounge connection closed. Rejoin when you are ready.');
      updateControlState();
    });

    socket.addEventListener('error', () => {
      if (state.socket !== socket) {
        return;
      }
      setStatus('The lounge connection hit a network error.');
    });
  }

  function handleMessageSubmit(event) {
    event.preventDefault();
    const text = ui.messageInput.value.trim();
    if (!text) {
      setStatus('Write a message first.');
      return;
    }
    if (sendJson({
      action: 'chat',
      text,
    })) {
      ui.messageInput.value = '';
    }
  }

  function handleInviteShare(override, silent) {
    const payload = buildSharePayload(override);
    if (!payload) {
      setStatus('Pick a game and enter the room code from that game first.');
      return false;
    }
    const sent = sendJson(payload);
    if (sent && !silent) {
      setStatus(`Sharing your ${GAME_LINKS[payload.gameType]?.title || 'game'} room into the lounge...`);
    }
    return sent;
  }

  function tryAutoShareDraft() {
    if (!state.pendingShare || state.autoShareDone || !state.snapshot) {
      return;
    }
    if (handleInviteShare(state.pendingShare, true)) {
      state.autoShareDone = true;
      state.pendingShare = null;
      setStatus('Your game room was shared into the public lounge.');
    }
  }

  function hydrateFromStorage() {
    const queryName = sanitizeText(query.get('name'), 18);
    ui.nameInput.value = queryName || (localStorage.getItem(STORAGE_KEYS.name) || '').slice(0, 18);
    ui.serverUrlInput.value = normalizeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || defaultServerUrl());
    const queryRoom = sanitizeRoomCode(query.get('room'));
    const storedRoom = sanitizeRoomCode(localStorage.getItem(STORAGE_KEYS.roomCode));
    ui.roomInput.value = queryRoom && !isPublicRoom(queryRoom)
      ? queryRoom
      : storedRoom && !isPublicRoom(storedRoom)
        ? storedRoom
        : '';
    if (queryRoom && !isPublicRoom(queryRoom)) {
      setStatus(`Private lounge ${queryRoom} is ready in the room field. Press "Join private room" to enter.`);
    }

    const shareGame = String(query.get('shareGame') || '').trim();
    const shareRoom = sanitizeRoomCode(query.get('shareRoom'));
    const shareNote = sanitizeText(query.get('shareNote'), 140);
    if (GAME_LINKS[shareGame]) {
      ui.gameSelect.value = shareGame;
    }
    if (shareRoom) {
      ui.gameRoomInput.value = shareRoom;
    }
    if (shareNote) {
      ui.inviteNoteInput.value = shareNote;
    }
    if (GAME_LINKS[shareGame] && shareRoom) {
      state.pendingShare = {
        gameType: shareGame,
        roomCode: shareRoom,
        note: shareNote,
        url: String(query.get('shareUrl') || '').trim(),
      };
      state.autoShareDone = false;
      if (query.get('autoShare') === '1') {
        setStatus(`Invite draft loaded from ${GAME_LINKS[shareGame].title}. Opening the public lounge and sharing it now.`);
      } else {
        setStatus(`Invite draft loaded from ${GAME_LINKS[shareGame].title}. Press Share invite when you are ready.`);
      }
    }
  }

  ui.publicBtn.addEventListener('click', () => {
    connect('host', PUBLIC_ROOM_CODE);
  });

  ui.hostBtn.addEventListener('click', () => {
    connect('host', sanitizeRoomCode(ui.roomInput.value));
  });

  ui.joinBtn.addEventListener('click', () => {
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (!roomCode) {
      setStatus('Enter a private room code before joining.');
      return;
    }
    connect('join', roomCode);
  });

  ui.copyInviteBtn.addEventListener('click', () => {
    copyToClipboard(ui.inviteInput.value, 'Lounge link copied.');
  });

  ui.copyGameLinkBtn.addEventListener('click', () => {
    copyToClipboard(ui.gameLinkPreview.value, 'Game invite link copied.');
  });

  ui.shareInviteBtn.addEventListener('click', () => handleInviteShare());
  ui.composerForm.addEventListener('submit', handleMessageSubmit);
  ui.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleMessageSubmit(event);
    }
  });

  ui.gameSelect.addEventListener('change', updateInvitePreview);
  ui.gameRoomInput.addEventListener('input', () => {
    ui.gameRoomInput.value = sanitizeRoomCode(ui.gameRoomInput.value);
    updateInvitePreview();
  });
  ui.inviteNoteInput.addEventListener('input', updateInvitePreview);
  ui.roomInput.addEventListener('input', () => {
    ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
    updateLoungeInviteUi();
  });
  ui.serverUrlInput.addEventListener('change', () => {
    ui.serverUrlInput.value = normalizeServerUrl(ui.serverUrlInput.value);
    savePrefs();
    updateInvitePreview();
    updateLoungeInviteUi();
  });
  ui.nameInput.addEventListener('change', savePrefs);

  hydrateFromStorage();
  updateInvitePreview();
  updateLoungeInviteUi();
  render();

  if (query.get('lounge') === 'public' || query.get('autoShare') === '1') {
    connect('host', PUBLIC_ROOM_CODE);
  }
})();
