(() => {
  'use strict';

  const Core = window.ZombieSiegeCore;
  const THREE = window.THREE;
  if (!Core || !THREE) {
    console.error('Zombie Siege dependencies are missing.');
    return;
  }

  const STORAGE_KEYS = {
    name: 'zombieSiege.name',
    serverUrl: 'zombieSiege.serverUrl',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const INPUT_SEND_MS = 50;
  const PLAYER_HEIGHT = 1.72;
  const CAMERA_DEFAULT_YAW = 0;
  const LOOK_TURN_SPEED = 2.8;
  const query = new URLSearchParams(window.location.search);

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    inviteInput: document.getElementById('inviteInput'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    soloBtn: document.getElementById('soloBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    openLoungeBtn: document.getElementById('openLoungeBtn'),
    shareLoungeBtn: document.getElementById('shareLoungeBtn'),
    restartBtn: document.getElementById('restartBtn'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    statusText: document.getElementById('statusText'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    waveLabel: document.getElementById('waveLabel'),
    remainingLabel: document.getElementById('remainingLabel'),
    scoreLabel: document.getElementById('scoreLabel'),
    conditionLabel: document.getElementById('conditionLabel'),
    objectiveText: document.getElementById('objectiveText'),
    missionText: document.getElementById('missionText'),
    controlHint: document.getElementById('controlHint'),
    presenceText: document.getElementById('presenceText'),
    playerCards: document.getElementById('playerCards'),
    feedList: document.getElementById('feedList'),
    stage: document.getElementById('arenaStage'),
    canvas: document.getElementById('gameCanvas'),
    crosshair: document.querySelector('.crosshair'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlayTitle'),
    overlayCopy: document.getElementById('overlayCopy'),
    overlayMeta: document.getElementById('overlayMeta'),
    startBtn: document.getElementById('startBtn'),
    toast: document.getElementById('toast'),
  };

  const state = {
    mode: 'idle',
    socket: null,
    snapshot: null,
    localGame: null,
    yourPlayerId: '',
    roomCode: '',
    serverUrl: '',
    statusMessage: '',
    toastTimer: 0,
    lastFrameAt: performance.now(),
    lastInputSentAt: 0,
    nextUiRefreshAt: 0,
    lastEventId: 0,
    hasYawSeed: false,
    movement: {
      active: false,
      rawX: 0,
      rawY: 0,
      worldX: 0,
      worldZ: 0,
    },
    input: {
      moveX: 0,
      moveY: 0,
      moveDirX: 0,
      moveDirZ: 0,
      yaw: -Math.PI / 2,
      aimX: 0,
      aimZ: 0,
      fire: false,
      jump: false,
      sprint: false,
      weaponKey: 'rifle',
    },
    keys: {
      forward: false,
      back: false,
      left: false,
      right: false,
      lookLeft: false,
      lookRight: false,
      sprint: false,
      fire: false,
      jump: false,
    },
    mouse: {
      inside: false,
      ndcX: 0,
      ndcY: 0,
      stageX: 0.5,
      stageY: 0.5,
    },
    scene: null,
    camera: null,
    renderer: null,
    world: null,
    textures: null,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function lerpAngle(start, end, amount) {
    const delta = ((((end - start) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return start + delta * amount;
  }

  function normalizeAngle(value) {
    let angle = Number(value) || 0;
    while (angle > Math.PI) {
      angle -= Math.PI * 2;
    }
    while (angle < -Math.PI) {
      angle += Math.PI * 2;
    }
    return angle;
  }

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function sanitizeServerUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return PROD_SERVER_URL;
    }
    if (/^wss?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getPlayerName() {
    return ui.nameInput.value.trim().slice(0, 18) || 'Survivor';
  }

  function currentGame() {
    return state.mode === 'solo' ? state.localGame : state.snapshot;
  }

  function localPlayer(game) {
    if (!game || !state.yourPlayerId || !Array.isArray(game.players)) {
      return null;
    }
    return game.players.find((player) => player.id === state.yourPlayerId) || null;
  }

  function remainingThreats(game) {
    if (!game) {
      return 0;
    }
    if (typeof game.remaining === 'number') {
      return game.remaining;
    }
    return (game.zombies?.length || 0) + (game.spawnBudget || 0);
  }

  function currentWeaponLabel(game) {
    const player = localPlayer(game);
    if (!player) {
      return 'Rifle';
    }
    const weapon = Core.WEAPONS[player.weaponKey] || Core.WEAPONS.rifle;
    return weapon.label;
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.add('visible');
    state.toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove('visible');
    }, 2600);
  }

  function setStatusMessage(message) {
    state.statusMessage = String(message || '');
  }

  function defaultStatusText() {
    if (state.statusMessage) {
      return state.statusMessage;
    }
    if (state.mode === 'connecting') {
      return 'Connecting to the live zombie room...';
    }
    if (state.mode === 'online') {
      return state.roomCode
        ? `Room ${state.roomCode} is live. Copy the invite or drop it into Arcade Lounge.`
        : 'Live room connected.';
    }
    if (state.mode === 'solo') {
      return 'Solo run is live. Turn with Q/E or Left/Right, then light up the breach.';
    }
    return 'Host a live room, join by room code, or jump into a solo run instantly.';
  }

  function setNetworkStatus(text, tone) {
    ui.networkStatus.textContent = text;
    ui.networkStatus.dataset.tone = tone;
  }

  function setModePill(text) {
    ui.modePill.textContent = text;
  }

  function inviteUrl() {
    if (state.mode !== 'online' || !state.roomCode) {
      return '';
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomCode);
    if (state.serverUrl && state.serverUrl !== PROD_SERVER_URL) {
      url.searchParams.set('server', state.serverUrl);
    } else {
      url.searchParams.delete('server');
    }
    return url.toString();
  }

  function updateInviteUi() {
    ui.inviteInput.value = inviteUrl();
    ui.copyBtn.disabled = !ui.inviteInput.value;
    ui.copyCodeBtn.disabled = !(state.mode === 'online' && state.roomCode);
    ui.shareLoungeBtn.disabled = !(state.mode === 'online' && state.roomCode);
  }

  async function copyText(value, successMessage) {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast(successMessage);
    } catch (error) {
      showToast('Copy failed in this browser.');
    }
  }

  function openArcadeLounge(autoShare) {
    if (!window.NovaArcadeLoungeBridge) {
      showToast('Arcade Lounge is not available right now.');
      return;
    }
    if (autoShare && !(state.mode === 'online' && state.roomCode)) {
      showToast('Host or join an online zombie room before sharing it.');
      return;
    }
    window.NovaArcadeLoungeBridge.open({
      name: getPlayerName(),
      serverUrl: sanitizeServerUrl(ui.serverUrlInput.value || state.serverUrl || PROD_SERVER_URL),
      gameType: 'zombie-siege',
      roomCode: state.mode === 'online' ? state.roomCode : '',
      inviteUrl: state.mode === 'online' ? inviteUrl() : '',
      note: state.mode === 'online' && state.roomCode
        ? `Join my Zombie Siege 3D room ${state.roomCode}.`
        : '',
      autoShare: Boolean(autoShare),
    });
    showToast(autoShare ? 'Opening Arcade Lounge with your zombie room ready to share.' : 'Opening Arcade Lounge in a new tab.');
  }

  function sizedCanvasTexture(size, painter) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    painter(ctx, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  function createTextures() {
    const asphalt = sizedCanvasTexture(512, (ctx, size) => {
      ctx.fillStyle = '#2a2e31';
      ctx.fillRect(0, 0, size, size);
      for (let index = 0; index < 5800; index += 1) {
        const shade = 28 + Math.floor(Math.random() * 40);
        ctx.fillStyle = `rgba(${shade}, ${shade + 2}, ${shade + 3}, ${0.15 + Math.random() * 0.18})`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
      }
      ctx.strokeStyle = 'rgba(18, 18, 18, 0.34)';
      ctx.lineWidth = 2;
      for (let crack = 0; crack < 16; crack += 1) {
        ctx.beginPath();
        const startX = Math.random() * size;
        const startY = Math.random() * size;
        ctx.moveTo(startX, startY);
        for (let segment = 0; segment < 5; segment += 1) {
          ctx.lineTo(startX + (Math.random() - 0.5) * 120, startY + (Math.random() - 0.5) * 120);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(235, 219, 173, 0.2)';
      ctx.fillRect(size * 0.48, 0, size * 0.04, size);
      ctx.fillRect(0, size * 0.48, size, size * 0.04);
    });
    asphalt.repeat.set(7, 7);

    const concrete = sizedCanvasTexture(512, (ctx, size) => {
      ctx.fillStyle = '#73767a';
      ctx.fillRect(0, 0, size, size);
      for (let index = 0; index < 6200; index += 1) {
        const tone = 96 + Math.floor(Math.random() * 44);
        ctx.fillStyle = `rgba(${tone}, ${tone}, ${tone - 4}, ${0.16 + Math.random() * 0.16})`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
      }
      for (let stain = 0; stain < 24; stain += 1) {
        const radius = 18 + Math.random() * 70;
        const x = Math.random() * size;
        const y = Math.random() * size;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(40, 42, 44, 0.22)');
        gradient.addColorStop(1, 'rgba(40, 42, 44, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    concrete.repeat.set(2, 1);

    const metal = sizedCanvasTexture(512, (ctx, size) => {
      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, '#3f454a');
      gradient.addColorStop(1, '#14181c');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      for (let index = 0; index < 90; index += 1) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.03 + Math.random() * 0.05})`;
        ctx.fillRect(0, Math.random() * size, size, 2);
      }
      ctx.fillStyle = 'rgba(176, 90, 56, 0.28)';
      for (let index = 0; index < 22; index += 1) {
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, 10 + Math.random() * 24, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    metal.repeat.set(1, 1);

    const hazard = sizedCanvasTexture(256, (ctx, size) => {
      ctx.fillStyle = '#18130b';
      ctx.fillRect(0, 0, size, size);
      ctx.translate(size / 2, size / 2);
      ctx.rotate(-Math.PI / 4);
      for (let band = -size; band < size; band += 32) {
        ctx.fillStyle = band % 64 === 0 ? '#efc45d' : '#18130b';
        ctx.fillRect(band, -size, 18, size * 2);
      }
    });
    hazard.repeat.set(1, 1);

    const flesh = sizedCanvasTexture(256, (ctx, size) => {
      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, '#889772');
      gradient.addColorStop(1, '#4e5644');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      for (let index = 0; index < 1200; index += 1) {
        const radius = 2 + Math.random() * 8;
        ctx.fillStyle = Math.random() > 0.7 ? 'rgba(94, 20, 18, 0.18)' : 'rgba(210, 224, 180, 0.06)';
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const zombieCloth = sizedCanvasTexture(256, (ctx, size) => {
      ctx.fillStyle = '#2b2f29';
      ctx.fillRect(0, 0, size, size);
      for (let index = 0; index < 80; index += 1) {
        ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
        ctx.fillRect(0, Math.random() * size, size, 1 + Math.random() * 2);
      }
      for (let tear = 0; tear < 24; tear += 1) {
        ctx.fillStyle = 'rgba(70, 16, 16, 0.2)';
        ctx.fillRect(Math.random() * size, Math.random() * size, 6 + Math.random() * 16, 2 + Math.random() * 6);
      }
    });

    const windows = sizedCanvasTexture(512, (ctx, size) => {
      ctx.fillStyle = '#0e1115';
      ctx.fillRect(0, 0, size, size);
      const cols = 8;
      const rows = 14;
      const pad = 18;
      const cellW = (size - pad * 2) / cols;
      const cellH = (size - pad * 2) / rows;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const lit = Math.random() > 0.42;
          ctx.fillStyle = lit ? `rgba(255, ${190 + Math.floor(Math.random() * 40)}, 108, ${0.32 + Math.random() * 0.24})` : 'rgba(25, 29, 34, 0.9)';
          ctx.fillRect(pad + col * cellW + 5, pad + row * cellH + 4, cellW - 10, cellH - 8);
        }
      }
    });

    return { asphalt, concrete, metal, hazard, flesh, zombieCloth, windows };
  }

  function createLabelSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 196;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(5, 8, 12, 0.72)';
    ctx.beginPath();
    ctx.roundRect(10, 14, 176, 40, 14);
    ctx.fill();
    ctx.strokeStyle = `${color}aa`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = '700 22px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5f7fb';
    ctx.fillText(String(text || '').slice(0, 18), canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }));
    sprite.scale.set(3.35, 1.2, 1);
    sprite.position.set(0, 3.02, 0);
    return sprite;
  }

  function initScene() {
    if (state.scene) {
      return;
    }
    const renderer = new THREE.WebGLRenderer({
      canvas: ui.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06080b);
    scene.fog = new THREE.FogExp2(0x06080b, 0.018);

    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 240);
    camera.position.set(0, 7, 11);

    state.renderer = renderer;
    state.scene = scene;
    state.camera = camera;
    state.textures = createTextures();
    state.world = {
      players: new Map(),
      zombies: new Map(),
      shots: new Map(),
      pickups: new Map(),
      entityRoot: new THREE.Group(),
      playerRoot: new THREE.Group(),
      zombieRoot: new THREE.Group(),
      shotRoot: new THREE.Group(),
      pickupRoot: new THREE.Group(),
      cameraPos: new THREE.Vector3(0, 7, 12),
      cameraLook: new THREE.Vector3(0, 2, 0),
      cameraYaw: CAMERA_DEFAULT_YAW,
      aimTarget: new THREE.Vector3(0, 1.55, -18),
      raycaster: new THREE.Raycaster(),
      aimPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.55),
      tempVecA: new THREE.Vector3(),
      tempVecB: new THREE.Vector3(),
      tempVecC: new THREE.Vector3(),
      dynamic: {
        smoke: [],
        traffic: [],
        sweepLights: [],
        beaconLights: [],
        skyline: [],
        helicopter: null,
      },
    };

    scene.add(state.world.entityRoot);
    state.world.entityRoot.add(state.world.playerRoot, state.world.zombieRoot, state.world.shotRoot, state.world.pickupRoot);

    const hemi = new THREE.HemisphereLight(0xa1b8ff, 0x111317, 1.1);
    scene.add(hemi);

    const fill = new THREE.AmbientLight(0xa8b5c0, 0.42);
    scene.add(fill);

    const moon = new THREE.DirectionalLight(0xb6d7ff, 1.35);
    moon.position.set(18, 26, 8);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -70;
    moon.shadow.camera.right = 70;
    moon.shadow.camera.top = 70;
    moon.shadow.camera.bottom = -70;
    scene.add(moon);

    const rim = new THREE.DirectionalLight(0xffb784, 0.46);
    rim.position.set(-26, 14, -18);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(Core.ARENA.width + 22, Core.ARENA.depth + 22),
      new THREE.MeshStandardMaterial({
        map: state.textures.asphalt,
        roughness: 0.98,
        metalness: 0.04,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(Core.ARENA.width - 6, Core.ARENA.depth - 6),
      new THREE.MeshStandardMaterial({
        map: state.textures.hazard,
        color: 0x56462c,
        transparent: true,
        opacity: 0.2,
        roughness: 0.9,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    scene.add(ring);

    const aimMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.36, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffe3aa,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      })
    );
    aimMarker.rotation.x = -Math.PI / 2;
    aimMarker.position.set(0, 0.05, 0);
    scene.add(aimMarker);
    state.world.aimMarker = aimMarker;

    buildArenaShell(scene);
    buildArenaProps(scene);
    resizeRenderer();
  }

  function buildArenaShell(scene) {
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: state.textures.concrete,
      roughness: 0.9,
      metalness: 0.05,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      map: state.textures.metal,
      roughness: 0.62,
      metalness: 0.42,
      color: 0xa5afb7,
    });
    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0x131821,
      roughness: 0.94,
      metalness: 0.06,
    });
    const windowMat = new THREE.MeshStandardMaterial({
      map: state.textures.windows,
      color: 0x778290,
      emissive: 0xc68d44,
      emissiveIntensity: 0.5,
      roughness: 0.72,
      metalness: 0.12,
    });
    const billboardMat = new THREE.MeshStandardMaterial({
      color: 0x2a3440,
      emissive: 0x5ba8ff,
      emissiveIntensity: 0.65,
      roughness: 0.4,
      metalness: 0.2,
    });
    const dynamic = state.world.dynamic;
    const halfW = Core.ARENA.width * 0.5;
    const halfD = Core.ARENA.depth * 0.5;

    [
      { x: 0, z: -halfD - 1.2, w: Core.ARENA.width + 10, d: 2.4 },
      { x: 0, z: halfD + 1.2, w: Core.ARENA.width + 10, d: 2.4 },
      { x: -halfW - 1.2, z: 0, w: 2.4, d: Core.ARENA.depth + 10 },
      { x: halfW + 1.2, z: 0, w: 2.4, d: Core.ARENA.depth + 10 },
    ].forEach((wall) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(wall.w, 7.4, wall.d),
        wallMaterial
      );
      mesh.position.set(wall.x, 3.7, wall.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    });

    [
      { x: 0, z: -halfD - 0.2, w: Core.ARENA.width - 8, d: 0.4 },
      { x: 0, z: halfD + 0.2, w: Core.ARENA.width - 8, d: 0.4 },
      { x: -halfW - 0.2, z: 0, w: 0.4, d: Core.ARENA.depth - 8 },
      { x: halfW + 0.2, z: 0, w: 0.4, d: Core.ARENA.depth - 8 },
    ].forEach((rail) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(rail.w, 2.8, rail.d),
        trimMaterial
      );
      mesh.position.set(rail.x, 3.2, rail.z);
      mesh.castShadow = true;
      scene.add(mesh);
    });

    const skyline = new THREE.Group();
    for (let index = 0; index < 22; index += 1) {
      const width = 9 + Math.random() * 14;
      const depth = 8 + Math.random() * 12;
      const height = 26 + Math.random() * 58;
      const tower = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), buildingMat);
      base.position.y = height * 0.5;
      base.castShadow = true;
      base.receiveShadow = true;
      tower.add(base);

      const windowPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.82, height * 0.8),
        windowMat.clone()
      );
      windowPanel.position.set(0, height * 0.56, depth * 0.5 + 0.06);
      tower.add(windowPanel);

      if (Math.random() > 0.55) {
        const billboard = new THREE.Mesh(
          new THREE.BoxGeometry(width * 0.7, 4.2 + Math.random() * 2.6, 0.36),
          billboardMat.clone()
        );
        billboard.position.set((Math.random() - 0.5) * 1.6, height * 0.68, depth * 0.5 + 0.45);
        tower.add(billboard);
        dynamic.skyline.push({
          mesh: billboard,
          baseY: billboard.position.y,
          bob: Math.random() * Math.PI * 2,
          speed: 0.5 + Math.random() * 0.5,
          flicker: 0.7 + Math.random() * 0.6,
        });
      }

      const angle = (index / 22) * Math.PI * 2;
      const radius = 88 + Math.random() * 34;
      tower.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      tower.rotation.y = angle + Math.PI;
      skyline.add(tower);

      if (Math.random() > 0.5) {
        const beacon = new THREE.PointLight(0xff5252, 1.6, 12, 2);
        beacon.position.set(tower.position.x, height + 5, tower.position.z);
        scene.add(beacon);
        dynamic.beaconLights.push({
          light: beacon,
          phase: Math.random() * Math.PI * 2,
          speed: 1.8 + Math.random() * 1.4,
        });
      }
    }
    scene.add(skyline);

    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x32373f,
      roughness: 0.6,
      metalness: 0.6,
    });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff4d2,
      emissive: 0xffd36a,
      emissiveIntensity: 1.8,
      roughness: 0.2,
      metalness: 0.15,
    });
    [
      [-34, -30],
      [34, -30],
      [-34, 30],
      [34, 30],
    ].forEach(([x, z], index) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 11, 10), poleMat);
      pole.position.set(x, 5.5, z);
      pole.castShadow = true;
      scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.56, 1.2), lampMat);
      lamp.position.set(x, 10.8, z);
      scene.add(lamp);
      const light = new THREE.SpotLight(0xffe1aa, 170, 48, Math.PI / 5.2, 0.4, 1.4);
      light.position.set(x, 10.3, z);
      light.target.position.set(Math.sign(-x) * 4, 0, Math.sign(-z) * 4);
      light.castShadow = false;
      scene.add(light, light.target);
      dynamic.sweepLights.push({
        light,
        target: light.target,
        centerX: x,
        centerZ: z,
        phase: index * 1.4 + Math.random() * 0.4,
      });
    });

    for (let index = 0; index < 9; index += 1) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.24, 0.42),
        new THREE.MeshStandardMaterial({
          color: 0x20262e,
          emissive: 0x0f141b,
          roughness: 0.54,
          metalness: 0.42,
        })
      );
      const headA = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.06),
        new THREE.MeshBasicMaterial({ color: 0xffd47a })
      );
      const headB = headA.clone();
      headA.position.set(0.52, 0, -0.1);
      headB.position.set(0.52, 0, 0.1);
      const tailA = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.06),
        new THREE.MeshBasicMaterial({ color: 0xff3d3d })
      );
      const tailB = tailA.clone();
      tailA.position.set(-0.52, 0, -0.1);
      tailB.position.set(-0.52, 0, 0.1);
      group.add(body, headA, headB, tailA, tailB);
      scene.add(group);
      dynamic.traffic.push({
        group,
        laneRadius: 72 + (index % 3) * 8,
        speed: 0.16 + Math.random() * 0.08,
        phase: (index / 9) * Math.PI * 2,
        height: 0.55 + Math.random() * 0.18,
      });
    }

    const heli = new THREE.Group();
    const heliBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 0.9, 1.1),
      new THREE.MeshStandardMaterial({
        color: 0x171b20,
        roughness: 0.52,
        metalness: 0.38,
      })
    );
    const heliTail = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.2, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0x1f252c,
        roughness: 0.48,
        metalness: 0.46,
      })
    );
    heliTail.position.set(-2.2, 0.15, 0);
    const rotor = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 0.06, 0.18),
      new THREE.MeshStandardMaterial({
        color: 0x343a42,
        roughness: 0.42,
        metalness: 0.62,
      })
    );
    rotor.position.y = 0.68;
    const spot = new THREE.SpotLight(0xdde8ff, 120, 78, Math.PI / 7, 0.56, 1.2);
    spot.position.set(0.6, -0.1, 0);
    spot.target.position.set(0, 0, 0);
    heli.add(heliBody, heliTail, rotor, spot);
    scene.add(heli, spot.target);
    dynamic.helicopter = {
      group: heli,
      rotor,
      light: spot,
      target: spot.target,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function buildBarricade(x, z, rotation) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x5b4637,
      roughness: 0.92,
      metalness: 0.02,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      map: state.textures.metal,
      roughness: 0.7,
      metalness: 0.55,
      color: 0x8f938d,
    });
    const beamA = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.36, 0.46), woodMat);
    beamA.position.set(0, 1.1, 0);
    beamA.rotation.z = 0.24;
    const beamB = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.36, 0.46), woodMat);
    beamB.position.set(0, 1.1, 0);
    beamB.rotation.z = -0.24;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 1.2, 16), metalMat);
    drum.position.set(-2.2, 0.6, 0.7);
    const drumB = drum.clone();
    drumB.position.set(2.1, 0.6, -0.7);
    [beamA, beamB, drum, drumB].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    return group;
  }

  function buildArenaProps(scene) {
    [
      [-18, -12, 0.3],
      [22, -12, -0.28],
      [-28, 18, -0.18],
      [30, 16, 0.42],
      [0, 6, 0],
      [-8, 26, 0.18],
      [14, 28, -0.24],
      [-30, -24, 0.54],
      [30, -24, -0.54],
    ].forEach(([x, z, rotation]) => {
      scene.add(buildBarricade(x, z, rotation));
    });

    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x54514b,
      roughness: 0.86,
      metalness: 0.08,
    });
    const stripMat = new THREE.MeshStandardMaterial({
      map: state.textures.hazard,
      roughness: 0.72,
      metalness: 0.2,
      emissive: 0x403118,
      emissiveIntensity: 0.22,
    });
    [
      [-24, 0],
      [24, 2],
      [0, -22],
      [0, 24],
      [-14, 20],
      [18, -18],
    ].forEach(([x, z], index) => {
      const stack = new THREE.Group();
      const crateA = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 2.2), crateMat);
      crateA.position.set(0, 0.9, 0);
      const crateB = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 2.2), crateMat);
      crateB.position.set(index % 2 === 0 ? 1.3 : -1.3, 0.9, 0.6);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 4.6), stripMat);
      strip.position.set(0, 0.09, 0);
      [crateA, crateB, strip].forEach((mesh) => {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        stack.add(mesh);
      });
      stack.position.set(x, 0, z);
      scene.add(stack);
    });

    const bloodMat = new THREE.MeshBasicMaterial({
      color: 0x43090c,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    for (let index = 0; index < 18; index += 1) {
      const decal = new THREE.Mesh(
        new THREE.CircleGeometry(0.8 + Math.random() * 1.6, 24),
        bloodMat
      );
      decal.rotation.x = -Math.PI / 2;
      decal.position.set((Math.random() - 0.5) * 60, 0.02, (Math.random() - 0.5) * 58);
      scene.add(decal);
    }

    for (let index = 0; index < 7; index += 1) {
      const smoke = new THREE.Mesh(
        new THREE.PlaneGeometry(7 + Math.random() * 6, 7 + Math.random() * 6),
        new THREE.MeshBasicMaterial({
          color: 0x4a5158,
          transparent: true,
          opacity: 0.14 + Math.random() * 0.06,
          depthWrite: false,
        })
      );
      smoke.position.set((Math.random() - 0.5) * 54, 3 + Math.random() * 4, (Math.random() - 0.5) * 52);
      smoke.rotation.y = Math.random() * Math.PI * 2;
      smoke.rotation.x = -Math.PI * 0.08;
      scene.add(smoke);
      state.world.dynamic.smoke.push({
        mesh: smoke,
        phase: Math.random() * Math.PI * 2,
        speed: 0.08 + Math.random() * 0.08,
        driftX: -0.16 + Math.random() * 0.32,
        driftZ: -0.16 + Math.random() * 0.32,
        baseY: smoke.position.y,
      });
    }
  }

  function createPlayerMesh(player) {
    const group = new THREE.Group();
    const accent = new THREE.Color(player.color || '#73d9ff');
    const fabricMat = new THREE.MeshStandardMaterial({
      color: 0x1b2026,
      roughness: 0.88,
      metalness: 0.04,
    });
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x46505a,
      roughness: 0.45,
      metalness: 0.24,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent.clone().multiplyScalar(0.18),
      roughness: 0.34,
      metalness: 0.22,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xd8b39d,
      roughness: 0.85,
      metalness: 0.02,
    });
    const gunMat = new THREE.MeshStandardMaterial({
      color: 0x171a1f,
      roughness: 0.32,
      metalness: 0.78,
      emissive: new THREE.Color(0x000000),
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x6fd4ff,
      emissive: 0x214f70,
      emissiveIntensity: 0.5,
      roughness: 0.16,
      metalness: 0.88,
      transparent: true,
      opacity: 0.92,
    });
    const muzzleMat = new THREE.MeshBasicMaterial({
      color: 0xffdf9a,
      transparent: true,
      opacity: 0,
    });

    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.42, 0.58), fabricMat);
    pelvis.position.set(0, 1.04, 0.02);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.08, 1.18, 0.68), armorMat);
    torso.position.set(0, 1.78, 0.02);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.82, 0.3), accentMat);
    chest.position.set(0, 1.76, 0.39);
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.92, 0.26), armorMat);
    backpack.position.set(0, 1.82, -0.42);
    const shoulderA = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.46), armorMat);
    shoulderA.position.set(-0.72, 2.1, 0.02);
    const shoulderB = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.46), armorMat);
    shoulderB.position.set(0.72, 2.1, 0.02);
    const thighA = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.72, 0.36), fabricMat);
    thighA.position.set(-0.24, 0.64, 0.02);
    const thighB = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.72, 0.36), fabricMat);
    thighB.position.set(0.24, 0.64, 0.02);
    const shinA = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.28), armorMat);
    shinA.position.set(-0.24, 0.02, 0.04);
    const shinB = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.28), armorMat);
    shinB.position.set(0.24, 0.02, 0.04);
    const bootA = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.56), gunMat);
    bootA.position.set(-0.24, -0.38, 0.12);
    const bootB = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.56), gunMat);
    bootB.position.set(0.24, -0.38, 0.12);
    const armA = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26), armorMat);
    armA.position.set(-0.82, 1.66, -0.04);
    armA.rotation.z = 0.2;
    const armB = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26), armorMat);
    armB.position.set(0.82, 1.68, -0.16);
    armB.rotation.z = -0.36;
    const forearmA = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), fabricMat);
    forearmA.position.set(-0.88, 1.08, -0.12);
    forearmA.rotation.z = 0.12;
    const forearmB = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.76, 0.22), fabricMat);
    forearmB.position.set(0.94, 1.12, -0.44);
    forearmB.rotation.z = -0.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 20), skinMat);
    head.position.set(0, 2.62, 0);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.39, 22, 18), armorMat);
    helmet.position.set(0, 2.73, 0.02);
    helmet.scale.set(1.02, 0.72, 1.08);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.24), visorMat);
    visor.position.set(0, 2.62, 0.26);

    const rifle = new THREE.Group();
    const rifleBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 1.08), gunMat);
    rifleBody.position.set(0, 0, -0.04);
    const rifleBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.62), gunMat);
    rifleBarrel.position.set(0, 0.02, -0.8);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.42), armorMat);
    stock.position.set(0, -0.02, 0.54);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.2), armorMat);
    mag.position.set(0, -0.16, -0.08);
    const optic = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.22), accentMat);
    optic.position.set(0, 0.16, -0.12);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), muzzleMat);
    muzzle.position.set(0, 0.02, -1.12);
    [rifleBody, rifleBarrel, stock, mag, optic, muzzle].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      rifle.add(mesh);
    });
    rifle.position.set(0.5, 1.58, -0.38);
    rifle.rotation.x = 0.06;
    rifle.rotation.z = -0.08;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.04, 10, 24),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.45,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    [
      pelvis,
      torso,
      chest,
      backpack,
      shoulderA,
      shoulderB,
      thighA,
      thighB,
      shinA,
      shinB,
      bootA,
      bootB,
      armA,
      armB,
      forearmA,
      forearmB,
      head,
      helmet,
      visor,
    ].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    group.add(rifle);
    group.add(ring);
    group.add(createLabelSprite(player.name, player.color || '#73d9ff'));
    group.userData = {
      gunMat,
      accentMat,
      ringMat: ring.material,
      visorMat,
      muzzleMat,
      upperArms: [armA, armB],
      forearms: [forearmA, forearmB],
      thighs: [thighA, thighB],
      shins: [shinA, shinB],
      backpack,
      rifle,
      walkPhase: Math.random() * Math.PI * 2,
      flash: 0,
      labelHeight: 3.05,
      targetX: player.x,
      targetZ: player.z,
      targetY: player.y || 0,
      targetYaw: player.yaw,
      targetAlive: player.alive,
      health: player.health,
      maxHealth: player.maxHealth,
    };
    return group;
  }

  function createZombieMesh(zombie) {
    const group = new THREE.Group();
    const type = Core.ZOMBIE_TYPES[zombie.type] || Core.ZOMBIE_TYPES.walker;
    const scale = zombie.type === 'boss' ? 1.55 : zombie.type === 'brute' ? 1.22 : zombie.type === 'runner' ? 0.88 : 1;
    const fleshMat = new THREE.MeshStandardMaterial({
      map: state.textures.flesh,
      color: new THREE.Color(type.tint || '#9ec593'),
      roughness: 0.88,
      metalness: 0.04,
      emissive: new THREE.Color(0x000000),
    });
    const clothMat = new THREE.MeshStandardMaterial({
      map: state.textures.zombieCloth,
      color: zombie.type === 'boss' ? 0x291617 : zombie.type === 'brute' ? 0x4b463c : 0x2e322b,
      roughness: 0.92,
      metalness: 0.04,
      emissive: new THREE.Color(0x000000),
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x2f0808,
      emissive: zombie.type === 'boss' ? 0xff6969 : 0xc73636,
      emissiveIntensity: zombie.type === 'boss' ? 3 : 1.8,
      roughness: 0.2,
    });
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0xd5c49a,
      roughness: 0.82,
      metalness: 0.03,
      emissive: new THREE.Color(0x000000),
    });
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.42, 0.58), clothMat);
    pelvis.position.set(0, 1.02, 0.04);
    const thighA = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.76, 0.34), clothMat);
    thighA.position.set(-0.24, 0.62, 0.04);
    const thighB = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.76, 0.34), clothMat);
    thighB.position.set(0.24, 0.62, 0.04);
    const shinA = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.74, 0.26), boneMat);
    shinA.position.set(-0.24, -0.02, 0.08);
    const shinB = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.74, 0.26), boneMat);
    shinB.position.set(0.24, -0.02, 0.08);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.22, 0.72), fleshMat);
    torso.position.set(0, 1.72, 0.08);
    torso.rotation.z = 0.05;
    torso.rotation.x = 0.12;
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.42, 0.7), clothMat);
    shoulders.position.set(0, 2.16, -0.04);
    shoulders.rotation.z = 0.1;
    const ribCage = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.48, 0.18), boneMat);
    ribCage.position.set(-0.04, 1.74, 0.46);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.94, 0.18), boneMat);
    spine.position.set(-0.14, 1.84, 0.34);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 20), fleshMat);
    head.position.set(0.04, 2.62, -0.12);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.3), boneMat);
    jaw.position.set(0.04, 2.34, -0.24);
    jaw.rotation.x = 0.16;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), eyeMat);
    eyes.position.set(0.04, 2.64, -0.34);
    const armA = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.88, 0.26), fleshMat);
    armA.position.set(-0.82, 1.74, -0.18);
    armA.rotation.z = 0.54;
    const armB = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.88, 0.26), fleshMat);
    armB.position.set(0.84, 1.68, -0.2);
    armB.rotation.z = -0.62;
    const forearmA = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.84, 0.22), boneMat);
    forearmA.position.set(-0.94, 1.06, -0.22);
    forearmA.rotation.z = 0.24;
    const forearmB = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.84, 0.22), boneMat);
    forearmB.position.set(0.98, 1.0, -0.24);
    forearmB.rotation.z = -0.28;
    const clawA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.44), boneMat);
    clawA.position.set(-0.98, 0.46, -0.22);
    const clawB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.44), boneMat);
    clawB.position.set(1.02, 0.42, -0.24);
    const ragA = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.04), clothMat);
    ragA.position.set(-0.28, 1.06, 0.34);
    ragA.rotation.z = 0.18;
    const ragB = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.98, 0.04), clothMat);
    ragB.position.set(0.24, 1.0, 0.36);
    ragB.rotation.z = -0.12;
    const shoulderSpikeA = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.38, 8), boneMat);
    shoulderSpikeA.position.set(-0.44, 2.38, 0.08);
    shoulderSpikeA.rotation.z = 0.4;
    const shoulderSpikeB = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.38, 8), boneMat);
    shoulderSpikeB.position.set(0.5, 2.34, 0.08);
    shoulderSpikeB.rotation.z = -0.38;

    const parts = [
      pelvis,
      thighA,
      thighB,
      shinA,
      shinB,
      torso,
      shoulders,
      ribCage,
      spine,
      head,
      jaw,
      eyes,
      armA,
      armB,
      forearmA,
      forearmB,
      clawA,
      clawB,
      ragA,
      ragB,
      shoulderSpikeA,
      shoulderSpikeB,
    ];
    if (zombie.type === 'boss') {
      const hump = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.94, 0.76), fleshMat);
      hump.position.set(0, 2.12, 0.22);
      hump.rotation.x = 0.4;
      const hornA = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.68, 10), boneMat);
      hornA.position.set(-0.28, 2.94, -0.02);
      hornA.rotation.z = 0.55;
      const hornB = hornA.clone();
      hornB.position.x = 0.34;
      hornB.rotation.z = -0.48;
      const spineRow = [];
      for (let index = 0; index < 4; index += 1) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.52 - index * 0.04, 8), boneMat);
        spike.position.set(0, 2.56 - index * 0.22, 0.58 - index * 0.12);
        spike.rotation.x = Math.PI * 0.58;
        spineRow.push(spike);
      }
      parts.push(hump, hornA, hornB, ...spineRow);
    }

    parts.forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    group.scale.setScalar(scale);
    group.userData = {
      fleshMat,
      clothMat,
      eyeMat,
      arms: [armA, armB],
      forearms: [forearmA, forearmB],
      legs: [thighA, thighB],
      shins: [shinA, shinB],
      claws: [clawA, clawB],
      torso,
      shoulders,
      head,
      jaw,
      targetX: zombie.x,
      targetZ: zombie.z,
      targetYaw: zombie.yaw,
      stridePhase: Math.random() * Math.PI * 2,
      hitFlash: 0,
      healthRatio: zombie.maxHp > 0 ? zombie.hp / zombie.maxHp : 1,
    };
    return group;
  }

  function createPickupMesh(pickup) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.28, 0.9),
      new THREE.MeshStandardMaterial({
        color: 0xb7bec6,
        roughness: 0.55,
        metalness: 0.16,
      })
    );
    const cross = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.08, 0.18),
      new THREE.MeshStandardMaterial({
        color: 0xe06161,
        emissive: 0x7d1818,
        emissiveIntensity: 1.2,
      })
    );
    const crossB = cross.clone();
    cross.position.y = 0.19;
    crossB.position.y = 0.19;
    crossB.rotation.y = Math.PI / 2;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.05, 10, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffc1c1,
        transparent: true,
        opacity: 0.55,
      })
    );
    ring.rotation.x = Math.PI / 2;
    [body, cross, crossB].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    group.add(ring);
    group.userData = {
      targetX: pickup.x,
      targetZ: pickup.z,
      rotation: pickup.rotation || 0,
      ring,
    };
    return group;
  }

  function createShotMesh(shot) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(shot.color || '#8be7ff'),
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geometry, material);
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 10),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(shot.color || '#8be7ff'),
        transparent: true,
        opacity: 0.9,
      })
    );
    const group = new THREE.Group();
    group.add(line, spark);
    group.userData = { line, spark };
    updateShotMesh(group, shot);
    return group;
  }

  function updateShotMesh(group, shot) {
    const positions = group.userData.line.geometry.attributes.position.array;
    positions[0] = shot.fromX;
    positions[1] = 1.5;
    positions[2] = shot.fromZ;
    positions[3] = shot.toX;
    positions[4] = 1.45;
    positions[5] = shot.toZ;
    group.userData.line.geometry.attributes.position.needsUpdate = true;
    const maxTtl = shot.weaponKey === 'shotgun' ? 0.07 : 0.09;
    const opacity = clamp((shot.ttl || maxTtl) / maxTtl, 0.18, 1);
    group.userData.line.material.opacity = opacity;
    group.userData.spark.material.opacity = shot.hit ? opacity : opacity * 0.2;
    group.userData.spark.visible = Boolean(shot.hit);
    group.userData.spark.position.set(shot.toX, 1.45, shot.toZ);
  }

  function syncEntityMap(map, items, parent, createMesh, applyState, removeMesh) {
    const seen = new Set();
    for (const item of items) {
      seen.add(item.id);
      let mesh = map.get(item.id);
      if (!mesh) {
        mesh = createMesh(item);
        map.set(item.id, mesh);
        parent.add(mesh);
      }
      applyState(mesh, item);
    }
    for (const [id, mesh] of map.entries()) {
      if (seen.has(id)) {
        continue;
      }
      parent.remove(mesh);
      if (removeMesh) {
        removeMesh(mesh);
      }
      map.delete(id);
    }
  }

  function syncSceneEntities(game) {
    const world = state.world;
    if (!world) {
      return;
    }
    syncEntityMap(
      world.players,
      game?.players || [],
      world.playerRoot,
      createPlayerMesh,
        (mesh, player) => {
          mesh.userData.targetX = player.x;
          mesh.userData.targetZ = player.z;
          mesh.userData.targetY = player.y || 0;
          mesh.userData.targetYaw = player.yaw;
          mesh.userData.targetAlive = player.alive;
          mesh.userData.health = player.health;
          mesh.userData.maxHealth = player.maxHealth;
          mesh.userData.flash = player.flash || 0;
          mesh.visible = true;
          const accentIntensity = player.alive ? 0.12 : 0.03;
          mesh.userData.accentMat.emissiveIntensity = accentIntensity;
          mesh.userData.gunMat.emissiveIntensity = clamp((player.flash || 0) * 2.4, 0, 2.4);
          mesh.userData.ringMat.opacity = player.alive ? 0.5 : 0.18;
        }
    );

    syncEntityMap(
      world.zombies,
      game?.zombies || [],
      world.zombieRoot,
      createZombieMesh,
      (mesh, zombie) => {
        mesh.userData.targetX = zombie.x;
        mesh.userData.targetZ = zombie.z;
        mesh.userData.targetYaw = zombie.yaw;
        mesh.userData.hitFlash = zombie.hitFlash || 0;
        mesh.userData.healthRatio = zombie.maxHp > 0 ? zombie.hp / zombie.maxHp : 1;
      }
    );

    syncEntityMap(
      world.pickups,
      game?.pickups || [],
      world.pickupRoot,
      createPickupMesh,
      (mesh, pickup) => {
        mesh.userData.targetX = pickup.x;
        mesh.userData.targetZ = pickup.z;
        mesh.userData.rotation = pickup.rotation || 0;
      }
    );

    syncEntityMap(
      world.shots,
      game?.shots || [],
      world.shotRoot,
      createShotMesh,
      updateShotMesh
    );
  }

  function clearSceneEntities() {
    if (!state.world) {
      return;
    }
    for (const key of ['players', 'zombies', 'shots', 'pickups']) {
      for (const mesh of state.world[key].values()) {
        mesh.parent?.remove(mesh);
      }
      state.world[key].clear();
    }
  }

  function resolveAimTarget(game, player) {
    if (!player) {
      return null;
    }
    return {
      x: player.x + Math.sin(state.input.yaw) * 48,
      z: player.z - Math.cos(state.input.yaw) * 48,
    };
  }

  function updateCamera(game, dt) {
    const camera = state.camera;
    const world = state.world;
    if (!camera || !world) {
      return;
    }
    const local = localPlayer(game);
    const targetPos = new THREE.Vector3();
    const lookAt = new THREE.Vector3();

    if (local) {
      const desiredLookYaw = Number.isFinite(state.input.yaw) ? state.input.yaw : local.yaw;
      const yawBlend = 1 - Math.pow(0.05, dt * 6.4);
      world.cameraYaw = lerpAngle(
        Number.isFinite(world.cameraYaw) ? world.cameraYaw : CAMERA_DEFAULT_YAW,
        desiredLookYaw,
        yawBlend
      );
      const cameraYaw = world.cameraYaw;
      const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const lift = (Number(local.y) || 0) * 0.72;
      const desiredAim = new THREE.Vector3(
        Number.isFinite(state.input.aimX) ? state.input.aimX : local.x + forward.x * 40,
        1.55,
        Number.isFinite(state.input.aimZ) ? state.input.aimZ : local.z + forward.z * 40
      );
      const aimBlend = 1 - Math.pow(0.22, dt * 7);
      world.aimTarget.lerp(desiredAim, aimBlend);
      const distance = game?.gameOver ? 11.3 : 9.4;
      const shoulder = new THREE.Vector3(local.x, PLAYER_HEIGHT + 0.45 + lift, local.z)
        .addScaledVector(right, 0.92);
      targetPos.copy(shoulder)
        .addScaledVector(forward, -distance)
        .addScaledVector(right, 1.08)
        .add(new THREE.Vector3(0, game?.gameOver ? 5.1 : 3.85, 0));
      const aimDir = new THREE.Vector3(world.aimTarget.x - local.x, 0, world.aimTarget.z - local.z);
      if (aimDir.lengthSq() > 0.001) {
        aimDir.normalize();
      } else {
        aimDir.copy(forward);
      }
      lookAt.set(local.x, PLAYER_HEIGHT + 0.74 + lift * 0.6, local.z)
        .addScaledVector(forward, 6.4)
        .addScaledVector(aimDir, 2.3);
    } else {
      const orbit = performance.now() * 0.00012;
      targetPos.set(Math.cos(orbit) * 30, 12, Math.sin(orbit) * 26);
      lookAt.set(0, 2, 0);
    }

    const amount = 1 - Math.pow(0.12, dt * 7);
    world.cameraPos.lerp(targetPos, amount);
    world.cameraLook.lerp(lookAt, amount);
    camera.position.copy(world.cameraPos);
    camera.lookAt(world.cameraLook);
  }

  function updateDynamicWorld(dt) {
    const world = state.world;
    if (!world) {
      return;
    }
    const time = performance.now() * 0.001;
    for (const sweep of world.dynamic.sweepLights) {
      const radius = 11 + Math.sin(time * 0.3 + sweep.phase) * 4;
      sweep.target.position.set(
        sweep.centerX + Math.cos(time * 0.6 + sweep.phase) * radius,
        0,
        sweep.centerZ + Math.sin(time * 0.5 + sweep.phase) * radius
      );
    }
    for (const beacon of world.dynamic.beaconLights) {
      beacon.light.intensity = 0.45 + Math.max(0, Math.sin(time * beacon.speed + beacon.phase)) * 2.1;
    }
    for (const entry of world.dynamic.skyline) {
      entry.mesh.position.y = entry.baseY + Math.sin(time * entry.speed + entry.bob) * 0.65;
      entry.mesh.material.emissiveIntensity = 0.35 + Math.max(0, Math.sin(time * entry.flicker + entry.bob)) * 0.9;
    }
    for (const traffic of world.dynamic.traffic) {
      const angle = time * traffic.speed + traffic.phase;
      traffic.group.position.set(Math.cos(angle) * traffic.laneRadius, traffic.height, Math.sin(angle) * traffic.laneRadius);
      traffic.group.rotation.y = -angle + Math.PI / 2;
    }
    if (world.dynamic.helicopter) {
      const heli = world.dynamic.helicopter;
      const angle = time * 0.16 + heli.phase;
      heli.group.position.set(Math.cos(angle) * 58, 20 + Math.sin(time * 0.7) * 1.1, Math.sin(angle) * 52);
      heli.group.rotation.y = -angle + Math.PI * 0.66;
      heli.rotor.rotation.y += dt * 24;
      heli.target.position.set(0, 0, 0);
    }
    for (const smoke of world.dynamic.smoke) {
      smoke.mesh.position.x += smoke.driftX * dt;
      smoke.mesh.position.z += smoke.driftZ * dt;
      smoke.mesh.position.y = smoke.baseY + Math.sin(time * smoke.speed + smoke.phase) * 0.7;
      smoke.mesh.material.opacity = 0.1 + (Math.sin(time * smoke.speed + smoke.phase) + 1) * 0.035;
      smoke.mesh.lookAt(state.camera.position);
      if (smoke.mesh.position.x > Core.ARENA.width * 0.5 + 20) {
        smoke.mesh.position.x = -Core.ARENA.width * 0.5 - 20;
      } else if (smoke.mesh.position.x < -Core.ARENA.width * 0.5 - 20) {
        smoke.mesh.position.x = Core.ARENA.width * 0.5 + 20;
      }
      if (smoke.mesh.position.z > Core.ARENA.depth * 0.5 + 20) {
        smoke.mesh.position.z = -Core.ARENA.depth * 0.5 - 20;
      } else if (smoke.mesh.position.z < -Core.ARENA.depth * 0.5 - 20) {
        smoke.mesh.position.z = Core.ARENA.depth * 0.5 + 20;
      }
    }
    if (world.aimMarker) {
      world.aimMarker.position.set(world.aimTarget.x, 0.05, world.aimTarget.z);
      world.aimMarker.material.opacity = state.mouse.inside ? 0.78 : 0.5;
      world.aimMarker.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
      world.aimMarker.visible = Boolean(currentGame() && !currentGame()?.gameOver);
    }
  }

  function animateScene(dt) {
    if (!state.world) {
      return;
    }
    const blend = 1 - Math.pow(0.002, dt * 60);

    for (const mesh of state.world.players.values()) {
      const moveDelta = Math.hypot(mesh.userData.targetX - mesh.position.x, mesh.userData.targetZ - mesh.position.z);
      const moving = mesh.userData.targetAlive && moveDelta > 0.025;
      const jumpLift = mesh.userData.targetY || 0;
      const airborne = mesh.userData.targetAlive && jumpLift > 0.04;
      mesh.position.x = lerp(mesh.position.x, mesh.userData.targetX, blend);
      mesh.position.z = lerp(mesh.position.z, mesh.userData.targetZ, blend);
      mesh.rotation.y = lerpAngle(mesh.rotation.y, mesh.userData.targetYaw, blend);
      mesh.userData.walkPhase += dt * (airborne ? 5.6 : moving ? 10.8 : 3.2);
      const bob = !airborne && moving ? Math.sin(mesh.userData.walkPhase) * 0.07 : 0;
      const recoil = clamp(mesh.userData.flash || 0, 0, 1);
      mesh.position.y = mesh.userData.targetAlive ? bob + jumpLift : -0.55;
      mesh.scale.y = lerp(mesh.scale.y, mesh.userData.targetAlive ? 1 : 0.85, blend);
      mesh.userData.thighs[0].rotation.x = airborne ? -0.42 : Math.sin(mesh.userData.walkPhase) * 0.34;
      mesh.userData.thighs[1].rotation.x = airborne ? 0.28 : Math.sin(mesh.userData.walkPhase + Math.PI) * 0.34;
      mesh.userData.shins[0].rotation.x = airborne ? 0.62 : Math.max(0, -Math.sin(mesh.userData.walkPhase)) * 0.24;
      mesh.userData.shins[1].rotation.x = airborne ? 0.42 : Math.max(0, -Math.sin(mesh.userData.walkPhase + Math.PI)) * 0.24;
      mesh.userData.upperArms[0].rotation.x = airborne ? -0.4 : -0.26 + Math.sin(mesh.userData.walkPhase + Math.PI) * 0.18;
      mesh.userData.upperArms[1].rotation.x = -0.5 + recoil * 0.3;
      mesh.userData.forearms[0].rotation.x = airborne ? -0.56 : -0.42 + Math.max(0, Math.sin(mesh.userData.walkPhase + Math.PI)) * 0.1;
      mesh.userData.forearms[1].rotation.x = -0.52 - recoil * 0.18;
      mesh.userData.rifle.rotation.x = 0.06 + recoil * 0.12;
      mesh.userData.rifle.position.y = 1.58 + bob * 0.22 + (airborne ? 0.04 : 0);
      mesh.userData.backpack.rotation.x = Math.sin(mesh.userData.walkPhase * 0.5) * 0.03;
      mesh.userData.visorMat.emissiveIntensity = 0.42 + recoil * 1.1;
      mesh.userData.muzzleMat.opacity = recoil * 0.95;
      mesh.userData.muzzleMat.color.set(recoil > 0.1 ? 0xffe3a8 : 0xffdf9a);
    }

    for (const mesh of state.world.zombies.values()) {
      mesh.position.x = lerp(mesh.position.x, mesh.userData.targetX, blend * 0.9);
      mesh.position.z = lerp(mesh.position.z, mesh.userData.targetZ, blend * 0.9);
      mesh.rotation.y = lerpAngle(mesh.rotation.y, mesh.userData.targetYaw, blend * 0.9);
      mesh.userData.stridePhase += dt * 6.4;
      mesh.userData.legs[0].rotation.x = Math.sin(mesh.userData.stridePhase) * 0.34;
      mesh.userData.legs[1].rotation.x = Math.sin(mesh.userData.stridePhase + Math.PI) * 0.34;
      mesh.userData.shins[0].rotation.x = Math.max(0, -Math.sin(mesh.userData.stridePhase)) * 0.28;
      mesh.userData.shins[1].rotation.x = Math.max(0, -Math.sin(mesh.userData.stridePhase + Math.PI)) * 0.28;
      mesh.userData.arms[0].rotation.x = Math.sin(mesh.userData.stridePhase) * 0.55;
      mesh.userData.arms[1].rotation.x = Math.sin(mesh.userData.stridePhase + Math.PI) * 0.55;
      mesh.userData.forearms[0].rotation.x = -0.2 + Math.sin(mesh.userData.stridePhase) * 0.44;
      mesh.userData.forearms[1].rotation.x = -0.2 + Math.sin(mesh.userData.stridePhase + Math.PI) * 0.44;
      mesh.userData.claws[0].rotation.x = Math.sin(mesh.userData.stridePhase) * 0.42;
      mesh.userData.claws[1].rotation.x = Math.sin(mesh.userData.stridePhase + Math.PI) * 0.42;
      mesh.userData.torso.rotation.x = 0.12 + Math.sin(mesh.userData.stridePhase * 0.5) * 0.05;
      mesh.userData.shoulders.rotation.z = 0.1 + Math.sin(mesh.userData.stridePhase * 0.36) * 0.04;
      mesh.userData.head.rotation.z = Math.sin(mesh.userData.stridePhase * 0.4) * 0.08;
      mesh.userData.head.rotation.x = 0.06 + Math.sin(mesh.userData.stridePhase * 0.32) * 0.04;
      mesh.userData.jaw.rotation.x = 0.16 + Math.max(0, Math.sin(mesh.userData.stridePhase * 1.1)) * 0.18;
      const flash = clamp(mesh.userData.hitFlash * 7.5, 0, 1.3);
      mesh.userData.fleshMat.emissive.setRGB(flash * 0.6, flash * 0.08, flash * 0.08);
      mesh.userData.clothMat.emissive.setRGB(flash * 0.2, flash * 0.03, flash * 0.03);
      mesh.userData.eyeMat.emissiveIntensity = 1.35 + Math.sin(mesh.userData.stridePhase * 0.8) * 0.52 + flash * 1.05;
    }

    for (const mesh of state.world.pickups.values()) {
      mesh.position.x = lerp(mesh.position.x, mesh.userData.targetX, blend);
      mesh.position.z = lerp(mesh.position.z, mesh.userData.targetZ, blend);
      mesh.position.y = 0.58 + Math.sin(performance.now() * 0.003 + mesh.userData.targetX) * 0.08;
      mesh.rotation.y += dt * 1.1;
      mesh.userData.ring.rotation.z += dt * 0.6;
    }

    updateDynamicWorld(dt);
  }

  function resizeRenderer() {
    if (!state.renderer || !state.camera) {
      return;
    }
    const rect = ui.stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (ui.canvas.width !== width || ui.canvas.height !== height) {
      state.renderer.setSize(width, height, false);
      state.camera.aspect = width / height;
      state.camera.updateProjectionMatrix();
    }
  }

  function disconnectSocket() {
    if (!state.socket) {
      return;
    }
    state.socket.onclose = null;
    state.socket.onerror = null;
    state.socket.onmessage = null;
    state.socket.close();
    state.socket = null;
  }

  function resetSession() {
    state.snapshot = null;
    state.localGame = null;
    state.yourPlayerId = '';
    state.roomCode = '';
    state.lastInputSentAt = 0;
    state.lastEventId = 0;
    state.hasYawSeed = false;
    state.movement.active = false;
    state.movement.rawX = 0;
    state.movement.rawY = 0;
    state.movement.worldX = 0;
    state.movement.worldZ = 0;
    state.input.moveDirX = 0;
    state.input.moveDirZ = 0;
    state.input.jump = false;
    state.keys.lookLeft = false;
    state.keys.lookRight = false;
    state.keys.jump = false;
    state.keys.fire = false;
    if (state.world) {
      state.world.cameraYaw = CAMERA_DEFAULT_YAW;
    }
    clearSceneEntities();
    updateInviteUi();
  }

  function connectOnline(mode) {
    const joinMode = mode === 'join' ? 'join' : 'host';
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (joinMode === 'join' && !roomCode) {
      showToast('Enter a room code first.');
      return;
    }

    disconnectSocket();
    resetSession();
    state.mode = 'connecting';
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    persistSettings();
    renderPanels();

    const socket = new WebSocket(state.serverUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        action: 'join',
        mode: joinMode,
        roomCode,
        name: getPlayerName(),
        game: 'zombie-siege',
      }));
    });

    socket.addEventListener('message', (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (payload.type === 'welcome') {
        state.mode = 'online';
        state.yourPlayerId = payload.playerId;
        state.roomCode = payload.roomCode || state.roomCode;
        ui.roomInput.value = state.roomCode;
        state.statusMessage = '';
        renderPanels();
        return;
      }

      if (payload.type === 'state') {
        state.snapshot = payload.snapshot;
        state.roomCode = payload.snapshot?.roomCode || state.roomCode;
        ui.roomInput.value = state.roomCode;
        if (!state.hasYawSeed) {
          const player = localPlayer(payload.snapshot);
          if (player) {
            state.input.yaw = player.yaw;
            if (state.world) {
              state.world.cameraYaw = player.yaw;
            }
            state.hasYawSeed = true;
          }
        }
        if (payload.message) {
          showToast(payload.message);
        }
        return;
      }

      if (payload.type === 'error') {
        state.mode = 'idle';
        setStatusMessage(payload.message || 'Could not join that room.');
        disconnectSocket();
        resetSession();
        renderPanels();
      }
    });

    socket.addEventListener('close', () => {
      const wasLive = state.mode === 'online' || state.mode === 'connecting';
      state.socket = null;
      if (wasLive) {
        state.mode = 'idle';
        setStatusMessage('Connection closed. Host again or rejoin the room.');
        resetSession();
        renderPanels();
      }
    });

    socket.addEventListener('error', () => {
      if (state.mode === 'connecting') {
        state.mode = 'idle';
        setStatusMessage('Could not reach the zombie server.');
        disconnectSocket();
        renderPanels();
      }
    });
  }

  function startSolo() {
    disconnectSocket();
    resetSession();
    state.mode = 'solo';
    state.localGame = Core.createGameState();
    Core.addPlayer(state.localGame, {
      id: 'solo-survivor',
      name: getPlayerName(),
      color: '#73d9ff',
    });
    state.yourPlayerId = 'solo-survivor';
    state.roomCode = 'SOLO';
    state.input.yaw = -Math.PI / 2;
    state.input.jump = false;
    if (state.world) {
      state.world.cameraYaw = state.input.yaw;
    }
    state.hasYawSeed = true;
    state.statusMessage = '';
    updateInviteUi();
    renderPanels();
  }

  function restartRun() {
    if (state.mode === 'solo' && state.localGame) {
      Core.resetMatch(state.localGame);
      state.lastEventId = 0;
      showToast('Solo run restarted.');
      return;
    }
    if (state.mode === 'online' && state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ action: 'restart' }));
    }
  }

  function formatFeedEvent(event) {
    switch (event.type) {
      case 'player-join':
        return `${event.playerName} checked in.`;
      case 'player-leave':
        return `${event.playerName} dropped from the squad.`;
      case 'wave-start':
        return `Wave ${event.wave} breached the yard.`;
      case 'boss-wave':
        return `Boss wave ${event.wave}: abomination incoming.`;
      case 'enemy-down':
        return `${event.playerName} dropped a ${event.enemyType}.`;
      case 'pickup':
        return `${event.playerName} grabbed a med kit.`;
      case 'player-down':
        return `${event.playerName} went down.`;
      case 'player-respawn':
        return `${event.playerName} got back in the fight.`;
      case 'wave-clear':
        return `Wave ${event.wave} cleared.`;
      case 'game-over':
        return `The yard fell on wave ${event.wave}.`;
      default:
        return 'Field activity updated.';
    }
  }

  function processEvents(game) {
    const events = Array.isArray(game?.events) ? game.events : [];
    if (events.length && events[events.length - 1].id < state.lastEventId) {
      state.lastEventId = 0;
    }
    for (const event of events) {
      if (event.id <= state.lastEventId) {
        continue;
      }
      state.lastEventId = event.id;
      if (event.type === 'boss-wave') {
        showToast(`Boss wave ${event.wave} is live.`);
      } else if (event.type === 'player-down' && event.playerId === state.yourPlayerId) {
        showToast('You went down. Stay in the room for the respawn.');
      } else if (event.type === 'player-respawn' && event.playerId === state.yourPlayerId) {
        showToast('You fought your way back in.');
      } else if (event.type === 'wave-clear') {
        showToast(`Wave ${event.wave} cleared.`);
      } else if (event.type === 'game-over') {
        showToast(`Run over on wave ${event.wave}.`);
      }
    }
  }

  function renderPlayersPanel(game) {
    const players = Array.isArray(game?.players) ? [...game.players].sort((left, right) => left.seat - right.seat) : [];
    ui.playerCards.innerHTML = players.map((player) => {
      const chips = [];
      if (player.id === state.yourPlayerId) {
        chips.push('<span class="chip you">You</span>');
      }
      if (!player.alive) {
        chips.push(`<span class="chip down">Respawn ${player.respawnTimer.toFixed(1)}s</span>`);
      } else {
        chips.push('<span class="chip">Alive</span>');
      }
      chips.push(`<span class="chip weapon">${escapeHtml((Core.WEAPONS[player.weaponKey] || Core.WEAPONS.rifle).label)}</span>`);
      return `
        <article class="player-card" style="border-color:${escapeHtml(player.color || '#73d9ff')}44">
          <strong>${escapeHtml(player.name)}</strong>
          <p>Health ${Math.round(player.health)} / ${Math.round(player.maxHealth)} · Kills ${player.kills} · Score ${player.score}</p>
          <div class="player-meta">${chips.join('')}</div>
        </article>
      `;
    }).join('');

    if (state.mode === 'online') {
      ui.presenceText.textContent = players.length >= 2 ? 'Squad synced online.' : 'Room live. Waiting for more survivors.';
    } else if (state.mode === 'solo') {
      ui.presenceText.textContent = 'Solo run active.';
    } else {
      ui.presenceText.textContent = 'No survivors connected yet.';
    }
  }

  function renderFeed(game) {
    const events = Array.isArray(game?.events) ? game.events.slice(-8).reverse() : [];
    ui.feedList.innerHTML = events.length
      ? events.map((event) => `
          <article class="feed-item">
            <strong>${escapeHtml(formatFeedEvent(event))}</strong>
            <p>${event.wave ? `Wave ${event.wave}` : 'Live event'} · ${event.time?.toFixed ? event.time.toFixed(1) : 'now'}s</p>
          </article>
        `).join('')
      : '<article class="feed-item"><strong>Quiet for now.</strong><p>The next wave call, pickup, or boss alert will land here.</p></article>';
  }

  function renderOverlay(game) {
    const show = !game || game.gameOver;
    ui.overlay.classList.toggle('hidden', !show);
    if (!show) {
      return;
    }

    if (!game) {
      ui.overlayTitle.textContent = 'Zombie Siege 3D Live';
      ui.overlayCopy.textContent = 'Host a room, join a friend, or start solo. Turn with Q/E or Left/Right, jump with Space, and click to fire.';
      ui.overlayMeta.textContent = 'Controls: WASD move, Q/E or Left/Right turns, Left Click fires, Space jumps, Shift sprints, 1 2 3 swaps weapons.';
      ui.startBtn.textContent = 'Start solo instantly';
      return;
    }

    if (game.gameOver) {
      ui.overlayTitle.textContent = `Run over on wave ${game.wave || 0}`;
      ui.overlayCopy.textContent = `Final squad score ${Math.round(game.score || 0)}. Restart the run or keep the room open and send a fresh invite.`;
      ui.overlayMeta.textContent = 'Restart uses the same room code online, so your squad can jump straight back in.';
      ui.startBtn.textContent = 'Restart run';
      return;
    }

    ui.overlayTitle.textContent = state.mode === 'online' ? 'Back to the yard' : 'Resume the solo siege';
    ui.overlayCopy.textContent = state.mode === 'online'
      ? 'The room is still live. Turn with Q/E or Left/Right, jump with Space, and click to fire.'
      : 'Turn with Q/E or Left/Right, jump with Space, and click to fire. No mouse lock needed.';
    ui.overlayMeta.textContent = `Current weapon: ${currentWeaponLabel(game)}. Use Q/E or Left/Right to turn, 1 2 3 to swap weapons, and Space to jump.`;
    ui.startBtn.textContent = 'Continue';
  }

  function renderPanels() {
    const game = currentGame();
    const player = localPlayer(game);
    ui.statusText.textContent = defaultStatusText();
    ui.roomCodeLabel.textContent = state.roomCode || '-';
    ui.waveLabel.textContent = game?.wave ? `Wave ${game.wave}` : 'Stand by';
    ui.remainingLabel.textContent = String(remainingThreats(game));
    ui.scoreLabel.textContent = String(Math.round(game?.score || 0));
    ui.missionText.textContent = game?.status || 'Get the room live and hold the lot.';
    ui.objectiveText.textContent = game?.objective || 'Clear the yard before the breach breaks through.';

    let condition = 'Stand by';
    if (game?.gameOver) {
      condition = 'Overrun';
    } else if (player && !player.alive) {
      condition = `Respawn ${player.respawnTimer.toFixed(1)}s`;
    } else if (state.mode === 'online' && (game?.players?.length || 0) < 2) {
      condition = 'Awaiting squad';
    } else if (game?.intermission > 0 && !remainingThreats(game) && game.wave > 0) {
      condition = `Intermission ${game.intermission.toFixed(1)}s`;
    } else if (game) {
      condition = `${currentWeaponLabel(game)} ready`;
    }
    ui.conditionLabel.textContent = condition;

    if (state.mode === 'online' && state.socket?.readyState === WebSocket.OPEN) {
      setNetworkStatus('Online', 'online');
      setModePill(state.roomCode ? `Room ${state.roomCode}` : 'Live room');
    } else if (state.mode === 'connecting') {
      setNetworkStatus('Connecting', 'connecting');
      setModePill('Connecting');
    } else if (state.mode === 'solo') {
      setNetworkStatus('Local', 'connecting');
      setModePill('Solo run');
    } else {
      setNetworkStatus('Offline', 'offline');
      setModePill('No room active');
    }

    ui.controlHint.textContent = 'WASD moves. Q/E or Left/Right turns. Left Click fires. Space jumps. Shift sprints. Press 1, 2, or 3 for rifle, SMG, and shotgun.';
    ui.restartBtn.disabled = !game;
    ui.stage.classList.toggle('live', Boolean(game && !game.gameOver));
    updateInviteUi();
    renderPlayersPanel(game);
    renderFeed(game);
    renderOverlay(game);
  }

  function seedYawIfNeeded(game) {
    if (state.hasYawSeed) {
      return;
    }
    const player = localPlayer(game);
    if (!player) {
      return;
    }
    state.input.yaw = player.yaw;
    if (state.world) {
      state.world.cameraYaw = player.yaw;
    }
    state.hasYawSeed = true;
  }

  function composeInput(game, dt) {
    let moveX = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
    let moveY = (state.keys.forward ? 1 : 0) - (state.keys.back ? 1 : 0);
    const magnitude = Math.hypot(moveX, moveY) || 1;
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }
    state.input.moveX = moveX;
    state.input.moveY = moveY;
    state.input.fire = state.keys.fire;
    state.input.jump = state.keys.jump;
    state.input.sprint = state.keys.sprint;
    const lookTurn = (state.keys.lookRight ? 1 : 0) - (state.keys.lookLeft ? 1 : 0);
    if (lookTurn) {
      state.input.yaw = normalizeAngle(state.input.yaw + lookTurn * LOOK_TURN_SPEED * dt);
      if (state.world) {
        state.world.cameraYaw = state.input.yaw;
      }
    }
    const player = localPlayer(game);
    if (player) {
      const target = resolveAimTarget(game, player);
      if (target) {
        state.input.aimX = target.x;
        state.input.aimZ = target.z;
      }
    }

    if (Math.abs(moveX) > 0.001 || Math.abs(moveY) > 0.001) {
      const movementYaw = Number.isFinite(state.input.yaw)
        ? state.input.yaw
        : (Number.isFinite(state.world?.cameraYaw) ? state.world.cameraYaw : CAMERA_DEFAULT_YAW);
      const forwardX = Math.sin(movementYaw);
      const forwardZ = -Math.cos(movementYaw);
      const rightX = -forwardZ;
      const rightZ = forwardX;
      const worldMoveX = rightX * moveX + forwardX * moveY;
      const worldMoveZ = rightZ * moveX + forwardZ * moveY;
      const worldMagnitude = Math.hypot(worldMoveX, worldMoveZ) || 1;
      state.input.moveDirX = worldMoveX / worldMagnitude;
      state.input.moveDirZ = worldMoveZ / worldMagnitude;
    } else {
      state.input.moveDirX = 0;
      state.input.moveDirZ = 0;
    }

    return state.input;
  }

  function sendInputIfNeeded(now) {
    if (state.mode !== 'online' || state.socket?.readyState !== WebSocket.OPEN || !state.snapshot) {
      return;
    }
    if (now - state.lastInputSentAt < INPUT_SEND_MS) {
      return;
    }
    state.lastInputSentAt = now;
    state.socket.send(JSON.stringify({
      action: 'input',
      input: state.input,
    }));
  }

  function updateSolo(dt) {
    if (state.mode !== 'solo' || !state.localGame) {
      return;
    }
    Core.setPlayerInput(state.localGame, state.yourPlayerId, state.input);
    Core.step(state.localGame, dt);
  }

  function renderFrame(now) {
    initScene();
    const dt = Math.min(0.05, Math.max(0.001, (now - state.lastFrameAt) / 1000));
    state.lastFrameAt = now;

    const preGame = currentGame();
    seedYawIfNeeded(preGame);
    composeInput(preGame, dt);
    updateSolo(dt);
    const game = currentGame();
    processEvents(game);
    syncSceneEntities(game);
    animateScene(dt);
    updateCamera(game, dt);
    resizeRenderer();
    sendInputIfNeeded(now);

    if (state.renderer && state.scene && state.camera) {
      state.renderer.render(state.scene, state.camera);
    }

    if (now >= state.nextUiRefreshAt) {
      renderPanels();
      state.nextUiRefreshAt = now + 140;
    }
    window.requestAnimationFrame(renderFrame);
  }

  function handleOverlayAction() {
    const game = currentGame();
    if (!game) {
      startSolo();
      return;
    }
    if (game.gameOver) {
      restartRun();
    }
  }

  function setKeyState(code, pressed) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        state.keys.forward = pressed;
        return true;
      case 'KeyS':
      case 'ArrowDown':
        state.keys.back = pressed;
        return true;
      case 'KeyA':
        state.keys.left = pressed;
        return true;
      case 'KeyD':
        state.keys.right = pressed;
        return true;
      case 'KeyQ':
      case 'ArrowLeft':
        state.keys.lookLeft = pressed;
        return true;
      case 'KeyE':
      case 'ArrowRight':
        state.keys.lookRight = pressed;
        return true;
      case 'ShiftLeft':
      case 'ShiftRight':
        state.keys.sprint = pressed;
        return true;
      case 'Space':
        state.keys.jump = pressed;
        return true;
      case 'Digit1':
        if (pressed) {
          state.input.weaponKey = 'rifle';
          showToast('Rifle ready.');
        }
        return true;
      case 'Digit2':
        if (pressed) {
          state.input.weaponKey = 'smg';
          showToast('SMG ready.');
        }
        return true;
      case 'Digit3':
        if (pressed) {
          state.input.weaponKey = 'shotgun';
          showToast('Shotgun ready.');
        }
        return true;
      default:
        return false;
    }
  }

  function updateMouseAim(clientX, clientY) {
    state.mouse.inside = true;
    if (ui.crosshair) {
      ui.crosshair.classList.remove('hidden');
    }
  }

  function bindEvents() {
    ui.roomInput.addEventListener('input', () => {
      ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
    });

    ui.serverUrlInput.addEventListener('change', () => {
      state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
      ui.serverUrlInput.value = state.serverUrl;
      persistSettings();
    });

    ui.hostBtn.addEventListener('click', () => connectOnline('host'));
    ui.joinBtn.addEventListener('click', () => connectOnline('join'));
    ui.soloBtn.addEventListener('click', () => startSolo());
    ui.copyBtn.addEventListener('click', () => copyText(ui.inviteInput.value, 'Invite copied.'));
    ui.copyCodeBtn.addEventListener('click', () => copyText(state.roomCode, 'Room code copied.'));
    ui.openLoungeBtn.addEventListener('click', () => openArcadeLounge(false));
    ui.shareLoungeBtn.addEventListener('click', () => openArcadeLounge(true));
    ui.restartBtn.addEventListener('click', restartRun);
    ui.startBtn.addEventListener('click', handleOverlayAction);

    ui.stage.addEventListener('mousemove', (event) => {
      updateMouseAim(event.clientX, event.clientY);
    });
    ui.stage.addEventListener('mouseenter', (event) => {
      updateMouseAim(event.clientX, event.clientY);
    });
    ui.stage.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
      if (!currentGame() || currentGame()?.gameOver) {
        return;
      }
      updateMouseAim(event.clientX, event.clientY);
      state.keys.fire = true;
    });

    window.addEventListener('mouseup', () => {
      state.keys.fire = false;
    });

    ui.stage.addEventListener('mouseleave', () => {
      state.mouse.inside = false;
      state.keys.fire = false;
      ui.crosshair?.classList.add('hidden');
    });

    window.addEventListener('keydown', (event) => {
      const consumed = setKeyState(event.code, true);
      if (consumed) {
        event.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('keyup', (event) => {
      const consumed = setKeyState(event.code, false);
      if (consumed) {
        event.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('resize', resizeRenderer);
    window.addEventListener('beforeunload', () => {
      disconnectSocket();
    });
  }

  function loadSettings() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = sanitizeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || query.get('server') || PROD_SERVER_URL);
    ui.serverUrlInput.value = state.serverUrl;
    const inviteRoom = sanitizeRoomCode(query.get('room'));
    if (inviteRoom) {
      ui.roomInput.value = inviteRoom;
      state.statusMessage = `Invite loaded for room ${inviteRoom}. Press Join room when you are ready.`;
    }
  }

  loadSettings();
  initScene();
  bindEvents();
  renderPanels();
  window.requestAnimationFrame(renderFrame);
})();
