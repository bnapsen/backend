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
  const MOUSE_SENSITIVITY = 0.00235;
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
    pointerLocked: false,
    lastFrameAt: performance.now(),
    lastInputSentAt: 0,
    nextUiRefreshAt: 0,
    lastEventId: 0,
    hasYawSeed: false,
    input: {
      moveX: 0,
      moveY: 0,
      yaw: -Math.PI / 2,
      fire: false,
      sprint: false,
      weaponKey: 'rifle',
    },
    keys: {
      forward: false,
      back: false,
      left: false,
      right: false,
      sprint: false,
      fire: false,
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
      return 'Solo run is live. Click into the arena to lock the mouse and test the new hitscan gunplay.';
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

    return { asphalt, concrete, metal, hazard };
  }

  function createLabelSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(5, 8, 12, 0.72)';
    ctx.beginPath();
    ctx.roundRect(12, 18, 232, 50, 18);
    ctx.fill();
    ctx.strokeStyle = `${color}aa`;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = '700 30px Rajdhani, sans-serif';
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
    sprite.scale.set(4.4, 1.65, 1);
    sprite.position.set(0, 3.5, 0);
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
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06080b);
    scene.fog = new THREE.FogExp2(0x06080b, 0.022);

    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 240);
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

    buildArenaShell(scene);
    buildArenaProps(scene);
    resizeRenderer();
  }

  function buildArenaShell(scene) {
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: state.textures.concrete,
      roughness: 0.92,
      metalness: 0.05,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      map: state.textures.metal,
      roughness: 0.62,
      metalness: 0.42,
      color: 0xa5afb7,
    });
    const halfW = Core.ARENA.width * 0.5;
    const halfD = Core.ARENA.depth * 0.5;

    [
      { x: 0, z: -halfD - 1.2, w: Core.ARENA.width + 8, d: 2.4 },
      { x: 0, z: halfD + 1.2, w: Core.ARENA.width + 8, d: 2.4 },
      { x: -halfW - 1.2, z: 0, w: 2.4, d: Core.ARENA.depth + 8 },
      { x: halfW + 1.2, z: 0, w: 2.4, d: Core.ARENA.depth + 8 },
    ].forEach((wall) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(wall.w, 6.4, wall.d),
        wallMaterial
      );
      mesh.position.set(wall.x, 3.2, wall.z);
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
      mesh.position.set(rail.x, 2.8, rail.z);
      mesh.castShadow = true;
      scene.add(mesh);
    });

    const skyline = new THREE.Group();
    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0x10151c,
      roughness: 0.95,
      metalness: 0.04,
    });
    for (let index = 0; index < 16; index += 1) {
      const width = 7 + Math.random() * 10;
      const depth = 7 + Math.random() * 10;
      const height = 18 + Math.random() * 44;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        buildingMat
      );
      const angle = (index / 16) * Math.PI * 2;
      const radius = 70 + Math.random() * 24;
      mesh.position.set(Math.cos(angle) * radius, height * 0.5, Math.sin(angle) * radius);
      skyline.add(mesh);
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
      [-28, -24],
      [28, -24],
      [-28, 24],
      [28, 24],
    ].forEach(([x, z]) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 11, 10), poleMat);
      pole.position.set(x, 5.5, z);
      pole.castShadow = true;
      scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.56, 1.2), lampMat);
      lamp.position.set(x, 10.8, z);
      scene.add(lamp);
      const light = new THREE.SpotLight(0xffe1aa, 170, 48, Math.PI / 5.2, 0.4, 1.4);
      light.position.set(x, 10.3, z);
      light.target.position.set(0, 0, 0);
      light.castShadow = false;
      scene.add(light, light.target);
    });
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
      [-14, -8, 0.3],
      [16, -10, -0.28],
      [-19, 11, -0.18],
      [20, 13, 0.42],
      [0, 4, 0],
    ].forEach(([x, z, rotation]) => {
      scene.add(buildBarricade(x, z, rotation));
    });

    const bloodMat = new THREE.MeshBasicMaterial({
      color: 0x43090c,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    for (let index = 0; index < 10; index += 1) {
      const decal = new THREE.Mesh(
        new THREE.CircleGeometry(0.8 + Math.random() * 1.6, 24),
        bloodMat
      );
      decal.rotation.x = -Math.PI / 2;
      decal.position.set((Math.random() - 0.5) * 36, 0.02, (Math.random() - 0.5) * 34);
      scene.add(decal);
    }
  }

  function createPlayerMesh(player) {
    const group = new THREE.Group();
    const accent = new THREE.Color(player.color || '#73d9ff');
    const fabricMat = new THREE.MeshStandardMaterial({
      color: 0x20252b,
      roughness: 0.92,
      metalness: 0.02,
    });
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x3d454d,
      roughness: 0.58,
      metalness: 0.18,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent.clone().multiplyScalar(0.1),
      roughness: 0.44,
      metalness: 0.15,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xd8b39d,
      roughness: 0.85,
      metalness: 0.02,
    });
    const gunMat = new THREE.MeshStandardMaterial({
      color: 0x171a1f,
      roughness: 0.42,
      metalness: 0.68,
      emissive: new THREE.Color(0x000000),
    });

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.88, 1.2, 0.6), fabricMat);
    legs.position.set(0, 0.64, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.14, 1.28, 0.7), armorMat);
    torso.position.set(0, 1.7, 0);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.84, 0.74), accentMat);
    vest.position.set(0, 1.64, 0.06);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 20), skinMat);
    head.position.set(0, 2.62, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.05), gunMat);
    gun.position.set(0.38, 1.68, -0.52);
    gun.rotation.x = Math.PI * 0.04;
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
    [legs, torso, vest, head, gun].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    group.add(ring);
    group.add(createLabelSprite(player.name, player.color || '#73d9ff'));
    group.userData = {
      gunMat,
      accentMat,
      ringMat: ring.material,
      labelHeight: 3.5,
      targetX: player.x,
      targetZ: player.z,
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
      color: new THREE.Color(type.tint || '#9ec593'),
      roughness: 0.92,
      metalness: 0.03,
      emissive: new THREE.Color(0x000000),
    });
    const clothMat = new THREE.MeshStandardMaterial({
      color: zombie.type === 'boss' ? 0x291617 : zombie.type === 'brute' ? 0x4b463c : 0x2e322b,
      roughness: 0.95,
      metalness: 0.02,
      emissive: new THREE.Color(0x000000),
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x2f0808,
      emissive: zombie.type === 'boss' ? 0xff6969 : 0xc73636,
      emissiveIntensity: zombie.type === 'boss' ? 3 : 1.8,
      roughness: 0.2,
    });
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.14, 0.58), clothMat);
    legs.position.set(0, 0.58, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.35, 0.72), fleshMat);
    torso.position.set(0, 1.62, 0);
    torso.rotation.z = 0.09;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 18), fleshMat);
    head.position.set(0, 2.58, -0.04);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.1), eyeMat);
    eyes.position.set(0, 2.62, -0.28);
    const armA = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.18, 0.28), fleshMat);
    armA.position.set(-0.72, 1.58, -0.16);
    armA.rotation.z = 0.38;
    const armB = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.18, 0.28), fleshMat);
    armB.position.set(0.72, 1.58, -0.2);
    armB.rotation.z = -0.5;
    [legs, torso, head, eyes, armA, armB].forEach((mesh) => {
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
        mesh.userData.targetYaw = player.yaw;
        mesh.userData.targetAlive = player.alive;
        mesh.userData.health = player.health;
        mesh.userData.maxHealth = player.maxHealth;
        mesh.visible = !(player.id === state.yourPlayerId && state.pointerLocked && player.alive);
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
      const forward = new THREE.Vector3(Math.sin(local.yaw), 0, -Math.cos(local.yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const distance = game?.gameOver ? 11.5 : state.pointerLocked ? 7.2 : 8.6;
      targetPos.copy(new THREE.Vector3(local.x, 0, local.z))
        .addScaledVector(forward, -distance)
        .addScaledVector(right, 1.6)
        .add(new THREE.Vector3(0, game?.gameOver ? 7.4 : 5.0, 0));
      lookAt.copy(new THREE.Vector3(local.x, PLAYER_HEIGHT + 0.28, local.z))
        .addScaledVector(forward, 6.6);
    } else {
      const orbit = performance.now() * 0.00012;
      targetPos.set(Math.cos(orbit) * 30, 12, Math.sin(orbit) * 26);
      lookAt.set(0, 2, 0);
    }

    const amount = 1 - Math.pow(0.0008, dt * 60);
    world.cameraPos.lerp(targetPos, amount);
    world.cameraLook.lerp(lookAt, amount);
    camera.position.copy(world.cameraPos);
    camera.lookAt(world.cameraLook);
  }

  function animateScene(dt) {
    if (!state.world) {
      return;
    }
    const blend = 1 - Math.pow(0.002, dt * 60);

    for (const mesh of state.world.players.values()) {
      mesh.position.x = lerp(mesh.position.x, mesh.userData.targetX, blend);
      mesh.position.z = lerp(mesh.position.z, mesh.userData.targetZ, blend);
      mesh.rotation.y = lerpAngle(mesh.rotation.y, mesh.userData.targetYaw, blend);
      mesh.position.y = mesh.userData.targetAlive ? 0 : -0.55;
    }

    for (const mesh of state.world.zombies.values()) {
      mesh.position.x = lerp(mesh.position.x, mesh.userData.targetX, blend * 0.9);
      mesh.position.z = lerp(mesh.position.z, mesh.userData.targetZ, blend * 0.9);
      mesh.rotation.y = lerpAngle(mesh.rotation.y, mesh.userData.targetYaw, blend * 0.9);
      mesh.userData.stridePhase += dt * 6.4;
      mesh.userData.arms[0].rotation.x = Math.sin(mesh.userData.stridePhase) * 0.55;
      mesh.userData.arms[1].rotation.x = Math.sin(mesh.userData.stridePhase + Math.PI) * 0.55;
      const flash = clamp(mesh.userData.hitFlash * 7.5, 0, 1.3);
      mesh.userData.fleshMat.emissive.setRGB(flash * 0.6, flash * 0.08, flash * 0.08);
      mesh.userData.clothMat.emissive.setRGB(flash * 0.2, flash * 0.03, flash * 0.03);
    }

    for (const mesh of state.world.pickups.values()) {
      mesh.position.x = lerp(mesh.position.x, mesh.userData.targetX, blend);
      mesh.position.z = lerp(mesh.position.z, mesh.userData.targetZ, blend);
      mesh.position.y = 0.58 + Math.sin(performance.now() * 0.003 + mesh.userData.targetX) * 0.08;
      mesh.rotation.y += dt * 1.1;
      mesh.userData.ring.rotation.z += dt * 0.6;
    }
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
    const show = !game || game.gameOver || !state.pointerLocked;
    ui.overlay.classList.toggle('hidden', !show);
    if (!show) {
      return;
    }

    if (!game) {
      ui.overlayTitle.textContent = 'Zombie Siege 3D Live';
      ui.overlayCopy.textContent = 'Host a room, join a friend, or start solo. Once you are in the yard, lock the mouse and the new hitscan gunplay will take over.';
      ui.overlayMeta.textContent = 'Controls: WASD move, mouse turns, Left Click fires, Shift sprints, 1 2 3 swaps weapons.';
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

    ui.overlayTitle.textContent = state.mode === 'online' ? 'Lock aim and deploy' : 'Resume the solo siege';
    ui.overlayCopy.textContent = state.mode === 'online'
      ? 'Click the button below or click the arena to lock the mouse. The room keeps running while your aim is unlocked.'
      : 'Click the button below or the arena to lock the mouse and resume the solo run.';
    ui.overlayMeta.textContent = `Current weapon: ${currentWeaponLabel(game)}. Use 1, 2, and 3 to swap instantly.`;
    ui.startBtn.textContent = 'Lock aim and continue';
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

    ui.controlHint.textContent = 'WASD moves. Mouse turns. Left Click fires. Shift sprints. Press 1, 2, or 3 for rifle, SMG, and shotgun. Click the arena to lock your aim.';
    ui.restartBtn.disabled = !game;
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
    state.hasYawSeed = true;
  }

  function composeInput() {
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
    state.input.sprint = state.keys.sprint;
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
      input: composeInput(),
    }));
  }

  function updateSolo(dt) {
    if (state.mode !== 'solo' || !state.localGame) {
      return;
    }
    composeInput();
    Core.setPlayerInput(state.localGame, state.yourPlayerId, state.input);
    Core.step(state.localGame, dt);
  }

  function renderFrame(now) {
    initScene();
    const dt = Math.min(0.05, Math.max(0.001, (now - state.lastFrameAt) / 1000));
    state.lastFrameAt = now;

    updateSolo(dt);
    const game = currentGame();
    seedYawIfNeeded(game);
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

  function requestAimLock() {
    if (!currentGame() || currentGame()?.gameOver) {
      return;
    }
    ui.stage.requestPointerLock?.();
  }

  function handleOverlayAction() {
    const game = currentGame();
    if (!game) {
      startSolo();
      requestAimLock();
      return;
    }
    if (game.gameOver) {
      restartRun();
      return;
    }
    requestAimLock();
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
      case 'ArrowLeft':
        state.keys.left = pressed;
        return true;
      case 'KeyD':
      case 'ArrowRight':
        state.keys.right = pressed;
        return true;
      case 'ShiftLeft':
      case 'ShiftRight':
        state.keys.sprint = pressed;
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

    ui.stage.addEventListener('click', () => {
      if (!state.pointerLocked && currentGame() && !currentGame()?.gameOver) {
        requestAimLock();
      }
    });

    ui.stage.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
      if (!state.pointerLocked) {
        requestAimLock();
        return;
      }
      state.keys.fire = true;
    });

    window.addEventListener('mouseup', () => {
      state.keys.fire = false;
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

    document.addEventListener('pointerlockchange', () => {
      state.pointerLocked = document.pointerLockElement === ui.stage;
      if (!state.pointerLocked) {
        state.keys.fire = false;
      }
      renderPanels();
    });

    document.addEventListener('mousemove', (event) => {
      if (!state.pointerLocked) {
        return;
      }
      state.input.yaw = normalizeAngle(state.input.yaw + event.movementX * MOUSE_SENSITIVITY);
    });

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
