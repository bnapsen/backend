'use strict';

(function () {
  const PROD_API_BASE = 'https://nova-arcade-backend-2rpkpv7fpq-uc.a.run.app';
  const CANONICAL_SITE_HOST = 'bnapsen.com';
  const FIREBASE_VERSION = '10.12.5';
  const WALLET_BROADCAST_NAME = 'nova-auth-wallet';
  const WALLET_SYNC_STORAGE_KEY = 'nova-auth:wallet-sync';
  const WALLET_REFRESH_STORAGE_KEY = 'nova-auth:wallet-refresh';
  const FLOATING_WALLET_STORAGE_KEY = 'nova-auth:floating-wallet';
  const WALLET_AUTO_REFRESH_MS = 30000;
  const FLOATING_WALLET_MIN_WIDTH = 190;
  const FLOATING_WALLET_MAX_WIDTH = 420;
  const FLOATING_WALLET_MARGIN = 12;
  const CLIENT_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (window.location.hostname.toLowerCase() === `www.${CANONICAL_SITE_HOST}`) {
    window.location.replace(`https://${CANONICAL_SITE_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`);
    return;
  }

  const state = {
    ready: false,
    enabled: false,
    required: true,
    error: '',
    firebaseConfig: null,
    providers: { google: true, password: true, facebook: false },
    modules: null,
    app: null,
    auth: null,
    user: null,
    apiBaseUrl: '',
    cachedToken: '',
    refreshTimer: 0,
    walletRefreshTimer: 0,
    walletRefreshInFlight: false,
    walletChannel: null,
    walletSyncInstalled: false,
    floatingWallet: null,
    floatingWalletRestore: null,
    floatingWalletPrefs: null,
    floatingWalletStylesInjected: false,
    floatingWalletPointerEventsInstalled: false,
    floatingWalletDrag: null,
    floatingWalletResize: null,
    listeners: new Set(),
    readyPromise: null,
    simWallet: {
      ready: false,
      loading: false,
      uid: '',
      currency: 'SIM',
      balance: null,
      balanceCents: null,
      startingBalance: 1000,
      startingBalanceCents: 100000,
      error: '',
    },
  };

  function defaultApiBaseUrl() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app')) {
      return `${window.location.protocol}//${window.location.host}`;
    }
    return PROD_API_BASE;
  }

  function cleanText(value, fallback = '', maxLength = 80) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    return text || fallback;
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return min;
    }
    return Math.min(max, Math.max(min, number));
  }

  function normalizeFloatingWalletPrefs(source = {}) {
    const width = clampNumber(source.width || 244, FLOATING_WALLET_MIN_WIDTH, FLOATING_WALLET_MAX_WIDTH);
    const left = source.left === null || source.left === undefined ? NaN : Number(source.left);
    const top = source.top === null || source.top === undefined ? NaN : Number(source.top);
    return {
      hidden: Boolean(source.hidden),
      left: Number.isFinite(left) ? left : null,
      top: Number.isFinite(top) ? top : null,
      width,
    };
  }

  function loadFloatingWalletPrefs() {
    if (state.floatingWalletPrefs) {
      return state.floatingWalletPrefs;
    }
    try {
      state.floatingWalletPrefs = normalizeFloatingWalletPrefs(
        JSON.parse(window.localStorage.getItem(FLOATING_WALLET_STORAGE_KEY) || '{}'),
      );
    } catch {
      state.floatingWalletPrefs = normalizeFloatingWalletPrefs();
    }
    return state.floatingWalletPrefs;
  }

  function saveFloatingWalletPrefs(nextPrefs) {
    state.floatingWalletPrefs = normalizeFloatingWalletPrefs(nextPrefs);
    try {
      window.localStorage.setItem(FLOATING_WALLET_STORAGE_KEY, JSON.stringify(state.floatingWalletPrefs));
    } catch {
      // The wallet still works if a browser blocks local storage; it just will not remember placement.
    }
    return state.floatingWalletPrefs;
  }

  function viewportLimit(value, size, maxSize) {
    const max = Math.max(FLOATING_WALLET_MARGIN, maxSize - size - FLOATING_WALLET_MARGIN);
    return clampNumber(value, FLOATING_WALLET_MARGIN, max);
  }

  function clampFloatingWalletToViewport(root, prefs = loadFloatingWalletPrefs()) {
    if (!root || prefs.left === null || prefs.top === null) {
      return prefs;
    }
    const rect = root.getBoundingClientRect();
    const width = clampNumber(prefs.width || rect.width, FLOATING_WALLET_MIN_WIDTH, Math.min(FLOATING_WALLET_MAX_WIDTH, window.innerWidth - FLOATING_WALLET_MARGIN * 2));
    const height = Math.max(56, rect.height || 96);
    return {
      ...prefs,
      width,
      left: viewportLimit(prefs.left, width, window.innerWidth),
      top: viewportLimit(prefs.top, height, window.innerHeight),
    };
  }

  function applyFloatingWalletPrefs(root) {
    if (!root) {
      return;
    }
    let prefs = loadFloatingWalletPrefs();
    root.style.width = `${Math.min(prefs.width, window.innerWidth - FLOATING_WALLET_MARGIN * 2)}px`;
    root.style.maxWidth = `calc(100vw - ${FLOATING_WALLET_MARGIN * 2}px)`;
    if (prefs.left === null || prefs.top === null) {
      root.style.left = 'auto';
      root.style.top = 'auto';
      root.style.right = '18px';
      root.style.bottom = '18px';
      return;
    }
    prefs = clampFloatingWalletToViewport(root, prefs);
    state.floatingWalletPrefs = prefs;
    root.style.left = `${prefs.left}px`;
    root.style.top = `${prefs.top}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.width = `${prefs.width}px`;
  }

  function applyFloatingWalletRestorePrefs(restore, prefs = loadFloatingWalletPrefs()) {
    if (!restore) {
      return;
    }
    restore.style.maxWidth = `calc(100vw - ${FLOATING_WALLET_MARGIN * 2}px)`;
    if (prefs.left === null || prefs.top === null) {
      restore.style.left = 'auto';
      restore.style.top = 'auto';
      restore.style.right = '18px';
      restore.style.bottom = '18px';
      return;
    }
    const rect = restore.getBoundingClientRect();
    const width = Math.max(96, rect.width || FLOATING_WALLET_MIN_WIDTH);
    const height = Math.max(40, rect.height || 44);
    restore.style.left = `${viewportLimit(prefs.left, width, window.innerWidth)}px`;
    restore.style.top = `${viewportLimit(prefs.top, height, window.innerHeight)}px`;
    restore.style.right = 'auto';
    restore.style.bottom = 'auto';
  }

  function currentFloatingWalletPlacement(root = state.floatingWallet) {
    if (!root) {
      return loadFloatingWalletPrefs();
    }
    const rect = root.getBoundingClientRect();
    return clampFloatingWalletToViewport(root, {
      ...loadFloatingWalletPrefs(),
      hidden: false,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });
  }

  function setFloatingWalletHidden(hidden) {
    const prefs = state.floatingWallet && !state.floatingWallet.hidden
      ? currentFloatingWalletPlacement(state.floatingWallet)
      : loadFloatingWalletPrefs();
    saveFloatingWalletPrefs({ ...prefs, hidden });
    renderFloatingWallet();
  }

  function startFloatingWalletDrag(event) {
    if (event.button !== 0 || !state.floatingWallet) {
      return;
    }
    const root = state.floatingWallet;
    const rect = root.getBoundingClientRect();
    state.floatingWalletDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
    };
    root.classList.add('is-moving');
    try {
      root.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works while the pointer stays over the wallet.
    }
    event.preventDefault();
  }

  function startFloatingWalletResize(event) {
    if (event.button !== 0 || !state.floatingWallet) {
      return;
    }
    const root = state.floatingWallet;
    const rect = root.getBoundingClientRect();
    state.floatingWalletResize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: rect.width,
      left: rect.left,
      top: rect.top,
    };
    root.classList.add('is-resizing');
    try {
      root.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort; resizing still works while the pointer stays over the wallet.
    }
    event.preventDefault();
  }

  function handleFloatingWalletPointerMove(event) {
    const root = state.floatingWallet;
    if (!root) {
      return;
    }

    if (state.floatingWalletDrag && state.floatingWalletDrag.pointerId === event.pointerId) {
      const drag = state.floatingWalletDrag;
      const nextPrefs = {
        ...loadFloatingWalletPrefs(),
        hidden: false,
        left: drag.startLeft + event.clientX - drag.startX,
        top: drag.startTop + event.clientY - drag.startY,
        width: drag.width,
      };
      state.floatingWalletPrefs = clampFloatingWalletToViewport(root, nextPrefs);
      applyFloatingWalletPrefs(root);
      event.preventDefault();
      return;
    }

    if (state.floatingWalletResize && state.floatingWalletResize.pointerId === event.pointerId) {
      const resize = state.floatingWalletResize;
      const maxWidth = Math.min(FLOATING_WALLET_MAX_WIDTH, window.innerWidth - FLOATING_WALLET_MARGIN * 2);
      const nextPrefs = {
        ...loadFloatingWalletPrefs(),
        hidden: false,
        left: resize.left,
        top: resize.top,
        width: clampNumber(resize.startWidth + event.clientX - resize.startX, FLOATING_WALLET_MIN_WIDTH, maxWidth),
      };
      state.floatingWalletPrefs = clampFloatingWalletToViewport(root, nextPrefs);
      applyFloatingWalletPrefs(root);
      event.preventDefault();
    }
  }

  function finishFloatingWalletPointer(event) {
    const root = state.floatingWallet;
    if (!root) {
      return;
    }
    const wasMoving = Boolean(state.floatingWalletDrag || state.floatingWalletResize);
    if (state.floatingWalletDrag?.pointerId === event.pointerId) {
      state.floatingWalletDrag = null;
    }
    if (state.floatingWalletResize?.pointerId === event.pointerId) {
      state.floatingWalletResize = null;
    }
    root.classList.remove('is-moving', 'is-resizing');
    try {
      root.releasePointerCapture?.(event.pointerId);
    } catch {
      // Some browsers throw if the pointer capture already ended.
    }
    if (wasMoving) {
      saveFloatingWalletPrefs(clampFloatingWalletToViewport(root, loadFloatingWalletPrefs()));
    }
  }

  function currentUid() {
    return cleanText(state.user && state.user.uid, '', 160);
  }

  function walletMatchesCurrentUser(wallet) {
    const uid = cleanText(wallet && wallet.uid, '', 160);
    const signedInUid = currentUid();
    return Boolean(signedInUid && (!uid || uid === signedInUid));
  }

  function postWalletMessage(message) {
    const payload = {
      ...message,
      clientId: CLIENT_ID,
      uid: currentUid(),
      sentAt: Date.now(),
    };

    try {
      state.walletChannel?.postMessage(payload);
    } catch {
      // Cross-tab sync is a convenience layer. The API remains the source of truth.
    }

    try {
      const storageKey = payload.type === 'refresh-wallet' ? WALLET_REFRESH_STORAGE_KEY : WALLET_SYNC_STORAGE_KEY;
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Some browsers disable storage. BroadcastChannel or polling can still keep pages fresh.
    }
  }

  function broadcastWallet(wallet = state.simWallet) {
    if (!walletMatchesCurrentUser(wallet) || wallet.loading || wallet.error) {
      return;
    }
    postWalletMessage({ type: 'wallet', wallet });
  }

  function requestWalletRefresh(reason = 'wallet-change') {
    if (!currentUid()) {
      return;
    }
    postWalletMessage({ type: 'refresh-wallet', reason });
  }

  function refreshWalletSoon() {
    if (!state.user || state.walletRefreshInFlight) {
      return;
    }
    loadSimWallet({ broadcast: true }).catch(() => {});
  }

  function handleWalletMessage(message) {
    const payload = message && typeof message === 'object' ? message : null;
    if (!payload || payload.clientId === CLIENT_ID) {
      return;
    }
    const payloadUid = cleanText(payload.uid, '', 160);
    const signedInUid = currentUid();
    if (!signedInUid || (payloadUid && payloadUid !== signedInUid)) {
      return;
    }

    if (payload.type === 'wallet' && walletMatchesCurrentUser(payload.wallet)) {
      applySimWallet(payload.wallet);
      emitChange();
      return;
    }

    if (payload.type === 'refresh-wallet') {
      refreshWalletSoon();
    }
  }

  function installWalletSync() {
    if (state.walletSyncInstalled) {
      return;
    }
    state.walletSyncInstalled = true;

    try {
      if ('BroadcastChannel' in window) {
        state.walletChannel = new BroadcastChannel(WALLET_BROADCAST_NAME);
        state.walletChannel.onmessage = (event) => {
          handleWalletMessage(event.data);
        };
      }
    } catch {
      state.walletChannel = null;
    }

    window.addEventListener('storage', (event) => {
      if (event.key === FLOATING_WALLET_STORAGE_KEY) {
        try {
          state.floatingWalletPrefs = normalizeFloatingWalletPrefs(JSON.parse(event.newValue || '{}'));
        } catch {
          state.floatingWalletPrefs = normalizeFloatingWalletPrefs();
        }
        renderFloatingWallet();
        return;
      }
      if (event.key !== WALLET_SYNC_STORAGE_KEY && event.key !== WALLET_REFRESH_STORAGE_KEY) {
        return;
      }
      try {
        handleWalletMessage(JSON.parse(event.newValue || '{}'));
      } catch {
        // Ignore malformed storage events from old tabs.
      }
    });

    window.addEventListener('focus', refreshWalletSoon);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshWalletSoon();
      }
    });

    window.addEventListener('resize', () => {
      if (state.floatingWallet) {
        saveFloatingWalletPrefs(clampFloatingWalletToViewport(state.floatingWallet, loadFloatingWalletPrefs()));
        renderFloatingWallet();
      }
    });
  }

  function startWalletAutoRefresh() {
    if (state.walletRefreshTimer) {
      return;
    }
    state.walletRefreshTimer = window.setInterval(refreshWalletSoon, WALLET_AUTO_REFRESH_MS);
  }

  function stopWalletAutoRefresh() {
    if (state.walletRefreshTimer) {
      window.clearInterval(state.walletRefreshTimer);
      state.walletRefreshTimer = 0;
    }
  }

  function emitChange() {
    renderWidgets();
    for (const listener of state.listeners) {
      try {
        listener(profile());
      } catch {
        // Auth listeners should never break the rest of the page.
      }
    }
  }

  async function loadFirebaseModules() {
    if (state.modules) {
      return state.modules;
    }

    const [appModule, authModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    ]);
    state.modules = { appModule, authModule };
    return state.modules;
  }

  async function fetchAuthConfig(apiBaseUrl) {
    if (window.NOVA_FIREBASE_CONFIG && typeof window.NOVA_FIREBASE_CONFIG === 'object') {
      return {
        ok: true,
        enabled: true,
        required: true,
        providers: { google: true, password: true, facebook: false },
        firebaseConfig: window.NOVA_FIREBASE_CONFIG,
      };
    }

    const response = await fetch(`${apiBaseUrl}/api/auth/config`, {
      method: 'GET',
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Unable to load account sign-in.');
    }
    return payload;
  }

  function scheduleTokenRefresh() {
    if (state.refreshTimer) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = 0;
    }
    if (!state.user) {
      return;
    }
    state.refreshTimer = setTimeout(() => {
      refreshToken(true).catch(() => {});
    }, 45 * 60 * 1000);
  }

  async function refreshToken(force = false) {
    if (!state.user) {
      state.cachedToken = '';
      scheduleTokenRefresh();
      resetSimWallet();
      return '';
    }

    state.cachedToken = await state.user.getIdToken(force);
    scheduleTokenRefresh();
    return state.cachedToken;
  }

  function resetSimWallet(error = '') {
    state.simWallet = {
      ready: Boolean(error),
      loading: false,
      uid: '',
      currency: 'SIM',
      balance: null,
      balanceCents: null,
      startingBalance: 1000,
      startingBalanceCents: 100000,
      error,
    };
  }

  function applySimWallet(wallet) {
    const source = wallet || {};
    state.simWallet = {
      ready: true,
      loading: false,
      uid: cleanText(source.uid, currentUid(), 160),
      currency: cleanText(source.currency, 'SIM', 12).toUpperCase(),
      balance: Number.isFinite(Number(source.balance)) ? Number(source.balance) : Number(source.balanceCents || 0) / 100,
      balanceCents: Number.isFinite(Number(source.balanceCents)) ? Math.round(Number(source.balanceCents)) : null,
      startingBalance: Number.isFinite(Number(source.startingBalance)) ? Number(source.startingBalance) : 1000,
      startingBalanceCents: Number.isFinite(Number(source.startingBalanceCents)) ? Math.round(Number(source.startingBalanceCents)) : 100000,
      updatedAt: cleanText(source.updatedAt, '', 40),
      recentTransactions: Array.isArray(source.recentTransactions) ? source.recentTransactions.slice(0, 12) : [],
      error: '',
    };
    return state.simWallet;
  }

  async function simWalletRequest(path, options = {}) {
    const token = state.cachedToken || await getIdToken();
    if (!token) {
      throw new Error('Sign in to use SIM.');
    }
    const response = await fetch(`${state.apiBaseUrl || defaultApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Unable to update SIM wallet.');
    }
    return payload;
  }

  async function loadSimWallet(options = {}) {
    if (!state.user) {
      resetSimWallet();
      emitChange();
      return null;
    }
    if (state.walletRefreshInFlight) {
      return state.simWallet;
    }
    state.walletRefreshInFlight = true;
    state.simWallet = {
      ...state.simWallet,
      loading: true,
      error: '',
    };
    emitChange();
    try {
      const payload = await simWalletRequest('/api/sim/wallet', {
        method: 'GET',
      });
      const wallet = applySimWallet(payload.wallet);
      emitChange();
      if (options.broadcast !== false) {
        broadcastWallet(wallet);
      }
      return wallet;
    } catch (error) {
      state.simWallet = {
        ...state.simWallet,
        loading: false,
        error: error.message || 'Unable to load SIM wallet.',
      };
      emitChange();
      throw error;
    } finally {
      state.walletRefreshInFlight = false;
    }
  }

  async function syncSignedInSession(forceToken = false) {
    await refreshToken(forceToken);
    try {
      await loadSimWallet();
    } catch (error) {
      state.error = error.message || 'Unable to load SIM wallet.';
      resetSimWallet(state.error);
    }
  }

  async function adjustSimWallet(adjustment = {}) {
    const payload = await simWalletRequest('/api/sim/wallet/adjust', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(adjustment),
    });
    const wallet = applySimWallet(payload.wallet);
    emitChange();
    broadcastWallet(wallet);
    requestWalletRefresh('wallet-adjusted');
    return state.simWallet;
  }

  function formatSimWallet(wallet = state.simWallet) {
    const balance = Number(wallet && wallet.balance);
    const currency = cleanText(wallet && wallet.currency, 'SIM', 12).toUpperCase();
    if (!Number.isFinite(balance)) {
      return currency;
    }
    return balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
  }

  function profile() {
    const user = state.user;
    return {
      ready: state.ready,
      enabled: state.enabled,
      required: state.required,
      signedIn: Boolean(user),
      error: state.error,
      displayName: cleanText(user && (user.displayName || user.email), 'AP member', 80),
      email: cleanText(user && user.email, '', 120),
      photoURL: cleanText(user && user.photoURL, '', 500),
      uid: cleanText(user && user.uid, '', 160),
      simWallet: { ...state.simWallet },
    };
  }

  async function init(options = {}) {
    if (typeof options.onChange === 'function') {
      state.listeners.add(options.onChange);
    }
    installWalletSync();
    if (state.readyPromise) {
      return state.readyPromise;
    }

    state.required = options.required !== undefined ? Boolean(options.required) : state.required;

    state.readyPromise = (async () => {
      try {
        const apiBaseUrl = options.apiBaseUrl || defaultApiBaseUrl();
        state.apiBaseUrl = apiBaseUrl;
        const config = await fetchAuthConfig(apiBaseUrl);
        state.enabled = Boolean(config.enabled && config.firebaseConfig);
        state.required = Boolean(config.required);
        state.firebaseConfig = config.firebaseConfig || null;
        state.providers = {
          google: config.providers?.google !== false,
          password: config.providers?.password !== false,
          facebook: false,
        };

        if (!state.enabled) {
          state.error = 'Firebase web config is missing on the server.';
          state.ready = true;
          resetSimWallet();
          emitChange();
          return profile();
        }

        const { appModule, authModule } = await loadFirebaseModules();
        state.app = appModule.initializeApp(state.firebaseConfig);
        state.auth = authModule.getAuth(state.app);
        state.auth.useDeviceLanguage();
        if (authModule.setPersistence && authModule.browserLocalPersistence) {
          try {
            await authModule.setPersistence(state.auth, authModule.browserLocalPersistence);
          } catch {
            // Some restricted browsers block persistent storage. Firebase will fall back as available.
          }
        }

        authModule.onAuthStateChanged(state.auth, async (user) => {
          state.user = user || null;
          state.error = '';
          if (state.user) {
            startWalletAutoRefresh();
          } else {
            stopWalletAutoRefresh();
          }
          try {
            await syncSignedInSession(true);
          } catch (error) {
            state.cachedToken = '';
            state.error = error.message || 'Unable to refresh sign-in.';
            resetSimWallet(error.message || 'Unable to load SIM wallet.');
          }
          state.ready = true;
          emitChange();
        });
      } catch (error) {
        state.enabled = false;
        state.error = error.message || 'Unable to load account sign-in.';
        state.ready = true;
        resetSimWallet();
        emitChange();
      }
      return profile();
    })();

    return state.readyPromise;
  }

  function friendlyAuthMessage(error) {
    const message = String(error && error.message || 'Sign-in did not complete.');
    const code = String(error && error.code || '').toLowerCase();
    const knownMessages = {
      'auth/email-already-in-use': 'That email already has an account. Try signing in instead.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/invalid-credential': 'That email or password did not match.',
      'auth/missing-password': 'Enter a password.',
      'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase yet.',
      'auth/popup-closed-by-user': 'The sign-in window was closed before it finished.',
      'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
      'auth/user-not-found': 'No account was found for that email.',
      'auth/weak-password': 'Use a password with at least 6 characters.',
      'auth/wrong-password': 'That email or password did not match.',
    };
    return knownMessages[code] || message.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]+\)\.?$/, '.');
  }

  function providerError(error) {
    state.error = friendlyAuthMessage(error);
    emitChange();
  }

  function setAuthNotConfiguredError() {
    state.error = 'Firebase account sign-in is not configured on the server yet.';
    emitChange();
  }

  async function signIn(providerName = 'google') {
    if (!state.enabled || !state.auth) {
      setAuthNotConfiguredError();
      return null;
    }

    try {
      const { authModule } = await loadFirebaseModules();
      const provider = new authModule.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await authModule.signInWithPopup(state.auth, provider);
      state.user = result.user || null;
      state.error = '';
      await syncSignedInSession(true);
      emitChange();
      return state.user;
    } catch (error) {
      providerError(error);
      return null;
    }
  }

  function normalizeEmail(email) {
    return String(email || '').trim().slice(0, 160);
  }

  function validateEmailPassword(email, password, options = {}) {
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = String(password || '');
    if (!cleanEmail) {
      throw Object.assign(new Error('Enter an email address.'), { code: 'auth/invalid-email' });
    }
    if (!options.passwordOptional && cleanPassword.length < 6) {
      throw Object.assign(new Error('Use a password with at least 6 characters.'), { code: 'auth/weak-password' });
    }
    return { email: cleanEmail, password: cleanPassword };
  }

  async function createAccountWithEmail(email, password) {
    if (!state.enabled || !state.auth) {
      setAuthNotConfiguredError();
      return null;
    }

    try {
      const { authModule } = await loadFirebaseModules();
      const credentials = validateEmailPassword(email, password);
      const result = await authModule.createUserWithEmailAndPassword(
        state.auth,
        credentials.email,
        credentials.password,
      );
      state.user = result.user || null;
      state.error = '';
      await syncSignedInSession(true);
      emitChange();
      return state.user;
    } catch (error) {
      providerError(error);
      return null;
    }
  }

  async function signInWithEmail(email, password) {
    if (!state.enabled || !state.auth) {
      setAuthNotConfiguredError();
      return null;
    }

    try {
      const { authModule } = await loadFirebaseModules();
      const credentials = validateEmailPassword(email, password);
      const result = await authModule.signInWithEmailAndPassword(
        state.auth,
        credentials.email,
        credentials.password,
      );
      state.user = result.user || null;
      state.error = '';
      await syncSignedInSession(true);
      emitChange();
      return state.user;
    } catch (error) {
      providerError(error);
      return null;
    }
  }

  async function sendPasswordReset(email) {
    if (!state.enabled || !state.auth) {
      setAuthNotConfiguredError();
      return false;
    }

    try {
      const { authModule } = await loadFirebaseModules();
      const credentials = validateEmailPassword(email, '', { passwordOptional: true });
      await authModule.sendPasswordResetEmail(state.auth, credentials.email);
      state.error = 'Password reset email sent.';
      emitChange();
      return true;
    } catch (error) {
      providerError(error);
      return false;
    }
  }

  async function signOutUser() {
    if (!state.auth || !state.modules) {
      return;
    }
    await state.modules.authModule.signOut(state.auth);
    state.user = null;
    state.cachedToken = '';
    stopWalletAutoRefresh();
    resetSimWallet();
    emitChange();
  }

  async function getIdToken(force = false) {
    if (!state.readyPromise) {
      await init();
    } else {
      await state.readyPromise;
    }
    if (!state.user) {
      return '';
    }
    if (!state.cachedToken || force) {
      return refreshToken(force);
    }
    return state.cachedToken;
  }

  async function appendAuthHeaders(headers = {}) {
    const nextHeaders = { ...headers };
    const token = await getIdToken();
    if (token) {
      nextHeaders.Authorization = `Bearer ${token}`;
    }
    return nextHeaders;
  }

  function authPayload() {
    return state.cachedToken ? { authToken: state.cachedToken } : {};
  }

  function requireSignedIn(actionLabel = 'continue') {
    if (!state.enabled) {
      state.error = 'Firebase account setup is missing on the server.';
      renderWidgets();
      return false;
    }
    if (state.user) {
      return true;
    }
    state.error = `Sign in to ${actionLabel}.`;
    renderWidgets();
    const firstButton = document.querySelector('[data-auth-google], [data-auth-email-toggle]');
    firstButton?.focus();
    return false;
  }

  function makeButton(text, className = 'nova-auth-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
  }

  function makeEmailForm(root, expandedByDefault) {
    const form = document.createElement('form');
    form.className = 'nova-auth-email-form';
    if (!expandedByDefault) {
      form.hidden = root.dataset.authEmailOpen !== 'true';
    }

    const emailInput = document.createElement('input');
    emailInput.className = 'nova-auth-input';
    emailInput.type = 'email';
    emailInput.name = 'email';
    emailInput.autocomplete = 'email';
    emailInput.placeholder = 'Email';
    emailInput.required = true;

    const passwordInput = document.createElement('input');
    passwordInput.className = 'nova-auth-input';
    passwordInput.type = 'password';
    passwordInput.name = 'password';
    passwordInput.autocomplete = 'current-password';
    passwordInput.placeholder = 'Password';
    passwordInput.minLength = 6;

    const buttonRow = document.createElement('div');
    buttonRow.className = 'nova-auth-email-actions';

    const createButton = makeButton('Create Account', 'nova-auth-button nova-auth-button--primary');
    createButton.type = 'submit';
    createButton.dataset.authAction = 'create';

    const signInButton = makeButton('Sign In');
    signInButton.type = 'submit';
    signInButton.dataset.authAction = 'sign-in';

    const resetButton = makeButton('Reset Password', 'nova-auth-link nova-auth-link--inline');
    resetButton.dataset.authAction = 'reset';

    buttonRow.append(createButton, signInButton, resetButton);
    form.append(emailInput, passwordInput, buttonRow);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!state.enabled) {
        setAuthNotConfiguredError();
        return;
      }
      const action = event.submitter?.dataset.authAction || 'sign-in';
      const email = emailInput.value;
      const password = passwordInput.value;
      if (action === 'create') {
        createAccountWithEmail(email, password).catch(providerError);
      } else if (action === 'reset') {
        sendPasswordReset(email).catch(providerError);
      } else {
        signInWithEmail(email, password).catch(providerError);
      }
    });

    resetButton.addEventListener('click', () => {
      if (!state.enabled) {
        setAuthNotConfiguredError();
        return;
      }
      sendPasswordReset(emailInput.value).catch(providerError);
    });

    return form;
  }

  function renderWidget(root) {
    if (!root) {
      return;
    }

    const snapshot = profile();
    root.innerHTML = '';
    root.classList.toggle('is-ready', snapshot.ready);
    root.classList.toggle('is-signed-in', snapshot.signedIn);

    if (!snapshot.ready) {
      const pill = document.createElement('span');
      pill.className = 'nova-auth-pill';
      pill.textContent = 'Checking account';
      root.appendChild(pill);
      return;
    }

    if (!snapshot.signedIn) {
      const label = document.createElement('span');
      label.className = 'nova-auth-label';
      label.textContent = root.dataset.authLabel || (state.required ? 'Account required' : 'Account');

      const actions = document.createElement('div');
      actions.className = 'nova-auth-actions';

      const makeGoogleButton = (text, intent = 'sign-in') => {
        const button = makeButton(
          text,
          intent === 'create' ? 'nova-auth-button nova-auth-button--primary' : 'nova-auth-button',
        );
        button.dataset.authGoogle = 'true';
        button.addEventListener('click', () => {
          if (!state.enabled) {
            setAuthNotConfiguredError();
            return;
          }
          signIn('google').catch(providerError);
        });
        return button;
      };

      if (state.providers.google) {
        actions.appendChild(makeGoogleButton('Continue with Google', 'create'));
      }

      const expandedEmail = root.dataset.authMode === 'home';
      const emailForm = makeEmailForm(root, expandedEmail);
      if (!expandedEmail && state.providers.password) {
        const emailToggle = makeButton('Email', 'nova-auth-button');
        emailToggle.dataset.authEmailToggle = 'true';
        emailToggle.addEventListener('click', () => {
          const isOpen = root.dataset.authEmailOpen === 'true';
          root.dataset.authEmailOpen = isOpen ? 'false' : 'true';
          renderWidget(root);
        });
        actions.appendChild(emailToggle);
      }

      if (root.dataset.authMode === 'home') {
        root.append(label, actions, emailForm);
      } else {
        root.append(label, actions, emailForm);
      }
    } else {
      const avatar = document.createElement('span');
      avatar.className = 'nova-auth-avatar';
      if (snapshot.photoURL) {
        avatar.style.backgroundImage = `url("${snapshot.photoURL.replace(/"/g, '')}")`;
      } else {
        avatar.textContent = snapshot.displayName.slice(0, 1).toUpperCase();
      }

      const name = document.createElement('span');
      name.className = 'nova-auth-name';
      name.textContent = snapshot.displayName;

      const wallet = document.createElement('span');
      wallet.className = 'nova-auth-wallet';
      if (snapshot.simWallet?.loading) {
        wallet.textContent = 'Syncing SIM';
      } else if (snapshot.simWallet?.error) {
        wallet.textContent = 'SIM unavailable';
      } else {
        wallet.textContent = formatSimWallet(snapshot.simWallet);
      }

      const signOutButton = document.createElement('button');
      signOutButton.type = 'button';
      signOutButton.className = 'nova-auth-link';
      signOutButton.textContent = 'Sign out';
      signOutButton.addEventListener('click', () => {
        signOutUser().catch(providerError);
      });

      root.append(avatar, name, wallet, signOutButton);
    }

    if (state.error) {
      const error = document.createElement('span');
      error.className = 'nova-auth-error';
      error.textContent = state.error;
      root.appendChild(error);
    }
  }

  function ensureFloatingWalletStyles() {
    if (state.floatingWalletStylesInjected || !document.head) {
      return;
    }
    state.floatingWalletStylesInjected = true;
    const style = document.createElement('style');
    style.id = 'nova-floating-wallet-style';
    style.textContent = `
      .nova-floating-wallet {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147482600;
        width: 244px;
        min-width: ${FLOATING_WALLET_MIN_WIDTH}px;
        max-width: calc(100vw - 24px);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 14px;
        background: rgba(9, 13, 21, 0.92);
        color: #f8fafc;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.36);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.2;
      }
      .nova-floating-wallet[hidden],
      .nova-floating-wallet-restore[hidden] {
        display: none;
      }
      .nova-floating-wallet__inner {
        display: grid;
        gap: 9px;
        padding: 12px 13px;
      }
      .nova-floating-wallet__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
      }
      .nova-floating-wallet__drag {
        align-items: center;
        cursor: move;
        display: inline-flex;
        gap: 7px;
        min-width: 0;
        touch-action: none;
      }
      .nova-floating-wallet__drag-dot {
        border: 1px solid rgba(52, 211, 153, 0.55);
        border-radius: 999px;
        box-shadow: 0 0 14px rgba(52, 211, 153, 0.28);
        display: inline-block;
        flex: 0 0 auto;
        height: 9px;
        width: 9px;
      }
      .nova-floating-wallet__label {
        color: #94a3b8;
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .nova-floating-wallet__value {
        color: #34d399;
        font-size: 1.08rem;
        font-weight: 900;
        letter-spacing: 0;
        white-space: nowrap;
      }
      .nova-floating-wallet__sub {
        color: #cbd5e1;
        font-size: 0.76rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nova-floating-wallet__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .nova-floating-wallet button {
        border: 1px solid rgba(148, 163, 184, 0.34);
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.94);
        color: #e2e8f0;
        cursor: pointer;
        font: inherit;
        font-size: 0.74rem;
        font-weight: 800;
        padding: 7px 10px;
      }
      .nova-floating-wallet button.nova-floating-wallet__control {
        align-items: center;
        display: inline-flex;
        height: 28px;
        justify-content: center;
        min-width: 28px;
        padding: 0 8px;
      }
      .nova-floating-wallet button:hover,
      .nova-floating-wallet button:focus-visible {
        border-color: rgba(52, 211, 153, 0.7);
        color: #ffffff;
        outline: none;
      }
      .nova-floating-wallet.is-error .nova-floating-wallet__value {
        color: #fb7185;
      }
      .nova-floating-wallet.is-syncing .nova-floating-wallet__value {
        color: #fbbf24;
      }
      .nova-floating-wallet.is-moving,
      .nova-floating-wallet.is-resizing {
        user-select: none;
      }
      .nova-floating-wallet__resize {
        bottom: 4px;
        cursor: nwse-resize;
        height: 18px;
        opacity: 0.78;
        position: absolute;
        right: 4px;
        touch-action: none;
        width: 18px;
      }
      .nova-floating-wallet__resize::before,
      .nova-floating-wallet__resize::after {
        border-bottom: 1px solid rgba(226, 232, 240, 0.7);
        border-right: 1px solid rgba(226, 232, 240, 0.7);
        bottom: 3px;
        content: "";
        position: absolute;
        right: 3px;
      }
      .nova-floating-wallet__resize::before {
        height: 10px;
        width: 10px;
      }
      .nova-floating-wallet__resize::after {
        height: 5px;
        width: 5px;
      }
      .nova-floating-wallet-restore {
        align-items: center;
        border: 1px solid rgba(52, 211, 153, 0.48);
        border-radius: 999px;
        background: rgba(9, 13, 21, 0.94);
        bottom: 18px;
        box-shadow: 0 14px 38px rgba(0, 0, 0, 0.32);
        color: #34d399;
        cursor: pointer;
        display: inline-flex;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 0.78rem;
        font-weight: 900;
        gap: 7px;
        justify-content: center;
        letter-spacing: 0;
        padding: 10px 12px;
        position: fixed;
        right: 18px;
        z-index: 2147482600;
      }
      .nova-floating-wallet-restore:hover,
      .nova-floating-wallet-restore:focus-visible {
        border-color: rgba(52, 211, 153, 0.86);
        color: #ffffff;
        outline: none;
      }
      @media (max-width: 760px) {
        .nova-floating-wallet {
          left: 12px;
          right: 12px;
          bottom: 12px;
          min-width: 0;
        }
        .nova-floating-wallet-restore {
          bottom: 12px;
          right: 12px;
        }
      }
      @media print {
        .nova-floating-wallet,
        .nova-floating-wallet-restore {
          display: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureFloatingWallet() {
    if (!document.body) {
      return null;
    }
    ensureFloatingWalletStyles();
    if (!state.floatingWallet || !document.body.contains(state.floatingWallet)) {
      const root = document.createElement('aside');
      root.className = 'nova-floating-wallet';
      root.setAttribute('aria-live', 'polite');
      root.setAttribute('aria-label', 'SIM wallet');
      document.body.appendChild(root);
      state.floatingWallet = root;
      state.floatingWalletPointerEventsInstalled = false;
    }
    if (!state.floatingWalletRestore || !document.body.contains(state.floatingWalletRestore)) {
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'nova-floating-wallet-restore';
      restore.setAttribute('aria-label', 'Show SIM wallet');
      restore.addEventListener('click', () => setFloatingWalletHidden(false));
      document.body.appendChild(restore);
      state.floatingWalletRestore = restore;
    }
    if (!state.floatingWalletPointerEventsInstalled) {
      state.floatingWalletPointerEventsInstalled = true;
      state.floatingWallet.addEventListener('pointermove', handleFloatingWalletPointerMove);
      state.floatingWallet.addEventListener('pointerup', finishFloatingWalletPointer);
      state.floatingWallet.addEventListener('pointercancel', finishFloatingWalletPointer);
    }
    return state.floatingWallet;
  }

  function renderFloatingWallet() {
    const root = ensureFloatingWallet();
    if (!root) {
      return;
    }
    const snapshot = profile();
    const wallet = snapshot.simWallet || {};
    const isSyncing = snapshot.signedIn && (wallet.loading || !wallet.ready);
    const isError = Boolean(snapshot.error || wallet.error);
    const value = !snapshot.ready
      ? 'Checking'
      : snapshot.signedIn
        ? (isSyncing ? 'Syncing' : (isError ? 'Unavailable' : formatSimWallet(wallet)))
        : 'Sign in';
    const sub = !snapshot.ready
      ? 'Loading your account'
      : snapshot.signedIn
        ? (isError ? (wallet.error || snapshot.error) : `${snapshot.displayName} account wallet`)
        : 'Use one SIM balance across the site';
    const prefs = loadFloatingWalletPrefs();
    const restore = state.floatingWalletRestore;

    if (prefs.hidden) {
      root.hidden = true;
      if (restore) {
        restore.hidden = false;
        restore.textContent = snapshot.signedIn && !isSyncing && !isError ? formatSimWallet(wallet) : 'SIM wallet';
        applyFloatingWalletRestorePrefs(restore, prefs);
      }
      return;
    }

    root.hidden = false;
    if (restore) {
      restore.hidden = true;
    }
    applyFloatingWalletPrefs(root);
    root.classList.toggle('is-syncing', Boolean(isSyncing));
    root.classList.toggle('is-error', isError);
    root.innerHTML = '';

    const inner = document.createElement('div');
    inner.className = 'nova-floating-wallet__inner';

    const top = document.createElement('div');
    top.className = 'nova-floating-wallet__top';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'nova-floating-wallet__drag';
    dragHandle.title = 'Drag to move the SIM wallet';
    dragHandle.addEventListener('pointerdown', startFloatingWalletDrag);

    const dragDot = document.createElement('span');
    dragDot.className = 'nova-floating-wallet__drag-dot';

    const label = document.createElement('span');
    label.className = 'nova-floating-wallet__label';
    label.textContent = 'SIM wallet';
    dragHandle.append(dragDot, label);

    const actions = document.createElement('div');
    actions.className = 'nova-floating-wallet__actions';

    const makeControlButton = (text, labelText, handler) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nova-floating-wallet__control';
      button.textContent = text;
      button.title = labelText;
      button.setAttribute('aria-label', labelText);
      button.addEventListener('click', handler);
      return button;
    };

    if (!snapshot.signedIn && snapshot.ready) {
      const signInButton = document.createElement('button');
      signInButton.type = 'button';
      signInButton.textContent = 'Sign in';
      signInButton.addEventListener('click', () => {
        signIn('google').catch(providerError);
      });
      actions.appendChild(signInButton);
    }
    actions.appendChild(makeControlButton('Hide', 'Hide SIM wallet', () => setFloatingWalletHidden(true)));

    const valueEl = document.createElement('strong');
    valueEl.className = 'nova-floating-wallet__value';
    valueEl.textContent = value;

    const subEl = document.createElement('span');
    subEl.className = 'nova-floating-wallet__sub';
    subEl.textContent = sub;

    const resizeHandle = document.createElement('span');
    resizeHandle.className = 'nova-floating-wallet__resize';
    resizeHandle.title = 'Drag to resize the SIM wallet';
    resizeHandle.addEventListener('pointerdown', startFloatingWalletResize);

    top.append(dragHandle, actions);
    inner.append(top, valueEl, subEl);
    root.append(inner, resizeHandle);
  }

  function renderWidgets() {
    if (!document.body) {
      return;
    }
    document.body.classList.toggle('auth-required', state.required);
    document.body.classList.toggle('auth-signed-in', Boolean(state.user));
    document.querySelectorAll('[data-auth-widget]').forEach(renderWidget);
    renderFloatingWallet();
  }

  window.NovaAuth = {
    init,
    onChange(listener) {
      if (typeof listener === 'function') {
        state.listeners.add(listener);
      }
      return () => state.listeners.delete(listener);
    },
    profile,
    isSignedIn() {
      return Boolean(state.user);
    },
    displayName(fallback = 'AP member') {
      return profile().displayName || fallback;
    },
    getIdToken,
    getIdTokenSync() {
      return state.cachedToken;
    },
    appendAuthHeaders,
    authPayload,
    loadSimWallet,
    refreshWallet() {
      return loadSimWallet({ broadcast: true });
    },
    adjustSimWallet,
    formatSimWallet,
    requireSignedIn,
    signInWithGoogle() {
      return signIn('google');
    },
    createAccountWithEmail,
    signInWithEmail,
    sendPasswordReset,
    signOut: signOutUser,
  };

  function autoInit() {
    if (!state.readyPromise) {
      init().catch(() => {});
    } else {
      renderWidgets();
    }
  }

  function queueAutoInit() {
    window.setTimeout(autoInit, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', queueAutoInit, { once: true });
  } else {
    queueAutoInit();
  }
})();
