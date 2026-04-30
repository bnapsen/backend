'use strict';

const BACKEND_WS_URL = 'wss://nova-arcade-backend-1000121513328.us-central1.run.app';
const BACKEND_HTTP_URL = 'https://nova-arcade-backend-1000121513328.us-central1.run.app';
const SIGNAL_RECONNECT_BASE_MS = 1000;
const SIGNAL_RECONNECT_MAX_MS = 10000;
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const state = {
  mode: 'host',
  socket: null,
  role: 'host',
  roomCode: '',
  localStream: null,
  sourceType: '',
  sourceLabel: '',
  hostId: '',
  viewerId: '',
  peers: new Map(),
  viewerPeer: null,
  pendingHostCandidates: new Map(),
  pendingViewerCandidates: [],
  viewers: [],
  chatMessages: [],
  mediaMuted: false,
  cameraOff: false,
  stoppingTracks: false,
  liveRooms: [],
  liveRoomsLoading: false,
  liveRoomsError: '',
  liveRoomsTimer: null,
  socketReconnectTimer: null,
  socketReconnectAttempts: 0,
  intentionalDisconnect: false,
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  bindElements();
  bindEvents();
  hydrateRoomFromQuery();
  setMode(els.joinRoomCode.value ? 'viewer' : 'host');
  refreshStage();
  renderChat();
  loadLiveRooms();
  startLiveRoomPolling();
  logEvent('Ready.');
});

function bindElements() {
  [
    'connectionPill',
    'roleBadge',
    'viewerCount',
    'stageTitle',
    'localVideo',
    'remoteVideo',
    'videoEmpty',
    'emptyHint',
    'onAirBadge',
    'streamStatus',
    'roomReadout',
    'mediaReadout',
    'signalReadout',
    'hostModeButton',
    'viewerModeButton',
    'liveRoomsList',
    'refreshLiveRoomsButton',
    'hostPanel',
    'viewerPanel',
    'hostName',
    'streamTitle',
    'cameraButton',
    'screenButton',
    'screenOnlyButton',
    'goLiveButton',
    'muteButton',
    'cameraToggleButton',
    'stopPreviewButton',
    'hostRoomCode',
    'shareLink',
    'copyLinkButton',
    'stopLiveButton',
    'viewerListCount',
    'viewerList',
    'viewerName',
    'joinRoomCode',
    'joinButton',
    'leaveButton',
    'viewerRoomCode',
    'hostLine',
    'chatRoomLabel',
    'chatList',
    'chatInput',
    'sendChatButton',
    'signalLog',
    'clearLogButton',
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll('.mode-tab').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  els.cameraButton.addEventListener('click', startCamera);
  els.screenButton.addEventListener('click', () => startScreenShare({ includeMic: true }));
  els.screenOnlyButton.addEventListener('click', () => startScreenShare({ includeMic: false }));
  els.goLiveButton.addEventListener('click', goLive);
  els.muteButton.addEventListener('click', toggleMute);
  els.cameraToggleButton.addEventListener('click', toggleCamera);
  els.stopPreviewButton.addEventListener('click', stopPreview);
  els.copyLinkButton.addEventListener('click', copyShareLink);
  els.stopLiveButton.addEventListener('click', stopLive);
  els.joinButton.addEventListener('click', joinStream);
  els.leaveButton.addEventListener('click', leaveStream);
  els.sendChatButton.addEventListener('click', sendChatMessage);
  els.chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });
  document.querySelectorAll('.emoji-button').forEach((button) => {
    button.addEventListener('click', () => insertChatEmoji(button.dataset.emoji || button.textContent || ''));
  });
  els.refreshLiveRoomsButton.addEventListener('click', () => loadLiveRooms({ announce: true }));
  els.liveRoomsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-room-code]');
    if (!button || button.disabled) {
      return;
    }
    joinListedRoom(button.dataset.roomCode);
  });
  els.clearLogButton.addEventListener('click', () => {
    els.signalLog.innerHTML = '';
  });
  els.joinRoomCode.addEventListener('input', () => {
    els.joinRoomCode.value = normalizeRoomCode(els.joinRoomCode.value);
  });
}

function hydrateRoomFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const room = normalizeRoomCode(params.get('room') || '');
  if (room) {
    els.joinRoomCode.value = room;
  }
}

function websocketUrl() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  return BACKEND_WS_URL;
}

function apiBaseUrl() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app')) {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return BACKEND_HTTP_URL;
}

function setMode(mode) {
  state.mode = mode === 'viewer' ? 'viewer' : 'host';
  if (!state.roomCode) {
    state.role = state.mode;
  }
  els.hostModeButton.classList.toggle('is-active', state.mode === 'host');
  els.viewerModeButton.classList.toggle('is-active', state.mode === 'viewer');
  els.hostPanel.classList.toggle('is-active', state.mode === 'host');
  els.viewerPanel.classList.toggle('is-active', state.mode === 'viewer');
  refreshStage();
  renderLiveRooms();
}

function startLiveRoomPolling() {
  if (state.liveRoomsTimer) {
    return;
  }
  state.liveRoomsTimer = window.setInterval(() => loadLiveRooms(), 8000);
}

async function loadLiveRooms(options = {}) {
  if (!els.liveRoomsList) {
    return;
  }

  state.liveRoomsLoading = true;
  renderLiveRooms();

  try {
    const response = await fetch(`${apiBaseUrl()}/api/live/rooms`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Live rooms returned ${response.status}`);
    }
    const data = await response.json();
    state.liveRooms = Array.isArray(data.rooms) ? data.rooms : [];
    state.liveRoomsError = '';
    if (options.announce) {
      logEvent('Live list refreshed.');
    }
  } catch (error) {
    state.liveRoomsError = 'Live list unavailable.';
    if (options.announce) {
      logEvent(`Live list failed: ${error.message || 'network error'}.`);
    }
  } finally {
    state.liveRoomsLoading = false;
    renderLiveRooms();
  }
}

function renderLiveRooms() {
  if (!els.liveRoomsList) {
    return;
  }

  els.liveRoomsList.innerHTML = '';

  if (state.liveRoomsLoading && !state.liveRooms.length) {
    els.liveRoomsList.appendChild(liveRoomEmptyItem('Checking live streams...'));
    return;
  }

  if (state.liveRoomsError && !state.liveRooms.length) {
    els.liveRoomsList.appendChild(liveRoomEmptyItem(state.liveRoomsError));
    return;
  }

  if (!state.liveRooms.length) {
    els.liveRoomsList.appendChild(liveRoomEmptyItem('No live streams right now.'));
    return;
  }

  const isHosting = state.role === 'host' && Boolean(state.roomCode);
  state.liveRooms.forEach((room) => {
    const roomCode = normalizeRoomCode(room.roomCode);
    if (!roomCode) {
      return;
    }
    const isCurrentRoom = state.roomCode === roomCode;
    const isCurrentHost = isCurrentRoom && state.role === 'host';
    const isCurrentViewer = isCurrentRoom && state.role === 'viewer';
    const buttonDisabled = isCurrentRoom || isHosting;
    const buttonText = isCurrentHost ? 'On Air' : isCurrentViewer ? 'Watching' : 'Watch';
    const article = document.createElement('article');
    article.className = `live-room-card${isCurrentRoom ? ' is-current' : ''}`;
    article.innerHTML = `
      <div class="live-room-main">
        <span class="live-room-status"><i></i>Live</span>
        <strong>${escapeHtml(room.title || 'Live stream')}</strong>
        <p>${escapeHtml(room.hostName || 'Host')} &middot; ${formatViewerCount(room.viewerCount)} &middot; ${escapeHtml(formatStartedAt(room.createdAt))}</p>
      </div>
      <div class="live-room-actions">
        <span class="live-room-code">${escapeHtml(roomCode)}</span>
        <button class="small-button live-room-join" type="button" data-room-code="${escapeHtml(roomCode)}" ${buttonDisabled ? 'disabled' : ''} aria-label="Watch ${escapeHtml(room.title || 'live stream')}">${buttonText}</button>
      </div>
    `;
    els.liveRoomsList.appendChild(article);
  });
}

function liveRoomEmptyItem(text) {
  const item = document.createElement('article');
  item.className = 'live-room-empty';
  item.textContent = text;
  return item;
}

function formatViewerCount(count) {
  const viewers = Number(count || 0);
  return `${viewers} viewer${viewers === 1 ? '' : 's'}`;
}

function formatStartedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'just started';
  }
  return `started ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function joinListedRoom(roomCode) {
  const nextRoomCode = normalizeRoomCode(roomCode);
  if (!nextRoomCode) {
    return;
  }
  els.joinRoomCode.value = nextRoomCode;
  joinStream();
}

function insertChatEmoji(emoji) {
  if (!emoji || els.chatInput.disabled) {
    return;
  }
  const input = els.chatInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const prefix = input.value.slice(0, start);
  const suffix = input.value.slice(end);
  const spacer = prefix && !/\s$/.test(prefix) ? ' ' : '';
  const nextValue = `${prefix}${spacer}${emoji}${suffix}`.slice(0, Number(input.maxLength || 240));
  input.value = nextValue;
  const nextPosition = Math.min((prefix + spacer + emoji).length, input.value.length);
  input.focus();
  input.setSelectionRange(nextPosition, nextPosition);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setConnection('Camera unavailable', 'error');
    logEvent('This browser does not expose camera capture.');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    await setLocalStream(stream, {
      sourceType: 'camera',
      sourceLabel: 'Camera + Mic',
      readyText: 'Camera Ready',
      logText: 'Camera preview started.',
    });
  } catch (error) {
    setConnection('Camera blocked', 'error');
    logEvent(`Camera failed: ${error.message || 'permission denied'}.`);
  }
}

async function startScreenShare(options = {}) {
  const includeMic = Boolean(options.includeMic);
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    setConnection('Desktop unavailable', 'error');
    logEvent('This browser does not expose desktop capture.');
    return;
  }

  let displayStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: includeMic,
    });
  } catch (error) {
    setConnection('Desktop blocked', 'error');
    logEvent(`Desktop capture failed: ${error.message || 'permission denied'}.`);
    return;
  }

  const tracks = [...displayStream.getVideoTracks(), ...displayStream.getAudioTracks()];
  if (includeMic && navigator.mediaDevices.getUserMedia) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      tracks.push(...micStream.getAudioTracks());
    } catch (error) {
      logEvent('Mic was not added; desktop capture will continue without microphone audio.');
    }
  }

  const stream = new MediaStream(tracks);
  await setLocalStream(stream, {
    sourceType: includeMic ? 'screen-mic' : 'screen-only',
    sourceLabel: includeMic ? 'Desktop + Mic' : 'Desktop Only',
    readyText: includeMic ? 'Desktop Ready' : 'Desktop Only Ready',
    logText: includeMic ? 'Desktop preview started with audio controls.' : 'Desktop-only preview started.',
  });
}

async function setLocalStream(stream, options = {}) {
  const previousStream = state.localStream;
  state.localStream = stream;
  state.sourceType = options.sourceType || 'custom';
  state.sourceLabel = options.sourceLabel || 'Stream';
  state.mediaMuted = false;
  state.cameraOff = false;

  els.localVideo.srcObject = state.localStream;
  els.localVideo.classList.toggle('is-screen', state.sourceType.startsWith('screen'));
  updateCaptureButtons(options.readyText || 'Source Ready');
  attachLocalTrackHandlers(stream);

  if (state.roomCode && state.role === 'host' && state.peers.size) {
    await replaceTracksForLivePeers(stream);
  }
  if (previousStream && previousStream !== stream) {
    stopStreamTracks(previousStream);
  }

  logEvent(options.logText || 'Preview started.');
  refreshStage();
}

function updateCaptureButtons(activeText) {
  els.cameraButton.textContent = state.sourceType === 'camera' ? activeText : 'Camera + Mic';
  els.screenButton.textContent = state.sourceType === 'screen-mic' ? activeText : 'Desktop + Mic';
  els.screenOnlyButton.textContent = state.sourceType === 'screen-only' ? activeText : 'Desktop Only';
  els.goLiveButton.disabled = !state.localStream || Boolean(state.roomCode);
  els.stopPreviewButton.disabled = !state.localStream || Boolean(state.roomCode);
  updateMediaButtons();
}

function updateMediaButtons() {
  const hasLocal = Boolean(state.localStream);
  const audioTracks = hasLocal ? state.localStream.getAudioTracks() : [];
  const videoTracks = hasLocal ? state.localStream.getVideoTracks() : [];
  els.muteButton.disabled = !audioTracks.length;
  els.muteButton.textContent = !audioTracks.length
    ? 'No Audio'
    : (state.mediaMuted ? 'Unmute Audio' : 'Mute Audio');
  els.cameraToggleButton.disabled = !videoTracks.length;
  els.cameraToggleButton.textContent = state.cameraOff ? 'Video On' : 'Video Off';
}

function attachLocalTrackHandlers(stream) {
  stream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (state.stoppingTracks) {
        return;
      }
      logEvent(state.sourceType.startsWith('screen') ? 'Desktop sharing ended.' : 'Video source ended.');
      if (state.role === 'host' && state.roomCode) {
        stopLive();
      } else {
        stopPreview();
      }
    }, { once: true });
  });
}

async function replaceTracksForLivePeers(stream) {
  const tracks = stream.getTracks();
  await Promise.all(Array.from(state.peers.entries()).map(async ([viewerId, peer]) => {
    const usedTrackIds = new Set();
    const senders = peer.getSenders().filter((sender) => sender.track);
    for (const sender of senders) {
      const replacement = tracks.find((track) => track.kind === sender.track.kind && !usedTrackIds.has(track.id));
      await sender.replaceTrack(replacement || null);
      if (replacement) {
        usedTrackIds.add(replacement.id);
      }
    }
    tracks
      .filter((track) => !usedTrackIds.has(track.id))
      .forEach((track) => peer.addTrack(track, stream));
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      sendSignal({
        action: 'live-signal',
        roomCode: state.roomCode,
        targetId: viewerId,
        signal: { description: peer.localDescription },
      });
    } catch (error) {
      logEvent(`Source switch failed for a viewer: ${error.message || 'unknown error'}.`);
    }
  }));
}

function connectSocket() {
  if (state.socket && state.socket.readyState <= 1) {
    return state.socket;
  }

  clearSignalReconnectTimer();
  const socket = new WebSocket(websocketUrl());
  state.socket = socket;
  setConnection('Connecting');
  setSignal('Opening');

  socket.addEventListener('open', () => {
    state.socketReconnectAttempts = 0;
    state.intentionalDisconnect = false;
    setConnection('Connected', 'live');
    setSignal('Connected');
    logEvent('Signal connected.');
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      logEvent('Skipped malformed signal.');
      return;
    }
    handleSocketMessage(message);
  });

  socket.addEventListener('close', () => {
    if (state.socket === socket) {
      state.socket = null;
    }
    const shouldReconnect = Boolean(state.roomCode && !state.intentionalDisconnect);
    setConnection('Offline');
    setSignal(shouldReconnect ? 'Reconnecting' : 'Closed');
    logEvent(shouldReconnect ? 'Signal closed; reconnecting.' : 'Signal closed.');
    if (shouldReconnect) {
      scheduleSignalReconnect();
    }
  });

  socket.addEventListener('error', () => {
    setConnection('Signal error', 'error');
    setSignal('Error');
    logEvent('Signal error.');
  });

  return socket;
}

function clearSignalReconnectTimer() {
  if (state.socketReconnectTimer) {
    window.clearTimeout(state.socketReconnectTimer);
    state.socketReconnectTimer = null;
  }
}

function scheduleSignalReconnect() {
  if (state.socketReconnectTimer || !state.roomCode) {
    return;
  }

  state.socketReconnectAttempts += 1;
  const delay = Math.min(
    SIGNAL_RECONNECT_MAX_MS,
    SIGNAL_RECONNECT_BASE_MS * state.socketReconnectAttempts,
  );
  state.socketReconnectTimer = window.setTimeout(() => {
    state.socketReconnectTimer = null;
    reconnectLiveSignal();
  }, delay);
}

function reconnectLiveSignal() {
  if (!state.roomCode || state.intentionalDisconnect) {
    return;
  }

  setSignal('Reconnecting');
  if (state.role === 'host' && state.localStream) {
    sendSignal({
      action: 'live-host',
      roomCode: state.roomCode,
      name: cleanText(els.hostName.value, 'Nova Host', 40),
      title: cleanText(els.streamTitle.value, 'Live from BNAPSEN', 70),
    });
    return;
  }

  if (state.role === 'viewer') {
    sendSignal({
      action: 'live-viewer',
      roomCode: state.roomCode,
      name: cleanText(els.viewerName.value, 'Viewer', 40),
    });
  }
}

function sendSignal(payload) {
  const socket = connectSocket();
  const message = JSON.stringify(payload);
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(message);
    return;
  }
  socket.addEventListener('open', () => socket.send(message), { once: true });
}

function goLive() {
  if (!state.localStream) {
    logEvent('Choose Camera + Mic, Desktop + Mic, or Desktop Only before going live.');
    return;
  }

  state.role = 'host';
  state.intentionalDisconnect = false;
  sendSignal({
    action: 'live-host',
    name: cleanText(els.hostName.value, 'Nova Host', 40),
    title: cleanText(els.streamTitle.value, 'Live from BNAPSEN', 70),
  });
  els.goLiveButton.disabled = true;
  els.stopLiveButton.disabled = false;
  setSignal('Creating room');
}

function joinStream() {
  const roomCode = normalizeRoomCode(els.joinRoomCode.value);
  if (!roomCode) {
    logEvent('Room code is required.');
    els.joinRoomCode.focus();
    return;
  }

  setMode('viewer');
  state.role = 'viewer';
  state.roomCode = roomCode;
  state.intentionalDisconnect = false;
  sendSignal({
    action: 'live-viewer',
    roomCode,
    name: cleanText(els.viewerName.value, 'Viewer', 40),
  });
  els.joinButton.disabled = true;
  els.leaveButton.disabled = false;
  setSignal('Joining');
  refreshStage();
}

function sendChatMessage() {
  const message = cleanText(els.chatInput.value, '', 240);
  if (!message) {
    return;
  }
  if (!state.roomCode) {
    logEvent('Join or start a stream before chatting.');
    return;
  }

  sendSignal({
    action: 'live-chat',
    roomCode: state.roomCode,
    message,
  });
  els.chatInput.value = '';
  els.chatInput.focus();
}

function handleSocketMessage(message) {
  const type = message.type || message.action;
  if (type === 'error') {
    setConnection('Signal error', 'error');
    const errorMessage = message.message || 'Unknown error.';
    logEvent(errorMessage);
    els.joinButton.disabled = false;
    els.goLiveButton.disabled = !state.localStream;
    if (state.roomCode && /already on air/i.test(errorMessage)) {
      scheduleSignalReconnect();
    }
    return;
  }

  if (type === 'live-ready') {
    handleLiveReady(message);
    return;
  }

  if (type === 'live-viewer-joined') {
    handleViewerJoined(message.viewer);
    return;
  }

  if (type === 'live-viewer-left') {
    removeHostPeer(message.viewerId);
    state.viewers = state.viewers.filter((viewer) => viewer.id !== message.viewerId);
    renderViewers();
    refreshStage();
    logEvent(`${message.viewerName || 'Viewer'} left.`);
    return;
  }

  if (type === 'live-viewer-list') {
    state.viewers = Array.isArray(message.viewers) ? message.viewers : [];
    renderViewers();
    refreshStage();
    return;
  }

  if (type === 'live-viewer-count') {
    state.viewers = new Array(Number(message.count || 0)).fill(null).map((_, index) => ({
      id: `viewer-${index}`,
      name: 'Viewer',
    }));
    refreshStage();
    return;
  }

  if (type === 'live-host-reconnecting') {
    setSignal('Host reconnecting');
    logEvent('Host signal is reconnecting; keeping the stream open.');
    return;
  }

  if (type === 'live-host-resumed') {
    state.hostId = message.hostId || state.hostId;
    els.hostLine.textContent = `${message.hostName || 'Host'} - ${message.title || 'Live stream'}`;
    setSignal('Host resumed');
    logEvent('Host signal resumed.');
    return;
  }

  if (type === 'live-chat') {
    addChatMessage(message.message);
    return;
  }

  if (type === 'live-signal') {
    handlePeerSignal(message);
    return;
  }

  if (type === 'live-ended') {
    logEvent('Host ended the stream.');
    leaveStream(false);
  }
}

function handleLiveReady(message) {
  clearSignalReconnectTimer();
  state.intentionalDisconnect = false;
  state.roomCode = normalizeRoomCode(message.roomCode || '');
  state.hostId = message.hostId || '';
  state.viewerId = message.viewerId || '';
  state.role = message.role || state.role;
  state.viewers = Array.isArray(message.viewers) ? message.viewers : [];
  state.chatMessages = Array.isArray(message.chatMessages) ? message.chatMessages : [];

  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${state.roomCode}`;
  els.shareLink.value = shareUrl;
  els.hostRoomCode.textContent = state.roomCode || '------';
  els.viewerRoomCode.textContent = state.roomCode || '------';
  els.joinRoomCode.value = state.roomCode || els.joinRoomCode.value;
  els.copyLinkButton.disabled = !state.roomCode;

  if (message.role === 'host') {
    setMode('host');
    els.stopLiveButton.disabled = false;
    setSignal('On air');
    logEvent(message.resumed ? `Room ${state.roomCode} reconnected.` : `Room ${state.roomCode} is live.`);
  } else {
    setMode('viewer');
    els.hostLine.textContent = `${message.hostName || 'Host'} - ${message.title || 'Live stream'}`;
    setSignal('Waiting for video');
    logEvent(`Joined room ${state.roomCode}.`);
  }

  renderViewers();
  renderChat();
  refreshStage();
  loadLiveRooms();
}

async function handleViewerJoined(viewer) {
  if (!viewer || !viewer.id || !state.localStream) {
    return;
  }
  state.viewers = uniqueViewers([...state.viewers, viewer]);
  renderViewers();
  refreshStage();
  logEvent(`${viewer.name || 'Viewer'} joined.`);

  const peer = createPeerConnection(viewer.id);
  state.localStream.getTracks().forEach((track) => {
    peer.addTrack(track, state.localStream);
  });

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendSignal({
      action: 'live-signal',
      roomCode: state.roomCode,
      targetId: viewer.id,
      signal: { description: peer.localDescription },
    });
    setSignal('Offer sent');
  } catch (error) {
    logEvent(`Offer failed: ${error.message || 'unknown error'}.`);
  }
}

function createPeerConnection(viewerId) {
  removeHostPeer(viewerId);
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.peers.set(viewerId, peer);

  peer.addEventListener('icecandidate', (event) => {
    if (!event.candidate) {
      return;
    }
    sendSignal({
      action: 'live-signal',
      roomCode: state.roomCode,
      targetId: viewerId,
      signal: { candidate: event.candidate },
    });
  });

  peer.addEventListener('connectionstatechange', () => {
    setSignal(peer.connectionState || 'Peer update');
  });

  return peer;
}

function createViewerPeer() {
  closeViewerPeer();
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.viewerPeer = peer;

  peer.addEventListener('track', (event) => {
    const [stream] = event.streams;
    if (stream) {
      els.remoteVideo.srcObject = stream;
      setSignal('Video live');
      logEvent('Video connected.');
      refreshStage();
    }
  });

  peer.addEventListener('icecandidate', (event) => {
    if (!event.candidate) {
      return;
    }
    sendSignal({
      action: 'live-signal',
      roomCode: state.roomCode,
      targetId: state.hostId,
      signal: { candidate: event.candidate },
    });
  });

  peer.addEventListener('connectionstatechange', () => {
    setSignal(peer.connectionState || 'Peer update');
  });

  return peer;
}

async function handlePeerSignal(message) {
  const signal = message.signal || {};

  if (state.role === 'host') {
    const peer = state.peers.get(message.fromId);
    if (!peer) {
      return;
    }
    try {
      if (signal.description) {
        await peer.setRemoteDescription(signal.description);
        await flushHostCandidateQueue(message.fromId, peer);
        setSignal('Answer received');
      }
      if (signal.candidate) {
        await addOrQueueHostCandidate(message.fromId, peer, signal.candidate);
      }
    } catch (error) {
      logEvent(`Host signal failed: ${error.message || 'unknown error'}.`);
    }
    return;
  }

  const peer = state.viewerPeer || createViewerPeer();
  try {
    if (signal.description) {
      await peer.setRemoteDescription(signal.description);
      await flushViewerCandidateQueue(peer);
      if (signal.description.type === 'offer') {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal({
          action: 'live-signal',
          roomCode: state.roomCode,
          targetId: state.hostId || message.fromId,
          signal: { description: peer.localDescription },
        });
        setSignal('Answer sent');
      }
    }
    if (signal.candidate) {
      await addOrQueueViewerCandidate(peer, signal.candidate);
    }
  } catch (error) {
    logEvent(`Viewer signal failed: ${error.message || 'unknown error'}.`);
  }
}

async function addOrQueueHostCandidate(viewerId, peer, candidate) {
  if (peer.remoteDescription) {
    await peer.addIceCandidate(candidate);
    return;
  }
  const queue = state.pendingHostCandidates.get(viewerId) || [];
  queue.push(candidate);
  state.pendingHostCandidates.set(viewerId, queue);
}

async function flushHostCandidateQueue(viewerId, peer) {
  const queue = state.pendingHostCandidates.get(viewerId) || [];
  state.pendingHostCandidates.delete(viewerId);
  for (const candidate of queue) {
    await peer.addIceCandidate(candidate);
  }
}

async function addOrQueueViewerCandidate(peer, candidate) {
  if (peer.remoteDescription) {
    await peer.addIceCandidate(candidate);
    return;
  }
  state.pendingViewerCandidates.push(candidate);
}

async function flushViewerCandidateQueue(peer) {
  const queue = state.pendingViewerCandidates.splice(0);
  for (const candidate of queue) {
    await peer.addIceCandidate(candidate);
  }
}

function toggleMute() {
  if (!state.localStream) {
    return;
  }
  state.mediaMuted = !state.mediaMuted;
  state.localStream.getAudioTracks().forEach((track) => {
    track.enabled = !state.mediaMuted;
  });
  updateMediaButtons();
  refreshStage();
}

function toggleCamera() {
  if (!state.localStream) {
    return;
  }
  state.cameraOff = !state.cameraOff;
  state.localStream.getVideoTracks().forEach((track) => {
    track.enabled = !state.cameraOff;
  });
  updateMediaButtons();
  refreshStage();
}

async function copyShareLink() {
  if (!els.shareLink.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(els.shareLink.value);
    logEvent('Share link copied.');
  } catch (error) {
    els.shareLink.select();
    document.execCommand('copy');
    logEvent('Share link selected.');
  }
}

function stopLive() {
  state.intentionalDisconnect = true;
  clearSignalReconnectTimer();
  sendSignal({ action: 'live-leave', roomCode: state.roomCode });
  closeAllHostPeers();
  stopLocalStream();
  resetLiveState();
  setMode('host');
  loadLiveRooms();
  logEvent('Stream stopped.');
}

function stopPreview() {
  if (state.roomCode) {
    return;
  }
  stopLocalStream();
  resetLiveState();
  logEvent('Preview stopped.');
}

function leaveStream(sendLeave = true) {
  state.intentionalDisconnect = true;
  clearSignalReconnectTimer();
  if (sendLeave) {
    sendSignal({ action: 'live-leave', roomCode: state.roomCode });
  }
  closeViewerPeer();
  state.roomCode = '';
  state.viewerId = '';
  state.hostId = '';
  state.viewers = [];
  state.chatMessages = [];
  els.joinButton.disabled = false;
  els.leaveButton.disabled = true;
  els.viewerRoomCode.textContent = '------';
  els.hostLine.textContent = 'No host connected.';
  els.chatInput.value = '';
  els.remoteVideo.srcObject = null;
  renderChat();
  refreshStage();
  loadLiveRooms();
}

function resetLiveState() {
  clearSignalReconnectTimer();
  state.roomCode = '';
  state.hostId = '';
  state.viewerId = '';
  state.viewers = [];
  state.chatMessages = [];
  state.mediaMuted = false;
  state.cameraOff = false;
  state.socketReconnectAttempts = 0;
  state.sourceType = state.localStream ? state.sourceType : '';
  state.sourceLabel = state.localStream ? state.sourceLabel : '';
  els.hostRoomCode.textContent = '------';
  els.viewerRoomCode.textContent = '------';
  els.shareLink.value = '';
  els.goLiveButton.disabled = !state.localStream;
  els.stopLiveButton.disabled = true;
  els.copyLinkButton.disabled = true;
  els.cameraButton.textContent = 'Camera + Mic';
  els.screenButton.textContent = 'Desktop + Mic';
  els.screenOnlyButton.textContent = 'Desktop Only';
  els.chatInput.value = '';
  els.stopPreviewButton.disabled = !state.localStream;
  updateMediaButtons();
  renderViewers();
  renderChat();
  refreshStage();
}

function stopLocalStream() {
  if (!state.localStream) {
    return;
  }
  stopStreamTracks(state.localStream);
  state.localStream = null;
  state.sourceType = '';
  state.sourceLabel = '';
  state.mediaMuted = false;
  state.cameraOff = false;
  els.localVideo.srcObject = null;
  els.localVideo.classList.remove('is-screen');
  updateCaptureButtons('Source Ready');
}

function stopStreamTracks(stream) {
  state.stoppingTracks = true;
  stream.getTracks().forEach((track) => track.stop());
  window.setTimeout(() => {
    state.stoppingTracks = false;
  }, 0);
}

function closeAllHostPeers() {
  state.peers.forEach((peer) => peer.close());
  state.peers.clear();
}

function removeHostPeer(viewerId) {
  const peer = state.peers.get(viewerId);
  if (peer) {
    peer.close();
  }
  state.peers.delete(viewerId);
  state.pendingHostCandidates.delete(viewerId);
}

function closeViewerPeer() {
  if (state.viewerPeer) {
    state.viewerPeer.close();
  }
  state.viewerPeer = null;
  state.pendingViewerCandidates = [];
}

function renderViewers() {
  const viewers = uniqueViewers(state.viewers);
  state.viewers = viewers;
  els.viewerListCount.textContent = String(viewers.length);
  els.viewerList.innerHTML = '';

  if (!viewers.length) {
    const item = document.createElement('li');
    item.textContent = 'No viewers connected.';
    els.viewerList.appendChild(item);
    return;
  }

  viewers.forEach((viewer) => {
    const item = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = viewer.name || 'Viewer';
    item.append(strong, document.createTextNode(` ${viewer.id ? viewer.id.slice(0, 8) : ''}`));
    els.viewerList.appendChild(item);
  });
}

function addChatMessage(message) {
  if (!message || !message.id) {
    return;
  }
  const exists = state.chatMessages.some((item) => item.id === message.id);
  if (!exists) {
    state.chatMessages.push(message);
    state.chatMessages = state.chatMessages.slice(-80);
  }
  renderChat();
}

function renderChat() {
  els.chatList.innerHTML = '';

  if (!state.chatMessages.length) {
    const item = document.createElement('li');
    item.className = 'chat-empty';
    item.textContent = state.roomCode ? 'No chat messages yet.' : 'Join or start a stream to chat.';
    els.chatList.appendChild(item);
    updateChatControls();
    return;
  }

  state.chatMessages.forEach((message) => {
    const item = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = message.senderName || 'Viewer';
    const role = document.createElement('span');
    role.className = 'chat-role';
    role.textContent = message.senderRole === 'host' ? 'Host' : formatChatTime(message.createdAt);
    meta.append(name, role);

    const body = document.createElement('div');
    body.className = 'chat-message';
    body.textContent = message.message || '';
    item.append(meta, body);
    els.chatList.appendChild(item);
  });
  els.chatList.scrollTop = els.chatList.scrollHeight;
  updateChatControls();
}

function updateChatControls() {
  const canChat = Boolean(state.roomCode && (state.role === 'host' || state.role === 'viewer'));
  els.chatInput.disabled = !canChat;
  els.sendChatButton.disabled = !canChat;
  els.chatRoomLabel.textContent = canChat ? state.roomCode : 'Offline';
  document.querySelectorAll('.emoji-button').forEach((button) => {
    button.disabled = !canChat;
  });
}

function formatChatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Now';
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function refreshStage() {
  const isHost = state.mode === 'host';
  const hasRemote = Boolean(els.remoteVideo.srcObject);
  const hasLocal = Boolean(state.localStream);
  const isLive = Boolean(state.roomCode && (state.role === 'host' || hasRemote));
  const title = isHost ? cleanText(els.streamTitle.value, 'Nova Live', 70) : 'Watching Nova Live';
  const audioTracks = hasLocal ? state.localStream.getAudioTracks() : [];
  const videoTracks = hasLocal ? state.localStream.getVideoTracks() : [];
  const audioState = audioTracks.length ? (state.mediaMuted ? 'Muted' : 'Audio on') : 'No audio';
  const videoState = videoTracks.length ? (state.cameraOff ? 'Video off' : 'Video on') : 'No video';

  els.roleBadge.textContent = isHost ? 'Host' : 'Viewer';
  els.stageTitle.textContent = title;
  els.viewerCount.textContent = `${state.viewers.length} viewer${state.viewers.length === 1 ? '' : 's'}`;
  els.roomReadout.textContent = state.roomCode || 'None';
  els.mediaReadout.textContent = isHost
    ? (hasLocal ? `${state.sourceLabel || 'Stream'} / ${videoState} / ${audioState}` : 'No source')
    : (hasRemote ? 'Receiving' : 'No video');
  els.streamStatus.textContent = isLive ? 'Live' : (hasLocal ? 'Preview' : 'Ready');
  els.onAirBadge.textContent = isLive ? 'On Air' : (hasLocal ? 'Preview' : 'Standby');
  els.onAirBadge.classList.toggle('is-live', isLive);
  els.hostRoomCode.textContent = state.roomCode || '------';
  els.viewerRoomCode.textContent = state.roomCode || '------';
  els.stopPreviewButton.disabled = !hasLocal || Boolean(state.roomCode);
  updateMediaButtons();

  els.localVideo.classList.toggle('is-visible', isHost && hasLocal);
  els.remoteVideo.classList.toggle('is-visible', !isHost && hasRemote);
  els.videoEmpty.classList.toggle('is-visible', (isHost && !hasLocal) || (!isHost && !hasRemote));
  els.emptyHint.textContent = isHost ? 'Choose camera or desktop capture to preview.' : 'The stream will appear here.';
  updateChatControls();
}

function setConnection(text, tone) {
  els.connectionPill.textContent = text;
  els.connectionPill.classList.toggle('is-live', tone === 'live');
  els.connectionPill.classList.toggle('is-error', tone === 'error');
}

function setSignal(text) {
  els.signalReadout.textContent = text;
}

function logEvent(text) {
  const item = document.createElement('li');
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `<strong>${time}</strong> ${escapeHtml(text)}`;
  els.signalLog.prepend(item);
  while (els.signalLog.children.length > 14) {
    els.signalLog.lastElementChild.remove();
  }
}

function cleanText(value, fallback, maxLength) {
  const next = String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return next || fallback;
}

function normalizeRoomCode(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
}

function uniqueViewers(viewers) {
  const seen = new Set();
  return viewers.filter((viewer) => {
    if (!viewer || !viewer.id || seen.has(viewer.id)) {
      return false;
    }
    seen.add(viewer.id);
    return true;
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
