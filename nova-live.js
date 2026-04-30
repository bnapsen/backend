'use strict';

const BACKEND_WS_URL = 'wss://nova-arcade-backend-1000121513328.us-central1.run.app';
const BACKEND_HTTP_URL = 'https://nova-arcade-backend-1000121513328.us-central1.run.app';
const SIGNAL_RECONNECT_BASE_MS = 1000;
const SIGNAL_RECONNECT_MAX_MS = 10000;
const CLIP_OWNERSHIP_STORAGE_KEY = 'nova-clips:owned-uploads';
const MAX_REPLAY_RECORDING_MS = 20 * 60 * 1000;
const MAX_REPLAY_UPLOAD_BYTES = 300 * 1024 * 1024;
const LEGACY_REPLAY_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
const REPLAY_VIDEO_BITS_PER_SECOND = 1200000;
const REPLAY_AUDIO_BITS_PER_SECOND = 96000;
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
  coStreams: new Map(),
  coStreamNames: new Map(),
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
  replays: [],
  replaysLoading: false,
  replaysError: '',
  socketReconnectTimer: null,
  socketReconnectAttempts: 0,
  intentionalDisconnect: false,
  recording: {
    recorder: null,
    chunks: [],
    blob: null,
    mimeType: '',
    previewUrl: '',
    startedAt: 0,
    durationMs: 0,
    timer: null,
    uploadInFlight: false,
    posted: false,
    finalizing: false,
    deleteInFlight: false,
    postedClipId: '',
    postedDeleteToken: '',
  },
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
  loadReplays();
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
    'coStreamPanel',
    'coStreamCount',
    'coStreamGrid',
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
    'refreshReplaysButton',
    'replayStatus',
    'replayGrid',
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
    'recordingTimer',
    'recordingStatus',
    'startRecordingButton',
    'stopRecordingButton',
    'recordingPreview',
    'recordingTitle',
    'recordingCaption',
    'postRecordingButton',
    'recordingPostLink',
    'deleteRecordingButton',
    'viewerName',
    'joinRoomCode',
    'joinButton',
    'leaveButton',
    'viewerRoomCode',
    'hostLine',
    'viewerShareStatus',
    'viewerPreviewVideo',
    'viewerCameraButton',
    'viewerScreenButton',
    'viewerStopShareButton',
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
  els.startRecordingButton.addEventListener('click', startReplayRecording);
  els.stopRecordingButton.addEventListener('click', () => stopReplayRecording('Recording stopped. Preparing replay clip...'));
  els.postRecordingButton.addEventListener('click', postReplayRecording);
  els.deleteRecordingButton.addEventListener('click', deletePostedReplay);
  els.joinButton.addEventListener('click', joinStream);
  els.leaveButton.addEventListener('click', leaveStream);
  els.viewerCameraButton.addEventListener('click', startViewerCameraShare);
  els.viewerScreenButton.addEventListener('click', startViewerScreenShare);
  els.viewerStopShareButton.addEventListener('click', stopCoStream);
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
  els.refreshReplaysButton.addEventListener('click', () => loadReplays({ announce: true }));
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

function clipsEndpoint() {
  return `${apiBaseUrl()}/api/clips`;
}

function clipDeleteEndpoint() {
  return `${apiBaseUrl()}/api/clips/delete`;
}

function clipUploadSessionEndpoint() {
  return `${apiBaseUrl()}/api/clips/upload-session`;
}

function clipFinalizeUploadEndpoint() {
  return `${apiBaseUrl()}/api/clips/finalize-upload`;
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
  renderCoStreams();
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

async function loadReplays(options = {}) {
  if (!els.replayGrid) {
    return;
  }

  state.replaysLoading = true;
  renderReplays();

  try {
    const response = await fetch(clipsEndpoint(), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Replay list returned ${response.status}`);
    }
    const data = await response.json();
    const clips = Array.isArray(data.clips) ? data.clips : [];
    const serverReplays = clips
      .filter(isLiveReplayClip)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    const serverReplayIds = new Set(serverReplays.map((clip) => clip.id));
    const localReplays = state.replays
      .filter((clip) => isLiveReplayClip(clip) && !serverReplayIds.has(clip.id));
    state.replays = [...localReplays, ...serverReplays]
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, 12);
    state.replaysError = '';
    if (options.announce) {
      logEvent('Replay library refreshed.');
    }
  } catch (error) {
    state.replaysError = 'Replay library unavailable.';
    if (options.announce) {
      logEvent(`Replay library failed: ${error.message || 'network error'}.`);
    }
  } finally {
    state.replaysLoading = false;
    renderReplays(options.focusClipId || '');
  }
}

function isLiveReplayClip(clip) {
  if (!clip) {
    return false;
  }
  const origin = String(clip.origin || clip.sourceContext || '').toLowerCase();
  if (origin === 'nova-live') {
    return true;
  }
  if (origin === 'nova-clips') {
    return false;
  }
  const text = `${clip.title || ''} ${clip.caption || ''}`.toLowerCase();
  return text.includes('nova live') || /\breplay\b/.test(text);
}

function upsertReplayClip(clip) {
  if (!clip || !clip.id || !isLiveReplayClip(clip)) {
    return;
  }
  state.replays = [
    clip,
    ...state.replays.filter((entry) => entry && entry.id !== clip.id),
  ].slice(0, 12);
}

function renderReplays(focusClipId = '') {
  if (!els.replayGrid || !els.replayStatus) {
    return;
  }

  els.replayGrid.innerHTML = '';
  els.replayStatus.classList.toggle('is-error', Boolean(state.replaysError));

  if (state.replaysLoading && !state.replays.length) {
    els.replayStatus.textContent = 'Loading Nova Live replays...';
    return;
  }

  if (state.replaysError && !state.replays.length) {
    els.replayStatus.textContent = state.replaysError;
    return;
  }

  if (!state.replays.length) {
    els.replayStatus.textContent = 'No Nova Live replays posted yet.';
    return;
  }

  els.replayStatus.textContent = `${state.replays.length} replay${state.replays.length === 1 ? '' : 's'} on Nova Live.`;
  const ownedUploads = readOwnedUploads();
  state.replays.forEach((clip) => {
    els.replayGrid.appendChild(createReplayCard(clip, ownedUploads, clip.id === focusClipId));
  });

  if (focusClipId) {
    const focusedCard = document.getElementById(`replay-${focusClipId}`);
    if (focusedCard) {
      window.setTimeout(() => focusedCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 80);
    }
  }
}

function createReplayCard(clip, ownedUploads, isNew = false) {
  const article = document.createElement('article');
  article.className = `replay-card${isNew ? ' is-new' : ''}`;
  article.id = `replay-${clip.id}`;

  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = resolveClipMediaUrl(clip.videoPath);
  const posterUrl = resolveClipMediaUrl(clip.posterPath);
  if (posterUrl) {
    video.poster = posterUrl;
  }
  article.appendChild(video);

  const body = document.createElement('div');
  body.className = 'replay-card-body';

  const title = document.createElement('h3');
  title.textContent = clip.title || 'Nova Live replay';
  body.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'replay-meta';
  meta.textContent = [
    formatReplayDuration(clip.durationSeconds),
    formatReplayDate(clip.createdAt),
    clip.uploaderName || 'Nova Host',
  ].filter(Boolean).join(' - ');
  body.appendChild(meta);

  if (clip.caption) {
    const caption = document.createElement('p');
    caption.className = 'replay-caption';
    caption.textContent = clip.caption;
    body.appendChild(caption);
  }

  const footer = document.createElement('div');
  footer.className = 'replay-card-footer';

  const stats = document.createElement('p');
  stats.className = 'replay-stats';
  stats.textContent = formatReplayStats(clip);
  footer.appendChild(stats);

  const deleteToken = ownedUploads[clip.id];
  if (deleteToken) {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'small-button replay-delete-button';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', async () => {
      if (!window.confirm('Delete this replay from Nova Live?')) {
        return;
      }
      deleteButton.disabled = true;
      try {
        await requestClipDelete(clip.id, deleteToken);
        forgetOwnedUpload(clip.id);
        state.replays = state.replays.filter((entry) => entry.id !== clip.id);
        renderReplays();
        logEvent('Replay deleted from Nova Live.');
      } catch (error) {
        deleteButton.disabled = false;
        logEvent(`Replay delete failed: ${error.message || 'network error'}.`);
      }
    });
    footer.appendChild(deleteButton);
  }

  body.appendChild(footer);
  article.appendChild(body);
  return article;
}

function resolveClipMediaUrl(value) {
  const pathValue = String(value || '').trim();
  if (!pathValue) {
    return '';
  }
  if (/^(https?:|data:|blob:)/i.test(pathValue)) {
    return pathValue;
  }
  return pathValue.startsWith('/')
    ? `${apiBaseUrl()}${pathValue}`
    : `${apiBaseUrl()}/${pathValue.replace(/^\/+/, '')}`;
}

function formatReplayDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  if (!totalSeconds) {
    return 'processing';
  }
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatReplayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'just now';
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatReplayStats(clip) {
  const views = Number(clip.viewCount || 0);
  const reactions = Number(clip.likeCount || 0) + Number(clip.dislikeCount || 0);
  const comments = Number(clip.commentCount || 0);
  return `${views} view${views === 1 ? '' : 's'} - ${reactions} reaction${reactions === 1 ? '' : 's'} - ${comments} comment${comments === 1 ? '' : 's'}`;
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

async function startViewerCameraShare() {
  if (!canViewerCoStream()) {
    logEvent('Join a live room before sharing back.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setViewerShareStatus('Camera unavailable', 'error');
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
      sourceType: 'viewer-camera',
      sourceLabel: 'Camera co-stream',
      readyText: 'Camera Sharing',
      logText: 'Camera co-stream started.',
    });
  } catch (error) {
    setViewerShareStatus('Camera blocked', 'error');
    logEvent(`Camera co-stream failed: ${error.message || 'permission denied'}.`);
  }
}

async function startViewerScreenShare() {
  if (!canViewerCoStream()) {
    logEvent('Join a live room before sharing back.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    setViewerShareStatus('Desktop unavailable', 'error');
    logEvent('This browser does not expose desktop capture.');
    return;
  }

  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: true,
    });
    const tracks = [...displayStream.getVideoTracks(), ...displayStream.getAudioTracks()];
    if (navigator.mediaDevices.getUserMedia) {
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
        logEvent('Mic was not added to the co-stream desktop share.');
      }
    }
    const stream = new MediaStream(tracks);
    await setLocalStream(stream, {
      sourceType: 'viewer-screen',
      sourceLabel: 'Desktop co-stream',
      readyText: 'Desktop Sharing',
      logText: 'Desktop co-stream started.',
    });
  } catch (error) {
    setViewerShareStatus('Desktop blocked', 'error');
    logEvent(`Desktop co-stream failed: ${error.message || 'permission denied'}.`);
  }
}

async function setLocalStream(stream, options = {}) {
  if (isReplayRecording()) {
    stopReplayRecording('Recording stopped before the source changed.');
  }

  const previousStream = state.localStream;
  state.localStream = stream;
  state.sourceType = options.sourceType || 'custom';
  state.sourceLabel = options.sourceLabel || 'Stream';
  state.mediaMuted = false;
  state.cameraOff = false;

  els.localVideo.srcObject = state.localStream;
  if (els.viewerPreviewVideo) {
    els.viewerPreviewVideo.srcObject = state.role === 'viewer' ? state.localStream : null;
  }
  els.localVideo.classList.toggle('is-screen', state.sourceType.startsWith('screen'));
  els.viewerPreviewVideo.classList.toggle('is-visible', state.role === 'viewer');
  els.viewerPreviewVideo.classList.toggle('is-screen', state.sourceType.includes('screen'));
  updateCaptureButtons(options.readyText || 'Source Ready');
  attachLocalTrackHandlers(stream);

  if (state.roomCode && state.role === 'host' && state.peers.size) {
    await replaceTracksForLivePeers(stream);
  }
  if (state.roomCode && state.role === 'viewer') {
    await shareViewerStreamWithHost(stream);
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
  updateRecordingControls();
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
      if (state.role === 'viewer' && state.roomCode) {
        stopCoStream();
        return;
      }
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

async function addOrReplaceLocalTracks(peer, stream) {
  if (!peer || !stream) {
    return;
  }

  const tracks = stream.getTracks();
  const usedTrackIds = new Set();
  const senders = peer.getSenders().filter((sender) => sender.track);
  for (const sender of senders) {
    const replacement = tracks.find((track) => track.kind === sender.track.kind && !usedTrackIds.has(track.id));
    if (replacement) {
      await sender.replaceTrack(replacement);
      usedTrackIds.add(replacement.id);
    } else {
      peer.removeTrack(sender);
    }
  }
  tracks
    .filter((track) => !usedTrackIds.has(track.id))
    .forEach((track) => peer.addTrack(track, stream));
}

async function shareViewerStreamWithHost(stream) {
  if (!canViewerCoStream() || !stream) {
    return;
  }
  const peer = state.viewerPeer || createViewerPeer();
  try {
    await addOrReplaceLocalTracks(peer, stream);
  } catch (error) {
    setViewerShareStatus('Share failed', 'error');
    logEvent(`Co-stream tracks failed: ${error.message || 'unknown error'}.`);
    return;
  }
  setViewerShareStatus('Sharing');
  sendSignal({
    action: 'live-signal',
    roomCode: state.roomCode,
    targetId: state.hostId,
    signal: { coStream: true },
  });

  if (!peer.remoteDescription || peer.signalingState !== 'stable') {
    setSignal('Co-stream ready');
    updateViewerShareControls();
    return;
  }

  await renegotiateViewerPeer('Co-stream offer sent');
}

async function renegotiateViewerPeer(successText = 'Offer sent') {
  const peer = state.viewerPeer;
  if (!peer || !state.roomCode || !state.hostId || !peer.remoteDescription) {
    return;
  }
  if (peer.signalingState !== 'stable') {
    logEvent('Co-stream will renegotiate after the current signal settles.');
    return;
  }

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendSignal({
      action: 'live-signal',
      roomCode: state.roomCode,
      targetId: state.hostId,
      signal: { description: peer.localDescription },
    });
    setSignal(successText);
  } catch (error) {
    logEvent(`Co-stream negotiation failed: ${error.message || 'unknown error'}.`);
  }
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

  peer.addEventListener('track', (event) => {
    const [stream] = event.streams;
    if (stream) {
      setCoStream(viewerId, stream);
      setSignal('Co-stream live');
    }
  });

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
  if (state.localStream) {
    addOrReplaceLocalTracks(peer, state.localStream);
  }

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
      if (signal.coStream === false) {
        removeCoStream(message.fromId);
      }
      if (signal.description) {
        await peer.setRemoteDescription(signal.description);
        await flushHostCandidateQueue(message.fromId, peer);
        if (signal.description.type === 'offer') {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          sendSignal({
            action: 'live-signal',
            roomCode: state.roomCode,
            targetId: message.fromId,
            signal: { description: peer.localDescription },
          });
          setSignal('Co-stream answer sent');
        } else {
          setSignal('Answer received');
        }
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

function isReplayRecording() {
  return Boolean(state.recording.recorder && state.recording.recorder.state === 'recording');
}

function preferredRecordingMimeType() {
  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4',
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

function startReplayRecording() {
  if (!state.localStream) {
    setRecordingStatus('Choose Camera + Mic, Desktop + Mic, or Desktop Only before recording.', 'error');
    return;
  }
  if (!window.MediaRecorder) {
    setRecordingStatus('This browser does not support recording live streams.', 'error');
    return;
  }
  if (isReplayRecording()) {
    return;
  }

  resetReplayRecording({ keepStatus: true });
  const mimeType = preferredRecordingMimeType();
  const options = mimeType ? { mimeType } : {};
  if (state.localStream.getVideoTracks().length) {
    options.videoBitsPerSecond = REPLAY_VIDEO_BITS_PER_SECOND;
  }
  if (state.localStream.getAudioTracks().length) {
    options.audioBitsPerSecond = REPLAY_AUDIO_BITS_PER_SECOND;
  }
  let recorder;
  try {
    recorder = new MediaRecorder(state.localStream, options);
  } catch (error) {
    setRecordingStatus(`Recording could not start: ${error.message || 'browser error'}.`, 'error');
    return;
  }

  state.recording.recorder = recorder;
  state.recording.chunks = [];
  state.recording.blob = null;
  state.recording.mimeType = recorder.mimeType || mimeType || 'video/webm';
  state.recording.startedAt = Date.now();
  state.recording.durationMs = 0;
  state.recording.posted = false;
  state.recording.finalizing = false;

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      state.recording.chunks.push(event.data);
    }
  });
  recorder.addEventListener('stop', finishReplayRecording, { once: true });
  recorder.addEventListener('error', (event) => {
    const message = event.error && event.error.message ? event.error.message : 'unknown recorder error';
    setRecordingStatus(`Recording error: ${message}.`, 'error');
    stopReplayRecording();
  });

  try {
    recorder.start(1000);
  } catch (error) {
    state.recording.recorder = null;
    setRecordingStatus(`Recording could not start: ${error.message || 'browser error'}.`, 'error');
    return;
  }

  setRecordingStatus('Recording replay clip...', 'recording');
  updateRecordingTimer();
  state.recording.timer = window.setInterval(() => {
    updateRecordingTimer();
    if (Date.now() - state.recording.startedAt >= MAX_REPLAY_RECORDING_MS) {
      stopReplayRecording('Recording reached the 20-minute replay limit.');
    }
  }, 250);
  updateRecordingControls();
  logEvent('Replay recording started.');
}

function stopReplayRecording(statusText = '') {
  if (!isReplayRecording()) {
    return;
  }

  const recorder = state.recording.recorder;
  clearRecordingTimer();
  state.recording.finalizing = true;
  if (statusText) {
    setRecordingStatus(statusText, 'ready');
  }
  try {
    recorder.stop();
  } catch (error) {
    state.recording.recorder = null;
    state.recording.finalizing = false;
    setRecordingStatus(`Recording could not stop cleanly: ${error.message || 'browser error'}.`, 'error');
  }
  updateRecordingControls();
}

function finishReplayRecording() {
  clearRecordingTimer();
  state.recording.durationMs = Math.max(0, Date.now() - state.recording.startedAt);
  state.recording.recorder = null;
  state.recording.finalizing = false;
  const chunks = state.recording.chunks.splice(0);
  const blob = new Blob(chunks, { type: state.recording.mimeType || 'video/webm' });

  if (!blob.size) {
    state.recording.blob = null;
    state.recording.finalizing = false;
    setRecordingStatus('No replay data was captured. Try recording again.', 'error');
    updateRecordingControls();
    return;
  }
  if (blob.size > MAX_REPLAY_UPLOAD_BYTES) {
    state.recording.blob = null;
    state.recording.finalizing = false;
    setRecordingStatus('Replay is larger than the 300 MB upload limit.', 'error');
    updateRecordingControls();
    return;
  }

  state.recording.blob = blob;
  state.recording.posted = false;
  releaseRecordingPreview();
  state.recording.previewUrl = URL.createObjectURL(blob);
  els.recordingPreview.src = state.recording.previewUrl;
  els.recordingPreview.classList.add('is-visible');
  els.recordingPostLink.classList.add('hidden');
  updateRecordingTimer();
  setRecordingStatus(`Replay saved (${formatFileSize(blob.size)}). Review it, then post to Nova Live.`, 'ready');
  updateRecordingControls();
  logEvent('Replay recording saved.');
}

function resetReplayRecording(options = {}) {
  clearRecordingTimer();
  if (state.recording.recorder && state.recording.recorder.state !== 'inactive') {
    try {
      state.recording.recorder.stop();
    } catch {
      // Ignore recorder cleanup errors while replacing a draft replay.
    }
  }
  state.recording.recorder = null;
  state.recording.chunks = [];
  state.recording.blob = null;
  state.recording.mimeType = '';
  state.recording.startedAt = 0;
  state.recording.durationMs = 0;
  state.recording.posted = false;
  state.recording.finalizing = false;
  state.recording.postedClipId = '';
  state.recording.postedDeleteToken = '';
  releaseRecordingPreview();
  els.recordingPostLink.classList.add('hidden');
  els.recordingPostLink.href = '#liveReplays';
  els.deleteRecordingButton.classList.add('hidden');
  if (!options.keepStatus) {
    setRecordingStatus(state.localStream
      ? 'Ready to record a 20-minute replay.'
      : 'Choose a stream source to record up to 20 minutes.');
  }
  updateRecordingTimer();
  updateRecordingControls();
}

function releaseRecordingPreview() {
  if (state.recording.previewUrl) {
    URL.revokeObjectURL(state.recording.previewUrl);
    state.recording.previewUrl = '';
  }
  if (els.recordingPreview) {
    els.recordingPreview.removeAttribute('src');
    els.recordingPreview.classList.remove('is-visible');
    els.recordingPreview.load();
  }
}

function clearRecordingTimer() {
  if (state.recording.timer) {
    window.clearInterval(state.recording.timer);
    state.recording.timer = null;
  }
}

function updateRecordingTimer() {
  if (!els.recordingTimer) {
    return;
  }
  const elapsedMs = isReplayRecording()
    ? Date.now() - state.recording.startedAt
    : state.recording.durationMs;
  els.recordingTimer.textContent = formatRecordingTime(elapsedMs);
}

function updateRecordingControls() {
  if (!els.startRecordingButton) {
    return;
  }

  const hasSource = Boolean(state.localStream);
  const recording = isReplayRecording();
  const supportsRecorder = Boolean(window.MediaRecorder);
  const busy = recording || state.recording.finalizing || state.recording.uploadInFlight || state.recording.deleteInFlight;
  els.startRecordingButton.disabled = !hasSource || busy || !supportsRecorder;
  els.stopRecordingButton.disabled = !recording;
  els.postRecordingButton.disabled = !state.recording.blob || busy;
  els.deleteRecordingButton.disabled = !state.recording.postedClipId
    || !state.recording.postedDeleteToken
    || state.recording.deleteInFlight
    || state.recording.uploadInFlight;

  if (!state.recording.blob && !state.recording.posted && !busy) {
    if (!supportsRecorder) {
      setRecordingStatus('This browser does not support live replay recording.', 'error');
    } else {
      setRecordingStatus(hasSource
        ? 'Ready to record a 20-minute replay.'
        : 'Choose a stream source to record up to 20 minutes.');
    }
  }
}

function setRecordingStatus(text, tone = '') {
  if (!els.recordingStatus) {
    return;
  }
  els.recordingStatus.textContent = text;
  els.recordingStatus.classList.toggle('is-recording', tone === 'recording');
  els.recordingStatus.classList.toggle('is-ready', tone === 'ready');
  els.recordingStatus.classList.toggle('is-error', tone === 'error');
}

async function postReplayRecording() {
  if (!state.recording.blob || state.recording.uploadInFlight) {
    return;
  }
  if (isReplayRecording()) {
    setRecordingStatus('Stop the recording before posting it.', 'error');
    return;
  }

  const title = cleanText(
    els.recordingTitle.value,
    `${cleanText(els.streamTitle.value, 'Nova Live', 70)} replay`,
    80,
  );
  const caption = cleanOptionalText(els.recordingCaption.value, 240);
  const uploaderName = cleanText(els.hostName.value, 'Nova Host', 48);
  const file = makeReplayFile(state.recording.blob, title);

  state.recording.uploadInFlight = true;
  updateRecordingControls();
  setRecordingStatus('Preparing replay upload...', 'ready');

  try {
    let payload;
    try {
      const session = await requestReplayUploadSession(file, title, caption, uploaderName);
      setRecordingStatus('Uploading replay to cloud storage... 0%', 'ready');
      await uploadFileToCloudSession(session.uploadUrl, file, (loaded, total) => {
        const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
        setRecordingStatus(`Uploading replay to cloud storage... ${percent}%`, 'ready');
      }, session.uploadContentType || session.mimeType || '');
      setRecordingStatus('Processing replay for Nova Live...', 'ready');
      payload = await finalizeReplayUpload(session.rawUploadKey, session.uploadToken);
    } catch (error) {
      if (file.size > LEGACY_REPLAY_UPLOAD_MAX_BYTES) {
        throw error;
      }
      setRecordingStatus('Direct upload paused. Trying legacy upload...', 'ready');
      payload = await uploadReplayLegacy(file, title, caption, uploaderName);
    }

    if (payload.clip && payload.deleteToken) {
      rememberOwnedUpload(payload.clip.id, payload.deleteToken);
      state.recording.postedClipId = payload.clip.id;
      state.recording.postedDeleteToken = payload.deleteToken;
    }
    if (payload.clip) {
      upsertReplayClip(payload.clip);
      renderReplays(payload.clip.id);
    }
    els.recordingPostLink.href = payload.clip && payload.clip.id
      ? `#replay-${encodeURIComponent(payload.clip.id)}`
      : '#liveReplays';
    els.recordingPostLink.classList.remove('hidden');
    els.deleteRecordingButton.classList.toggle('hidden', !state.recording.postedClipId);
    state.recording.blob = null;
    state.recording.posted = true;
    setRecordingStatus(payload.clip && payload.clip.status === 'active'
      ? 'Replay posted to Nova Live.'
      : 'Replay uploaded and sent to moderation.', 'ready');
    logEvent('Replay posted to Nova Live.');
    loadReplays({ focusClipId: payload.clip && payload.clip.id ? payload.clip.id : '' });
  } catch (error) {
    setRecordingStatus(`Replay upload failed: ${error.message || 'network error'}.`, 'error');
    logEvent(`Replay upload failed: ${error.message || 'network error'}.`);
  } finally {
    state.recording.uploadInFlight = false;
    updateRecordingControls();
  }
}

async function requestReplayUploadSession(file, title, caption, uploaderName) {
  const response = await fetch(clipUploadSessionEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || '',
      sizeBytes: file.size,
      uploaderName,
      title,
      caption,
      origin: 'nova-live',
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Unable to start a replay upload.');
  }
  return payload;
}

function uploadFileToCloudSession(uploadUrl, file, onProgress, uploadContentType = '') {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', uploadContentType || file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') {
        return;
      }
      onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(xhr.responseText || 'Direct upload failed.'));
    };
    xhr.onerror = () => reject(new Error('Direct upload failed.'));
    xhr.onabort = () => reject(new Error('Direct upload was canceled.'));
    xhr.send(file);
  });
}

async function finalizeReplayUpload(rawUploadKey, uploadToken) {
  const response = await fetch(clipFinalizeUploadEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rawUploadKey,
      uploadToken,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Unable to finish processing that replay.');
  }
  return payload;
}

async function uploadReplayLegacy(file, title, caption, uploaderName) {
  const formData = new FormData();
  formData.append('clipFile', file, file.name);
  formData.append('uploaderName', uploaderName);
  formData.append('title', title);
  formData.append('origin', 'nova-live');
  if (caption) {
    formData.append('caption', caption);
  }

  const response = await fetch(clipsEndpoint(), {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Unable to save that replay right now.');
  }
  return payload;
}

function makeReplayFile(blob, title) {
  const extension = replayFileExtension(blob.type);
  const name = `${slugifyFileName(title) || 'nova-live-replay'}-${Date.now()}${extension}`;
  if (typeof File === 'function') {
    return new File([blob], name, {
      type: blob.type || 'video/webm',
      lastModified: Date.now(),
    });
  }
  const file = new Blob([blob], { type: blob.type || 'video/webm' });
  file.name = name;
  file.lastModified = Date.now();
  return file;
}

function replayFileExtension(mimeType = '') {
  if (/mp4/i.test(mimeType)) {
    return '.mp4';
  }
  if (/quicktime/i.test(mimeType)) {
    return '.mov';
  }
  return '.webm';
}

function slugifyFileName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function formatRecordingTime(ms) {
  const totalSeconds = Math.max(0, Math.min(Math.floor(ms / 1000), Math.ceil(MAX_REPLAY_RECORDING_MS / 1000)));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function readOwnedUploads() {
  try {
    const raw = window.localStorage.getItem(CLIP_OWNERSHIP_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOwnedUploads(ownedUploads) {
  try {
    window.localStorage.setItem(CLIP_OWNERSHIP_STORAGE_KEY, JSON.stringify(ownedUploads));
  } catch {
    // Ignore storage failures in restrictive browsers.
  }
}

function rememberOwnedUpload(clipId, deleteToken) {
  if (!clipId || !deleteToken) {
    return;
  }
  const ownedUploads = readOwnedUploads();
  ownedUploads[clipId] = deleteToken;
  writeOwnedUploads(ownedUploads);
}

function forgetOwnedUpload(clipId) {
  if (!clipId) {
    return;
  }
  const ownedUploads = readOwnedUploads();
  delete ownedUploads[clipId];
  writeOwnedUploads(ownedUploads);
}

async function requestClipDelete(clipId, deleteToken) {
  const response = await fetch(clipDeleteEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clipId,
      deleteToken,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Unable to delete that replay.');
  }
  return payload;
}

async function deletePostedReplay() {
  const clipId = state.recording.postedClipId;
  const deleteToken = state.recording.postedDeleteToken;
  if (!clipId || !deleteToken || state.recording.deleteInFlight) {
    return;
  }

  if (!window.confirm('Delete this posted replay from Nova Live?')) {
    return;
  }

  state.recording.deleteInFlight = true;
  updateRecordingControls();
  setRecordingStatus('Deleting replay...', 'ready');

  try {
    await requestClipDelete(clipId, deleteToken);
    forgetOwnedUpload(clipId);
    state.recording.postedClipId = '';
    state.recording.postedDeleteToken = '';
    state.recording.posted = false;
    state.replays = state.replays.filter((clip) => clip.id !== clipId);
    els.recordingPostLink.classList.add('hidden');
    els.recordingPostLink.href = '#liveReplays';
    els.deleteRecordingButton.classList.add('hidden');
    renderReplays();
    loadReplays();
    setRecordingStatus('Replay deleted from Nova Live.', 'ready');
    logEvent('Replay deleted from Nova Live.');
  } catch (error) {
    setRecordingStatus(`Replay delete failed: ${error.message || 'network error'}.`, 'error');
    logEvent(`Replay delete failed: ${error.message || 'network error'}.`);
  } finally {
    state.recording.deleteInFlight = false;
    updateRecordingControls();
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
  if (state.role === 'viewer' && state.localStream) {
    stopLocalStream();
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
  if (els.viewerPreviewVideo) {
    els.viewerPreviewVideo.srcObject = null;
    els.viewerPreviewVideo.classList.remove('is-visible', 'is-screen');
  }
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
  if (state.role === 'host') {
    clearCoStreams();
  }
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
  if (isReplayRecording()) {
    stopReplayRecording('Recording stopped with the stream.');
  }
  stopStreamTracks(state.localStream);
  state.localStream = null;
  state.sourceType = '';
  state.sourceLabel = '';
  state.mediaMuted = false;
  state.cameraOff = false;
  els.localVideo.srcObject = null;
  els.localVideo.classList.remove('is-screen');
  if (els.viewerPreviewVideo) {
    els.viewerPreviewVideo.srcObject = null;
    els.viewerPreviewVideo.classList.remove('is-visible', 'is-screen');
  }
  updateCaptureButtons('Source Ready');
  updateViewerShareControls();
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
  clearCoStreams();
}

function removeHostPeer(viewerId) {
  const peer = state.peers.get(viewerId);
  if (peer) {
    peer.close();
  }
  state.peers.delete(viewerId);
  state.pendingHostCandidates.delete(viewerId);
  removeCoStream(viewerId);
}

function closeViewerPeer() {
  if (state.viewerPeer) {
    state.viewerPeer.close();
  }
  state.viewerPeer = null;
  state.pendingViewerCandidates = [];
}

function canViewerCoStream() {
  return state.role === 'viewer' && Boolean(state.roomCode && state.hostId);
}

function setViewerShareStatus(text, tone = '') {
  if (!els.viewerShareStatus) {
    return;
  }
  els.viewerShareStatus.textContent = text;
  els.viewerShareStatus.classList.toggle('is-error', tone === 'error');
}

function updateViewerShareControls() {
  if (!els.viewerCameraButton) {
    return;
  }
  const canShare = canViewerCoStream();
  const sharing = Boolean(state.role === 'viewer' && state.localStream);
  els.viewerCameraButton.disabled = !canShare || sharing;
  els.viewerScreenButton.disabled = !canShare || sharing;
  els.viewerStopShareButton.disabled = !sharing;
  els.viewerPreviewVideo.classList.toggle('is-visible', sharing);
  if (!sharing && els.viewerPreviewVideo.srcObject) {
    els.viewerPreviewVideo.srcObject = null;
  }
  if (sharing) {
    setViewerShareStatus('Sharing');
  } else if (canShare) {
    setViewerShareStatus('Ready');
  } else {
    setViewerShareStatus('Offline');
  }
}

async function stopCoStream() {
  if (state.role !== 'viewer' || !state.localStream) {
    updateViewerShareControls();
    return;
  }

  const stream = state.localStream;
  const streamTrackIds = new Set(stream.getTracks().map((track) => track.id));
  const peer = state.viewerPeer;
  const canRenegotiate = Boolean(peer && peer.remoteDescription);
  if (peer) {
    peer.getSenders().forEach((sender) => {
      if (sender.track && streamTrackIds.has(sender.track.id)) {
        try {
          peer.removeTrack(sender);
        } catch (error) {
          logEvent(`Co-stream sender cleanup failed: ${error.message || 'unknown error'}.`);
        }
      }
    });
  }

  sendSignal({
    action: 'live-signal',
    roomCode: state.roomCode,
    targetId: state.hostId,
    signal: { coStream: false },
  });

  stopStreamTracks(stream);
  state.localStream = null;
  state.sourceType = '';
  state.sourceLabel = '';
  state.mediaMuted = false;
  state.cameraOff = false;
  els.localVideo.srcObject = null;
  els.localVideo.classList.remove('is-screen');
  els.viewerPreviewVideo.srcObject = null;
  els.viewerPreviewVideo.classList.remove('is-visible', 'is-screen');
  setViewerShareStatus('Ready');
  updateCaptureButtons('Source Ready');
  updateViewerShareControls();
  refreshStage();
  logEvent('Co-stream stopped.');

  if (canRenegotiate) {
    await renegotiateViewerPeer('Co-stream stopped');
  }
}

function setCoStream(viewerId, stream) {
  const safeViewerId = String(viewerId || '').trim();
  if (!safeViewerId || !stream) {
    return;
  }
  state.coStreams.set(safeViewerId, stream);
  renderCoStreams();
}

function removeCoStream(viewerId) {
  const safeViewerId = String(viewerId || '').trim();
  if (!safeViewerId) {
    return;
  }
  state.coStreams.delete(safeViewerId);
  renderCoStreams();
}

function clearCoStreams() {
  state.coStreams.clear();
  renderCoStreams();
}

function renderCoStreams() {
  if (!els.coStreamGrid || !els.coStreamPanel) {
    return;
  }
  const streams = Array.from(state.coStreams.entries());
  els.coStreamPanel.classList.toggle('is-visible', state.mode === 'host' && streams.length > 0);
  els.coStreamCount.textContent = `${streams.length} guest${streams.length === 1 ? '' : 's'}`;
  els.coStreamGrid.innerHTML = '';
  if (!streams.length) {
    const empty = document.createElement('article');
    empty.className = 'co-stream-empty';
    empty.textContent = 'Guests who share back will appear here.';
    els.coStreamGrid.appendChild(empty);
    return;
  }

  streams.forEach(([viewerId, stream]) => {
    const article = document.createElement('article');
    article.className = 'co-stream-card';
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.controls = true;
    video.srcObject = stream;
    const label = document.createElement('strong');
    label.textContent = state.coStreamNames.get(viewerId) || `Guest ${viewerId.slice(0, 8)}`;
    article.append(video, label);
    els.coStreamGrid.appendChild(article);
  });
}

function renderViewers() {
  const viewers = uniqueViewers(state.viewers);
  state.viewers = viewers;
  state.coStreamNames.clear();
  els.viewerListCount.textContent = String(viewers.length);
  els.viewerList.innerHTML = '';

  if (!viewers.length) {
    const item = document.createElement('li');
    item.textContent = 'No viewers connected.';
    els.viewerList.appendChild(item);
    return;
  }

  viewers.forEach((viewer) => {
    state.coStreamNames.set(viewer.id, viewer.name || 'Viewer');
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
  updateRecordingControls();
  updateViewerShareControls();
  renderCoStreams();
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

function cleanOptionalText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
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
