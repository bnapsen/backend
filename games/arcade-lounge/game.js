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
  const VOICE_CHAT_CONFIG = {
    rtcConfig: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
      bundlePolicy: 'max-bundle',
      iceCandidatePoolSize: 2,
    },
    mediaConstraints: {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
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
    voiceStream: null,
    voiceJoined: false,
    voiceJoining: false,
    voiceMuted: false,
    voicePeers: new Map(),
    voiceAudioElements: new Map(),
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
    voiceBtn: document.getElementById('voiceBtn'),
    muteVoiceBtn: document.getElementById('muteVoiceBtn'),
    voiceStatus: document.getElementById('voiceStatus'),
    voiceAudioHost: document.getElementById('voiceAudioHost'),
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

  function voiceChatSupported() {
    return Boolean(
      navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function'
      && typeof window.RTCPeerConnection === 'function'
    );
  }

  function setVoiceStatus(message, tone) {
    if (!ui.voiceStatus) {
      return;
    }
    ui.voiceStatus.textContent = message;
    ui.voiceStatus.dataset.tone = tone || 'idle';
  }

  function currentPlayers() {
    return Array.isArray(state.snapshot && state.snapshot.players)
      ? state.snapshot.players
      : [];
  }

  function findSnapshotPlayer(playerId) {
    if (!playerId) {
      return null;
    }
    return currentPlayers().find((player) => player.id === playerId) || null;
  }

  function remoteVoicePlayers() {
    return currentPlayers().filter((player) => player.id !== state.playerId && player.voiceJoined);
  }

  function selfSnapshotPlayer() {
    return findSnapshotPlayer(state.playerId);
  }

  function voiceParticipantCount() {
    return currentPlayers().filter((player) => player.voiceJoined).length;
  }

  function voiceParticipantLabel() {
    const total = voiceParticipantCount();
    if (!total) {
      return 'no one on voice';
    }
    return `${total} player${total === 1 ? '' : 's'} on voice`;
  }

  function voicePresenceSentence() {
    const total = voiceParticipantCount();
    if (!total) {
      return 'No one is on voice yet.';
    }
    if (total === 1) {
      return '1 player is already on voice.';
    }
    return `${total} players are already on voice.`;
  }

  function createRemoteAudioElement(playerId, playerName) {
    let audio = state.voiceAudioElements.get(playerId);
    if (audio) {
      return audio;
    }
    audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.dataset.playerId = playerId;
    audio.setAttribute('aria-label', `Voice chat audio for ${playerName || 'Guest'}`);
    ui.voiceAudioHost.appendChild(audio);
    state.voiceAudioElements.set(playerId, audio);
    return audio;
  }

  function removeRemoteAudioElement(playerId) {
    const audio = state.voiceAudioElements.get(playerId);
    if (!audio) {
      return;
    }
    audio.pause();
    audio.srcObject = null;
    audio.remove();
    state.voiceAudioElements.delete(playerId);
  }

  function setLocalVoiceTracksEnabled(enabled) {
    if (!state.voiceStream) {
      return;
    }
    for (const track of state.voiceStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  function stopLocalVoiceStream() {
    if (!state.voiceStream) {
      return;
    }
    for (const track of state.voiceStream.getTracks()) {
      track.stop();
    }
    state.voiceStream = null;
  }

  function updateVoiceUi() {
    if (!ui.voiceBtn) {
      return;
    }
    if (state.voiceJoining) {
      ui.voiceBtn.textContent = 'Joining voice...';
      ui.voiceBtn.dataset.state = 'processing';
    } else if (state.voiceJoined) {
      ui.voiceBtn.textContent = 'Leave voice';
      ui.voiceBtn.dataset.state = 'live';
    } else {
      ui.voiceBtn.textContent = 'Join voice';
      ui.voiceBtn.dataset.state = 'idle';
    }

    if (ui.muteVoiceBtn) {
      ui.muteVoiceBtn.textContent = state.voiceMuted ? 'Unmute mic' : 'Mute mic';
      ui.muteVoiceBtn.dataset.muted = state.voiceMuted ? 'true' : 'false';
    }
  }

  function attachLocalTracks(session) {
    if (!session || !state.voiceStream || session.localTracksAdded) {
      return;
    }
    for (const track of state.voiceStream.getAudioTracks()) {
      session.pc.addTrack(track, state.voiceStream);
    }
    session.localTracksAdded = true;
  }

  async function flushPendingVoiceCandidates(session) {
    if (!session || !session.pendingCandidates.length || !session.pc.remoteDescription) {
      return;
    }
    const queue = session.pendingCandidates.splice(0);
    for (const candidate of queue) {
      try {
        await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        // Ignore stale ICE from a previous negotiation.
      }
    }
  }

  function closeVoicePeer(playerId) {
    const session = state.voicePeers.get(playerId);
    if (!session) {
      return;
    }
    state.voicePeers.delete(playerId);
    session.pc.ontrack = null;
    session.pc.onicecandidate = null;
    session.pc.onconnectionstatechange = null;
    session.pc.oniceconnectionstatechange = null;
    try {
      session.pc.close();
    } catch (error) {
      // Ignore close errors for already-closed peers.
    }
    removeRemoteAudioElement(playerId);
  }

  function resetVoiceChatState() {
    state.voiceJoining = false;
    state.voiceJoined = false;
    state.voiceMuted = false;
    stopLocalVoiceStream();
    for (const playerId of Array.from(state.voicePeers.keys())) {
      closeVoicePeer(playerId);
    }
  }

  function shouldInitiateVoice(remotePlayerId) {
    return String(state.playerId || '') < String(remotePlayerId || '');
  }

  function createVoicePeerSession(remotePlayerId, remotePlayerName) {
    const existing = state.voicePeers.get(remotePlayerId);
    if (existing) {
      return existing;
    }

    const pc = new RTCPeerConnection(VOICE_CHAT_CONFIG.rtcConfig);
    const remoteStream = new MediaStream();
    const audio = createRemoteAudioElement(remotePlayerId, remotePlayerName);
    audio.srcObject = remoteStream;

    const session = {
      playerId: remotePlayerId,
      playerName: remotePlayerName || 'Guest',
      pc,
      remoteStream,
      localTracksAdded: false,
      pendingCandidates: [],
      creatingOffer: false,
      offerSent: false,
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      sendJson({
        action: 'voice-signal',
        toPlayerId: remotePlayerId,
        signal: {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        },
      });
    };

    pc.ontrack = (event) => {
      const sourceTracks = event.streams && event.streams[0]
        ? event.streams[0].getAudioTracks()
        : [event.track];
      for (const track of sourceTracks) {
        if (!session.remoteStream.getAudioTracks().some((existingTrack) => existingTrack.id === track.id)) {
          session.remoteStream.addTrack(track);
        }
      }
      const playResult = audio.play();
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(() => {});
      }
    };

    const handleConnectionChange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.iceConnectionState === 'failed') {
        closeVoicePeer(remotePlayerId);
        if (state.voiceJoined && findSnapshotPlayer(remotePlayerId)?.voiceJoined) {
          ensureVoiceConnections();
        }
      }
    };

    pc.onconnectionstatechange = handleConnectionChange;
    pc.oniceconnectionstatechange = handleConnectionChange;

    attachLocalTracks(session);
    state.voicePeers.set(remotePlayerId, session);
    return session;
  }

  async function sendVoiceOffer(session) {
    if (!session || session.creatingOffer || !state.voiceJoined || !state.voiceStream) {
      return;
    }
    session.creatingOffer = true;
    try {
      attachLocalTracks(session);
      const offer = await session.pc.createOffer({
        offerToReceiveAudio: true,
      });
      await session.pc.setLocalDescription(offer);
      sendJson({
        action: 'voice-signal',
        toPlayerId: session.playerId,
        signal: {
          type: 'offer',
          description: session.pc.localDescription,
        },
      });
      session.offerSent = true;
    } catch (error) {
      closeVoicePeer(session.playerId);
    } finally {
      session.creatingOffer = false;
    }
  }

  function ensureVoiceConnections() {
    if (!state.voiceJoined || !state.voiceStream) {
      for (const playerId of Array.from(state.voicePeers.keys())) {
        closeVoicePeer(playerId);
      }
      return;
    }

    const remotePlayers = remoteVoicePlayers();
    const activeIds = new Set(remotePlayers.map((player) => player.id));

    for (const playerId of Array.from(state.voicePeers.keys())) {
      if (!activeIds.has(playerId)) {
        closeVoicePeer(playerId);
      }
    }

    for (const remotePlayer of remotePlayers) {
      const session = createVoicePeerSession(remotePlayer.id, remotePlayer.name);
      session.playerName = remotePlayer.name || session.playerName;
      attachLocalTracks(session);
      if (
        shouldInitiateVoice(remotePlayer.id)
        && session.pc.signalingState === 'stable'
        && !session.pc.currentRemoteDescription
        && !session.creatingOffer
        && !session.offerSent
      ) {
        sendVoiceOffer(session);
      }
    }
  }

  async function handleVoiceSignal(payload) {
    if (!state.voiceJoined || !state.voiceStream) {
      return;
    }

    const remotePlayerId = String(payload && payload.fromPlayerId || '').trim();
    const signal = payload && payload.signal;
    if (!remotePlayerId || remotePlayerId === state.playerId || !signal || typeof signal !== 'object') {
      return;
    }

    const remotePlayer = findSnapshotPlayer(remotePlayerId);
    if (remotePlayer && !remotePlayer.voiceJoined && signal.type !== 'offer') {
      return;
    }

    const session = createVoicePeerSession(
      remotePlayerId,
      (payload && payload.fromPlayerName) || (remotePlayer && remotePlayer.name) || 'Guest'
    );
    attachLocalTracks(session);

    try {
      if (signal.type === 'offer' && signal.description) {
        await session.pc.setRemoteDescription(new RTCSessionDescription(signal.description));
        await flushPendingVoiceCandidates(session);
        const answer = await session.pc.createAnswer();
        await session.pc.setLocalDescription(answer);
        sendJson({
          action: 'voice-signal',
          toPlayerId: remotePlayerId,
          signal: {
            type: 'answer',
            description: session.pc.localDescription,
          },
        });
        session.offerSent = true;
        return;
      }

      if (signal.type === 'answer' && signal.description) {
        await session.pc.setRemoteDescription(new RTCSessionDescription(signal.description));
        await flushPendingVoiceCandidates(session);
        return;
      }

      if (signal.type === 'ice-candidate' && signal.candidate) {
        if (session.pc.remoteDescription) {
          await session.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          session.pendingCandidates.push(signal.candidate);
        }
        return;
      }

      if (signal.type === 'leave') {
        closeVoicePeer(remotePlayerId);
      }
    } catch (error) {
      closeVoicePeer(remotePlayerId);
    }
  }

  async function joinVoiceChat() {
    if (!voiceChatSupported()) {
      setVoiceStatus('Voice chat needs microphone access and WebRTC support.', 'error');
      setStatus('This browser does not support direct lounge voice chat.');
      updateControlState();
      return;
    }
    if (!state.snapshot) {
      setStatus('Join a lounge room before opening voice chat.');
      return;
    }
    if (state.voiceJoined || state.voiceJoining) {
      return;
    }

    state.voiceJoining = true;
    updateControlState();
    setVoiceStatus('Opening your mic for lounge voice chat...', 'processing');
    setStatus('Requesting microphone access for direct lounge voice chat.');

    try {
      const stream = await navigator.mediaDevices.getUserMedia(VOICE_CHAT_CONFIG.mediaConstraints);
      state.voiceStream = stream;
      state.voiceJoined = true;
      state.voiceMuted = false;
      state.voiceJoining = false;
      setLocalVoiceTracksEnabled(true);

      if (!sendJson({
        action: 'voice-join',
        muted: false,
      })) {
        throw new Error('Could not connect you to lounge voice chat.');
      }

      setVoiceStatus('Mic live. Use headphones for the cleanest chat.', 'live');
      setStatus('You joined lounge voice chat.');
      ensureVoiceConnections();
      updateControlState();
      renderPlayers();
    } catch (error) {
      resetVoiceChatState();
      const message = error && error.name === 'NotAllowedError'
        ? 'Microphone access was blocked.'
        : error && error.message
          ? error.message
          : 'Could not start lounge voice chat.';
      setVoiceStatus(message, 'error');
      setStatus(message);
      updateControlState();
    }
  }

  function leaveVoiceChat(notifyServer) {
    const wasJoined = state.voiceJoined || Boolean(state.voiceStream);
    if (notifyServer && wasJoined && state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({
        action: 'voice-leave',
      }));
    }
    resetVoiceChatState();
    if (voiceChatSupported()) {
      setVoiceStatus(
        state.snapshot
          ? 'Join voice when you want to talk live in this lounge.'
          : 'Join a lounge, then open direct voice chat with your mic.',
        'idle'
      );
    } else {
      setVoiceStatus('Voice chat needs microphone access and WebRTC support.', 'error');
    }
    if (wasJoined) {
      setStatus('You left lounge voice chat.');
    }
    updateControlState();
    renderPlayers();
  }

  function toggleVoiceMute() {
    if (!state.voiceJoined || !state.voiceStream) {
      return;
    }
    state.voiceMuted = !state.voiceMuted;
    setLocalVoiceTracksEnabled(!state.voiceMuted);
    sendJson({
      action: 'voice-mute',
      muted: state.voiceMuted,
    });
    setVoiceStatus(
      state.voiceMuted
        ? 'You are muted in lounge voice chat.'
        : 'Mic live. Use headphones for the cleanest chat.',
      state.voiceMuted ? 'ready' : 'live'
    );
    updateControlState();
    renderPlayers();
  }

  function toggleVoiceChat() {
    if (state.voiceJoining) {
      return;
    }
    if (state.voiceJoined) {
      leaveVoiceChat(true);
      return;
    }
    joinVoiceChat();
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
    const liveVoiceCount = players.filter((player) => player.voiceJoined).length;
    ui.presenceText.textContent = players.length
      ? `${players.length} player${players.length === 1 ? '' : 's'} in this lounge, ${liveVoiceCount} on voice`
      : 'Nobody is connected yet.';
    if (!players.length) {
      ui.playerList.innerHTML = '<div class="player-empty">Open the public lounge and you will appear here instantly.</div>';
      return;
    }
    ui.playerList.innerHTML = players.map((player) => {
      const chips = [
        player.id === state.playerId ? '<span class="chip">You</span>' : '',
        player.voiceJoined
          ? `<span class="chip ${player.voiceMuted ? 'voice-muted' : 'voice-live'}">${player.voiceMuted ? 'Muted' : 'Voice live'}</span>`
          : '',
      ].filter(Boolean).join('');
      const description = player.voiceJoined
        ? player.voiceMuted
          ? 'In voice chat with mic muted.'
          : 'Talking live in lounge voice chat.'
        : player.id === state.playerId
          ? 'Connected from this browser.'
          : 'Live in this lounge right now.';
      return `
        <article class="player-card${player.voiceJoined ? ' voice-active' : ''}">
          <strong>${escapeHtml(player.name || 'Guest')}</strong>
          <p>${description}</p>
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
    const voiceTotal = Array.isArray(snapshot && snapshot.players)
      ? snapshot.players.filter((player) => player.voiceJoined).length
      : 0;
    const playerLabel = `${playerTotal} player${playerTotal === 1 ? '' : 's'}`;
    ui.roomCodeLabel.textContent = snapshot ? snapshot.roomCode : (isPublicRoom(code) ? 'PUBLIC' : code || '-');
    ui.roomHeadline.textContent = roomLabel(snapshot ? snapshot.roomCode : code);
    ui.roomSummary.textContent = snapshot
      ? snapshot.status || (voiceTotal
        ? `${voiceTotal} player${voiceTotal === 1 ? '' : 's'} are already in live voice chat.`
        : 'Players are active in this lounge.')
      : isPublicRoom(code)
        ? 'A shared place to trade invite links, coordinate rematches, and point people at the right multiplayer game.'
        : 'Private side room ready. Host it or join it once everyone has the code.';
    ui.roomPill.textContent = snapshot
      ? roomLabel(snapshot.roomCode)
      : isPublicRoom(code)
        ? 'Public lounge ready'
        : `Private room ${code}`;
    ui.feedStatus.textContent = snapshot
      ? `${playerLabel} live in ${roomLabel(snapshot.roomCode).toLowerCase()}${voiceTotal ? `, ${voiceTotal} on voice.` : '.'}`
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
    ui.voiceBtn.disabled = !connected || !voiceChatSupported() || state.voiceJoining;
    ui.muteVoiceBtn.disabled = !connected || !state.voiceJoined;
    ui.gameSelect.disabled = !connected;
    ui.gameRoomInput.disabled = !connected;
    ui.inviteNoteInput.disabled = !connected;
    if (!voiceChatSupported()) {
      setVoiceStatus('Voice chat needs microphone access and WebRTC support.', 'error');
    } else if (!connected) {
      setVoiceStatus('Join a lounge, then open direct voice chat with your mic.', 'idle');
    } else if (state.voiceJoining) {
      setVoiceStatus('Opening your mic for lounge voice chat...', 'processing');
    } else if (state.voiceJoined) {
      setVoiceStatus(
        state.voiceMuted
          ? `You are muted. ${voiceParticipantLabel()}.`
          : `Mic live. ${voiceParticipantLabel()}.`,
        state.voiceMuted ? 'ready' : 'live'
      );
    } else if (ui.voiceStatus && ui.voiceStatus.dataset.tone !== 'error') {
      setVoiceStatus(`Join live voice chat for this lounge. ${voicePresenceSentence()}`, 'idle');
    }
    updateVoiceUi();
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
    const selfPlayer = selfSnapshotPlayer();
    if (selfPlayer && state.voiceJoined) {
      state.voiceMuted = Boolean(selfPlayer.voiceMuted);
    }
    if (state.voiceJoined) {
      ensureVoiceConnections();
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
    if (state.voiceJoined || state.voiceJoining || state.voiceStream) {
      leaveVoiceChat(Boolean(previous && previous.readyState === WebSocket.OPEN));
    }
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

      if (payload.type === 'voice-signal') {
        handleVoiceSignal(payload);
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
      resetVoiceChatState();
      state.socket = null;
      setNetworkStatus('offline', 'Offline');
      setStatus('The lounge connection closed. Rejoin when you are ready.');
      if (voiceChatSupported()) {
        setVoiceStatus('Reconnect to the lounge to open live voice chat again.', 'idle');
      }
      updateControlState();
      renderPlayers();
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
  ui.voiceBtn.addEventListener('click', toggleVoiceChat);
  ui.muteVoiceBtn.addEventListener('click', toggleVoiceMute);
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
