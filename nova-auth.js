'use strict';

(function () {
  const PROD_API_BASE = 'https://nova-arcade-backend-2rpkpv7fpq-uc.a.run.app';
  const CANONICAL_SITE_HOST = 'bnapsen.com';
  const FIREBASE_VERSION = '10.12.5';

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
    listeners: new Set(),
    readyPromise: null,
    simWallet: {
      ready: false,
      loading: false,
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

  async function loadSimWallet() {
    if (!state.user) {
      resetSimWallet();
      return null;
    }
    state.simWallet = {
      ...state.simWallet,
      loading: true,
      error: '',
    };
    const payload = await simWalletRequest('/api/sim/wallet', {
      method: 'GET',
    });
    return applySimWallet(payload.wallet);
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
    applySimWallet(payload.wallet);
    emitChange();
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
      displayName: cleanText(user && (user.displayName || user.email), 'Nova member', 80),
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

  function renderWidgets() {
    document.body.classList.toggle('auth-required', state.required);
    document.body.classList.toggle('auth-signed-in', Boolean(state.user));
    document.querySelectorAll('[data-auth-widget]').forEach(renderWidget);
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
    displayName(fallback = 'Nova member') {
      return profile().displayName || fallback;
    },
    getIdToken,
    getIdTokenSync() {
      return state.cachedToken;
    },
    appendAuthHeaders,
    authPayload,
    loadSimWallet,
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
})();
