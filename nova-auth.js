'use strict';

(function () {
  const PROD_API_BASE = 'https://nova-arcade-backend-1000121513328.us-central1.run.app';
  const FIREBASE_VERSION = '10.12.5';

  const state = {
    ready: false,
    enabled: false,
    required: true,
    error: '',
    firebaseConfig: null,
    modules: null,
    app: null,
    auth: null,
    user: null,
    cachedToken: '',
    refreshTimer: 0,
    listeners: new Set(),
    readyPromise: null,
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
        providers: { google: true, facebook: true },
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
      return '';
    }

    state.cachedToken = await state.user.getIdToken(force);
    scheduleTokenRefresh();
    return state.cachedToken;
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
    };
  }

  async function init(options = {}) {
    if (state.readyPromise) {
      return state.readyPromise;
    }

    state.required = options.required !== undefined ? Boolean(options.required) : state.required;
    if (typeof options.onChange === 'function') {
      state.listeners.add(options.onChange);
    }

    state.readyPromise = (async () => {
      try {
        const apiBaseUrl = options.apiBaseUrl || defaultApiBaseUrl();
        const config = await fetchAuthConfig(apiBaseUrl);
        state.enabled = Boolean(config.enabled && config.firebaseConfig);
        state.required = Boolean(config.required);
        state.firebaseConfig = config.firebaseConfig || null;

        if (!state.enabled) {
          state.error = 'Account sign-in needs Firebase setup before Google or Facebook can work.';
          state.ready = true;
          emitChange();
          return profile();
        }

        const { appModule, authModule } = await loadFirebaseModules();
        state.app = appModule.initializeApp(state.firebaseConfig);
        state.auth = authModule.getAuth(state.app);
        state.auth.useDeviceLanguage();

        authModule.onAuthStateChanged(state.auth, async (user) => {
          state.user = user || null;
          state.error = '';
          try {
            await refreshToken(true);
          } catch (error) {
            state.cachedToken = '';
            state.error = error.message || 'Unable to refresh sign-in.';
          }
          state.ready = true;
          emitChange();
        });
      } catch (error) {
        state.enabled = false;
        state.error = error.message || 'Unable to load account sign-in.';
        state.ready = true;
        emitChange();
      }
      return profile();
    })();

    return state.readyPromise;
  }

  function providerError(error) {
    const message = String(error && error.message || 'Sign-in did not complete.');
    state.error = message.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]+\)\.?$/, '.');
    emitChange();
  }

  async function signIn(providerName) {
    if (!state.enabled || !state.auth) {
      state.error = 'Account sign-in is not configured yet.';
      emitChange();
      return null;
    }

    try {
      const { authModule } = await loadFirebaseModules();
      const provider = providerName === 'facebook'
        ? new authModule.FacebookAuthProvider()
        : new authModule.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await authModule.signInWithPopup(state.auth, provider);
      state.user = result.user || null;
      await refreshToken(true);
      emitChange();
      return state.user;
    } catch (error) {
      providerError(error);
      return null;
    }
  }

  async function signOutUser() {
    if (!state.auth || !state.modules) {
      return;
    }
    await state.modules.authModule.signOut(state.auth);
    state.user = null;
    state.cachedToken = '';
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
      state.error = 'Sign-in is being set up. Firebase config is missing on the server.';
      renderWidgets();
      return false;
    }
    if (state.user) {
      return true;
    }
    state.error = `Sign in to ${actionLabel}.`;
    renderWidgets();
    const firstButton = document.querySelector('[data-auth-google]');
    firstButton?.focus();
    return false;
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

    if (!state.enabled) {
      const notice = document.createElement('span');
      notice.className = 'nova-auth-notice';
      notice.textContent = 'Accounts need setup';
      root.appendChild(notice);
      return;
    }

    if (!snapshot.signedIn) {
      const googleButton = document.createElement('button');
      googleButton.type = 'button';
      googleButton.className = 'nova-auth-button';
      googleButton.dataset.authGoogle = 'true';
      googleButton.textContent = 'Google';
      googleButton.addEventListener('click', () => {
        signIn('google').catch(providerError);
      });

      const facebookButton = document.createElement('button');
      facebookButton.type = 'button';
      facebookButton.className = 'nova-auth-button';
      facebookButton.textContent = 'Facebook';
      facebookButton.addEventListener('click', () => {
        signIn('facebook').catch(providerError);
      });

      const label = document.createElement('span');
      label.className = 'nova-auth-label';
      label.textContent = state.required ? 'Sign in' : 'Account';

      root.append(label, googleButton, facebookButton);
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

      const signOutButton = document.createElement('button');
      signOutButton.type = 'button';
      signOutButton.className = 'nova-auth-link';
      signOutButton.textContent = 'Sign out';
      signOutButton.addEventListener('click', () => {
        signOutUser().catch(providerError);
      });

      root.append(avatar, name, signOutButton);
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
    requireSignedIn,
    signInWithGoogle() {
      return signIn('google');
    },
    signInWithFacebook() {
      return signIn('facebook');
    },
    signOut: signOutUser,
  };
})();
