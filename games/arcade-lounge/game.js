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
  const VOICE_MODEL_CONFIG = {
    primaryModelId: 'onnx-community/moonshine-base-ONNX',
    fallbackModelId: 'onnx-community/moonshine-tiny-ONNX',
    libraryUrl: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
    sampleRate: 16000,
    maxDurationMs: 14000,
    modelLoadTimeoutMs: 60000,
    transcriptionTimeoutMs: 30000,
    chunkLengthS: 8,
    strideLengthS: 2,
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
    voiceRecorder: null,
    voiceStream: null,
    voiceChunks: [],
    voiceRecording: false,
    voiceTranscribing: false,
    voiceEngineLoading: false,
    voiceStopTimer: 0,
    voiceModelId: '',
    voiceTranscriber: null,
    voiceTranscriberPromise: null,
    voiceLibraryPromise: null,
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
    voiceStatus: document.getElementById('voiceStatus'),
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

  function voiceAudioSupported() {
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }

  function voiceCaptureSupported() {
    return Boolean(
      navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function'
      && typeof window.MediaRecorder === 'function'
      && voiceAudioSupported()
    );
  }

  function preferredVoiceMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const mimeType of candidates) {
      if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') {
        return '';
      }
      if (window.MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }
    return '';
  }

  function setVoiceStatus(message, tone) {
    if (!ui.voiceStatus) {
      return;
    }
    ui.voiceStatus.textContent = message;
    ui.voiceStatus.dataset.tone = tone || 'idle';
  }

  function describeVoiceLoadProgress(progress) {
    if (!progress || !progress.status) {
      return 'Loading the sharper local speech model...';
    }
    if (progress.status === 'progress' && Number.isFinite(progress.progress)) {
      return `Loading local speech tools... ${Math.round(progress.progress)}%`;
    }
    if ((progress.status === 'initiate' || progress.status === 'download' || progress.status === 'done') && progress.file) {
      return `Loading ${progress.file}...`;
    }
    if (progress.status === 'ready') {
      return 'Local speech model ready.';
    }
    return 'Loading the sharper local speech model...';
  }

  function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);

      Promise.resolve(promise)
        .then((value) => {
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timer);
          reject(error);
        });
    });
  }

  function currentVoiceModelLabel() {
    if (state.voiceModelId === VOICE_MODEL_CONFIG.fallbackModelId) {
      return 'Fast local speech';
    }
    return 'Sharper local speech';
  }

  function disposeVoiceTranscriber(transcriber) {
    if (!transcriber || typeof transcriber.dispose !== 'function') {
      return;
    }
    const disposeResult = transcriber.dispose();
    if (disposeResult && typeof disposeResult.catch === 'function') {
      disposeResult.catch(() => {});
    }
  }

  function loadVoiceLibrary() {
    if (!state.voiceLibraryPromise) {
      state.voiceLibraryPromise = import(VOICE_MODEL_CONFIG.libraryUrl);
    }
    return state.voiceLibraryPromise;
  }

  async function createVoiceTranscriber(modelId, progress_callback) {
    const module = await loadVoiceLibrary();
    const { pipeline } = module;
    const buildTranscriber = (options = {}) => withTimeout(
      pipeline('automatic-speech-recognition', modelId, {
        progress_callback,
        ...options,
      }),
      VOICE_MODEL_CONFIG.modelLoadTimeoutMs,
      'The local speech model took too long to load.'
    );

    if (navigator.gpu) {
      try {
        return await buildTranscriber({ device: 'webgpu' });
      } catch (error) {
        return buildTranscriber();
      }
    }

    return buildTranscriber();
  }

  async function loadVoiceTranscriber() {
    if (state.voiceTranscriber && state.voiceModelId) {
      return state.voiceTranscriber;
    }
    if (state.voiceTranscriberPromise) {
      return state.voiceTranscriberPromise;
    }

    state.voiceEngineLoading = true;
    updateVoiceUi();
    setVoiceStatus('Loading the sharper local speech model...', 'processing');
    setStatus('Downloading a stronger free speech model for lounge chat. The first run can take a bit.');

    state.voiceTranscriberPromise = (async () => {
      const progress_callback = (progress) => {
        if (!state.voiceEngineLoading) {
          return;
        }
        setVoiceStatus(describeVoiceLoadProgress(progress), 'processing');
      };

      if (navigator.gpu) {
        progress_callback({ status: 'initiate', file: 'webgpu' });
      }

      try {
        const transcriber = await createVoiceTranscriber(VOICE_MODEL_CONFIG.primaryModelId, progress_callback);
        state.voiceModelId = VOICE_MODEL_CONFIG.primaryModelId;
        return transcriber;
      } catch (primaryError) {
        setVoiceStatus('The sharper model was heavy for this device. Trying a lighter local model...', 'processing');
        setStatus('Trying a lighter local speech model so voice-to-text still works smoothly.');
        const transcriber = await createVoiceTranscriber(VOICE_MODEL_CONFIG.fallbackModelId, progress_callback);
        state.voiceModelId = VOICE_MODEL_CONFIG.fallbackModelId;
        return transcriber;
      }
    })();

    try {
      state.voiceTranscriber = await state.voiceTranscriberPromise;
      setVoiceStatus(`${currentVoiceModelLabel()} ready.`, 'ready');
      return state.voiceTranscriber;
    } catch (error) {
      state.voiceTranscriberPromise = null;
      state.voiceModelId = '';
      disposeVoiceTranscriber(state.voiceTranscriber);
      state.voiceTranscriber = null;
      const message = error && error.message
        ? error.message
        : 'The local speech model could not load on this device.';
      setVoiceStatus(message, 'error');
      setStatus(message);
      throw new Error(message);
    } finally {
      state.voiceEngineLoading = false;
      updateVoiceUi();
      updateControlState();
    }
  }

  function audioContextCtor() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  async function decodeVoiceBlob(blob) {
    const AudioContextCtor = audioContextCtor();
    if (!AudioContextCtor) {
      throw new Error('Voice to text needs Web Audio support.');
    }

    const context = new AudioContextCtor();
    let audioBuffer;
    try {
      const arrayBuffer = await blob.arrayBuffer();
      audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      if (typeof context.close === 'function') {
        const closeResult = context.close();
        if (closeResult && typeof closeResult.catch === 'function') {
          closeResult.catch(() => {});
        }
      }
    }

    if (!audioBuffer || !audioBuffer.length) {
      throw new Error('The voice note could not be decoded.');
    }

    const mono = new Float32Array(audioBuffer.length);
    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
      const channel = audioBuffer.getChannelData(channelIndex);
      for (let index = 0; index < channel.length; index += 1) {
        mono[index] += channel[index];
      }
    }
    const scale = audioBuffer.numberOfChannels > 1 ? 1 / audioBuffer.numberOfChannels : 1;
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] *= scale;
    }

    if (audioBuffer.sampleRate === VOICE_MODEL_CONFIG.sampleRate) {
      return mono;
    }

    const ratio = audioBuffer.sampleRate / VOICE_MODEL_CONFIG.sampleRate;
    const targetLength = Math.max(1, Math.round(mono.length / ratio));
    const output = new Float32Array(targetLength);
    for (let index = 0; index < targetLength; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const right = Math.min(mono.length - 1, left + 1);
      const alpha = position - left;
      output[index] = mono[left] * (1 - alpha) + mono[right] * alpha;
    }
    return output;
  }

  function preprocessVoiceWaveform(waveform) {
    if (!waveform || !waveform.length) {
      throw new Error('The voice note was empty.');
    }

    let mean = 0;
    for (let index = 0; index < waveform.length; index += 1) {
      mean += waveform[index];
    }
    mean /= waveform.length;

    const centered = new Float32Array(waveform.length);
    let peak = 0;
    for (let index = 0; index < waveform.length; index += 1) {
      const value = waveform[index] - mean;
      centered[index] = value;
      const abs = Math.abs(value);
      if (abs > peak) {
        peak = abs;
      }
    }

    if (peak < 0.01) {
      throw new Error('The recording was too quiet. Try moving closer to the mic.');
    }

    const windowSize = 320;
    const totalWindows = Math.max(1, Math.ceil(centered.length / windowSize));
    let maxRms = 0;
    const rmsValues = new Float32Array(totalWindows);
    for (let windowIndex = 0; windowIndex < totalWindows; windowIndex += 1) {
      const start = windowIndex * windowSize;
      const end = Math.min(centered.length, start + windowSize);
      let energy = 0;
      for (let index = start; index < end; index += 1) {
        energy += centered[index] * centered[index];
      }
      const rms = Math.sqrt(energy / Math.max(1, end - start));
      rmsValues[windowIndex] = rms;
      if (rms > maxRms) {
        maxRms = rms;
      }
    }

    const threshold = Math.max(0.01, maxRms * 0.16);
    let startWindow = 0;
    while (startWindow < rmsValues.length && rmsValues[startWindow] < threshold) {
      startWindow += 1;
    }
    let endWindow = rmsValues.length - 1;
    while (endWindow > startWindow && rmsValues[endWindow] < threshold) {
      endWindow -= 1;
    }

    const padding = Math.round(VOICE_MODEL_CONFIG.sampleRate * 0.18);
    const startSample = Math.max(0, startWindow * windowSize - padding);
    const endSample = Math.min(centered.length, (endWindow + 1) * windowSize + padding);
    const trimmed = centered.subarray(startSample, endSample);

    if (trimmed.length < VOICE_MODEL_CONFIG.sampleRate * 0.2) {
      throw new Error('The recording was too short to understand. Try a slightly longer note.');
    }

    let trimmedPeak = 0;
    for (let index = 0; index < trimmed.length; index += 1) {
      const abs = Math.abs(trimmed[index]);
      if (abs > trimmedPeak) {
        trimmedPeak = abs;
      }
    }

    const gain = trimmedPeak > 0 ? Math.min(4.5, 0.88 / trimmedPeak) : 1;
    const normalized = new Float32Array(trimmed.length);
    for (let index = 0; index < trimmed.length; index += 1) {
      const amplified = trimmed[index] * gain;
      normalized[index] = Math.tanh(amplified * 1.15);
    }
    return normalized;
  }

  function stopVoiceTracks() {
    if (!state.voiceStream) {
      return;
    }
    for (const track of state.voiceStream.getTracks()) {
      track.stop();
    }
    state.voiceStream = null;
  }

  function clearVoiceStopTimer() {
    if (state.voiceStopTimer) {
      window.clearTimeout(state.voiceStopTimer);
      state.voiceStopTimer = 0;
    }
  }

  function updateVoiceUi() {
    if (!ui.voiceBtn) {
      return;
    }
    if (state.voiceRecording) {
      ui.voiceBtn.textContent = 'Stop mic';
      ui.voiceBtn.dataset.state = 'recording';
    } else if (state.voiceEngineLoading) {
      ui.voiceBtn.textContent = 'Loading voice...';
      ui.voiceBtn.dataset.state = 'processing';
    } else if (state.voiceTranscribing) {
      ui.voiceBtn.textContent = 'Transcribing...';
      ui.voiceBtn.dataset.state = 'processing';
    } else {
      ui.voiceBtn.textContent = 'Voice to text';
      ui.voiceBtn.dataset.state = 'idle';
    }
  }

  function mergeTranscriptIntoComposer(text) {
    const transcript = sanitizeText(text, 360);
    if (!transcript) {
      return;
    }
    const existing = sanitizeText(ui.messageInput.value, 320);
    ui.messageInput.value = sanitizeText(existing ? `${existing} ${transcript}` : transcript, 360);
    ui.messageInput.focus();
    const end = ui.messageInput.value.length;
    ui.messageInput.setSelectionRange(end, end);
  }

  async function transcribeVoiceBlob(blob) {
    state.voiceTranscribing = true;
    updateVoiceUi();
    setVoiceStatus(state.voiceTranscriber ? 'Transcribing voice note locally...' : 'Loading the sharper local speech model...', 'processing');
    setStatus(state.voiceTranscriber
      ? `Transcribing your voice note with ${currentVoiceModelLabel().toLowerCase()}...`
      : 'Loading the sharper free speech model for your first transcription...');
    try {
      const transcriber = await loadVoiceTranscriber();
      const waveform = preprocessVoiceWaveform(await decodeVoiceBlob(blob));
      const payload = await withTimeout(transcriber(waveform, {
        chunk_length_s: VOICE_MODEL_CONFIG.chunkLengthS,
        stride_length_s: VOICE_MODEL_CONFIG.strideLengthS,
      }), VOICE_MODEL_CONFIG.transcriptionTimeoutMs, 'The voice note took too long to transcribe. Try a shorter, clearer note.');
      const transcript = sanitizeText(payload && payload.text, 360);
      if (!transcript) {
        throw new Error('The voice note came back empty.');
      }
      mergeTranscriptIntoComposer(transcript);
      setVoiceStatus(`Transcript ready with ${currentVoiceModelLabel().toLowerCase()}.`, 'ready');
      setStatus('Voice note transcribed in your browser and added to the chat box.');
    } catch (error) {
      const message = error && error.message ? error.message : 'Voice transcription failed.';
      setVoiceStatus(message, 'error');
      setStatus(message);
    } finally {
      state.voiceTranscribing = false;
      updateVoiceUi();
      updateControlState();
    }
  }

  function finishVoiceCapture() {
    const mimeType = state.voiceRecorder && state.voiceRecorder.mimeType
      ? state.voiceRecorder.mimeType
      : preferredVoiceMimeType() || 'audio/webm';
    const blob = new Blob(state.voiceChunks, { type: mimeType });
    state.voiceChunks = [];
    state.voiceRecorder = null;
    state.voiceRecording = false;
    clearVoiceStopTimer();
    stopVoiceTracks();
    updateVoiceUi();
    if (!blob.size) {
      setVoiceStatus('No audio captured. Try again.', 'error');
      updateControlState();
      return;
    }
    transcribeVoiceBlob(blob);
  }

  async function startVoiceCapture() {
    if (!voiceCaptureSupported()) {
      setVoiceStatus('Voice capture needs microphone recording and Web Audio support.', 'error');
      setStatus('This browser does not support local voice transcription on the lounge page.');
      return;
    }
    if (!state.snapshot) {
      setStatus('Join a lounge room before using voice to text.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      state.voiceStream = stream;
      state.voiceRecorder = recorder;
      state.voiceChunks = [];
      state.voiceRecording = true;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size) {
          state.voiceChunks.push(event.data);
        }
      });
      recorder.addEventListener('stop', finishVoiceCapture);
      recorder.addEventListener('error', () => {
        state.voiceRecording = false;
        clearVoiceStopTimer();
        stopVoiceTracks();
        state.voiceRecorder = null;
        state.voiceChunks = [];
        updateVoiceUi();
        setVoiceStatus('The microphone hit an error.', 'error');
        setStatus('The microphone hit an error while recording.');
        updateControlState();
      });
      recorder.start();
      clearVoiceStopTimer();
      state.voiceStopTimer = window.setTimeout(() => {
        if (state.voiceRecorder && state.voiceRecorder.state === 'recording') {
          state.voiceRecorder.stop();
        }
      }, VOICE_MODEL_CONFIG.maxDurationMs);
      updateVoiceUi();
      setVoiceStatus('Recording... tap Stop mic when done.', 'recording');
      setStatus(state.voiceTranscriber
        ? 'Recording a short voice note for sharper local transcription.'
        : 'Recording a short voice note. The first transcription downloads a stronger free speech model.');
      updateControlState();
    } catch (error) {
      stopVoiceTracks();
      state.voiceRecorder = null;
      state.voiceChunks = [];
      state.voiceRecording = false;
      updateVoiceUi();
      const message = error && error.name === 'NotAllowedError'
        ? 'Microphone access was blocked.'
        : 'Could not start the microphone.';
      setVoiceStatus(message, 'error');
      setStatus(message);
      updateControlState();
    }
  }

  function stopVoiceCapture() {
    if (!state.voiceRecorder || state.voiceRecorder.state !== 'recording') {
      return;
    }
    clearVoiceStopTimer();
    setVoiceStatus('Stopping mic and preparing transcript...', 'processing');
    setStatus('Processing your voice note...');
    state.voiceRecorder.stop();
  }

  function toggleVoiceCapture() {
    if (state.voiceTranscribing || state.voiceEngineLoading) {
      return;
    }
    if (state.voiceRecording) {
      stopVoiceCapture();
      return;
    }
    startVoiceCapture();
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
    ui.voiceBtn.disabled = !connected || !voiceCaptureSupported() || (!state.voiceRecording && (state.voiceTranscribing || state.voiceEngineLoading));
    ui.gameSelect.disabled = !connected;
    ui.gameRoomInput.disabled = !connected;
    ui.inviteNoteInput.disabled = !connected;
    if (!voiceCaptureSupported()) {
      setVoiceStatus('Voice to text needs a browser with microphone recording and Web Audio.', 'error');
    } else if (state.voiceRecording) {
      setVoiceStatus('Recording... tap Stop mic when done.', 'recording');
    } else if (state.voiceEngineLoading) {
      setVoiceStatus('Loading the sharper local speech model...', 'processing');
    } else if (state.voiceTranscribing) {
      setVoiceStatus('Transcribing voice note locally...', 'processing');
    } else if (!connected) {
      setVoiceStatus('Sharper local voice-to-text runs in your browser after you join a lounge.', 'idle');
    } else if (
      ui.voiceStatus
      && ui.voiceStatus.dataset.tone !== 'error'
      && ui.voiceStatus.dataset.tone !== 'ready'
    ) {
      setVoiceStatus('Voice to text is ready. First use downloads a stronger free local speech model.', 'idle');
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
  ui.voiceBtn.addEventListener('click', toggleVoiceCapture);
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
