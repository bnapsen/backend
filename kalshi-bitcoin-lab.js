(function () {
  "use strict";

  const PROD_API_BASE = "https://nova-arcade-backend-2rpkpv7fpq-uc.a.run.app";
  const LIVE_REFRESH_MS = 650;
  const FALLBACK_REFRESH_MS = 1000;
  const CHART_RENDER_MIN_MS = 850;
  const HEAVY_RENDER_MIN_MS = 2500;
  const PAPER_EVAL_IDLE_MS = 1500;
  const PAPER_EVAL_BOT_MS = 650;
  const PAPER_STORAGE_KEY = "kalshiBtcPaperLedger";
  const PAPER_AUTO_STORAGE_KEY = "kalshiBtcPaperBots";
  const PAPER_ACCOUNTS_STORAGE_KEY = "kalshiBtcPaperAccounts";
  const PAPER_COLLAPSE_STORAGE_KEY = "kalshiBtcPaperCollapse";
  const PAPER_DEFAULT_ACCOUNT_ID = "paper-desk-main";
  const PAPER_AUTO_CONTRACTS = 10;
  const PAPER_AUTO_COOLDOWN_MS = 15000;
  const PAPER_SCALP_TARGET_CENTS = 10;
  const PAPER_RESEARCH_TARGET_CENTS = 6;
  const PAPER_RESEARCH_MIN_EDGE = 0.04;
  const PAPER_RESEARCH_MIN_ABS_Z = 0.65;
  const PAPER_RESEARCH_MAX_SPREAD = 0.08;
  const PAPER_RESEARCH_MAX_ASK_CENTS = 35;
  const PAPER_RESEARCH_MIN_SECONDS_SINCE_OPEN = 90;
  const PAPER_RESEARCH_MAX_SECONDS_SINCE_OPEN = 600;
  const PAPER_RESEARCH_MIN_SECONDS_TO_AVERAGE = 150;
  const PAPER_RESEARCH_EXIT_SECONDS_TO_AVERAGE = 75;
  const PAPER_RESEARCH_DEFENSIVE_EDGE = 0.015;
  const PAPER_RESEARCH_MAX_FILLS_PER_TICKER = 2;
  const PAPER_SIM_BOT_DEFAULTS = {
    contracts: 10,
    minEdgePct: 8,
    maxAskCents: 40,
    maxSpreadPct: 8,
    maxFillsPerTicker: 2,
    cooldownSeconds: 30,
    maxExposure: 50,
    exitMode: "settle",
    targetCents: 10,
    minSecondsSinceOpen: 45,
    maxSecondsSinceOpen: 660,
  };
  const state = {
    scan: null,
    stream: null,
    fallbackTimer: null,
    clockTimer: null,
    marketClock: null,
    tradeTicket: null,
    executionPlan: null,
    chartMeta: null,
    sound: {
      enabled: false,
      context: null,
      lastPrice: null,
      lastPriceToneAt: 0,
      lastDecision: "",
      lastPhase: "",
    },
    auto: {
      lastTicker: "",
      lastAttemptTicker: "",
      lastAttemptAt: 0,
      running: false,
      log: [],
    },
    paperAccounts: [],
    activePaperAccountId: PAPER_DEFAULT_ACCOUNT_ID,
    paperUiMuted: false,
    paperCollapse: {},
    paperBookUpdatedAt: "",
    paperAccountSync: {
      loading: false,
      saving: false,
      saveTimer: null,
      saveQueuedAt: 0,
      applyingRemote: false,
      lastLoadedUid: "",
      error: "",
    },
    paper: {
      currency: "SIM",
      startingBankroll: 1000,
      cash: 1000,
      orders: [],
      positions: [],
      history: [],
      layout: {
        floating: false,
        x: null,
        y: null,
      },
    },
    paperDrag: null,
    paperTicketPositionId: "",
    paperAuto: {
      completion: false,
      scalp: false,
      research: false,
      simAccount: false,
      simBot: { ...PAPER_SIM_BOT_DEFAULTS },
      fills: {},
      lastAttemptAt: {},
    },
    paperSimBotPending: {},
    simWallet: {
      ready: false,
      signedIn: false,
      syncing: false,
      currency: "SIM",
      balance: null,
      startingBalance: 1000,
      error: "",
      paperAccountId: PAPER_DEFAULT_ACCOUNT_ID,
    },
    paint: {
      pendingScan: null,
      frame: 0,
      lastChartAt: 0,
      chartKey: "",
      lastHeavyAt: 0,
      heavyKey: "",
      lastPaperEvalAt: 0,
      lastPaperTicker: "",
    },
  };

  const form = document.querySelector("#scan-form");
  const statusEl = document.querySelector("#status");
  const summaryEl = document.querySelector("#summary");
  const rowsEl = document.querySelector("#candidate-rows");
  const chartStage = document.querySelector("#chart-stage");
  const chartSourceEl = document.querySelector("#chart-source");
  const keyStatusEl = document.querySelector("#key-status");
  const eventTitleEl = document.querySelector("#event-title");
  const eventWindowEl = document.querySelector("#event-window");
  const kalshiLinkEl = document.querySelector("#kalshi-link");
  const clockLabelEl = document.querySelector("#clock-label");
  const marketCountdownEl = document.querySelector("#market-countdown");
  const marketPhaseEl = document.querySelector("#market-phase");
  const marketProgressEl = document.querySelector("#market-progress");
  const settlementProgressEl = document.querySelector("#settlement-progress");
  const marketOpenLabelEl = document.querySelector("#market-open-label");
  const marketSettlementLabelEl = document.querySelector("#market-settlement-label");
  const marketCloseLabelEl = document.querySelector("#market-close-label");
  const marketClockNoteEl = document.querySelector("#market-clock-note");
  const recommendationLabelEl = document.querySelector("#recommendation-label");
  const modelReasonsEl = document.querySelector("#model-reasons");
  const rulesEl = document.querySelector("#rules");
  const minEdgeInput = document.querySelector("#min-edge");
  const maxCostInput = document.querySelector("#max-cost");
  const accessTokenInput = document.querySelector("#access-token");
  const streamToggle = document.querySelector("#stream-toggle");
  const soundToggle = document.querySelector("#sound-toggle");
  const prepareTicketButton = document.querySelector("#prepare-ticket");
  const openTicketKalshiButton = document.querySelector("#open-ticket-kalshi");
  const placeTicketButton = document.querySelector("#place-ticket");
  const ticketCardEl = document.querySelector("#ticket-card");
  const ticketStatusEl = document.querySelector("#ticket-status");
  const autoEnableInput = document.querySelector("#auto-enable");
  const autoModeInput = document.querySelector("#auto-mode");
  const autoMinEdgeInput = document.querySelector("#auto-min-edge");
  const autoFirstMinutesInput = document.querySelector("#auto-first-minutes");
  const autoMaxCostInput = document.querySelector("#auto-max-cost");
  const autoStatusEl = document.querySelector("#auto-status");
  const autoLogEl = document.querySelector("#auto-log");
  const strategyActionEl = document.querySelector("#strategy-action");
  const strategyGridEl = document.querySelector("#strategy-grid");
  const strategyRulesEl = document.querySelector("#strategy-rules");
  const strategyBankrollInput = document.querySelector("#strategy-bankroll");
  const strategyRiskInput = document.querySelector("#strategy-risk");
  const strategyKellyInput = document.querySelector("#strategy-kelly");
  const strategyPositionSideInput = document.querySelector("#strategy-position-side");
  const strategyEntryCentsInput = document.querySelector("#strategy-entry-cents");
  const strategyTakeProfitInput = document.querySelector("#strategy-take-profit");
  const strategyStopLossInput = document.querySelector("#strategy-stop-loss");
  const strategyExitBufferInput = document.querySelector("#strategy-exit-buffer");
  const paperPanelEl = document.querySelector("#paper-panel");
  const paperStatusEl = document.querySelector("#paper-status");
  const paperAccountTabsEl = document.querySelector("#paper-account-tabs");
  const paperAccountNameInput = document.querySelector("#paper-account-name");
  const paperAddAccountButton = document.querySelector("#paper-add-account");
  const paperCloneAccountButton = document.querySelector("#paper-clone-account");
  const paperDeleteAccountButton = document.querySelector("#paper-delete-account");
  const paperAccountComparisonEl = document.querySelector("#paper-account-comparison");
  const paperDesksEl = document.querySelector(".paper-desks");
  const paperBotsEl = document.querySelector(".paper-bots");
  const paperSettingsRowEl = document.querySelector(".paper-settings-row");
  const paperTicketEl = document.querySelector(".paper-ticket");
  const paperTableWrapEl = document.querySelector(".paper-table-wrap");
  const paperSimBotCardEl = document.querySelector(".paper-sim-bot-card");
  const paperCurrencyInput = document.querySelector("#paper-currency");
  const paperStartingBankrollInput = document.querySelector("#paper-starting-bankroll");
  const paperOrderActionInput = document.querySelector("#paper-order-action");
  const paperOrderSideInput = document.querySelector("#paper-order-side");
  const paperActionBuyButton = document.querySelector("#paper-action-buy");
  const paperActionSellButton = document.querySelector("#paper-action-sell");
  const paperSideYesButton = document.querySelector("#paper-side-yes");
  const paperSideNoButton = document.querySelector("#paper-side-no");
  const paperYesQuoteEl = document.querySelector("#paper-yes-quote");
  const paperYesSubquoteEl = document.querySelector("#paper-yes-subquote");
  const paperNoQuoteEl = document.querySelector("#paper-no-quote");
  const paperNoSubquoteEl = document.querySelector("#paper-no-subquote");
  const paperLimitCentsInput = document.querySelector("#paper-limit-cents");
  const paperContractsInput = document.querySelector("#paper-contracts");
  const paperFillLimitButton = document.querySelector("#paper-fill-limit");
  const paperUsePlanButton = document.querySelector("#paper-use-plan");
  const paperBuyBestButton = document.querySelector("#paper-buy-best");
  const paperAutoCompletionInput = document.querySelector("#paper-auto-completion");
  const paperAutoScalpInput = document.querySelector("#paper-auto-scalp");
  const paperAutoResearchInput = document.querySelector("#paper-auto-research");
  const paperAutoSimAccountInput = document.querySelector("#paper-auto-sim-account");
  const paperSimBotContractsInput = document.querySelector("#paper-sim-bot-contracts");
  const paperSimBotMinEdgeInput = document.querySelector("#paper-sim-bot-min-edge");
  const paperSimBotMaxAskInput = document.querySelector("#paper-sim-bot-max-ask");
  const paperSimBotMaxSpreadInput = document.querySelector("#paper-sim-bot-max-spread");
  const paperSimBotMaxFillsInput = document.querySelector("#paper-sim-bot-max-fills");
  const paperSimBotCooldownInput = document.querySelector("#paper-sim-bot-cooldown");
  const paperSimBotMaxExposureInput = document.querySelector("#paper-sim-bot-max-exposure");
  const paperSimBotExitModeInput = document.querySelector("#paper-sim-bot-exit-mode");
  const paperSimBotTargetCentsInput = document.querySelector("#paper-sim-bot-target-cents");
  const paperSimBotInputs = [
    paperSimBotContractsInput,
    paperSimBotMinEdgeInput,
    paperSimBotMaxAskInput,
    paperSimBotMaxSpreadInput,
    paperSimBotMaxFillsInput,
    paperSimBotCooldownInput,
    paperSimBotMaxExposureInput,
    paperSimBotExitModeInput,
    paperSimBotTargetCentsInput,
  ].filter(Boolean);
  const paperAutoStatusEl = document.querySelector("#paper-auto-status");
  const paperFloatButton = document.querySelector("#paper-float");
  const paperDockButton = document.querySelector("#paper-dock");
  const paperSyncBankrollButton = document.querySelector("#paper-sync-bankroll");
  const paperResetButton = document.querySelector("#paper-reset");
  const paperHeadlineEl = document.querySelector("#paper-headline");
  const paperSummaryEl = document.querySelector("#paper-summary");
  const paperTicketPreviewEl = document.querySelector("#paper-ticket-preview");
  const paperPositionsEl = document.querySelector("#paper-positions");
  const paperOrdersEl = document.querySelector("#paper-orders");
  const paperHistoryEl = document.querySelector("#paper-history");
  const paperCollapseSections = [
    { key: "desks", label: "Desk Controls", detail: "switch, clone, and delete paper desks", element: paperDesksEl, defaultCollapsed: true },
    { key: "comparison", label: "Desk Comparison", detail: "compare every paper desk", element: paperAccountComparisonEl, defaultCollapsed: true },
    { key: "headline", label: "Wallet Snapshot", detail: "cash, equity, contracts, and average paid", element: paperHeadlineEl, defaultCollapsed: false },
    { key: "bots", label: "Bot Controls", detail: "completion, scalp, research, and account SIM bot", element: paperBotsEl, defaultCollapsed: false },
    { key: "settings", label: "Paper Settings", detail: "starting grant, reset, and Kelly sync", element: paperSettingsRowEl, defaultCollapsed: true },
    { key: "ticket", label: "Limit Ticket", detail: "manual buy and sell order ticket", element: paperTicketEl, defaultCollapsed: false },
    { key: "summary", label: "Paper Metrics", detail: "cash, reserved, open mark, and risk", element: paperSummaryEl, defaultCollapsed: true },
    { key: "positions", label: "Open Positions", detail: "active paper contracts and exits", element: paperTableWrapEl, defaultCollapsed: false },
    { key: "orders", label: "Pending Limits", detail: "resting paper buy and sell limits", element: paperOrdersEl, defaultCollapsed: true },
    { key: "history", label: "Recent Trades", detail: "paper buy, sell, win, loss, and limit log", element: paperHistoryEl, defaultCollapsed: true },
  ];

  kalshiLinkEl.addEventListener("click", function (event) {
    if (openKalshiWindow(kalshiLinkEl.href)) {
      event.preventDefault();
    }
  });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    restart();
  });
  streamToggle.addEventListener("change", restart);
  soundToggle.addEventListener("change", function () {
    state.sound.enabled = soundToggle.checked;
    localStorage.setItem("kalshiBtcSoundFx", soundToggle.checked ? "1" : "0");
    if (soundToggle.checked) {
      unlockAudio();
      playSound("arm");
    }
  });
  rowsEl.addEventListener("click", function (event) {
    const button = event.target.closest("[data-ticket-side]");
    if (button) {
      prepareTicket(button.getAttribute("data-ticket-side"));
    }
  });
  prepareTicketButton.addEventListener("click", function () {
    prepareTicket("");
  });
  openTicketKalshiButton.addEventListener("click", openPreparedTicketOnKalshi);
  placeTicketButton.addEventListener("click", placePreparedTicket);
  paperActionBuyButton.addEventListener("click", function () { setPaperAction("buy"); });
  paperActionSellButton.addEventListener("click", function () { setPaperAction("sell"); });
  paperSideYesButton.addEventListener("click", function () { setPaperSide("yes"); });
  paperSideNoButton.addEventListener("click", function () { setPaperSide("no"); });
  paperFillLimitButton.addEventListener("click", fillPaperLimitFromMarket);
  paperUsePlanButton.addEventListener("click", fillPaperTicketFromPlan);
  paperBuyBestButton.addEventListener("pointerdown", pressPaperLimitButton);
  paperBuyBestButton.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") pressPaperLimitButton();
  });
  paperBuyBestButton.addEventListener("click", paperBuyPlan);
  paperFloatButton.addEventListener("click", floatPaperPanel);
  paperDockButton.addEventListener("click", dockPaperPanel);
  paperSyncBankrollButton.addEventListener("click", syncPaperBankrollToKelly);
  paperResetButton.addEventListener("click", resetPaperLedger);
  paperAccountTabsEl.addEventListener("click", function (event) {
    const button = event.target.closest("[data-paper-account-id]");
    if (!button) return;
    switchPaperAccount(button.getAttribute("data-paper-account-id"));
  });
  paperAccountNameInput.addEventListener("input", updateActivePaperAccountName);
  paperAccountNameInput.addEventListener("change", updateActivePaperAccountName);
  paperAddAccountButton.addEventListener("click", addPaperAccount);
  paperCloneAccountButton.addEventListener("click", clonePaperAccountSetup);
  paperDeleteAccountButton.addEventListener("click", deleteActivePaperAccount);
  [paperAutoCompletionInput, paperAutoScalpInput, paperAutoResearchInput, paperAutoSimAccountInput].forEach(function (input) {
    input.addEventListener("change", savePaperAutoSettings);
  });
  paperSimBotInputs.forEach(function (input) {
    input.addEventListener("input", savePaperAutoSettings);
    input.addEventListener("change", savePaperAutoSettings);
  });
  [paperCurrencyInput, paperStartingBankrollInput].forEach(function (input) {
    input.addEventListener("input", updatePaperSettings);
    input.addEventListener("change", updatePaperSettings);
  });
  [paperOrderActionInput, paperOrderSideInput, paperLimitCentsInput, paperContractsInput].forEach(function (input) {
    input.addEventListener("input", renderPaperTicket);
    input.addEventListener("change", renderPaperTicket);
  });
  paperPositionsEl.addEventListener("click", function (event) {
    const button = event.target.closest("[data-paper-action]");
    if (!button) return;
    const id = button.getAttribute("data-paper-id");
    const action = button.getAttribute("data-paper-action");
    if (action === "sell") paperSellPosition(id);
    if (action === "settle") paperSettlePosition(id);
    if (action === "ticket") fillPaperSellTicket(id);
  });
  paperOrdersEl.addEventListener("click", function (event) {
    const button = event.target.closest("[data-paper-order-action]");
    if (!button) return;
    if (button.getAttribute("data-paper-order-action") === "cancel") {
      cancelPaperOrder(button.getAttribute("data-paper-order-id"));
    }
  });
  paperPanelEl.addEventListener("pointerdown", beginPaperDrag);
  window.addEventListener("pointermove", movePaperPanel);
  window.addEventListener("pointerup", endPaperDrag);
  accessTokenInput.value = localStorage.getItem("kalshiLabToken") || "";
  accessTokenInput.addEventListener("input", function () {
    localStorage.setItem("kalshiLabToken", accessTokenInput.value.trim());
  });
  restoreSoundSettings();
  restoreStrategySettings();
  restorePaperCollapseSettings();
  installPaperCollapsibles();
  restorePaperLedger();
  restorePaperAutoSettings();
  if (window.NovaAuth) {
    window.NovaAuth.init({
      apiBaseUrl: defaultApiBase(),
      onChange: handleNovaAuthChange,
    }).catch(function () {
      state.simWallet.error = "SIM wallet sign-in did not initialize.";
      renderPaperBankroll();
    });
  }
  [
    strategyBankrollInput,
    strategyRiskInput,
    strategyKellyInput,
    strategyPositionSideInput,
    strategyEntryCentsInput,
    strategyTakeProfitInput,
    strategyStopLossInput,
    strategyExitBufferInput,
  ].forEach(function (input) {
    input.addEventListener("input", saveStrategySettings);
    input.addEventListener("change", saveStrategySettings);
  });
  chartStage.addEventListener("mousemove", handleChartHover);
  chartStage.addEventListener("mouseleave", hideChartHover);
  restoreAutoSettings();
  [autoEnableInput, autoModeInput, autoMinEdgeInput, autoFirstMinutesInput, autoMaxCostInput].forEach(function (input) {
    input.addEventListener("change", saveAutoSettings);
  });

  startClockTicker();
  restart();

  function restart() {
    stopStream();
    if (streamToggle.checked && window.EventSource) {
      startStream();
    } else {
      loadScan();
      state.fallbackTimer = setInterval(loadScan, FALLBACK_REFRESH_MS);
    }
  }

  function stopStream() {
    if (state.stream) {
      state.stream.close();
      state.stream = null;
    }
    if (state.fallbackTimer) {
      clearInterval(state.fallbackTimer);
      state.fallbackTimer = null;
    }
  }

  function startStream() {
    setStatus("Opening live stream...");
    const source = new EventSource(bitcoinEndpoint("/api/kalshi/bitcoin/stream"));
    state.stream = source;
    source.addEventListener("scan", function (event) {
      try {
        const payload = JSON.parse(event.data);
        queueRender(payload);
        const refreshMs = payload && payload.stream && Number(payload.stream.refreshMs) || LIVE_REFRESH_MS;
        const mode = payload && payload.stream && payload.stream.mode === "patch" ? "compact" : "full";
        setStatus("Live stream connected - " + mode + " backend tick about " + (refreshMs / 1000).toFixed(1) + "s.");
      } catch (error) {
        setStatus("Live stream returned malformed data.", true);
      }
    });
    source.addEventListener("error", function () {
      setStatus("Live stream paused; falling back to polling.", true);
      stopStream();
      loadScan();
      state.fallbackTimer = setInterval(loadScan, FALLBACK_REFRESH_MS);
    });
  }

  async function loadScan() {
    try {
      setStatus("Refreshing Bitcoin market...");
      queueRender(await fetchJson(bitcoinEndpoint("/api/kalshi/bitcoin/scan")));
      setStatus(streamToggle.checked ? "Polling live every 1.0s." : "Manual refresh complete.");
    } catch (error) {
      setStatus(error.message || "Unable to load Bitcoin scan.", true);
    }
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      cache: "no-store",
      ...(options || {}),
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }

  function bitcoinEndpoint(path, overrides) {
    const paramsSource = overrides || {};
    const params = new URLSearchParams({
      minEdge: String(paramsSource.minEdge != null ? Number(paramsSource.minEdge) : Number(minEdgeInput.value || 0) / 100),
      maxCost: String(paramsSource.maxCost != null ? Number(paramsSource.maxCost) : Number(maxCostInput.value || 5)),
      minutes: String(paramsSource.minutes != null ? Number(paramsSource.minutes) : 180),
    });
    if (paramsSource.maxContracts != null) params.set("maxContracts", String(Number(paramsSource.maxContracts)));
    const token = accessTokenInput.value.trim();
    if (token) params.set("token", token);
    return defaultApiBase() + path + "?" + params.toString();
  }

  function tradeHeaders() {
    const token = accessTokenInput.value.trim();
    return {
      "Content-Type": "application/json",
      ...(token ? {
        "X-Kalshi-Lab-Token": token,
        "X-Kalshi-Trade-Token": token,
      } : {}),
    };
  }

  function defaultApiBase() {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".run.app")) {
      return window.location.origin;
    }
    return PROD_API_BASE;
  }

  function handleNovaAuthChange(profile) {
    const signedIn = Boolean(profile && profile.signedIn);
    const wallet = profile && profile.simWallet || {};
    state.simWallet.signedIn = signedIn;
    state.simWallet.ready = Boolean(wallet.ready);
    state.simWallet.syncing = Boolean(wallet.loading);
    state.simWallet.currency = "SIM";
    state.simWallet.balance = Number.isFinite(Number(wallet.balance)) ? Number(wallet.balance) : null;
    state.simWallet.startingBalance = Number.isFinite(Number(wallet.startingBalance)) ? Number(wallet.startingBalance) : 1000;
    state.simWallet.error = signedIn ? String(wallet.error || "") : "";
    if (signedIn && state.simWallet.ready && !state.simWallet.error && Number.isFinite(Number(state.simWallet.balance))) {
      attachSimWalletToActivePaper();
    } else {
      syncPaperInputsFromActive();
    }
    if (signedIn && profile && profile.uid && state.paperAccountSync.lastLoadedUid !== profile.uid) {
      state.paperAccountSync.lastLoadedUid = profile.uid;
      loadBitcoinPaperAccountState();
    }
    renderPaperBankroll();
  }

  function attachSimWalletToActivePaper() {
    if (!state.simWallet.signedIn || !Number.isFinite(Number(state.simWallet.balance))) {
      return;
    }
    state.simWallet.paperAccountId = state.activePaperAccountId;
    state.paper.currency = "SIM";
    state.paper.startingBankroll = Math.max(1, Number(state.simWallet.startingBalance || 1000));
    state.paper.cash = Math.max(0, Number(state.simWallet.balance || 0));
    syncActivePaperAccount();
    syncPaperInputsFromActive();
    savePaperLedger();
  }

  function simWalletConnected() {
    return Boolean(
      state.simWallet.signedIn
      && state.simWallet.ready
      && !state.simWallet.error
      && state.simWallet.paperAccountId === state.activePaperAccountId
      && Number.isFinite(Number(state.simWallet.balance))
    );
  }

  function syncSimWalletDelta() {
    // Bitcoin paper trades are wallet-backed only through /api/sim/bitcoin-15m/*.
    // The generic wallet adjustment endpoint intentionally rejects this game.
    return Promise.resolve(null);
  }

  function applySimWalletFromServer(wallet) {
    if (!wallet) return;
    state.simWallet.ready = true;
    state.simWallet.syncing = false;
    state.simWallet.balance = Number(wallet.balance);
    state.simWallet.startingBalance = Number(wallet.startingBalance) || state.simWallet.startingBalance;
    state.simWallet.error = "";
    attachSimWalletToActivePaper();
    if (window.NovaAuth && typeof window.NovaAuth.refreshWallet === "function") {
      window.NovaAuth.refreshWallet().catch(function () {});
    }
  }

  function secureSimManualOrder(order) {
    return Boolean(simWalletConnected() && order && (!order.automation || order.secureSim === true || order.secureSimAutomation === true));
  }

  function secureSimBitcoinRequest(action, payload) {
    if (!window.NovaAuth || typeof window.NovaAuth.appendAuthHeaders !== "function") {
      return Promise.reject(new Error("Sign in before using secure SIM paper trading."));
    }
    state.simWallet.syncing = true;
    renderPaperBankroll();
    return window.NovaAuth.appendAuthHeaders({
      "Content-Type": "application/json",
    }).then(function (headers) {
      return fetch(defaultApiBase() + "/api/sim/bitcoin-15m/" + action, {
        method: "POST",
        headers,
        body: JSON.stringify(payload || {}),
        cache: "no-store",
      });
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok || !body.ok) {
          throw new Error(body.error || "Secure SIM Bitcoin paper trade failed.");
        }
        return body;
      });
    }).catch(function (error) {
      state.simWallet.syncing = false;
      state.simWallet.error = "";
      renderPaperBankroll();
      throw error;
    });
  }

  function bitcoinPaperAccountPayload() {
    syncActivePaperAccount();
    return {
      version: 1,
      updatedAt: state.paperBookUpdatedAt || new Date().toISOString(),
      activeId: state.activePaperAccountId,
      accounts: state.paperAccounts.map(function (account) {
        return {
          id: account.id,
          name: account.name,
          paper: account.paper,
          auto: account.auto,
          lastAutomationMessage: account.lastAutomationMessage || "",
          lastAutomationTone: account.lastAutomationTone || "",
        };
      }),
    };
  }

  function loadBitcoinPaperAccountState() {
    if (!window.NovaAuth || typeof window.NovaAuth.appendAuthHeaders !== "function" || state.paperAccountSync.loading) return;
    state.paperAccountSync.loading = true;
    window.NovaAuth.appendAuthHeaders({})
      .then(function (headers) {
        return fetch(defaultApiBase() + "/api/sim/bitcoin-15m/state", {
          method: "GET",
          headers,
          cache: "no-store",
        });
      })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok || !body.ok) throw new Error(body.error || "Account paper state sync failed.");
          return body.state || null;
        });
      })
      .then(function (remoteState) {
        const remoteUpdated = new Date(remoteState && (remoteState.updatedAt || remoteState.savedAt) || 0).getTime();
        const localUpdated = new Date(state.paperBookUpdatedAt || 0).getTime();
        if (remoteState && Number.isFinite(remoteUpdated) && remoteUpdated > localUpdated) {
          applyRemoteBitcoinPaperState(remoteState);
          return;
        }
        scheduleBitcoinPaperAccountSave(200);
      })
      .catch(function (error) {
        state.paperAccountSync.error = error && error.message ? error.message : "Account paper state sync failed.";
      })
      .finally(function () {
        state.paperAccountSync.loading = false;
      });
  }

  function applyRemoteBitcoinPaperState(remoteState) {
    const accounts = Array.isArray(remoteState && remoteState.accounts)
      ? remoteState.accounts.map(normalizePaperAccount).filter(Boolean)
      : [];
    if (!accounts.length) return;
    state.paperAccountSync.applyingRemote = true;
    state.paperAccounts = accounts;
    state.activePaperAccountId = accounts.some(function (account) { return account.id === remoteState.activeId; })
      ? remoteState.activeId
      : accounts[0].id;
    state.paperBookUpdatedAt = remoteState.updatedAt || remoteState.savedAt || new Date().toISOString();
    bindActivePaperAccount();
    if (state.simWallet.signedIn && Number.isFinite(Number(state.simWallet.balance))) {
      state.paper.currency = "SIM";
      state.paper.startingBankroll = Math.max(1, Number(state.simWallet.startingBalance || 1000));
      state.paper.cash = Math.max(0, Number(state.simWallet.balance || 0));
      syncActivePaperAccount();
    }
    syncPaperInputsFromActive();
    renderPaperAccounts();
    renderPaperBankroll();
    state.paperAccountSync.applyingRemote = false;
    savePaperLedger({ skipAccountSync: true });
  }

  function scheduleBitcoinPaperAccountSave(delayMs) {
    if (state.paperAccountSync.applyingRemote) return;
    if (!state.simWallet.signedIn || !window.NovaAuth || typeof window.NovaAuth.appendAuthHeaders !== "function") return;
    const now = Date.now();
    if (!state.paperAccountSync.saveQueuedAt) {
      state.paperAccountSync.saveQueuedAt = now;
    }
    if (state.paperAccountSync.saveTimer) {
      clearTimeout(state.paperAccountSync.saveTimer);
    }
    const normalDelay = Math.max(100, Number(delayMs || 2000));
    const maxWait = 10_000;
    const elapsed = now - state.paperAccountSync.saveQueuedAt;
    const nextDelay = elapsed >= maxWait ? 100 : Math.min(normalDelay, Math.max(100, maxWait - elapsed));
    state.paperAccountSync.saveTimer = window.setTimeout(saveBitcoinPaperAccountState, nextDelay);
  }

  function saveBitcoinPaperAccountState() {
    state.paperAccountSync.saveTimer = null;
    state.paperAccountSync.saveQueuedAt = 0;
    if (state.paperAccountSync.saving || !state.simWallet.signedIn || !window.NovaAuth || typeof window.NovaAuth.appendAuthHeaders !== "function") return;
    state.paperAccountSync.saving = true;
    const payload = bitcoinPaperAccountPayload();
    window.NovaAuth.appendAuthHeaders({
      "Content-Type": "application/json",
    })
      .then(function (headers) {
        return fetch(defaultApiBase() + "/api/sim/bitcoin-15m/state", {
          method: "POST",
          headers,
          body: JSON.stringify({ state: payload }),
          cache: "no-store",
        });
      })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok || !body.ok) throw new Error(body.error || "Unable to save Bitcoin paper state.");
          state.paperAccountSync.error = "";
          return body;
        });
      })
      .catch(function (error) {
        state.paperAccountSync.error = error && error.message ? error.message : "Unable to save Bitcoin paper state.";
      })
      .finally(function () {
        state.paperAccountSync.saving = false;
      });
  }

  function openKalshiWindow(url) {
    if (!url) return false;
    const opened = window.open(
      url,
      "kalshiMarket-" + Date.now(),
      "popup=yes,width=1280,height=900,left=80,top=40,resizable=yes,scrollbars=yes"
    );
    if (!opened) return false;
    opened.opener = null;
    opened.focus();
    return true;
  }

  function queueRender(incomingScan) {
    state.paint.pendingScan = mergeScanPatch(state.scan, incomingScan);
    if (state.paint.frame) return;
    const schedule = window.requestAnimationFrame || function (callback) { return window.setTimeout(callback, 16); };
    state.paint.frame = schedule(function () {
      state.paint.frame = 0;
      const scan = state.paint.pendingScan;
      state.paint.pendingScan = null;
      if (scan) render(scan);
    });
  }

  function mergeScanPatch(previousScan, incomingScan) {
    if (!incomingScan || !incomingScan.chart || incomingScan.chart.patch !== true) {
      return incomingScan;
    }
    const previousChart = previousScan && previousScan.chart || {};
    const previousPoints = Array.isArray(previousChart.points) ? previousChart.points : [];
    const patchPoints = Array.isArray(incomingScan.chart.points) ? incomingScan.chart.points : [];
    if (!previousPoints.length) {
      return {
        ...incomingScan,
        chart: {
          ...incomingScan.chart,
          patch: false,
        },
      };
    }
    return {
      ...previousScan,
      ...incomingScan,
      market: {
        ...(previousScan && previousScan.market || {}),
        ...(incomingScan.market || {}),
      },
      model: {
        ...(previousScan && previousScan.model || {}),
        ...(incomingScan.model || {}),
      },
      source: {
        ...(previousScan && previousScan.source || {}),
        ...(incomingScan.source || {}),
      },
      chart: {
        ...previousChart,
        ...incomingScan.chart,
        points: mergeChartPoints(previousPoints, patchPoints),
      },
    };
  }

  function mergeChartPoints(existingPoints, patchPoints) {
    const byTime = new Map();
    existingPoints.slice(-420).forEach(function (point) {
      const timeMs = Number(point && point.timeMs);
      if (Number.isFinite(timeMs)) byTime.set(timeMs, point);
    });
    patchPoints.forEach(function (point) {
      const timeMs = Number(point && point.timeMs);
      if (Number.isFinite(timeMs)) byTime.set(timeMs, point);
    });
    return Array.from(byTime.values())
      .sort(function (left, right) { return Number(left.timeMs) - Number(right.timeMs); })
      .slice(-420);
  }

  function render(scan) {
    state.scan = scan;
    if (scan.error) {
      setStatus(scan.error, true);
    }
    const now = nowForPaint();
    renderSummary(scan);
    renderMarketStrip(scan);
    renderCandidates(scan);
    renderExecutionPlan(scan);
    renderPaperTicket();
    if (shouldEvaluatePaper(scan, now)) {
      evaluateAllPaperAccounts(scan);
      state.paint.lastPaperEvalAt = now;
      state.paint.lastPaperTicker = scan && scan.ticker || "";
    }
    renderPaperBankroll();
    if (shouldRenderChart(scan, now)) {
      renderChart(scan);
      state.paint.chartKey = chartRenderKey(scan);
      state.paint.lastChartAt = now;
    }
    if (shouldRenderHeavy(scan, now)) {
      renderReasons(scan);
      renderRules(scan);
      state.paint.heavyKey = heavyRenderKey(scan);
      state.paint.lastHeavyAt = now;
    }
    evaluateAutoPilot(scan);
    handleSoundEffects(scan);
  }

  function nowForPaint() {
    return window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now();
  }

  function shouldRenderChart(scan, now) {
    const key = chartRenderKey(scan);
    return key !== state.paint.chartKey || now - state.paint.lastChartAt >= CHART_RENDER_MIN_MS;
  }

  function chartRenderKey(scan) {
    const chart = scan && scan.chart || {};
    const plan = state.executionPlan || {};
    return [
      scan && scan.ticker || "",
      chart.closeTime || "",
      chart.targetPrice || "",
      plan.actionClass || "",
      plan.side || "",
      plan.entry && Number(plan.entry.limitCents || 0).toFixed(2) || "",
    ].join("|");
  }

  function shouldRenderHeavy(scan, now) {
    const key = heavyRenderKey(scan);
    return key !== state.paint.heavyKey || now - state.paint.lastHeavyAt >= HEAVY_RENDER_MIN_MS;
  }

  function heavyRenderKey(scan) {
    const model = scan && scan.model || {};
    const source = scan && scan.source || {};
    const rules = scan && scan.rules || {};
    return [
      scan && scan.ticker || "",
      source.tickerSource || "",
      source.tickerMode || "",
      source.kalshiWebsocketStatus || "",
      rules.settlementSource || "",
      model.caveat || "",
    ].join("|");
  }

  function shouldEvaluatePaper(scan, now) {
    const interval = hasActivePaperAutomation() ? PAPER_EVAL_BOT_MS : PAPER_EVAL_IDLE_MS;
    const ticker = scan && scan.ticker || "";
    return !state.paint.lastPaperEvalAt
      || now - state.paint.lastPaperEvalAt >= interval
      || ticker !== state.paint.lastPaperTicker;
  }

  function hasActivePaperAutomation() {
    return state.paperAccounts.some(function (account) {
      const auto = account && account.auto || {};
      return Boolean(auto.completion || auto.scalp || auto.research || auto.simAccount);
    }) || Boolean(state.paperAuto.completion || state.paperAuto.scalp || state.paperAuto.research || state.paperAuto.simAccount);
  }

  function renderSummary(scan) {
    const market = scan.market || {};
    const model = scan.model || {};
    const best = scan.best || {};
    const source = scan.source || {};
    const range = Number(source.tickerAuthoritative ? source.compositeReferenceRange : market.proxyDispersionDollars || 0);
    const spotLabel = source.tickerAuthoritative ? "Kalshi BRTI spot" : "Live BTC proxy";
    const spotSubtext = source.tickerAuthoritative
      ? "CF Benchmarks live / proxy check range " + dollars(range)
      : "Bid " + dollars(market.proxyBid) + " / ask " + dollars(market.proxyAsk) + " / source range " + dollars(range);
    summaryEl.innerHTML = [
      metric(spotLabel, dollars(market.currentPrice), spotSubtext, "price-metric"),
      metric("Kalshi target", dollars(market.targetPrice), "Distance " + signedDollars(market.distanceDollars)),
      metric("YES expiry odds", pct(model.yesProbability), "Raw " + pct(model.rawYesProbability) + " / " + modelSigmaSummary(model)),
      metric("Best call", callLabel(best.recommendation), best.side ? best.side.toUpperCase() + " edge " + pct(best.edge) : "No candidate"),
    ].join("");
  }

  function renderMarketStrip(scan) {
    const source = scan.source || {};
    const market = scan.market || {};
    chartSourceEl.textContent = source.tickerSource || source.chartSource || "Unknown";
    keyStatusEl.textContent = [
      source.tickerSummary || "",
      source.tickerMode || "",
      market.quoteSource ? "Quotes: " + market.quoteSource : "",
      market.clockSource ? "Clock: " + market.clockSource : "",
      source.kalshiWebsocketStatus ? "Kalshi WS " + source.kalshiWebsocketStatus : "",
      source.cfBenchmarksConfigured ? "CF key configured" : "CF key not configured",
      source.kalshiWebsocketConfigured ? "Kalshi WS configured" : "Kalshi WS not configured",
    ].filter(Boolean).join(" / ");
    eventTitleEl.textContent = scan.ticker || "KXBTC15M";
    eventWindowEl.textContent = market.closeTime ? "Closes " + formatTime(market.closeTime) + " / " + formatDuration(Number(market.secondsToClose || 0)) + " left" : "Waiting";
    clockLabelEl.textContent = scan.generatedAt ? "Updated " + formatTime(scan.generatedAt) : "--";
    if (scan.url) kalshiLinkEl.href = scan.url;
    syncMarketClock(scan);
  }

  function renderCandidates(scan) {
    const rows = Array.isArray(scan.candidates) ? scan.candidates : [];
    const model = scan.model || {};
    const secondsToClose = Number(scan.market && scan.market.secondsToClose);
    const horizon = Number.isFinite(secondsToClose) ? formatDuration(secondsToClose) : "n/a";
    recommendationLabelEl.textContent = rows[0] ? callLabel(rows[0].recommendation) : "No market";
    rowsEl.innerHTML = rows.map(function (row) {
      const edgeClass = Number(row.edge || 0) >= 0 ? "pos" : "neg";
      return [
        "<tr>",
        '<td><span class="side-pill ' + escapeHtml(row.side) + '">' + escapeHtml(String(row.side || "").toUpperCase()) + "</span></td>",
        "<td>" + formatCents(row.askCents) + '<br><span class="subtext">bid ' + formatCents(row.bidCents) + " / spread " + pct(row.spread) + "</span></td>",
        "<td>" + pct(row.probability) + '<br><span class="subtext">' + escapeHtml(sideSigmaText(row.side, model.z)) + " / horizon " + escapeHtml(horizon) + "</span></td>",
        "<td>" + pct(row.breakEven) + '<br><span class="subtext">incl fee</span></td>',
        '<td class="' + edgeClass + '">' + pct(row.edge) + "</td>",
        '<td class="' + (Number(row.expectedProfit || 0) >= 0 ? "pos" : "neg") + '">' + signedDollars(row.expectedProfit) + "</td>",
        "<td>" + row.contracts + '<br><span class="subtext">' + dollars(row.cost) + " cost / " + dollars(row.fee) + " fee</span></td>",
        '<td><span class="call-pill ' + callClass(row.recommendation) + '">' + escapeHtml(callLabel(row.recommendation)) + "</span></td>",
        '<td><button class="mini-button" type="button" data-ticket-side="' + escapeHtml(row.side) + '">Ticket</button></td>',
        "</tr>",
      ].join("");
    }).join("");
  }

  function restoreSoundSettings() {
    state.sound.enabled = localStorage.getItem("kalshiBtcSoundFx") === "1";
    soundToggle.checked = state.sound.enabled;
  }

  function unlockAudio() {
    if (!state.sound.context) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      state.sound.context = new AudioCtor();
    }
    if (state.sound.context.state === "suspended") {
      state.sound.context.resume().catch(function () {});
    }
    return state.sound.context;
  }

  function playCashRegisterSound(ctx, now) {
    const notes = [
      [880, 0, 0.055, 0.035],
      [1320, 0.055, 0.07, 0.042],
      [1760, 0.13, 0.095, 0.032],
    ];
    notes.forEach(function (note, index) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = index === notes.length - 1 ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(note[0], now + note[1]);
      gain.gain.setValueAtTime(0.0001, now + note[1]);
      gain.gain.exponentialRampToValueAtTime(note[3], now + note[1] + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note[1] + note[2]);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now + note[1]);
      oscillator.stop(now + note[1] + note[2] + 0.03);
    });

    const duration = 0.055;
    const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      const fade = 1 - index / frameCount;
      channel[index] = (Math.random() * 2 - 1) * fade * fade;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(1800, now + 0.02);
    gain.gain.setValueAtTime(0.0001, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.018, now + 0.028);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02 + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now + 0.02);
    source.stop(now + 0.02 + duration);
  }

  function playSound(kind) {
    if (!state.sound.enabled || !soundToggle.checked) return;
    const ctx = unlockAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (kind === "cash") {
      playCashRegisterSound(ctx, now);
      return;
    }
    const patterns = {
      arm: [[520, 0, 0.06], [760, 0.065, 0.08]],
      up: [[880, 0, 0.045], [1180, 0.045, 0.04]],
      down: [[520, 0, 0.05], [330, 0.05, 0.06]],
      buy: [[660, 0, 0.07], [990, 0.075, 0.09], [1320, 0.16, 0.08]],
      sell: [[740, 0, 0.08], [390, 0.09, 0.13]],
      wait: [[300, 0, 0.055]],
      phase: [[620, 0, 0.07], [620, 0.12, 0.07]],
    };
    const notes = patterns[kind] || patterns.wait;
    notes.forEach(function (note) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = kind === "phase" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(note[0], now + note[1]);
      gain.gain.setValueAtTime(0.0001, now + note[1]);
      gain.gain.exponentialRampToValueAtTime(kind === "sell" ? 0.045 : 0.032, now + note[1] + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note[1] + note[2]);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now + note[1]);
      oscillator.stop(now + note[1] + note[2] + 0.025);
    });
  }

  function handleSoundEffects(scan) {
    const market = scan.market || {};
    const price = Number(market.currentPrice);
    const now = Date.now();
    if (!state.sound.enabled || !soundToggle.checked) {
      if (Number.isFinite(price)) state.sound.lastPrice = price;
      return;
    }

    if (Number.isFinite(price)) {
      const previous = Number(state.sound.lastPrice);
      if (Number.isFinite(previous) && Math.abs(price - previous) >= 0.25 && now - state.sound.lastPriceToneAt > 900) {
        playSound(price > previous ? "up" : "down");
        state.sound.lastPriceToneAt = now;
      }
      state.sound.lastPrice = price;
    }

    const plan = state.executionPlan;
    const decision = plan ? plan.actionLabel : "";
    if (decision && state.sound.lastDecision && state.sound.lastDecision !== decision) {
      playSound(plan.actionClass === "buy" ? "buy" : plan.actionClass === "sell" ? "sell" : "wait");
    }
    if (decision) state.sound.lastDecision = decision;

    const secondsToAverageStart = Number(scan.model && scan.model.secondsToAverageStart);
    const phase = Number.isFinite(secondsToAverageStart) && secondsToAverageStart <= 0 ? "final-average" : "trading";
    if (state.sound.lastPhase && state.sound.lastPhase !== phase) {
      playSound("phase");
    }
    state.sound.lastPhase = phase;
  }

  function restoreStrategySettings() {
    const saved = JSON.parse(localStorage.getItem("kalshiBtcStrategy") || "{}");
    strategyBankrollInput.value = saved.bankroll || "1000";
    strategyRiskInput.value = saved.risk || "0.25";
    strategyKellyInput.value = saved.kelly || "10";
    strategyPositionSideInput.value = ["auto", "yes", "no"].includes(saved.side) ? saved.side : "auto";
    strategyEntryCentsInput.value = saved.entryCents || "";
    strategyTakeProfitInput.value = saved.takeProfit || "10";
    strategyStopLossInput.value = saved.stopLoss || "6";
    strategyExitBufferInput.value = saved.exitBuffer || "1.5";
  }

  function saveStrategySettings() {
    localStorage.setItem("kalshiBtcStrategy", JSON.stringify({
      bankroll: strategyBankrollInput.value,
      risk: strategyRiskInput.value,
      kelly: strategyKellyInput.value,
      side: strategyPositionSideInput.value,
      entryCents: strategyEntryCentsInput.value,
      takeProfit: strategyTakeProfitInput.value,
      stopLoss: strategyStopLossInput.value,
      exitBuffer: strategyExitBufferInput.value,
    }));
    if (state.scan) {
      renderExecutionPlan(state.scan);
      renderChart(state.scan);
    }
  }

  function renderExecutionPlan(scan) {
    const plan = buildExecutionPlan(scan);
    state.executionPlan = plan;
    if (!plan) {
      strategyActionEl.textContent = "No market";
      strategyActionEl.className = "strategy-action wait";
      strategyGridEl.innerHTML = "";
      strategyRulesEl.innerHTML = "";
      return;
    }

    strategyActionEl.textContent = plan.actionLabel;
    strategyActionEl.className = "strategy-action " + plan.actionClass;
    strategyGridEl.innerHTML = [
      strategyCard("Entry limit", plan.entry.title, plan.entry.detail, plan.entry.ok ? "pos" : "wait"),
      strategyCard("Expiry odds", plan.expiry.title, plan.expiry.detail, plan.expiry.edgeOk ? "pos" : "wait"),
      strategyCard("Size", plan.size.title, plan.size.detail, plan.size.contracts > 0 ? "pos" : "wait"),
      strategyCard("Cash-out", plan.exit.title, plan.exit.detail, plan.exit.actionClass),
      strategyCard("Timing", plan.timing.title, plan.timing.detail, plan.timing.entryOpen ? "pos" : "wait"),
    ].join("");
    strategyRulesEl.innerHTML = [
      "<p><strong>Buy limit:</strong> " + escapeHtml(plan.rules.entry) + "</p>",
      "<p><strong>Odds basis:</strong> " + escapeHtml(plan.rules.odds) + "</p>",
      "<p><strong>Profit exit:</strong> " + escapeHtml(plan.rules.profit) + "</p>",
      "<p><strong>Stop/time exit:</strong> " + escapeHtml(plan.rules.stop) + "</p>",
    ].join("");
  }

  function buildExecutionPlan(scan) {
    const rows = Array.isArray(scan.candidates) ? scan.candidates : [];
    if (!rows.length) return null;
    const market = scan.market || {};
    const model = scan.model || {};
    const best = scan.best || rows[0];
    const selectedSide = strategyPositionSideInput.value === "auto" ? best.side : strategyPositionSideInput.value;
    const candidate = rows.find(function (row) { return row.side === selectedSide; }) || best;
    const side = candidate.side || "yes";
    const probability = Number(candidate.probability);
    const askCents = Number(candidate.askCents);
    const bidCents = Number(candidate.bidCents);
    const minEdge = Number(minEdgeInput.value || 0) / 100;
    const maxEntryCents = maxEntryLimitCents(probability, minEdge);
    const roundedAsk = Math.ceil(askCents);
    const entryLimitCents = clampNumber(Math.min(roundedAsk, maxEntryCents), 1, 99);
    const spread = Number(candidate.spread || 0);
    const timing = executionTiming(market, model);
    const recommendationOk = candidate.recommendation === "research-buy" || candidate.recommendation === "tiny-only";
    const edgeOk = Number(candidate.edge) >= minEdge;
    const priceOk = askCents <= maxEntryCents;
    const spreadOk = spread <= 0.08;
    const entryOk = timing.entryOpen && recommendationOk && edgeOk && priceOk && spreadOk;

    const bankroll = Math.max(1, Number(strategyBankrollInput.value || 1000));
    const riskBudget = bankroll * clampNumber(Number(strategyRiskInput.value || 0.25) / 100, 0.0001, 1);
    const kellyFraction = kellyCostFraction(probability, entryLimitCents / 100);
    const kellyBudget = bankroll * kellyFraction * clampNumber(Number(strategyKellyInput.value || 10) / 100, 0, 1);
    const maxCostBudget = Math.max(0.5, Number(maxCostInput.value || 5));
    const budget = Math.max(0, Math.min(riskBudget, kellyBudget || 0, maxCostBudget));
    const sized = contractsForBudget(budget, entryLimitCents);

    const manualEntry = Number(strategyEntryCentsInput.value);
    const entryCents = Number.isFinite(manualEntry) && manualEntry > 0 ? manualEntry : entryLimitCents;
    const takeProfitCents = Math.max(1, Number(strategyTakeProfitInput.value || 10));
    const stopLossCents = Math.max(1, Number(strategyStopLossInput.value || 6));
    const exitBufferCents = Math.max(0, Number(strategyExitBufferInput.value || 1.5));
    const exit = exitPlan({
      candidate,
      side,
      probability,
      bidCents,
      entryCents,
      takeProfitCents,
      stopLossCents,
      exitBufferCents,
      timing,
    });

    let actionLabel = "WAIT";
    let actionClass = "wait";
    let entryTitle = "Wait for " + side.toUpperCase() + " <= " + formatCents(maxEntryCents);
    let entryDetail = "Ask " + formatCents(askCents) + " / max edge price " + formatCents(maxEntryCents) + " / edge " + pct(candidate.edge) + ".";
    if (entryOk && sized.contracts > 0) {
      actionLabel = "BUY " + side.toUpperCase() + " <= " + formatCents(entryLimitCents);
      actionClass = "buy";
      entryTitle = "Buy " + side.toUpperCase() + " limit " + formatCents(entryLimitCents);
      entryDetail = "Current ask " + formatCents(askCents) + "; do not chase above " + formatCents(maxEntryCents) + ".";
    } else if (!timing.entryOpen) {
      entryTitle = "No fresh entry";
      entryDetail = timing.reason + " Limit remains " + formatCents(maxEntryCents) + " if this setup appears earlier next cycle.";
    } else if (!priceOk) {
      actionLabel = "BID <= " + formatCents(maxEntryCents);
      entryDetail = "Current ask " + formatCents(askCents) + " is above the max edge price.";
    } else if (!spreadOk) {
      actionLabel = "REST ONLY";
      entryDetail = "Spread is " + pct(spread) + "; use a resting limit no higher than " + formatCents(entryLimitCents) + ".";
    }

    return {
      side,
      candidate,
      actionLabel,
      actionClass,
      timing,
      entry: {
        ok: entryOk,
        limitCents: entryLimitCents,
        maxEntryCents,
        askCents,
        bidCents,
        title: entryTitle,
        detail: entryDetail,
      },
      size: {
        contracts: entryOk ? sized.contracts : 0,
        budget,
        cost: sized.cost,
        kellyFraction,
        title: entryOk && sized.contracts > 0 ? sized.contracts + " contracts" : "0 contracts",
        detail: "Risk cap " + dollars(riskBudget) + " / " + Math.round(Number(strategyKellyInput.value || 10)) + "% Kelly " + dollars(kellyBudget) + " / ticket cost " + dollars(sized.cost) + ".",
      },
      expiry: {
        probability,
        rawProbability: Number(candidate.rawProbability),
        priorProbability: side === "yes" ? Number(model.marketPriorYes) : Number(model.marketPriorNo),
        calibrationWeight: Number(model.calibrationWeight),
        edge: Number(candidate.edge),
        edgeOk,
        sigmaLabel: sideSigmaText(side, model.z),
        title: side.toUpperCase() + " " + pct(probability),
        detail: "Raw " + pct(candidate.rawProbability) + " from " + sideSigmaText(side, model.z) + "; prior " + pct(side === "yes" ? model.marketPriorYes : model.marketPriorNo) + " with " + pct(model.calibrationWeight) + " blend.",
      },
      exit,
      rules: {
        entry: "Place " + side.toUpperCase() + " only with a buy limit at " + formatCents(entryLimitCents) + " or better; skip if the ask is above " + formatCents(maxEntryCents) + ".",
        odds: "The " + pct(probability) + " " + side.toUpperCase() + " odds are for expiry/settlement only: raw " + pct(candidate.rawProbability) + " from " + sideSigmaText(side, model.z) + ", then blended toward Kalshi prior by " + pct(model.calibrationWeight) + ". Exit limits change realized P&L, not settlement probability.",
        profit: "After entry around " + formatCents(entryCents) + ", set a sell limit at " + formatCents(exit.sellLimitCents) + "; take posted bids at or above that level.",
        stop: "Cut if bid trades at or below " + formatCents(exit.stopLimitCents) + ", or exit before the final average if expiry odds drop below " + pct(0.55) + ".",
      },
    };
  }

  function executionTiming(market, model) {
    const openMs = new Date(market.openTime || 0).getTime();
    const closeMs = new Date(market.closeTime || 0).getTime();
    const settleStartMs = new Date(market.settlementAveragingStart || 0).getTime();
    const nowMs = new Date(market.clockTime || Date.now()).getTime();
    const entryEndMs = Math.min(openMs + 10 * 60_000, settleStartMs - 60_000);
    const entryOpen = Number.isFinite(openMs) && Number.isFinite(entryEndMs) && nowMs >= openMs && nowMs <= entryEndMs;
    const secondsToAverageStart = Number(model.secondsToAverageStart);
    const detail = entryOpen
      ? "Entry window open until " + formatTime(entryEndMs) + ". Final avg starts " + formatTime(settleStartMs) + "."
      : "Entry window closed; final avg starts " + formatTime(settleStartMs) + ".";
    return {
      openMs,
      closeMs,
      settleStartMs,
      nowMs,
      entryEndMs,
      entryOpen,
      secondsToAverageStart,
      title: entryOpen ? "Enter before " + formatTime(entryEndMs) : "Late window",
      detail,
      reason: entryOpen ? "Fresh-window entry is still live." : "The first-10-minute entry window is closed.",
    };
  }

  function exitPlan(options) {
    const entryCents = clampNumber(options.entryCents, 1, 99);
    const bidCents = Number(options.bidCents);
    const takeProfitLimit = clampNumber(entryCents + options.takeProfitCents, 1, 99);
    const stopLimit = clampNumber(entryCents - options.stopLossCents, 1, 99);
    const modelCashOutLimit = clampNumber((Number(options.probability) * 100) - options.exitBufferCents, 1, 99);
    const plannedSellLimit = clampNumber(Math.min(takeProfitLimit, Math.max(modelCashOutLimit, entryCents + 1)), 1, 99);
    const nearFinalAverage = Number(options.timing.secondsToAverageStart) <= 90;
    let title = "Hold; sell >= " + formatCents(plannedSellLimit);
    let detail = "Bid " + formatCents(bidCents) + " / take profit " + formatCents(takeProfitLimit) + " / model cash-out " + formatCents(modelCashOutLimit) + ".";
    let actionClass = "wait";
    let sellLimitCents = plannedSellLimit;

    if (bidCents >= takeProfitLimit) {
      title = "Take profit now";
      sellLimitCents = Math.floor(bidCents);
      detail = "Current bid clears the take-profit limit of " + formatCents(takeProfitLimit) + ".";
      actionClass = "sell";
    } else if (bidCents <= stopLimit) {
      title = "Stop out";
      sellLimitCents = Math.max(1, Math.floor(bidCents));
      detail = "Current bid is at or below the stop level of " + formatCents(stopLimit) + ".";
      actionClass = "sell";
    } else if (bidCents >= modelCashOutLimit && bidCents > entryCents) {
      title = "Cash out on model";
      sellLimitCents = Math.floor(bidCents);
      detail = "Bid is at or above model cash-out level " + formatCents(modelCashOutLimit) + ".";
      actionClass = "sell";
    } else if (nearFinalAverage && Number(options.probability) < 0.55) {
      title = "Time exit";
      sellLimitCents = Math.max(1, Math.floor(bidCents));
      detail = "Final averaging is close and expiry odds are under 55%.";
      actionClass = "sell";
    }

    return {
      entryCents,
      bidCents,
      takeProfitLimit,
      stopLimit,
      modelCashOutLimit,
      sellLimitCents,
      title,
      detail,
      actionClass,
    };
  }

  function strategyCard(label, title, detail, className) {
    return [
      '<div class="strategy-card ' + escapeHtml(className || "") + '">',
      "<span>" + escapeHtml(label) + "</span>",
      "<strong>" + escapeHtml(title) + "</strong>",
      "<small>" + escapeHtml(detail) + "</small>",
      "</div>",
    ].join("");
  }

  function maxEntryLimitCents(probability, minEdge) {
    const probabilityNumber = Number(probability);
    if (!Number.isFinite(probabilityNumber)) return 1;
    for (let cents = 99; cents >= 1; cents -= 1) {
      const price = cents / 100;
      const breakEven = price + kalshiFeeDollars(1, price);
      if (probabilityNumber - breakEven >= minEdge) return cents;
    }
    return 1;
  }

  function contractsForBudget(budget, limitCents) {
    const price = clampNumber(limitCents, 1, 99) / 100;
    let contracts = Math.min(25, Math.floor(Number(budget || 0) / price));
    while (contracts > 0) {
      const cost = contracts * price + kalshiFeeDollars(contracts, price);
      if (cost <= Number(budget || 0) + 0.00001) {
        return { contracts, cost };
      }
      contracts -= 1;
    }
    return { contracts: 0, cost: 0 };
  }

  function kellyCostFraction(probability, priceDollars) {
    const price = Number(priceDollars) + kalshiFeeDollars(1, Number(priceDollars));
    const probabilityNumber = Number(probability);
    if (!Number.isFinite(price) || !Number.isFinite(probabilityNumber) || price <= 0 || price >= 1) return 0;
    return clampNumber((probabilityNumber - price) / (1 - price), 0, 1);
  }

  function kalshiFeeDollars(contracts, priceDollars) {
    return Math.ceil(0.07 * contracts * priceDollars * (1 - priceDollars) * 100) / 100;
  }

  async function prepareTicket(side) {
    try {
      setTicketStatus("Preparing live ticket...");
      placeTicketButton.disabled = true;
      const payload = {
        side: side || "",
        minEdge: Number(minEdgeInput.value || 0) / 100,
        maxCost: Number(maxCostInput.value || 5),
        maxPriceCents: side || !state.executionPlan ? 0 : state.executionPlan.entry.maxEntryCents,
        maxContracts: side || !state.executionPlan ? undefined : state.executionPlan.size.contracts,
        minutes: 180,
      };
      const data = await requestTicketPreview(payload);
      state.tradeTicket = data;
      renderTradeTicket(data);
      setTicketStatus(data.ok ? "Ticket ready. Final Buy will re-check price and send FOK." : "Ticket blocked. No order sent.");
    } catch (error) {
      state.tradeTicket = null;
      renderTradeTicket(null);
      setTicketStatus(error.message || "Could not prepare ticket.", true);
    }
  }

  async function requestTicketPreview(payload) {
    return fetchJson(bitcoinEndpoint("/api/kalshi/bitcoin/order-preview", payload), {
      method: "POST",
      headers: tradeHeaders(),
      body: JSON.stringify(payload),
    });
  }

  async function placePreparedTicket() {
    const prepared = state.tradeTicket || {};
    const ticket = prepared.ticket || {};
    if (!prepared.ok || !ticket.side) {
      setTicketStatus("Prepare a valid ticket first.", true);
      return;
    }
    const label = String(ticket.side || "").toUpperCase() + " " + ticket.contracts + " @ " + formatCents(ticket.limitPriceCents);
    if (!window.confirm("Final click: send " + label + " as fill-or-kill?")) {
      setTicketStatus("Final order canceled. No order sent.");
      return;
    }
    try {
      setTicketStatus("Sending final order...");
      placeTicketButton.disabled = true;
      const placePayload = {
        side: ticket.side,
        maxCost: Number(ticket.maxCost || maxCostInput.value || 5),
        minEdge: Math.max(Number(minEdgeInput.value || 0) / 100, Number(ticket.requiredMinEdge || 0)),
        maxPriceCents: ticket.limitPriceCents,
        maxContracts: Math.max(1, Math.floor(Number(ticket.contracts || 1))),
        confirm: "PLACE_ORDER",
        minutes: 180,
      };
      const data = await fetchJson(bitcoinEndpoint("/api/kalshi/bitcoin/place-order", placePayload), {
        method: "POST",
        headers: tradeHeaders(),
        body: JSON.stringify(placePayload),
      });
      if (!data.ok) {
        state.tradeTicket = data;
        renderTradeTicket(data);
        setTicketStatus(data.error || "Order blocked. No order sent.", true);
        return;
      }
      state.tradeTicket = null;
      renderTradeTicket(null);
      const order = data.order || {};
      setTicketStatus("Order sent: " + String(order.order_id || order.client_order_id || "Kalshi accepted it") + ".");
      loadScan();
    } catch (error) {
      renderTradeTicket(state.tradeTicket);
      setTicketStatus(error.message || "Final order failed. No order may have been sent.", true);
    }
  }

  async function openPreparedTicketOnKalshi() {
    const prepared = state.tradeTicket || {};
    const ticket = prepared.ticket || {};
    if (!ticket.url) {
      setTicketStatus("Prepare a ticket first.", true);
      return;
    }
    const details = [
      "Kalshi BTC 15m ticket",
      "Ticker: " + (ticket.ticker || ""),
      "Side: BUY " + String(ticket.side || "").toUpperCase(),
      "Contracts: " + ticket.contracts,
      "Limit: " + formatCents(ticket.limitPriceCents),
      "Max cost: " + dollars(ticket.maxCost),
      "Expiry odds: " + pct(ticket.modelProbability),
      "Break-even: " + pct(ticket.breakEven),
      "Edge: " + pct(ticket.edge),
    ].join("\n");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(details);
        setTicketStatus("Ticket copied. Opening exact Kalshi market...");
      } else {
        setTicketStatus("Opening exact Kalshi market. Clipboard unavailable in this browser.");
      }
    } catch (error) {
      setTicketStatus("Opening exact Kalshi market. Clipboard copy was blocked.", true);
    }
    openKalshiWindow(ticket.url);
  }

  function renderTradeTicket(data) {
    if (!ticketCardEl || !placeTicketButton) return;
    if (!data || !data.ticket) {
      ticketCardEl.innerHTML = '<strong>No ticket prepared</strong><p class="subtext">Prepare a ticket from the current best row or from a side button in the table.</p>';
      openTicketKalshiButton.disabled = true;
      placeTicketButton.disabled = true;
      return;
    }
    const ticket = data.ticket;
    const blockers = Array.isArray(data.blockers) ? data.blockers : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    ticketCardEl.innerHTML = [
      '<div class="ticket-main">',
      '<span class="side-pill ' + escapeHtml(ticket.side) + '">' + escapeHtml(String(ticket.side || "").toUpperCase()) + "</span>",
      "<strong>" + escapeHtml(ticket.contracts + " contracts @ " + formatCents(ticket.limitPriceCents)) + "</strong>",
      "<small>" + escapeHtml(dollars(ticket.maxCost) + " max / edge " + pct(ticket.edge) + " / expiry " + pct(ticket.modelProbability) + " vs pay " + pct(ticket.breakEven)) + "</small>",
      "</div>",
      '<div class="ticket-facts">',
      ticketLine("Quote", (ticket.quoteSource || "Unknown") + " / " + Math.round(Number(ticket.quoteAgeMs || 0)) + "ms"),
      ticketLine("Clock", (ticket.clockSource || "Unknown") + " / " + formatDuration(ticket.secondsToClose) + " left"),
      ticketLine("Target", dollars(ticket.targetPrice) + " / spot " + dollars(ticket.currentPrice)),
      ticketLine("EV", signedDollars(ticket.expectedProfit) + " before model error"),
      "</div>",
      blockers.length ? '<div class="ticket-list bad-list">' + blockers.map(function (item) { return "<p>" + escapeHtml(item) + "</p>"; }).join("") + "</div>" : "",
      warnings.length ? '<div class="ticket-list warn-list">' + warnings.map(function (item) { return "<p>" + escapeHtml(item) + "</p>"; }).join("") + "</div>" : "",
    ].join("");
    openTicketKalshiButton.disabled = !ticket.url;
    placeTicketButton.disabled = !data.ok;
  }

  function ticketLine(label, value) {
    return "<p><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></p>";
  }

  function setTicketStatus(message, error) {
    if (!ticketStatusEl) return;
    ticketStatusEl.textContent = message;
    ticketStatusEl.className = error ? "neg" : "";
  }

  function restorePaperLedger() {
    let savedBook = {};
    try {
      savedBook = JSON.parse(localStorage.getItem(PAPER_ACCOUNTS_STORAGE_KEY) || "{}") || {};
    } catch {
      savedBook = {};
    }
    let accounts = Array.isArray(savedBook.accounts) ? savedBook.accounts.map(normalizePaperAccount).filter(Boolean) : [];
    if (!accounts.length) {
      accounts = [migrateLegacyPaperAccount()];
    }
    state.paperAccounts = accounts;
    state.activePaperAccountId = accounts.some(function (account) { return account.id === savedBook.activeId; })
      ? savedBook.activeId
      : accounts[0].id;
    state.paperBookUpdatedAt = savedBook.updatedAt || savedBook.savedAt || "";
    bindActivePaperAccount();
    syncPaperInputsFromActive();
    applyPaperLayout();
    renderPaperAccounts();
    renderPaperBankroll();
  }

  function restorePaperCollapseSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(PAPER_COLLAPSE_STORAGE_KEY) || "{}") || {};
    } catch {
      saved = {};
    }
    state.paperCollapse = {};
    paperCollapseSections.forEach(function (section) {
      state.paperCollapse[section.key] = Object.prototype.hasOwnProperty.call(saved, section.key)
        ? saved[section.key] === true
        : section.defaultCollapsed === true;
    });
    state.paperCollapse.simBot = Object.prototype.hasOwnProperty.call(saved, "simBot")
      ? saved.simBot === true
      : true;
  }

  function savePaperCollapseSettings() {
    try {
      localStorage.setItem(PAPER_COLLAPSE_STORAGE_KEY, JSON.stringify(state.paperCollapse || {}));
    } catch {
      // The panel still works if local storage is blocked; it just will not remember collapsed sections.
    }
  }

  function installPaperCollapsibles() {
    paperCollapseSections.forEach(function (section) {
      if (!section.element || section.toggleButton) return;
      if (!section.element.id) section.element.id = "paper-section-" + section.key;
      section.element.classList.add("paper-collapsible-body");
      section.element.setAttribute("data-paper-collapse-body", section.key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "paper-collapse-toggle";
      button.setAttribute("data-paper-collapse-toggle", section.key);
      button.setAttribute("aria-controls", section.element.id);
      button.addEventListener("click", function () {
        setPaperSectionCollapsed(section.key, !paperSectionCollapsed(section.key));
      });
      section.element.parentNode.insertBefore(button, section.element);
      section.toggleButton = button;
      applyPaperSectionCollapse(section);
    });
    installPaperSimBotCollapse();
  }

  function installPaperSimBotCollapse() {
    if (!paperSimBotCardEl || paperSimBotCardEl.getAttribute("data-collapse-installed") === "1") return;
    const controls = paperSimBotCardEl.querySelector(".paper-bot-controls");
    if (!controls) return;
    paperSimBotCardEl.setAttribute("data-collapse-installed", "1");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper-sim-bot-collapse";
    button.addEventListener("click", function () {
      state.paperCollapse.simBot = !paperSimBotControlsCollapsed();
      applyPaperSimBotCollapse();
      savePaperCollapseSettings();
    });
    paperSimBotCardEl.insertBefore(button, controls);
    applyPaperSimBotCollapse();
  }

  function paperSectionCollapsed(key) {
    return state.paperCollapse && state.paperCollapse[key] === true;
  }

  function paperSimBotControlsCollapsed() {
    return state.paperCollapse && state.paperCollapse.simBot === true;
  }

  function setPaperSectionCollapsed(key, collapsed) {
    if (!state.paperCollapse) state.paperCollapse = {};
    state.paperCollapse[key] = collapsed === true;
    const section = paperCollapseSections.find(function (item) { return item.key === key; });
    if (section) applyPaperSectionCollapse(section);
    savePaperCollapseSettings();
  }

  function applyPaperSectionCollapse(section) {
    const collapsed = paperSectionCollapsed(section.key);
    if (section.element) {
      section.element.hidden = collapsed;
      section.element.classList.toggle("is-collapsed", collapsed);
    }
    if (!section.toggleButton) return;
    section.toggleButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
    section.toggleButton.classList.toggle("is-collapsed", collapsed);
    section.toggleButton.innerHTML = [
      '<span class="paper-collapse-title">',
      '<strong>' + escapeHtml(section.label) + '</strong>',
      '<small>' + escapeHtml(section.detail || "") + '</small>',
      '</span>',
      '<span class="paper-collapse-state">' + (collapsed ? "Show" : "Hide") + '</span>',
    ].join("");
  }

  function applyPaperSimBotCollapse() {
    if (!paperSimBotCardEl) return;
    const controls = paperSimBotCardEl.querySelector(".paper-bot-controls");
    const button = paperSimBotCardEl.querySelector(".paper-sim-bot-collapse");
    const collapsed = paperSimBotControlsCollapsed();
    paperSimBotCardEl.classList.toggle("is-sim-bot-compact", collapsed);
    if (controls) controls.hidden = collapsed;
    if (button) {
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
      button.textContent = collapsed ? "Show Account SIM parameters" : "Hide Account SIM parameters";
    }
  }

  function savePaperLedger(options) {
    state.paperBookUpdatedAt = new Date().toISOString();
    const payload = bitcoinPaperAccountPayload();
    localStorage.setItem(PAPER_ACCOUNTS_STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(state.paper));
    localStorage.setItem(PAPER_AUTO_STORAGE_KEY, JSON.stringify(state.paperAuto));
    if (!options || options.skipAccountSync !== true) {
      scheduleBitcoinPaperAccountSave();
    }
  }

  function migrateLegacyPaperAccount() {
    let savedPaper = {};
    let savedAuto = {};
    try {
      savedPaper = JSON.parse(localStorage.getItem(PAPER_STORAGE_KEY) || "{}") || {};
    } catch {
      savedPaper = {};
    }
    try {
      savedAuto = JSON.parse(localStorage.getItem(PAPER_AUTO_STORAGE_KEY) || "{}") || {};
    } catch {
      savedAuto = {};
    }
    return normalizePaperAccount({
      id: PAPER_DEFAULT_ACCOUNT_ID,
      name: "Desk 1",
      paper: savedPaper,
      auto: savedAuto,
    });
  }

  function normalizePaperAccount(saved, index) {
    const source = saved || {};
    const id = cleanPaperAccountId(source.id) || (index === 0 ? PAPER_DEFAULT_ACCOUNT_ID : newPaperAccountId());
    return {
      id,
      name: cleanPaperAccountName(source.name || ("Desk " + ((index || 0) + 1))),
      paper: normalizePaperLedger(source.paper || {}),
      auto: normalizePaperAuto(source.auto || {}),
      lastAutomationMessage: String(source.lastAutomationMessage || ""),
      lastAutomationTone: String(source.lastAutomationTone || ""),
    };
  }

  function normalizePaperLedger(saved) {
    const source = saved || {};
    const startingBankroll = Math.max(1, Number(source.startingBankroll || 1000));
    return {
      currency: cleanPaperCurrency(source.currency || "SIM"),
      startingBankroll,
      cash: Number.isFinite(Number(source.cash)) ? Number(source.cash) : startingBankroll,
      orders: Array.isArray(source.orders) ? source.orders.filter(function (item) { return item && item.status === "open"; }) : [],
      positions: Array.isArray(source.positions) ? source.positions.filter(function (item) { return item && item.status === "open"; }) : [],
      history: Array.isArray(source.history) ? source.history.slice(0, 100) : [],
      layout: normalizePaperLayout(source.layout),
    };
  }

  function normalizePaperAuto(saved) {
    const source = saved || {};
    return {
      completion: source.completion === true,
      scalp: source.scalp === true,
      research: source.research === true,
      simAccount: source.simAccount === true,
      simBot: normalizePaperSimBotParams(source.simBot || {}),
      fills: source.fills && typeof source.fills === "object" && !Array.isArray(source.fills) ? source.fills : {},
      lastAttemptAt: source.lastAttemptAt && typeof source.lastAttemptAt === "object" && !Array.isArray(source.lastAttemptAt) ? source.lastAttemptAt : {},
    };
  }

  function normalizePaperSimBotParams(saved) {
    const source = saved || {};
    const defaults = PAPER_SIM_BOT_DEFAULTS;
    const numberOrDefault = function (value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    return {
      contracts: clampNumber(Math.floor(numberOrDefault(source.contracts, defaults.contracts)), 1, 100),
      minEdgePct: clampNumber(numberOrDefault(source.minEdgePct, defaults.minEdgePct), 0, 50),
      maxAskCents: clampNumber(numberOrDefault(source.maxAskCents, defaults.maxAskCents), 1, 99),
      maxSpreadPct: clampNumber(numberOrDefault(source.maxSpreadPct, defaults.maxSpreadPct), 0.5, 50),
      maxFillsPerTicker: clampNumber(Math.floor(numberOrDefault(source.maxFillsPerTicker, defaults.maxFillsPerTicker)), 1, 20),
      cooldownSeconds: clampNumber(numberOrDefault(source.cooldownSeconds, defaults.cooldownSeconds), 5, 300),
      maxExposure: clampNumber(numberOrDefault(source.maxExposure, defaults.maxExposure), 1, 1000),
      exitMode: String(source.exitMode || defaults.exitMode) === "scalp" ? "scalp" : "settle",
      targetCents: clampNumber(numberOrDefault(source.targetCents, defaults.targetCents), 1, 50),
      minSecondsSinceOpen: clampNumber(numberOrDefault(source.minSecondsSinceOpen, defaults.minSecondsSinceOpen), 0, 600),
      maxSecondsSinceOpen: clampNumber(numberOrDefault(source.maxSecondsSinceOpen, defaults.maxSecondsSinceOpen), 60, 850),
    };
  }

  function syncActivePaperAccount() {
    const account = activePaperAccount();
    if (!account) return;
    account.paper = state.paper;
    account.auto = state.paperAuto;
  }

  function bindActivePaperAccount() {
    const account = activePaperAccount() || state.paperAccounts[0];
    if (!account) return;
    state.activePaperAccountId = account.id;
    state.paper = account.paper;
    state.paperAuto = account.auto;
  }

  function activePaperAccount() {
    return state.paperAccounts.find(function (account) { return account.id === state.activePaperAccountId; });
  }

  function syncPaperInputsFromActive() {
    const account = activePaperAccount();
    if (!account) return;
    paperAccountNameInput.value = account.name;
    state.paper.currency = "SIM";
    paperCurrencyInput.value = "SIM";
    paperCurrencyInput.readOnly = true;
    paperCurrencyInput.title = "SIM is the site-wide paper currency.";
    paperStartingBankrollInput.readOnly = Boolean(state.simWallet.signedIn && state.simWallet.ready);
    paperStartingBankrollInput.title = paperStartingBankrollInput.readOnly
      ? "Signed-in SIM wallets start at 1,000 SIM and keep their balance on your account."
      : "Unsigned local paper mode can still change the starting roll.";
    paperStartingBankrollInput.value = String(state.paper.startingBankroll);
    paperAutoCompletionInput.checked = state.paperAuto.completion;
    paperAutoScalpInput.checked = state.paperAuto.scalp;
    paperAutoResearchInput.checked = state.paperAuto.research;
    paperAutoSimAccountInput.checked = state.paperAuto.simAccount;
    state.paperAuto.simBot = normalizePaperSimBotParams(state.paperAuto.simBot || {});
    paperSimBotContractsInput.value = String(state.paperAuto.simBot.contracts);
    paperSimBotMinEdgeInput.value = String(state.paperAuto.simBot.minEdgePct);
    paperSimBotMaxAskInput.value = String(state.paperAuto.simBot.maxAskCents);
    paperSimBotMaxSpreadInput.value = String(state.paperAuto.simBot.maxSpreadPct);
    paperSimBotMaxFillsInput.value = String(state.paperAuto.simBot.maxFillsPerTicker);
    paperSimBotCooldownInput.value = String(state.paperAuto.simBot.cooldownSeconds);
    paperSimBotMaxExposureInput.value = String(state.paperAuto.simBot.maxExposure);
    paperSimBotExitModeInput.value = state.paperAuto.simBot.exitMode;
    paperSimBotTargetCentsInput.value = String(state.paperAuto.simBot.targetCents);
    updatePaperAutoStatus(account.lastAutomationMessage || "", account.lastAutomationTone || "");
  }

  function newPaperAccountId() {
    return "paper-desk-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  }

  function cleanPaperAccountId(value) {
    return String(value || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 60);
  }

  function cleanPaperAccountName(value) {
    return String(value || "Desk").replace(/\s+/g, " ").trim().slice(0, 32) || "Desk";
  }

  function switchPaperAccount(id) {
    const account = state.paperAccounts.find(function (item) { return item.id === id; });
    if (!account || account.id === state.activePaperAccountId) return;
    syncActivePaperAccount();
    state.activePaperAccountId = account.id;
    bindActivePaperAccount();
    if (state.simWallet.signedIn && state.simWallet.ready) {
      attachSimWalletToActivePaper();
    }
    syncPaperInputsFromActive();
    applyPaperLayout();
    savePaperLedger();
    renderPaperAccounts();
    renderPaperBankroll();
    setPaperStatus("Switched to " + account.name + ".", false, "pos");
  }

  function addPaperAccount() {
    syncActivePaperAccount();
    const active = activePaperAccount();
    const activePaper = active ? active.paper : state.paper;
    const nextNumber = state.paperAccounts.length + 1;
    const account = normalizePaperAccount({
      id: newPaperAccountId(),
      name: "Desk " + nextNumber,
      paper: {
        currency: "SIM",
        startingBankroll: state.simWallet.signedIn ? state.simWallet.startingBalance : (activePaper.startingBankroll || 1000),
        cash: state.simWallet.signedIn && Number.isFinite(Number(state.simWallet.balance)) ? state.simWallet.balance : (activePaper.startingBankroll || 1000),
        layout: activePaper.layout,
      },
      auto: {},
    }, nextNumber - 1);
    state.paperAccounts.push(account);
    state.activePaperAccountId = account.id;
    bindActivePaperAccount();
    if (state.simWallet.signedIn && state.simWallet.ready) {
      attachSimWalletToActivePaper();
    }
    syncPaperInputsFromActive();
    savePaperLedger();
    renderPaperAccounts();
    renderPaperBankroll();
    setPaperStatus("Created " + account.name + ".", false, "pos");
  }

  function clonePaperAccountSetup() {
    syncActivePaperAccount();
    const active = activePaperAccount();
    if (!active) return;
    const nextNumber = state.paperAccounts.length + 1;
    const account = normalizePaperAccount({
      id: newPaperAccountId(),
      name: active.name + " copy",
      paper: {
        currency: "SIM",
        startingBankroll: state.simWallet.signedIn ? state.simWallet.startingBalance : active.paper.startingBankroll,
        cash: state.simWallet.signedIn && Number.isFinite(Number(state.simWallet.balance)) ? state.simWallet.balance : active.paper.startingBankroll,
        layout: active.paper.layout,
      },
      auto: {
        completion: active.auto.completion,
        scalp: active.auto.scalp,
        research: active.auto.research,
        simAccount: false,
        simBot: active.auto.simBot || { ...PAPER_SIM_BOT_DEFAULTS },
      },
    }, nextNumber - 1);
    state.paperAccounts.push(account);
    state.activePaperAccountId = account.id;
    bindActivePaperAccount();
    if (state.simWallet.signedIn && state.simWallet.ready) {
      attachSimWalletToActivePaper();
    }
    syncPaperInputsFromActive();
    savePaperLedger();
    renderPaperAccounts();
    renderPaperBankroll();
    setPaperStatus("Cloned setup into " + account.name + ".", false, "pos");
  }

  function deleteActivePaperAccount() {
    if (state.paperAccounts.length <= 1) {
      setPaperStatus("Keep at least one paper desk.", true);
      return;
    }
    const account = activePaperAccount();
    if (!account || !window.confirm("Delete " + account.name + " and its paper history?")) return;
    state.paperAccounts = state.paperAccounts.filter(function (item) { return item.id !== account.id; });
    state.activePaperAccountId = state.paperAccounts[0].id;
    bindActivePaperAccount();
    syncPaperInputsFromActive();
    applyPaperLayout();
    savePaperLedger();
    renderPaperAccounts();
    renderPaperBankroll();
    setPaperStatus("Deleted " + account.name + ".", false);
  }

  function updateActivePaperAccountName() {
    const account = activePaperAccount();
    if (!account) return;
    account.name = cleanPaperAccountName(paperAccountNameInput.value || account.name);
    paperAccountNameInput.value = account.name;
    savePaperLedger();
    renderPaperAccounts();
  }

  function renderPaperAccounts() {
    if (!paperAccountTabsEl || !paperAccountComparisonEl) return;
    if (state.paperUiMuted) return;
    syncActivePaperAccount();
    paperDeleteAccountButton.disabled = state.paperAccounts.length <= 1;
    paperAccountTabsEl.innerHTML = state.paperAccounts.map(function (account) {
      const metrics = paperAccountMetrics(account);
      return [
        '<button class="paper-account-tab ' + (account.id === state.activePaperAccountId ? "active" : "") + '" type="button" data-paper-account-id="' + escapeHtml(account.id) + '">',
        "<strong>" + escapeHtml(account.name) + "</strong>",
        "<span>" + escapeHtml(paperMoneyFor(account.paper, metrics.equity) + " / " + signedPaperMoneyFor(account.paper, metrics.pnl)) + "</span>",
        "</button>",
      ].join("");
    }).join("");
    paperAccountComparisonEl.innerHTML = [
      "<h3>Desk comparison</h3>",
      '<div class="paper-desk-grid">',
      state.paperAccounts.map(renderPaperDeskCard).join(""),
      "</div>",
    ].join("");
  }

  function renderPaperDeskCard(account) {
    const metrics = paperAccountMetrics(account);
    const pnlClass = metrics.pnl >= 0 ? "pos" : "neg";
    return [
      '<div class="paper-desk-card ' + (account.id === state.activePaperAccountId ? "active" : "") + '">',
      "<strong>" + escapeHtml(account.name) + "</strong>",
      '<span>Equity <b>' + escapeHtml(paperMoneyFor(account.paper, metrics.equity)) + '</b> / <b class="' + pnlClass + '">' + escapeHtml(signedPaperMoneyFor(account.paper, metrics.pnl)) + "</b></span>",
      "<span>Cash " + escapeHtml(paperMoneyFor(account.paper, account.paper.cash)) + " / open risk " + escapeHtml(paperMoneyFor(account.paper, metrics.openRisk)) + "</span>",
      "<span>" + escapeHtml(metrics.contracts + " contracts / " + metrics.positions + " positions / bots " + paperBotSummary(account.auto)) + "</span>",
      account.lastAutomationMessage ? "<span>" + escapeHtml(account.lastAutomationMessage.slice(0, 135)) + "</span>" : "",
      "</div>",
    ].join("");
  }

  function paperAccountMetrics(account) {
    const paper = account && account.paper || normalizePaperLedger({});
    const openValue = paperLedgerOpenValue(paper);
    const equity = Number(paper.cash || 0) + openValue;
    const starting = Number(paper.startingBankroll || 0);
    const openRisk = paper.positions.reduce(function (sum, position) {
      return sum + Number(position.entryCost || 0);
    }, 0);
    return {
      equity,
      pnl: equity - starting,
      openValue,
      openRisk,
      contracts: paper.positions.reduce(function (sum, position) { return sum + Number(position.contracts || 0); }, 0),
      positions: paper.positions.length,
    };
  }

  function paperLedgerOpenValue(paper) {
    return (paper.positions || []).reduce(function (sum, position) {
      return sum + paperPositionMarkFor(position);
    }, 0);
  }

  function paperPositionMarkFor(position) {
    const bidCents = Number(position.lastBidCents);
    if (!Number.isFinite(bidCents) || bidCents <= 0) return 0;
    const price = bidCents / 100;
    return Math.max(0, Number(position.contracts || 0) * price - kalshiFeeDollars(position.contracts, price));
  }

  function paperBotSummary(auto) {
    const active = [];
    if (auto && auto.completion) active.push("completion");
    if (auto && auto.scalp) active.push("scalp");
    if (auto && auto.research) active.push("research");
    return active.length ? active.join(", ") : "off";
  }

  function updatePaperSettings() {
    const previousStarting = Number(state.paper.startingBankroll || 1000);
    if (state.simWallet.signedIn && state.simWallet.ready) {
      state.paper.currency = "SIM";
      state.paper.startingBankroll = Math.max(1, Number(state.simWallet.startingBalance || 1000));
      if (Number.isFinite(Number(state.simWallet.balance))) {
        state.paper.cash = Math.max(0, Number(state.simWallet.balance || 0));
      }
      syncPaperInputsFromActive();
      savePaperLedger();
      renderPaperBankroll();
      return;
    }
    const nextStarting = Math.max(1, Number(paperStartingBankrollInput.value || previousStarting));
    const untouched = !state.paper.positions.length
      && !state.paper.orders.length
      && !state.paper.history.length
      && Math.abs(Number(state.paper.cash || 0) - previousStarting) < 0.01;
    state.paper.currency = "SIM";
    state.paper.startingBankroll = nextStarting;
    if (untouched) state.paper.cash = nextStarting;
    paperCurrencyInput.value = "SIM";
    savePaperLedger();
    renderPaperBankroll();
  }

  function setPaperAction(action) {
    paperOrderActionInput.value = action === "sell" ? "sell" : "buy";
    state.paperTicketPositionId = "";
    renderPaperTicket();
  }

  function setPaperSide(side) {
    paperOrderSideInput.value = side === "no" ? "no" : "yes";
    state.paperTicketPositionId = "";
    renderPaperTicket();
  }

  function fillPaperLimitFromMarket() {
    const action = paperOrderActionInput.value === "sell" ? "sell" : "buy";
    const side = paperOrderSideInput.value === "no" ? "no" : "yes";
    const quote = getCurrentPaperQuote(side);
    const priceCents = quote ? Number(action === "buy" ? quote.askCents : quote.bidCents) : NaN;
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      setPaperStatus("No live " + (action === "buy" ? "ask" : "bid") + " available to auto-fill.", true);
      return;
    }
    paperLimitCentsInput.value = centsInputValue(priceCents);
    renderPaperTicket();
    setPaperStatus("Limit price auto-filled from current " + (action === "buy" ? "ask" : "bid") + " at " + formatCents(priceCents) + ".", false);
  }

  function renderPaperTicket() {
    if (!paperTicketPreviewEl) return;
    const action = paperOrderActionInput.value === "sell" ? "sell" : "buy";
    const side = paperOrderSideInput.value === "no" ? "no" : "yes";
    const yesQuote = getCurrentPaperQuote("yes");
    const noQuote = getCurrentPaperQuote("no");
    paperActionBuyButton.classList.toggle("active", action === "buy");
    paperActionSellButton.classList.toggle("active", action === "sell");
    paperSideYesButton.classList.toggle("active", side === "yes");
    paperSideNoButton.classList.toggle("active", side === "no");
    renderPaperQuoteButton("yes", yesQuote, action);
    renderPaperQuoteButton("no", noQuote, action);

    const quote = side === "yes" ? yesQuote : noQuote;
    const quotePrice = quote ? Number(action === "buy" ? quote.askCents : quote.bidCents) : NaN;
    const limitCents = Number(paperLimitCentsInput.value || quotePrice);
    const rawContracts = Math.floor(Number(paperContractsInput.value || 0));
    const contracts = Math.max(0, rawContracts || (action === "buy" && state.executionPlan && state.executionPlan.size ? Number(state.executionPlan.size.contracts || 1) : 1));
    const price = Number.isFinite(limitCents) ? clampNumber(limitCents, 1, 99) / 100 : NaN;
    const fee = Number.isFinite(price) ? kalshiFeeDollars(contracts, price) : NaN;
    const gross = Number.isFinite(price) ? contracts * price : NaN;
    const total = action === "buy" ? gross + fee : Math.max(0, gross - fee);
    const marketable = action === "buy"
      ? quote && Number(quote.askCents) <= limitCents
      : quote && Number(quote.bidCents) >= limitCents;
    const hasTradableQuote = quote && Number.isFinite(quotePrice) && Number.isFinite(limitCents);
    const statusTitle = hasTradableQuote ? (marketable ? "Fills now" : "Rests") : "Waiting";
    const statusDetail = hasTradableQuote
      ? (marketable ? "Limit crosses the live quote" : "Limit waits in paper order book")
      : "Need a live quote and limit price";
    const currentLabel = action === "buy" ? "Current ask" : "Current bid";
    const totalLabel = action === "buy" ? "Est. cost" : "Est. proceeds";
    paperFillLimitButton.textContent = action === "buy" ? "Ask" : "Bid";
    paperBuyBestButton.textContent = action === "buy" ? "Place Buy Limit" : "Place Sell Limit";
    paperBuyBestButton.classList.toggle("sell", action === "sell");
    paperTicketPreviewEl.innerHTML = [
      paperTicketMetric(currentLabel, formatCents(quotePrice), quote ? "Bid " + formatCents(quote.bidCents) + " / Ask " + formatCents(quote.askCents) : "Waiting for quote"),
      paperTicketMetric(totalLabel, paperMoney(total), contracts + " contract" + (contracts === 1 ? "" : "s") + " incl est. fee " + paperMoney(fee)),
      paperTicketMetric("Status", statusTitle, statusDetail, marketable ? "pos" : "wait"),
    ].join("");
  }

  function renderPaperQuoteButton(side, quote, action) {
    const main = quote ? Number(action === "buy" ? quote.askCents : quote.bidCents) : NaN;
    const sub = quote ? (action === "buy" ? "bid " + formatCents(quote.bidCents) : "ask " + formatCents(quote.askCents)) : "waiting";
    const quoteEl = side === "yes" ? paperYesQuoteEl : paperNoQuoteEl;
    const subEl = side === "yes" ? paperYesSubquoteEl : paperNoSubquoteEl;
    quoteEl.textContent = formatCents(main);
    subEl.textContent = sub;
  }

  function paperTicketMetric(label, value, detail, className) {
    return '<div class="' + escapeHtml(className || "") + '"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong><small>" + escapeHtml(detail || "") + "</small></div>";
  }

  function fillPaperTicketFromPlan() {
    const plan = state.executionPlan;
    if (!plan || !plan.candidate) {
      setPaperStatus("No active plan to copy into the paper ticket.", true);
      return;
    }
    paperOrderActionInput.value = "buy";
    state.paperTicketPositionId = "";
    paperOrderSideInput.value = plan.side || "yes";
    paperLimitCentsInput.value = centsInputValue(plan.entry.limitCents || plan.entry.askCents);
    paperContractsInput.value = plan.size.contracts > 0 ? String(plan.size.contracts) : "1";
    renderPaperTicket();
    setPaperStatus("Paper ticket loaded: " + String(plan.side || "yes").toUpperCase() + " limit " + formatCents(plan.entry.limitCents || plan.entry.askCents) + ".", false);
  }

  function pressPaperLimitButton() {
    if (!paperBuyBestButton || paperBuyBestButton.disabled) return;
    paperBuyBestButton.classList.remove("is-pressing");
    void paperBuyBestButton.offsetWidth;
    paperBuyBestButton.classList.add("is-pressing");
    window.setTimeout(function () {
      paperBuyBestButton.classList.remove("is-pressing");
    }, 170);
  }

  function confirmPaperLimitButton(action) {
    if (!paperBuyBestButton) return;
    paperBuyBestButton.classList.remove("is-order-placed", "is-order-sell");
    void paperBuyBestButton.offsetWidth;
    paperBuyBestButton.classList.add("is-order-placed");
    if (action === "sell") paperBuyBestButton.classList.add("is-order-sell");
    window.setTimeout(function () {
      paperBuyBestButton.classList.remove("is-order-placed", "is-order-sell");
    }, 720);
    playSound(action === "sell" ? "sell" : "cash");
  }

  function paperBuyPlan() {
    const order = paperTicketOrder();
    if (!order) return;
    const quote = getCurrentPaperQuote(order.side);
    if (!quote) {
      setPaperStatus("No paper order: live quote is unavailable for " + order.side.toUpperCase() + ".", true);
      return;
    }
    order.lastBidCents = quote.bidCents;
    order.lastAskCents = quote.askCents;
    order.lastModelProbability = quote.probability;

    if (order.action === "buy") {
      const maxContracts = maxPaperContracts(paperAvailableCash(), order.limitCents);
      order.contracts = Math.min(order.contracts, maxContracts);
      if (order.contracts <= 0) {
        setPaperStatus("No paper buy: fake cash is tied up or below this limit cost.", true);
        return;
      }
      order.secureSim = secureSimManualOrder(order);
      if (Number(quote.askCents) <= order.limitCents) {
        if (order.secureSim) {
          confirmPaperLimitButton("buy");
          fillPaperBuySecure(order, quote.askCents, "Marketable secure SIM limit buy filled immediately");
        } else {
          const position = fillPaperBuy(order, quote.askCents, "Marketable limit buy filled immediately");
          if (position) confirmPaperLimitButton("buy");
        }
      } else {
        queuePaperOrder(order, "Waiting for ask <= " + formatCents(order.limitCents));
        confirmPaperLimitButton("buy");
      }
      return;
    }

    const availableContracts = paperAvailableContractsForSell(order.ticker, order.side);
    order.contracts = Math.min(order.contracts, availableContracts);
    if (order.contracts <= 0) {
      setPaperStatus("No paper sell: no unreserved open " + order.side.toUpperCase() + " contracts.", true);
      return;
    }
    const sellSourcePosition = findPaperPosition(order.sourcePositionId);
    order.secureSim = Boolean(sellSourcePosition && sellSourcePosition.secureSim && sellSourcePosition.serverPositionId);
    if (Number(quote.bidCents) >= order.limitCents) {
      confirmPaperLimitButton("sell");
      if (order.secureSim) {
        paperSellContractsSecure(order, quote.bidCents, "Marketable secure SIM limit sell filled immediately");
      } else {
        paperSellContracts(order.ticker, order.side, order.contracts, quote.bidCents, "Marketable limit sell filled immediately");
      }
    } else {
      queuePaperOrder(order, "Waiting for bid >= " + formatCents(order.limitCents));
      confirmPaperLimitButton("sell");
    }
  }

  function paperTicketOrder() {
    const scan = state.scan || {};
    const market = scan.market || {};
    const plan = state.executionPlan || {};
    const action = paperOrderActionInput.value === "sell" ? "sell" : "buy";
    const side = paperOrderSideInput.value === "no" ? "no" : "yes";
    const sourcePosition = action === "sell" ? findPaperPosition(state.paperTicketPositionId) : null;
    const ticker = sourcePosition && sourcePosition.side === side ? sourcePosition.ticker : (scan.ticker || "KXBTC15M");
    const quote = getCurrentPaperQuote(side);
    const fallbackLimit = action === "buy"
      ? Number(plan.entry && plan.side === side ? plan.entry.limitCents : quote && quote.askCents)
      : Number(plan.exit && plan.side === side ? plan.exit.sellLimitCents : quote && quote.bidCents);
    const rawLimitCents = Number(paperLimitCentsInput.value || fallbackLimit);
    if (!Number.isFinite(rawLimitCents) || rawLimitCents <= 0) {
      setPaperStatus("No paper order: enter a limit price in cents.", true);
      return null;
    }
    const limitCents = clampNumber(rawLimitCents, 1, 99);
    let contracts = Math.floor(Number(paperContractsInput.value || 0));
    if (contracts <= 0 && action === "buy") contracts = Math.max(1, Math.floor(Number(plan.size && plan.size.contracts || 1)));
    if (contracts <= 0 && action === "sell") contracts = paperAvailableContractsForSell(ticker, side);
    contracts = Math.min(1000, Math.max(0, contracts));
    if (contracts <= 0) {
      setPaperStatus("No paper order: enter at least 1 contract.", true);
      return null;
    }
    return {
      id: "paper-order-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      status: "open",
      action,
      side,
      contracts,
      limitCents,
      ticker,
      createdAt: new Date().toISOString(),
      closeTime: market.closeTime || "",
      targetPrice: Number(market.targetPrice),
      entrySpot: Number(market.currentPrice),
      lastSpot: Number(market.currentPrice),
      lastMarkedAt: scan.generatedAt || new Date().toISOString(),
      sourcePositionId: sourcePosition ? sourcePosition.id : "",
    };
  }

  function queuePaperOrder(order, detail) {
    state.paper.orders.unshift(order);
    addPaperHistory({
      type: "LIMIT",
      ticker: order.ticker,
      side: order.side,
      contracts: order.contracts,
      priceCents: order.limitCents,
      pnl: 0,
      detail: order.action.toUpperCase() + " " + detail,
    });
    savePaperLedger();
    renderPaperBankroll();
    setPaperStatus("Paper limit resting: " + order.action.toUpperCase() + " " + order.contracts + " " + order.side.toUpperCase() + " @ " + formatCents(order.limitCents) + ".", false);
  }

  function fillPaperBuy(order, fillCents, detail, options) {
    options = options || {};
    const entryCents = clampNumber(Number(fillCents), 1, 99);
    const requestedContracts = Number.isFinite(Number(options.contracts)) ? Number(options.contracts) : Number(order.contracts || 0);
    const maxContracts = options.skipCashCheck
      ? Math.max(0, Math.floor(requestedContracts))
      : maxPaperContracts(state.paper.cash, entryCents);
    const contracts = Math.min(Math.floor(requestedContracts), maxContracts);
    if (contracts <= 0) {
      if (order.id) removePaperOrder(order.id);
      setPaperStatus("Paper buy could not fill: fake cash no longer covers it.", true);
      savePaperLedger();
      renderPaperBankroll();
      return null;
    }
    const scan = state.scan || {};
    const market = scan.market || {};
    const price = entryCents / 100;
    const entryFee = kalshiFeeDollars(contracts, price);
    const entryCost = contracts * price + entryFee;
    if (!options.skipCashCheck && state.simWallet.signedIn && !simWalletConnected()) {
      setPaperStatus("No paper buy: signed-in SIM wallet is still syncing.", true);
      savePaperLedger();
      renderPaperBankroll();
      return null;
    }
    if (!options.skipCashCheck && simWalletConnected() && !options.secureSim && !order.secureSim && !order.automation) {
      setPaperStatus("No account SIM buy: signed-in Bitcoin paper trades must use the secure server endpoint.", true);
      savePaperLedger();
      renderPaperBankroll();
      return null;
    }
    if (!options.skipCashCheck && simWalletConnected() && Number(state.simWallet.balance || 0) + 0.0001 < entryCost) {
      setPaperStatus("No paper buy: account SIM wallet has only " + paperMoney(state.simWallet.balance) + ".", true);
      savePaperLedger();
      renderPaperBankroll();
      return null;
    }
    const probability = Number(order.lastModelProbability || (state.executionPlan && state.executionPlan.expiry && state.executionPlan.expiry.probability));
    const orderEdge = Number(order.lastModelEdge);
    const edge = Number.isFinite(orderEdge) ? orderEdge : Number((state.executionPlan && state.executionPlan.side === order.side && state.executionPlan.expiry && state.executionPlan.expiry.edge) || 0);
    const position = {
      id: "paper-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      status: "open",
      ticker: order.ticker || scan.ticker || "KXBTC15M",
      side: order.side,
      contracts,
      entryCents,
      entryLimitCents: Number(order.limitCents),
      entryFee,
      entryCost,
      openedAt: new Date().toISOString(),
      automation: order.automation || "",
      closeTime: order.closeTime || market.closeTime || "",
      targetPrice: Number(order.targetPrice || market.targetPrice),
      entrySpot: Number(order.entrySpot || market.currentPrice),
      entryProbability: probability,
      entryEdge: edge,
      secureSim: Boolean(options.secureSim || order.secureSim),
      serverPositionId: options.serverPosition && options.serverPosition.id || order.serverPositionId || "",
      lastBidCents: Number(order.lastBidCents),
      lastAskCents: Number(order.lastAskCents || fillCents),
      lastSpot: Number(order.lastSpot || market.currentPrice),
      lastModelProbability: probability,
      lastMarkedAt: scan.generatedAt || new Date().toISOString(),
    };
    if (order.id) removePaperOrder(order.id);
    if (!options.skipCashDebit) {
      state.paper.cash -= entryCost;
    }
    state.paper.positions.unshift(position);
    addPaperHistory({
      type: "BUY",
      ticker: position.ticker,
      side: position.side,
      contracts,
      priceCents: entryCents,
      pnl: 0,
      detail: (detail || "Paper limit buy") + " / limit " + formatCents(position.entryLimitCents),
    });
    savePaperLedger();
    renderPaperBankroll();
    setPaperStatus("Paper bought " + contracts + " " + String(order.side).toUpperCase() + " @ " + formatCents(entryCents) + ".", false, "pos");
    if (!options.skipWalletSync) {
      syncSimWalletDelta(-entryCost, "buy", "Bitcoin 15-minute paper buy", {
        ticker: position.ticker,
        side: position.side,
        contracts,
        priceCents: entryCents,
        fee: entryFee,
        automation: position.automation || "",
      });
    }
    return position;
  }

  function fillPaperBuySecure(order, fillCents, detail) {
    if (!secureSimManualOrder(order)) {
      return fillPaperBuy(order, fillCents, detail);
    }
    order.status = "syncing";
    setPaperStatus("Secure SIM buy is being confirmed on the server.", false);
    savePaperLedger();
    renderPaperBankroll();
    return secureSimBitcoinRequest("buy", {
      ticker: order.ticker,
      side: order.side,
      contracts: order.contracts,
      limitCents: order.limitCents,
      expectedAskCents: fillCents,
    }).then(function (result) {
      order.status = "open";
      const position = fillPaperBuy(order, result.fill && result.fill.priceCents || fillCents, detail, {
        skipWalletSync: true,
        skipCashCheck: true,
        skipCashDebit: true,
        secureSim: true,
        serverPosition: result.position,
        contracts: result.position && result.position.contracts || order.contracts,
      });
      applySimWalletFromServer(result.wallet);
      setPaperStatus("Secure SIM bought " + (result.position && result.position.contracts || order.contracts) + " " + String(order.side).toUpperCase() + " @ " + formatCents(result.fill && result.fill.priceCents || fillCents) + ".", false, "pos");
      return position;
    }).catch(function (error) {
      order.status = "open";
      setPaperStatus("Secure SIM buy rejected: " + (error && error.message ? error.message : "server rejected the fill"), true);
      savePaperLedger();
      renderPaperBankroll();
      return null;
    });
  }

  function paperSellPosition(id) {
    const position = findPaperPosition(id);
    if (!position) return;
    const bidCents = Number(position.lastBidCents);
    if (!Number.isFinite(bidCents) || bidCents <= 0) {
      setPaperStatus("No paper sell: current bid is unavailable.", true);
      return;
    }
    if (position.secureSim && position.serverPositionId) {
      paperSellContractsSecure({
        id: "secure-sell-" + Date.now(),
        ticker: position.ticker,
        side: position.side,
        contracts: position.contracts,
        limitCents: bidCents,
        sourcePositionId: position.id,
        secureSim: true,
      }, bidCents, "Secure SIM bid-side exit before settlement");
      return;
    }
    paperSellContracts(position.ticker, position.side, position.contracts, bidCents, "Bid-side exit before settlement");
  }

  function paperSellContracts(ticker, side, requestedContracts, exitCents, detail, orderId, sourcePositionId, sourcePositionIds, sourceAutomation, options) {
    options = options || {};
    const priceCents = clampNumber(Number(exitCents), 1, 99);
    const price = priceCents / 100;
    let remaining = Math.floor(Number(requestedContracts || 0));
    let soldContracts = 0;
    let entryCost = 0;
    let automationSource = sourceAutomation || "";
    const sourceIdList = Array.isArray(sourcePositionIds) ? sourcePositionIds.filter(Boolean) : [];
    const positions = state.paper.positions
      .filter(function (position) {
        if (sourceIdList.length) return sourceIdList.includes(position.id) && position.ticker === ticker && position.side === side;
        if (sourceAutomation) return position.automation === sourceAutomation && position.ticker === ticker && position.side === side;
        if (sourcePositionId) return position.id === sourcePositionId && position.ticker === ticker && position.side === side;
        return position.ticker === ticker && position.side === side;
      })
      .sort(function (a, b) { return new Date(a.openedAt || 0).getTime() - new Date(b.openedAt || 0).getTime(); });
    if (orderId) removePaperOrder(orderId);
    positions.forEach(function (position) {
      if (remaining <= 0) return;
      const openContracts = Math.floor(Number(position.contracts || 0));
      const take = Math.min(openContracts, remaining);
      const ratio = openContracts > 0 ? take / openContracts : 0;
      const costSlice = Number(position.entryCost || 0) * ratio;
      entryCost += costSlice;
      soldContracts += take;
      if (!automationSource && position.automation) automationSource = position.automation;
      remaining -= take;
      if (take >= openContracts) {
        removePaperPosition(position.id);
      } else {
        position.contracts = openContracts - take;
        position.entryCost = Number(position.entryCost || 0) - costSlice;
        position.entryFee = Number(position.entryFee || 0) * (1 - ratio);
      }
    });
    if (soldContracts <= 0) {
      setPaperStatus("No paper sell: no matching open contracts.", true);
      savePaperLedger();
      renderPaperBankroll();
      return;
    }
    const exitFee = kalshiFeeDollars(soldContracts, price);
    const proceeds = soldContracts * price - exitFee;
    const pnl = proceeds - entryCost;
    state.paper.cash += proceeds;
    addPaperHistory({
      type: "SELL",
      ticker,
      side,
      contracts: soldContracts,
      priceCents,
      pnl,
      detail: detail || "Limit exit before settlement",
    });
    savePaperLedger();
    renderPaperBankroll();
    setPaperStatus("Paper sold " + soldContracts + " " + String(side).toUpperCase() + " @ " + formatCents(priceCents) + " for " + signedPaperMoney(pnl) + ".", pnl < 0, pnl >= 0 ? "pos" : "neg");
    if (!options.skipWalletSync && !automationSource) {
      syncSimWalletDelta(proceeds, "sell", "Bitcoin 15-minute paper sell", {
        ticker,
        side,
        contracts: soldContracts,
        priceCents,
        fee: exitFee,
        pnl,
        detail: detail || "",
      });
    }
  }

  function paperSellContractsSecure(order, bidCents, detail) {
    const sourcePosition = findPaperPosition(order.sourcePositionId);
    if (!sourcePosition || !sourcePosition.secureSim || !sourcePosition.serverPositionId) {
      setPaperStatus("No secure SIM sell: server-backed position was not found.", true);
      return Promise.resolve(null);
    }
    order.status = "syncing";
    setPaperStatus("Secure SIM sell is being confirmed on the server.", false);
    savePaperLedger();
    renderPaperBankroll();
    return secureSimBitcoinRequest("sell", {
      positionId: sourcePosition.serverPositionId,
      contracts: Math.min(order.contracts, sourcePosition.contracts),
      limitCents: order.limitCents || bidCents,
    }).then(function (result) {
      order.status = "open";
      paperSellContracts(
        sourcePosition.ticker,
        sourcePosition.side,
        result.fill && result.fill.contracts || order.contracts,
        result.fill && result.fill.priceCents || bidCents,
        detail,
        order.id,
        sourcePosition.id,
        "",
        "",
        { skipWalletSync: true },
      );
      applySimWalletFromServer(result.wallet);
      setPaperStatus("Secure SIM sold " + (result.fill && result.fill.contracts || order.contracts) + " " + String(sourcePosition.side).toUpperCase() + " @ " + formatCents(result.fill && result.fill.priceCents || bidCents) + ".", false, "pos");
      return result;
    }).catch(function (error) {
      order.status = "open";
      setPaperStatus("Secure SIM sell rejected: " + (error && error.message ? error.message : "server rejected the fill"), true);
      savePaperLedger();
      renderPaperBankroll();
      return null;
    });
  }

  function paperSettlePosition(id, options) {
    const position = findPaperPosition(id);
    if (!position) return;
    if ((!options || !options.skipSecure) && position.secureSim && position.serverPositionId) {
      if (position.settlementPending) return;
      position.settlementPending = true;
      paperSettlePositionSecure(id, options);
      return;
    }
    const spot = Number(position.lastSpot);
    const target = Number(position.targetPrice);
    if (!Number.isFinite(spot) || !Number.isFinite(target)) {
      if (!options || !options.silent) setPaperStatus("No paper settlement: final spot/target is unavailable.", true);
      return;
    }
    const wins = String(position.side).toLowerCase() === "yes" ? spot >= target : spot < target;
    const payout = wins ? Number(position.contracts || 0) : 0;
    const pnl = payout - Number(position.entryCost || 0);
    state.paper.cash += payout;
    removePaperPosition(id);
    addPaperHistory({
      type: wins ? "WIN" : "LOSS",
      ticker: position.ticker,
      side: position.side,
      contracts: position.contracts,
      priceCents: wins ? 100 : 0,
      pnl,
      detail: "Paper settlement using app spot " + dollars(spot) + " vs target " + dollars(target),
    });
    savePaperLedger();
    renderPaperBankroll();
    if (payout > 0 && !position.automation && (!options || !options.skipWalletSync)) {
      syncSimWalletDelta(payout, "settlement", "Bitcoin 15-minute paper settlement", {
        ticker: position.ticker,
        side: position.side,
        contracts: position.contracts,
        won: wins,
        finalSpot: spot,
        target,
      });
    }
    if (!options || !options.silent) {
      const legacyNote = state.simWallet.signedIn && !position.secureSim
        ? " Local-only legacy position: account SIM was not changed."
        : "";
      setPaperStatus("Paper settled " + position.ticker + " as " + (wins ? "win" : "loss") + " for " + signedPaperMoney(pnl) + "." + legacyNote, pnl < 0, pnl >= 0 ? "pos" : "neg");
    }
  }

  function paperSettlePositionSecure(id, options) {
    const position = findPaperPosition(id);
    if (!position || !position.serverPositionId) return Promise.resolve(null);
    setPaperStatus("Secure SIM settlement is being confirmed on the server.", false);
    state.simWallet.syncing = true;
    renderPaperBankroll();
    return secureSimBitcoinRequest("settle", {
      positionId: position.serverPositionId,
    }).then(function (result) {
      if (result.fill && Number.isFinite(Number(result.fill.finalSpot))) {
        position.lastSpot = Number(result.fill.finalSpot);
      }
      if (result.fill && Number.isFinite(Number(result.fill.targetPrice))) {
        position.targetPrice = Number(result.fill.targetPrice);
      }
      paperSettlePosition(id, {
        ...(options || {}),
        skipSecure: true,
        skipWalletSync: true,
      });
      applySimWalletFromServer(result.wallet);
      setPaperStatus("Secure SIM settled " + position.ticker + " as " + (result.fill && result.fill.won ? "win" : "loss") + ".", false, result.fill && result.fill.won ? "pos" : "neg");
      return result;
    }).catch(function (error) {
      position.settlementPending = false;
      state.simWallet.syncing = false;
      state.simWallet.error = error && error.message ? error.message : "Secure SIM settlement failed.";
      if (!options || !options.silent) {
        setPaperStatus("Secure SIM settlement failed: " + state.simWallet.error, true);
      }
      renderPaperBankroll();
      return null;
    });
  }

  function fillPaperSellTicket(id) {
    const position = findPaperPosition(id);
    if (!position) return;
    state.paperTicketPositionId = id;
    paperOrderActionInput.value = "sell";
    paperOrderSideInput.value = position.side || "yes";
    paperContractsInput.value = String(position.contracts || 1);
    const plan = state.executionPlan;
    const planSell = plan && plan.side === position.side && plan.exit ? Number(plan.exit.sellLimitCents) : NaN;
    paperLimitCentsInput.value = centsInputValue(Number.isFinite(planSell) ? planSell : position.lastBidCents);
    renderPaperTicket();
    setPaperStatus("Paper sell ticket loaded for " + String(position.side || "yes").toUpperCase() + ".", false);
  }

  function syncPaperBankrollToKelly() {
    const equity = paperEquity();
    strategyBankrollInput.value = String(Math.max(1, Math.round(equity)));
    saveStrategySettings();
    setPaperStatus("Kelly bankroll set to paper equity " + paperMoney(equity) + ".", false, "pos");
  }

  function resetPaperLedger() {
    const account = activePaperAccount();
    const name = account ? account.name : "active desk";
    const resetNote = state.simWallet.signedIn
      ? "Reset " + name + "'s open paper positions, pending limits, and local paper history? This will not reset your account SIM wallet."
      : "Reset " + name + "'s paper bankroll, open paper positions, pending limits, and local paper history?";
    if (!window.confirm(resetNote)) {
      return;
    }
    const startingBankroll = state.simWallet.signedIn
      ? Math.max(1, Number(state.simWallet.startingBalance || 1000))
      : Math.max(1, Number(paperStartingBankrollInput.value || 1000));
    state.paper = normalizePaperLedger({
      currency: "SIM",
      startingBankroll,
      cash: state.simWallet.signedIn && Number.isFinite(Number(state.simWallet.balance)) ? Number(state.simWallet.balance) : startingBankroll,
      orders: [],
      positions: [],
      history: [],
      layout: normalizePaperLayout(state.paper.layout),
    });
    state.paperAuto.fills = {};
    state.paperAuto.lastAttemptAt = {};
    savePaperLedger();
    persistPaperAutoSettings();
    syncPaperInputsFromActive();
    renderPaperAccounts();
    renderPaperBankroll();
    setPaperStatus(name + " reset.", false);
    updatePaperAutoStatus();
  }

  function restorePaperAutoSettings() {
    syncPaperInputsFromActive();
  }

  function savePaperAutoSettings() {
    state.paperAuto.completion = paperAutoCompletionInput.checked;
    state.paperAuto.scalp = paperAutoScalpInput.checked;
    state.paperAuto.research = paperAutoResearchInput.checked;
    state.paperAuto.simAccount = paperAutoSimAccountInput.checked;
    state.paperAuto.simBot = readPaperSimBotInputs();
    persistPaperAutoSettings();
    renderPaperAccounts();
    updatePaperAutoStatus();
  }

  function readPaperSimBotInputs() {
    return normalizePaperSimBotParams({
      contracts: paperSimBotContractsInput.value,
      minEdgePct: paperSimBotMinEdgeInput.value,
      maxAskCents: paperSimBotMaxAskInput.value,
      maxSpreadPct: paperSimBotMaxSpreadInput.value,
      maxFillsPerTicker: paperSimBotMaxFillsInput.value,
      cooldownSeconds: paperSimBotCooldownInput.value,
      maxExposure: paperSimBotMaxExposureInput.value,
      exitMode: paperSimBotExitModeInput.value,
      targetCents: paperSimBotTargetCentsInput.value,
    });
  }

  function persistPaperAutoSettings() {
    savePaperLedger();
  }

  function evaluateAllPaperAccounts(scan) {
    if (!state.paperAccounts.length) {
      markPaperLedger(scan);
      evaluatePaperAutomation(scan);
      return;
    }
    const activeId = state.activePaperAccountId;
    syncActivePaperAccount();
    state.paperAccounts.forEach(function (account) {
      withPaperAccount(account, { muted: true }, function () {
        markPaperLedger(scan);
        const result = evaluatePaperAutomation(scan);
        if (result) {
          account.lastAutomationMessage = result.message || "";
          account.lastAutomationTone = result.tone || "";
        }
      });
    });
    state.activePaperAccountId = activeId;
    bindActivePaperAccount();
    const active = activePaperAccount();
    if (active && active.lastAutomationMessage) {
      updatePaperAutoStatus(active.lastAutomationMessage, active.lastAutomationTone || "");
    } else {
      updatePaperAutoStatus();
    }
    savePaperLedger();
  }

  function withPaperAccount(account, options, callback) {
    const previousPaper = state.paper;
    const previousAuto = state.paperAuto;
    const previousId = state.activePaperAccountId;
    const previousMuted = state.paperUiMuted;
    state.paper = account.paper;
    state.paperAuto = account.auto;
    state.activePaperAccountId = account.id;
    state.paperUiMuted = Boolean(options && options.muted);
    try {
      return callback();
    } finally {
      account.paper = state.paper;
      account.auto = state.paperAuto;
      state.paper = previousPaper;
      state.paperAuto = previousAuto;
      state.activePaperAccountId = previousId;
      state.paperUiMuted = previousMuted;
    }
  }

  function evaluatePaperAutomation(scan) {
    if (!state.paperAuto.completion && !state.paperAuto.scalp && !state.paperAuto.research && !state.paperAuto.simAccount) {
      updatePaperAutoStatus();
      return { message: "", tone: "" };
    }
    const results = [];
    let researchExitFilled = false;
    if (state.paperAuto.simAccount) {
      const simExitResult = managePaperSimAccountBotExits(scan);
      if (simExitResult && simExitResult.message) results.push(simExitResult);
    }
    if (state.paperAuto.research) {
      const exitResult = managePaperResearchExits(scan);
      if (exitResult && exitResult.message) {
        results.push(exitResult);
        researchExitFilled = Boolean(exitResult.filled);
      }
    }
    if (state.paperAuto.completion || state.paperAuto.scalp) {
      results.push.apply(results, evaluateModelPaperBots(scan));
    }
    if (state.paperAuto.research && !researchExitFilled) {
      results.push(runPaperResearchStrategy(scan));
    }
    if (state.paperAuto.simAccount) {
      results.push(runPaperSimAccountBot(scan));
    }
    const visible = results.filter(function (item) { return item && item.message; });
    const filled = visible.some(function (item) { return item.filled; });
    const errored = visible.some(function (item) { return item.error; });
    const message = visible.map(function (item) { return item.message; }).join(" ");
    const tone = filled ? "pos" : (errored ? "neg" : "");
    updatePaperAutoStatus(message, tone);
    return { message, tone };
  }

  function evaluateModelPaperBots(scan) {
    const plan = state.executionPlan;
    const ticker = scan && scan.ticker ? scan.ticker : "";
    if (!ticker || !plan || !plan.candidate || !plan.entry || !plan.entry.ok || plan.actionClass !== "buy") {
      return [{ filled: false, message: "Completion/scalp bots: waiting for a green BUY signal from the model." }];
    }
    if (!plan.size || Number(plan.size.contracts) <= 0) {
      return [{ filled: false, message: "Completion/scalp bots: model is green, but the Kelly/risk size is currently 0." }];
    }
    const side = plan.side === "no" ? "no" : "yes";
    const quote = getCurrentPaperQuote(side);
    if (!quote || !Number.isFinite(Number(quote.askCents)) || Number(quote.askCents) <= 0) {
      return [{ filled: false, message: "Completion/scalp bots: waiting for a live " + side.toUpperCase() + " ask." }];
    }
    const limitCents = Number(plan.entry.limitCents);
    if (!Number.isFinite(limitCents) || Number(quote.askCents) > limitCents) {
      return [{ filled: false, message: "Completion/scalp bots: current ask " + formatCents(quote.askCents) + " is above the model limit " + formatCents(limitCents) + "." }];
    }

    const strategies = [];
    if (state.paperAuto.completion) strategies.push("completion");
    if (state.paperAuto.scalp) strategies.push("scalp");
    strategies.sort(function (left, right) {
      return paperAutoFillCount(left, ticker) - paperAutoFillCount(right, ticker);
    });
    const results = strategies.map(function (strategy) {
      return runPaperAutoStrategy(strategy, scan, plan, quote);
    });
    return results;
  }

  function runPaperAutoStrategy(strategy, scan, plan, quote) {
    const ticker = scan.ticker || "KXBTC15M";
    const side = plan.side === "no" ? "no" : "yes";
    const label = strategy === "scalp" ? "Scalp bot" : "Completion bot";
    const key = paperAutoKey(strategy, ticker);
    const fills = paperAutoFillCount(strategy, ticker);
    const nowMs = Date.now();
    const tickerKey = paperAutoKey("ticker", ticker);
    const lastTickerAttempt = Number(state.paperAuto.lastAttemptAt[tickerKey] || 0);
    if (lastTickerAttempt > 0 && nowMs - lastTickerAttempt < PAPER_AUTO_COOLDOWN_MS) {
      return { filled: false, message: label + ": shared cooldown " + formatDuration((PAPER_AUTO_COOLDOWN_MS - (nowMs - lastTickerAttempt)) / 1000) + " before another auto fill on this market." };
    }
    const lastAttempt = Number(state.paperAuto.lastAttemptAt[key] || 0);
    if (lastAttempt > 0 && nowMs - lastAttempt < PAPER_AUTO_COOLDOWN_MS) {
      return { filled: false, message: label + ": cooling down " + formatDuration((PAPER_AUTO_COOLDOWN_MS - (nowMs - lastAttempt)) / 1000) + " before another possible fill." };
    }
    const askCents = clampNumber(Number(quote.askCents), 1, 99);
    const limitCents = clampNumber(Number(plan.entry.limitCents), 1, 99);
    const availableContracts = maxPaperContracts(paperAvailableCash(), askCents);
    if (availableContracts < PAPER_AUTO_CONTRACTS) {
      return { filled: false, error: true, message: label + ": not enough free paper cash for 10 contracts at " + formatCents(askCents) + "." };
    }

    state.paperAuto.lastAttemptAt[key] = nowMs;
    state.paperAuto.lastAttemptAt[tickerKey] = nowMs;
    persistPaperAutoSettings();
    const order = {
      id: "paper-auto-" + strategy + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      status: "open",
      action: "buy",
      side,
      contracts: PAPER_AUTO_CONTRACTS,
      limitCents,
      ticker,
      createdAt: new Date().toISOString(),
      closeTime: scan.market && scan.market.closeTime || "",
      targetPrice: Number(scan.market && scan.market.targetPrice),
      entrySpot: Number(scan.market && scan.market.currentPrice),
      lastSpot: Number(scan.market && scan.market.currentPrice),
      lastBidCents: Number(quote.bidCents),
      lastAskCents: Number(quote.askCents),
      lastModelProbability: Number(quote.probability),
      lastModelEdge: Number(plan.expiry && plan.expiry.edge),
      automation: strategy,
    };
    const position = fillPaperBuy(order, askCents, label + " auto entry");
    if (!position) {
      return { filled: false, error: true, message: label + ": entry did not fill." };
    }

    state.paperAuto.fills[key] = fills + 1;
    persistPaperAutoSettings();

    if (strategy === "scalp") {
      const group = syncPaperScalpGroupExit(position.ticker, side);
      return { filled: true, message: label + ": bought 10 " + side.toUpperCase() + " @ " + formatCents(position.entryCents) + "; grouped target " + formatCents(group.limitCents) + " on " + group.contracts + " contracts from avg " + formatCents(group.averageCents) + " (buy #" + (fills + 1) + ")." };
    }

    return { filled: true, message: label + ": bought 10 " + side.toUpperCase() + " @ " + formatCents(position.entryCents) + " and will hold to settlement (buy #" + (fills + 1) + ")." };
  }

  function runPaperResearchStrategy(scan) {
    const signal = buildPaperResearchSignal(scan);
    if (!signal.ok) {
      return { filled: false, message: "Research fade bot: " + signal.reason };
    }
    const ticker = signal.ticker;
    const side = signal.side;
    const label = "Research fade bot";
    const key = paperAutoKey("research", ticker);
    const fills = paperAutoFillCount("research", ticker);
    if (fills >= PAPER_RESEARCH_MAX_FILLS_PER_TICKER) {
      return { filled: false, message: label + ": already used " + fills + " entry fills on this market; waiting for the next 15-minute ticker." };
    }
    const nowMs = Date.now();
    const tickerKey = paperAutoKey("ticker", ticker);
    const lastTickerAttempt = Number(state.paperAuto.lastAttemptAt[tickerKey] || 0);
    if (lastTickerAttempt > 0 && nowMs - lastTickerAttempt < PAPER_AUTO_COOLDOWN_MS) {
      return { filled: false, message: label + ": shared cooldown " + formatDuration((PAPER_AUTO_COOLDOWN_MS - (nowMs - lastTickerAttempt)) / 1000) + " before another auto fill on this market." };
    }
    const lastAttempt = Number(state.paperAuto.lastAttemptAt[key] || 0);
    if (lastAttempt > 0 && nowMs - lastAttempt < PAPER_AUTO_COOLDOWN_MS) {
      return { filled: false, message: label + ": cooling down " + formatDuration((PAPER_AUTO_COOLDOWN_MS - (nowMs - lastAttempt)) / 1000) + " before another possible fill." };
    }
    const availableContracts = maxPaperContracts(paperAvailableCash(), signal.askCents);
    if (availableContracts < PAPER_AUTO_CONTRACTS) {
      return { filled: false, error: true, message: label + ": not enough free paper cash for 10 contracts at " + formatCents(signal.askCents) + "." };
    }

    state.paperAuto.lastAttemptAt[key] = nowMs;
    state.paperAuto.lastAttemptAt[tickerKey] = nowMs;
    persistPaperAutoSettings();
    const market = scan.market || {};
    const order = {
      id: "paper-auto-research-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      status: "open",
      action: "buy",
      side,
      contracts: PAPER_AUTO_CONTRACTS,
      limitCents: signal.limitCents,
      ticker,
      createdAt: new Date().toISOString(),
      closeTime: market.closeTime || "",
      targetPrice: Number(market.targetPrice),
      entrySpot: Number(market.currentPrice),
      lastSpot: Number(market.currentPrice),
      lastBidCents: Number(signal.bidCents),
      lastAskCents: Number(signal.askCents),
      lastModelProbability: Number(signal.probability),
      lastModelEdge: Number(signal.edge),
      automation: "research",
    };
    const position = fillPaperBuy(order, signal.askCents, label + " auto entry: " + signal.summary);
    if (!position) {
      return { filled: false, error: true, message: label + ": entry did not fill." };
    }

    state.paperAuto.fills[key] = fills + 1;
    persistPaperAutoSettings();
    const group = syncPaperResearchGroupExit(position.ticker, side);
    return { filled: true, message: label + ": bought 10 " + side.toUpperCase() + " @ " + formatCents(position.entryCents) + "; grouped target " + formatCents(group.limitCents) + " on " + group.contracts + " contracts from avg " + formatCents(group.averageCents) + " (buy #" + (fills + 1) + ")." };
  }

  function runPaperSimAccountBot(scan) {
    const settings = normalizePaperSimBotParams(state.paperAuto.simBot || {});
    state.paperAuto.simBot = settings;
    const label = "Account SIM bot";
    if (!state.simWallet.signedIn) {
      return { filled: false, error: true, message: label + ": sign in first so the bot can use your account SIM wallet." };
    }
    if (!simWalletConnected()) {
      return { filled: false, error: true, message: label + ": waiting for the signed-in SIM wallet to sync." };
    }
    const signal = buildPaperSimBotSignal(scan, settings);
    if (!signal.ok) {
      return { filled: false, message: label + ": " + signal.reason };
    }

    const key = paperAutoKey("sim-account", signal.ticker);
    const pendingKey = paperAutoKey("sim-account-pending", signal.ticker);
    if (state.paperSimBotPending[pendingKey]) {
      return { filled: false, message: label + ": secure server fill is still pending for this market." };
    }
    const fills = paperAutoFillCount("sim-account", signal.ticker);
    if (fills >= settings.maxFillsPerTicker) {
      return { filled: false, message: label + ": already used " + fills + " fills on this market; waiting for the next 15-minute ticker." };
    }
    const nowMs = Date.now();
    const cooldownMs = settings.cooldownSeconds * 1000;
    const lastAttempt = Number(state.paperAuto.lastAttemptAt[key] || 0);
    if (lastAttempt > 0 && nowMs - lastAttempt < cooldownMs) {
      return { filled: false, message: label + ": cooling down " + formatDuration((cooldownMs - (nowMs - lastAttempt)) / 1000) + " before another account SIM fill." };
    }

    state.paperAuto.lastAttemptAt[key] = nowMs;
    state.paperSimBotPending[pendingKey] = true;
    persistPaperAutoSettings();
    const market = scan && scan.market || {};
    const order = {
      id: "paper-auto-sim-account-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      status: "open",
      action: "buy",
      side: signal.side,
      contracts: settings.contracts,
      limitCents: signal.limitCents,
      ticker: signal.ticker,
      createdAt: new Date().toISOString(),
      closeTime: market.closeTime || "",
      targetPrice: Number(market.targetPrice),
      entrySpot: Number(market.currentPrice),
      lastSpot: Number(market.currentPrice),
      lastBidCents: Number(signal.bidCents),
      lastAskCents: Number(signal.askCents),
      lastModelProbability: Number(signal.probability),
      lastModelEdge: Number(signal.edge),
      automation: "sim-account",
      secureSim: true,
      secureSimAutomation: true,
    };
    Promise.resolve(fillPaperBuySecure(order, signal.askCents, label + " auto entry: " + signal.summary)).then(function (position) {
      delete state.paperSimBotPending[pendingKey];
      if (position) {
        state.paperAuto.fills[key] = paperAutoFillCount("sim-account", signal.ticker) + 1;
        persistPaperAutoSettings();
        if (settings.exitMode === "scalp") {
          setPaperStatus(label + ": bought " + position.contracts + " " + signal.side.toUpperCase() + " @ " + formatCents(position.entryCents) + "; watching for +" + formatCents(settings.targetCents) + " scalp.", false, "pos");
        }
      }
      renderPaperBankroll();
    });
    return { filled: true, message: label + ": sent secure buy for " + settings.contracts + " " + signal.side.toUpperCase() + " @ limit " + formatCents(signal.limitCents) + " (" + signal.summary + ")." };
  }

  function buildPaperSimBotSignal(scan, settings) {
    const rows = Array.isArray(scan && scan.candidates) ? scan.candidates : [];
    const market = scan && scan.market || {};
    const model = scan && scan.model || {};
    const ticker = scan && scan.ticker || "";
    if (!ticker || !rows.length) return { ok: false, reason: "waiting for a live 15-minute market and quotes." };

    const secondsSinceOpen = paperSecondsSinceOpen(market);
    const secondsToAverageStart = paperSecondsToAverageStart(market, model);
    if (Number.isFinite(secondsSinceOpen) && secondsSinceOpen < settings.minSecondsSinceOpen) {
      return { ok: false, reason: "waiting until " + formatDuration(settings.minSecondsSinceOpen) + " after market open before using account SIM." };
    }
    if (Number.isFinite(secondsSinceOpen) && secondsSinceOpen > settings.maxSecondsSinceOpen) {
      return { ok: false, reason: "past the account SIM entry window for this ticker." };
    }
    if (Number.isFinite(secondsToAverageStart) && secondsToAverageStart < 45) {
      return { ok: false, reason: "too close to final averaging for a new account SIM entry." };
    }

    const minEdge = settings.minEdgePct / 100;
    const maxSpread = settings.maxSpreadPct / 100;
    const candidates = rows.map(function (row) {
      const side = row && row.side === "no" ? "no" : "yes";
      const askCents = Number(row && row.askCents);
      const bidCents = Number(row && row.bidCents);
      const probability = Number(row && row.probability);
      const fallbackEdge = Number.isFinite(probability) && Number.isFinite(askCents) ? probability - askCents / 100 : NaN;
      const edge = Number.isFinite(Number(row && row.edge)) ? Number(row.edge) : fallbackEdge;
      const spread = Number.isFinite(Number(row && row.spread)) ? Number(row.spread) : (askCents - bidCents) / 100;
      return { row, side, askCents, bidCents, probability, edge, spread };
    }).filter(function (candidate) {
      return Number.isFinite(candidate.askCents) && candidate.askCents > 0
        && Number.isFinite(candidate.bidCents) && candidate.bidCents > 0
        && Number.isFinite(candidate.probability)
        && Number.isFinite(candidate.edge);
    }).sort(function (left, right) {
      return right.edge - left.edge;
    });
    const candidate = candidates[0];
    if (!candidate) return { ok: false, reason: "waiting for a candidate with usable model odds, bid, and ask." };

    const maxEdgeEntryCents = maxEntryLimitCents(candidate.probability, minEdge);
    const blockers = [];
    if (candidate.edge < minEdge) blockers.push("best edge " + pct(candidate.edge) + " is below " + pct(minEdge));
    if (candidate.askCents > settings.maxAskCents) blockers.push("ask " + formatCents(candidate.askCents) + " is above max ask " + formatCents(settings.maxAskCents));
    if (candidate.askCents > maxEdgeEntryCents) blockers.push("ask " + formatCents(candidate.askCents) + " is above edge-safe price " + formatCents(maxEdgeEntryCents));
    if (candidate.spread > maxSpread) blockers.push("spread " + pct(candidate.spread) + " is wider than " + pct(maxSpread));
    const entryCost = settings.contracts * candidate.askCents / 100 + kalshiFeeDollars(settings.contracts, candidate.askCents / 100);
    if (Number(state.simWallet.balance || 0) + 0.0001 < entryCost) blockers.push("wallet has only " + paperMoney(state.simWallet.balance));
    const openRisk = paperSimAccountOpenRisk();
    if (openRisk + entryCost > settings.maxExposure + 0.0001) blockers.push("account SIM bot exposure would be " + paperMoney(openRisk + entryCost) + " above max " + paperMoney(settings.maxExposure));
    if (blockers.length) return { ok: false, reason: blockers.join("; ") + "." };

    const limitCents = clampNumber(Math.min(Math.ceil(candidate.askCents), settings.maxAskCents, maxEdgeEntryCents), 1, 99);
    return {
      ok: true,
      ticker,
      side: candidate.side,
      probability: candidate.probability,
      edge: candidate.edge,
      askCents: candidate.askCents,
      bidCents: candidate.bidCents,
      spread: candidate.spread,
      limitCents,
      summary: "model " + pct(candidate.probability) + " vs ask " + formatCents(candidate.askCents) + ", edge " + pct(candidate.edge) + ", spread " + pct(candidate.spread),
    };
  }

  function paperSimAccountOpenRisk() {
    return state.paper.positions.reduce(function (sum, position) {
      if (position.status !== "open" || position.automation !== "sim-account") return sum;
      return sum + Number(position.entryCost || 0);
    }, 0);
  }

  function buildPaperResearchSignal(scan) {
    const rows = Array.isArray(scan && scan.candidates) ? scan.candidates : [];
    const market = scan && scan.market || {};
    const model = scan && scan.model || {};
    const ticker = scan && scan.ticker || "";
    if (!ticker || !rows.length) return { ok: false, reason: "waiting for a live 15-minute market and quotes." };

    const secondsSinceOpen = paperSecondsSinceOpen(market);
    const secondsToAverageStart = paperSecondsToAverageStart(market, model);
    if (!Number.isFinite(secondsSinceOpen) || !Number.isFinite(secondsToAverageStart)) {
      return { ok: false, reason: "waiting for synchronized Kalshi market timing." };
    }
    if (secondsSinceOpen < PAPER_RESEARCH_MIN_SECONDS_SINCE_OPEN) {
      return { ok: false, reason: "letting the first " + formatDuration(PAPER_RESEARCH_MIN_SECONDS_SINCE_OPEN) + " settle; open noise is too high." };
    }
    if (secondsSinceOpen > PAPER_RESEARCH_MAX_SECONDS_SINCE_OPEN || secondsToAverageStart < PAPER_RESEARCH_MIN_SECONDS_TO_AVERAGE) {
      return { ok: false, reason: "too close to final averaging for a new mean-reversion entry." };
    }

    const side = paperResearchFadeSide(market, model);
    if (!side) {
      return { ok: false, reason: "waiting for at least " + formatSigma(PAPER_RESEARCH_MIN_ABS_Z) + " of stretch away from the target." };
    }
    const candidate = rows.find(function (row) { return row.side === side; });
    if (!candidate) return { ok: false, reason: "waiting for a live " + side.toUpperCase() + " quote." };

    const askCents = Number(candidate.askCents);
    const bidCents = Number(candidate.bidCents);
    const probability = Number(candidate.probability);
    const edge = Number(candidate.edge);
    const spread = Number.isFinite(Number(candidate.spread)) ? Number(candidate.spread) : (askCents - bidCents) / 100;
    const minEdge = Math.max(PAPER_RESEARCH_MIN_EDGE, Number(minEdgeInput.value || 0) / 100);
    const maxEdgeEntry = maxEntryLimitCents(probability, minEdge);
    const maxEntryCents = Math.min(PAPER_RESEARCH_MAX_ASK_CENTS, maxEdgeEntry);
    const limitCents = clampNumber(Math.min(Math.ceil(askCents), maxEntryCents), 1, 99);
    const blockers = [];
    if (!Number.isFinite(askCents) || askCents <= 0) blockers.push("ask is unavailable");
    if (!Number.isFinite(bidCents) || bidCents <= 0) blockers.push("bid is unavailable");
    if (!Number.isFinite(probability)) blockers.push("model probability is unavailable");
    if (!Number.isFinite(edge) || edge < minEdge) blockers.push("edge " + pct(edge) + " is below required " + pct(minEdge));
    if (Number.isFinite(askCents) && askCents > maxEntryCents) blockers.push("ask " + formatCents(askCents) + " is above max edge price " + formatCents(maxEntryCents));
    if (Number.isFinite(spread) && spread > PAPER_RESEARCH_MAX_SPREAD) blockers.push("spread " + pct(spread) + " is wider than " + pct(PAPER_RESEARCH_MAX_SPREAD));
    if (!Number.isFinite(spread)) blockers.push("spread is unavailable");

    const z = Number(model.z);
    const stretch = Number.isFinite(z) ? sideSigmaText(side, z) : "price stretch";
    return {
      ok: blockers.length === 0,
      reason: blockers.length ? blockers.join("; ") + "." : "",
      ticker,
      side,
      candidate,
      probability,
      edge,
      askCents,
      bidCents,
      spread,
      limitCents,
      maxEntryCents,
      summary: stretch + "; model " + pct(probability) + " vs edge floor " + pct(minEdge) + "; ask " + formatCents(askCents) + ", spread " + pct(spread),
    };
  }

  function paperResearchFadeSide(market, model) {
    const z = Number(model && model.z);
    if (Number.isFinite(z) && Math.abs(z) >= PAPER_RESEARCH_MIN_ABS_Z) {
      return z > 0 ? "yes" : "no";
    }
    const current = Number(market && market.currentPrice);
    const target = Number(market && market.targetPrice);
    if (!Number.isFinite(current) || !Number.isFinite(target)) return "";
    const distance = current - target;
    if (Math.abs(distance) < 25) return "";
    return distance < 0 ? "yes" : "no";
  }

  function paperSecondsSinceOpen(market) {
    const direct = Number(market && market.secondsSinceOpen);
    if (Number.isFinite(direct)) return direct;
    const openMs = new Date(market && market.openTime || 0).getTime();
    const nowMs = new Date(market && market.clockTime || Date.now()).getTime();
    return Number.isFinite(openMs) && openMs > 0 && Number.isFinite(nowMs) ? (nowMs - openMs) / 1000 : NaN;
  }

  function paperSecondsToAverageStart(market, model) {
    const direct = Number(model && model.secondsToAverageStart);
    if (Number.isFinite(direct)) return direct;
    const settleMs = new Date(market && market.settlementAveragingStart || 0).getTime();
    const nowMs = new Date(market && market.clockTime || Date.now()).getTime();
    return Number.isFinite(settleMs) && settleMs > 0 && Number.isFinite(nowMs) ? (settleMs - nowMs) / 1000 : NaN;
  }

  function managePaperSimAccountBotExits(scan) {
    const settings = normalizePaperSimBotParams(state.paperAuto.simBot || {});
    if (settings.exitMode !== "scalp") return null;
    if (!simWalletConnected()) return null;
    const ticker = scan && scan.ticker || "";
    const rows = Array.isArray(scan && scan.candidates) ? scan.candidates : [];
    if (!ticker || !rows.length) return null;
    const messages = [];
    state.paper.positions.slice().forEach(function (position) {
      if (position.status !== "open" || position.automation !== "sim-account" || !position.secureSim || !position.serverPositionId || position.ticker !== ticker) return;
      const candidate = rows.find(function (row) { return row.side === position.side; });
      const bidCents = Number(candidate && candidate.bidCents);
      if (!Number.isFinite(bidCents) || bidCents <= 0) return;
      const targetCents = clampNumber(Number(position.entryCents || 0) + settings.targetCents, 1, 99);
      if (bidCents < targetCents) return;
      const pendingKey = "sell:" + String(position.serverPositionId || position.id);
      if (state.paperSimBotPending[pendingKey]) return;
      state.paperSimBotPending[pendingKey] = true;
      paperSellContractsSecure({
        id: "paper-auto-sim-account-sell-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
        ticker: position.ticker,
        side: position.side,
        contracts: position.contracts,
        limitCents: targetCents,
        sourcePositionId: position.id,
        secureSim: true,
      }, bidCents, "Account SIM bot scalp exit: entry " + formatCents(position.entryCents) + " + target " + formatCents(settings.targetCents)).then(function () {
        delete state.paperSimBotPending[pendingKey];
        renderPaperBankroll();
      });
      messages.push("sent scalp exit for " + position.contracts + " " + String(position.side).toUpperCase() + " @ " + formatCents(targetCents));
    });
    return messages.length ? { filled: true, message: "Account SIM bot: " + messages.join("; ") + "." } : null;
  }

  function managePaperResearchExits(scan) {
    const ticker = scan && scan.ticker || "";
    if (!ticker) return null;
    const rows = Array.isArray(scan && scan.candidates) ? scan.candidates : [];
    const model = scan && scan.model || {};
    const market = scan && scan.market || {};
    const groups = {};
    state.paper.positions.forEach(function (position) {
      if (position.status === "open" && position.automation === "research" && position.ticker === ticker) {
        groups[String(position.side || "yes")] = true;
      }
    });
    const messages = [];
    Object.keys(groups).forEach(function (side) {
      const positions = paperAutoGroupPositions("research", ticker, side);
      const totals = paperAutoGroupTotals(positions);
      const candidate = rows.find(function (row) { return row.side === side; });
      if (!candidate || totals.contracts <= 0) return;
      const bidCents = Number(candidate.bidCents);
      const probability = Number(candidate.probability);
      const averagePrice = totals.averageCents / 100;
      const averageBreakEven = averagePrice + kalshiFeeDollars(1, averagePrice);
      const secondsToAverageStart = paperSecondsToAverageStart(market, model);
      const edgeExit = Number.isFinite(probability) && probability < averageBreakEven + PAPER_RESEARCH_DEFENSIVE_EDGE;
      const timeExit = Number.isFinite(secondsToAverageStart) && secondsToAverageStart <= PAPER_RESEARCH_EXIT_SECONDS_TO_AVERAGE && Number.isFinite(probability) && probability < 0.62;
      if (Number.isFinite(bidCents) && bidCents > 0 && (edgeExit || timeExit)) {
        const positionIds = positions.map(function (position) { return position.id; });
        removePaperAutomationGroupExitOrders("research", ticker, side);
        paperSellContracts(ticker, side, totals.contracts, bidCents, "Research fade bot defensive exit: " + (edgeExit ? "edge faded to " + pct(probability - averageBreakEven) : "final-average time risk") + " from avg " + formatCents(totals.averageCents), "", "", positionIds, "research");
        messages.push("Research fade bot: defensive sold " + totals.contracts + " " + side.toUpperCase() + " @ " + formatCents(bidCents) + ".");
      } else {
        syncPaperResearchGroupExit(ticker, side);
      }
    });
    return messages.length ? { filled: true, message: messages.join(" ") } : null;
  }

  function paperAutoKey(strategy, ticker) {
    return strategy + ":" + String(ticker || "KXBTC15M");
  }

  function paperAutoFillCount(strategy, ticker) {
    return Number(state.paperAuto.fills[paperAutoKey(strategy, ticker)] || 0);
  }

  function syncPaperScalpGroupExit(ticker, side) {
    return upsertPaperAutoGroupExit(ticker, side, {
      strategy: "scalp",
      automation: "scalp-group-exit",
      targetCents: PAPER_SCALP_TARGET_CENTS,
      label: "Scalp bot",
      recordHistory: true,
    });
  }

  function syncPaperResearchGroupExit(ticker, side) {
    return upsertPaperAutoGroupExit(ticker, side, {
      strategy: "research",
      automation: "research-group-exit",
      targetCents: PAPER_RESEARCH_TARGET_CENTS,
      label: "Research fade bot",
      recordHistory: true,
    });
  }

  function upsertPaperAutoGroupExit(ticker, side, options) {
    const settings = options || {};
    const strategy = settings.strategy || "scalp";
    const automation = settings.automation || strategy + "-group-exit";
    const label = settings.label || (strategy === "research" ? "Research fade bot" : "Scalp bot");
    const targetCents = Number.isFinite(Number(settings.targetCents)) ? Number(settings.targetCents) : PAPER_SCALP_TARGET_CENTS;
    const shouldSave = settings.save !== false;
    const shouldRender = settings.render !== false;
    const shouldRecordHistory = settings.recordHistory !== false;
    const positions = paperAutoGroupPositions(strategy, ticker, side);
    let changed = false;
    let existingGroupOrder = null;
    state.paper.orders = state.paper.orders.filter(function (order) {
      const isSameGroupExit = (order.automation === automation || (strategy === "scalp" && order.automation === "scalp-exit") || order.sourceAutomation === strategy)
        && order.ticker === ticker
        && order.side === side;
      if (!isSameGroupExit) return true;
      if (order.automation === automation && !existingGroupOrder) {
        existingGroupOrder = order;
        return true;
      }
      changed = true;
      return false;
    });
    const totals = paperAutoGroupTotals(positions);
    if (totals.contracts <= 0) {
      if (existingGroupOrder) {
        removePaperOrder(existingGroupOrder.id);
        changed = true;
      }
      if (changed && shouldSave) savePaperLedger();
      if (changed && shouldRender) renderPaperBankroll();
      return { contracts: 0, averageCents: NaN, limitCents: NaN, changed };
    }
    const scan = state.scan || {};
    const market = scan.market || {};
    const quote = scan.ticker === ticker ? getCurrentPaperQuote(side) : null;
    const lastPosition = positions[0] || {};
    const bidCents = Number(quote && quote.bidCents);
    const askCents = Number(quote && quote.askCents);
    const exitCents = clampNumber(totals.averageCents + targetCents, 1, 99);
    const positionIds = positions.map(function (position) { return position.id; });
    if (Number.isFinite(bidCents) && bidCents >= exitCents) {
      paperSellContracts(ticker, side, totals.contracts, bidCents, label + " grouped +" + formatCents(targetCents) + " target filled from avg " + formatCents(totals.averageCents), existingGroupOrder && existingGroupOrder.id, "", positionIds, strategy);
      return { contracts: totals.contracts, averageCents: totals.averageCents, limitCents: exitCents, changed: true };
    }
    const order = existingGroupOrder || {
      id: "paper-auto-" + strategy + "-group-exit-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      status: "open",
      action: "sell",
      side,
      ticker,
      createdAt: new Date().toISOString(),
      automation,
      sourceAutomation: strategy,
    };
    const previousSnapshot = JSON.stringify({
      contracts: order.contracts,
      limitCents: order.limitCents,
      sourcePositionIds: order.sourcePositionIds,
      groupAverageCents: order.groupAverageCents,
    });
    order.contracts = totals.contracts;
    order.limitCents = exitCents;
    order.closeTime = market.closeTime || lastPosition.closeTime || "";
    order.targetPrice = Number(market.targetPrice || lastPosition.targetPrice);
    order.entrySpot = Number(lastPosition.entrySpot || market.currentPrice);
    order.lastSpot = Number(market.currentPrice || lastPosition.lastSpot);
    order.lastBidCents = Number.isFinite(bidCents) ? bidCents : Number(lastPosition.lastBidCents);
    order.lastAskCents = Number.isFinite(askCents) ? askCents : Number(lastPosition.lastAskCents);
    order.lastModelProbability = Number(quote && quote.probability || lastPosition.lastModelProbability);
    order.sourcePositionIds = positionIds;
    order.groupAverageCents = totals.averageCents;
    if (!existingGroupOrder) {
      state.paper.orders.unshift(order);
      changed = true;
      if (shouldRecordHistory) {
        addPaperHistory({
          type: "LIMIT",
          ticker: order.ticker,
          side: order.side,
          contracts: order.contracts,
          priceCents: order.limitCents,
          pnl: 0,
          detail: "SELL " + label + " group target: avg " + formatCents(totals.averageCents) + " + " + formatCents(targetCents) + " across " + totals.contracts + " contracts",
        });
      }
    } else {
      const nextSnapshot = JSON.stringify({
        contracts: order.contracts,
        limitCents: order.limitCents,
        sourcePositionIds: order.sourcePositionIds,
        groupAverageCents: order.groupAverageCents,
      });
      changed = changed || previousSnapshot !== nextSnapshot;
    }
    if (changed && shouldSave) savePaperLedger();
    if (changed && shouldRender) renderPaperBankroll();
    if (!existingGroupOrder && shouldRender) {
      setPaperStatus("Paper limit resting: SELL " + order.contracts + " " + side.toUpperCase() + " @ " + formatCents(order.limitCents) + ".", false);
    }
    return { contracts: totals.contracts, averageCents: totals.averageCents, limitCents: exitCents, changed };
  }

  function paperAutoGroupPositions(strategy, ticker, side) {
    return state.paper.positions.filter(function (position) {
      return position.status === "open" && position.automation === strategy && position.ticker === ticker && position.side === side;
    }).sort(function (left, right) {
      return new Date(left.openedAt || 0).getTime() - new Date(right.openedAt || 0).getTime();
    });
  }

  function paperAutoGroupTotals(positions) {
    const totals = positions.reduce(function (acc, position) {
      const contracts = Math.max(0, Math.floor(Number(position.contracts || 0)));
      acc.contracts += contracts;
      acc.cents += contracts * Number(position.entryCents || 0);
      return acc;
    }, { contracts: 0, cents: 0 });
    return {
      contracts: totals.contracts,
      averageCents: totals.contracts > 0 ? totals.cents / totals.contracts : NaN,
    };
  }

  function removePaperAutomationGroupExitOrders(strategy, ticker, side) {
    let removed = false;
    state.paper.orders = state.paper.orders.filter(function (order) {
      const match = order.action === "sell"
        && order.ticker === ticker
        && order.side === side
        && (order.sourceAutomation === strategy || order.automation === strategy + "-group-exit");
      if (!match) return true;
      removed = true;
      return false;
    });
    return removed;
  }

  function updatePaperAutoStatus(message, tone) {
    if (!paperAutoStatusEl) return;
    if (state.paperUiMuted) return;
    const active = [];
    if (state.paperAuto.completion) active.push("completion");
    if (state.paperAuto.scalp) active.push("scalp");
    if (state.paperAuto.research) active.push("research fade");
    if (state.paperAuto.simAccount) active.push("account SIM");
    paperAutoStatusEl.textContent = message || (active.length ? "Paper bots armed: " + active.join(" + ") + ". Local bots use sandbox paper; account SIM uses the secure signed-in wallet and adjustable filters." : "Paper bots are off.");
    paperAutoStatusEl.className = "paper-auto-status " + (tone || "");
  }

  function cleanupPaperSellOrders() {
    let changed = false;
    const groupsToSync = {};
    state.paper.orders.slice().forEach(function (order) {
      if (order.status !== "open" || order.action !== "sell") return;
      const groupStrategy = paperGroupExitStrategy(order);
      const groupKey = String(groupStrategy || "") + "|" + String(order.ticker || "") + "|" + String(order.side || "");
      if (order.sourcePositionId && !findPaperPosition(order.sourcePositionId)) {
        removePaperOrder(order.id);
        changed = true;
        if (groupStrategy) groupsToSync[groupKey] = { strategy: groupStrategy, ticker: order.ticker, side: order.side };
        return;
      }
      if (Array.isArray(order.sourcePositionIds) && order.sourcePositionIds.length) {
        const liveIds = order.sourcePositionIds.filter(function (id) {
          return findPaperPosition(id);
        });
        if (!liveIds.length) {
          removePaperOrder(order.id);
          changed = true;
          if (groupStrategy) groupsToSync[groupKey] = { strategy: groupStrategy, ticker: order.ticker, side: order.side };
          return;
        }
        if (liveIds.length !== order.sourcePositionIds.length) {
          order.sourcePositionIds = liveIds;
          changed = true;
          if (groupStrategy) groupsToSync[groupKey] = { strategy: groupStrategy, ticker: order.ticker, side: order.side };
        }
      }
      if (groupStrategy) {
        groupsToSync[groupKey] = { strategy: groupStrategy, ticker: order.ticker, side: order.side };
      }
    });
    if (state.paperAuto.scalp || state.paperAuto.research) {
      state.paper.positions.forEach(function (position) {
        const strategy = position.automation;
        if (position.status === "open" && (strategy === "scalp" || strategy === "research") && state.paperAuto[strategy]) {
          groupsToSync[String(strategy || "") + "|" + String(position.ticker || "") + "|" + String(position.side || "")] = {
            strategy,
            ticker: position.ticker,
            side: position.side,
          };
        }
      });
    }
    Object.keys(groupsToSync).forEach(function (key) {
      const group = groupsToSync[key];
      if (!group.strategy || !group.ticker || !group.side) return;
      const result = upsertPaperAutoGroupExit(group.ticker, group.side, {
        strategy: group.strategy,
        automation: group.strategy + "-group-exit",
        targetCents: group.strategy === "research" ? PAPER_RESEARCH_TARGET_CENTS : PAPER_SCALP_TARGET_CENTS,
        label: group.strategy === "research" ? "Research fade bot" : "Scalp bot",
        recordHistory: false,
        save: false,
        render: false,
      });
      changed = changed || Boolean(result && result.changed);
    });
    return changed;
  }

  function paperGroupExitStrategy(order) {
    if (order.sourceAutomation === "research" || order.automation === "research-group-exit") return "research";
    if (order.sourceAutomation === "scalp" || order.automation === "scalp-group-exit" || order.automation === "scalp-exit") return "scalp";
    return "";
  }

  function markPaperLedger(scan) {
    const market = scan.market || {};
    const ticker = scan.ticker || "";
    const candidates = Array.isArray(scan.candidates) ? scan.candidates : [];
    const clockMs = new Date(market.clockTime || scan.generatedAt || Date.now()).getTime();
    let changed = false;
    state.paper.positions.slice().forEach(function (position) {
      if (position.status !== "open") return;
      if (ticker && position.ticker === ticker) {
        const candidate = candidates.find(function (row) { return row.side === position.side; });
        if (candidate) {
          position.lastBidCents = Number(candidate.bidCents);
          position.lastAskCents = Number(candidate.askCents);
          position.lastModelProbability = Number(candidate.probability);
          position.lastModelEdge = Number(candidate.edge);
        }
        position.lastSpot = Number(market.currentPrice);
        position.targetPrice = Number(market.targetPrice);
        position.closeTime = market.closeTime || position.closeTime;
        position.lastMarkedAt = scan.generatedAt || new Date().toISOString();
        changed = true;
      }
      const closeMs = new Date(position.closeTime || 0).getTime();
      if (Number.isFinite(closeMs) && closeMs > 0 && Number.isFinite(clockMs) && clockMs >= closeMs && Number.isFinite(Number(position.lastSpot))) {
        paperSettlePosition(position.id, { silent: true });
        changed = true;
      }
    });
    changed = cleanupPaperSellOrders() || changed;
    state.paper.orders.slice().forEach(function (order) {
      if (order.status !== "open" || !ticker || order.ticker !== ticker) return;
      const candidate = candidates.find(function (row) { return row.side === order.side; });
      if (candidate) {
        order.lastBidCents = Number(candidate.bidCents);
        order.lastAskCents = Number(candidate.askCents);
        order.lastModelProbability = Number(candidate.probability);
        order.lastModelEdge = Number(candidate.edge);
      }
      order.lastSpot = Number(market.currentPrice);
      order.targetPrice = Number(market.targetPrice);
      order.closeTime = market.closeTime || order.closeTime;
      order.lastMarkedAt = scan.generatedAt || new Date().toISOString();
      changed = true;
      if (order.status === "syncing") return;
      if (order.action === "buy" && Number(order.lastAskCents) <= Number(order.limitCents)) {
        if (simWalletConnected() && !order.automation) {
          order.secureSim = true;
        }
        if (order.secureSim) {
          fillPaperBuySecure(order, Number(order.lastAskCents), "Resting secure SIM limit buy filled");
        } else {
          fillPaperBuy(order, Number(order.lastAskCents), "Resting limit buy filled");
        }
      } else if (order.action === "sell" && Number(order.lastBidCents) >= Number(order.limitCents)) {
        if (order.secureSim) {
          paperSellContractsSecure(order, Number(order.lastBidCents), "Resting secure SIM limit sell filled");
        } else {
          paperSellContracts(order.ticker, order.side, order.contracts, Number(order.lastBidCents), "Resting limit sell filled", order.id, order.sourcePositionId, order.sourcePositionIds, order.sourceAutomation);
        }
      }
    });
    if (changed) savePaperLedger();
  }

  function renderPaperBankroll() {
    if (!paperHeadlineEl || !paperSummaryEl || !paperPositionsEl || !paperOrdersEl || !paperHistoryEl) return;
    if (state.paperUiMuted) return;
    const openValue = paperOpenValue();
    const reserved = paperReservedCash();
    const buyOrderCount = state.paper.orders.filter(function (order) { return order.action === "buy"; }).length;
    const equity = Number(state.paper.cash || 0) + openValue;
    const pnl = equity - Number(state.paper.startingBankroll || 0);
    const openRisk = state.paper.positions.reduce(function (sum, position) {
      return sum + Number(position.entryCost || 0);
    }, 0);
    const openContracts = paperOpenContractsTotal();
    const openAvg = paperOpenAverageCents();
    const openMarkPnl = openValue - openRisk;
    const walletValue = state.simWallet.signedIn
      ? (Number.isFinite(Number(state.simWallet.balance)) ? paperMoney(state.simWallet.balance) : (state.simWallet.syncing ? "Syncing" : "Unavailable"))
      : paperMoney(state.paper.cash);
    const walletDetail = state.simWallet.signedIn
      ? (state.simWallet.error ? state.simWallet.error : "Account wallet shared across SIM games")
      : "Local browser wallet until you sign in";
    paperHeadlineEl.innerHTML = [
      paperHeadlineCard(state.simWallet.signedIn ? "SIM wallet" : "Local SIM wallet", walletValue, walletDetail, state.simWallet.error ? "neg" : "primary"),
      paperHeadlineCard("Paper equity", paperMoney(equity), "SIM cash plus current open bid mark"),
      paperHeadlineCard("Cash available", paperMoney(paperAvailableCash()), "Cash " + paperMoney(state.paper.cash) + " / reserved " + paperMoney(reserved)),
      paperHeadlineCard("Contracts held", formatWholeNumber(openContracts), state.paper.positions.length + " open position" + (state.paper.positions.length === 1 ? "" : "s")),
      paperHeadlineCard("Avg paid", formatCents(openAvg), "Weighted average on open contracts"),
      paperHeadlineCard("Open P/L", signedPaperMoney(openMarkPnl), "Marked at bid after estimated exit fees", openMarkPnl >= 0 ? "pos" : "neg"),
    ].join("");
    paperSummaryEl.innerHTML = [
      paperMetric("Cash", paperMoney(state.paper.cash), paperMoney(paperAvailableCash()) + " free after limits"),
      paperMetric("Reserved", paperMoney(reserved), buyOrderCount + " buy limit" + (buyOrderCount === 1 ? "" : "s")),
      paperMetric("Open mark", paperMoney(openValue), "Bid-side value after estimated exit fees"),
      paperMetric("Equity", paperMoney(equity), "Cash plus open mark", pnl >= 0 ? "pos" : "neg"),
      paperMetric("Total P/L", signedPaperMoney(pnl), "Versus starting paper bankroll", pnl >= 0 ? "pos" : "neg"),
      paperMetric("Open avg", formatCents(paperOpenAverageCents()), "Weighted average entry on open contracts"),
      paperMetric("Avg bought", formatCents(paperAverageBuyCents()), "Weighted average of every paper buy"),
      paperMetric("Open risk", paperMoney(openRisk), state.paper.positions.length + " open position" + (state.paper.positions.length === 1 ? "" : "s")),
    ].join("");

    if (!state.paper.positions.length) {
      paperPositionsEl.innerHTML = '<tr><td colspan="7" class="subtext">No open paper positions. Place a paper limit when the execution plan is green.</td></tr>';
    } else {
      paperPositionsEl.innerHTML = state.paper.positions.map(renderPaperPositionRow).join("");
    }
    renderPaperTicket();
    renderPaperOrders();
    renderPaperHistory();
    renderPaperAccounts();
  }

  function renderPaperPositionRow(position) {
    const mark = paperPositionMark(position);
    const pnlClass = mark.pnl >= 0 ? "pos" : "neg";
    const closeMs = new Date(position.closeTime || 0).getTime();
    const canSettle = Number.isFinite(closeMs) && Date.now() >= closeMs && Number.isFinite(Number(position.lastSpot));
    return [
      "<tr>",
      "<td><strong>" + escapeHtml(position.ticker || "KXBTC15M") + '</strong><br><span class="subtext">Close ' + escapeHtml(formatTime(position.closeTime)) + "</span></td>",
      '<td><span class="side-pill ' + escapeHtml(position.side) + '">' + escapeHtml(String(position.side || "").toUpperCase()) + "</span></td>",
      "<td>" + escapeHtml(String(position.contracts || 0)) + '<br><span class="subtext">cost ' + escapeHtml(paperMoney(position.entryCost)) + "</span></td>",
      "<td>" + escapeHtml(formatCents(position.entryCents)) + '<br><span class="subtext">' + escapeHtml(paperAutomationEntryLabel(position) + " " + formatCents(position.entryLimitCents || position.entryCents)) + "</span></td>",
      "<td>" + escapeHtml(formatCents(position.lastBidCents)) + '<br><span class="subtext">spot ' + escapeHtml(dollars(position.lastSpot)) + "</span></td>",
      '<td class="' + pnlClass + '">' + escapeHtml(signedPaperMoney(mark.pnl)) + '<br><span class="subtext">' + escapeHtml(paperMoney(mark.value)) + " value</span></td>",
      '<td><button class="mini-button" type="button" data-paper-action="sell" data-paper-id="' + escapeHtml(position.id) + '">Sell @ Bid</button> <button class="mini-button ghost-button" type="button" data-paper-action="ticket" data-paper-id="' + escapeHtml(position.id) + '">Limit</button> <button class="mini-button ghost-button" type="button" data-paper-action="settle" data-paper-id="' + escapeHtml(position.id) + '"' + (canSettle ? "" : " disabled") + ">Settle</button></td>",
      "</tr>",
    ].join("");
  }

  function renderPaperOrders() {
    if (!state.paper.orders.length) {
      paperOrdersEl.innerHTML = '<h3>Pending paper limits</h3><p class="subtext">No resting paper limit orders.</p>';
      return;
    }
    paperOrdersEl.innerHTML = [
      "<h3>Pending paper limits</h3>",
      '<div class="paper-order-list">',
      state.paper.orders.map(function (order) {
        const quote = order.action === "buy" ? "ask " + formatCents(order.lastAskCents) : "bid " + formatCents(order.lastBidCents);
        const condition = order.action === "buy" ? "fills at ask <= " : "fills at bid >= ";
        const groupStrategy = paperGroupExitStrategy(order);
        const groupDetail = groupStrategy
          ? " / grouped " + paperStrategyLabel(groupStrategy).toLowerCase() + " avg " + formatCents(order.groupAverageCents) + " + " + formatCents(groupStrategy === "research" ? PAPER_RESEARCH_TARGET_CENTS : PAPER_SCALP_TARGET_CENTS)
          : "";
        return [
          '<div class="paper-order-item">',
          "<div><strong>" + escapeHtml(order.action.toUpperCase() + " " + String(order.side || "").toUpperCase() + " " + order.contracts + " @ " + formatCents(order.limitCents)) + "</strong>",
          '<small class="subtext">' + escapeHtml((order.ticker || "KXBTC15M") + " / " + condition + formatCents(order.limitCents) + groupDetail + " / " + quote + " / " + formatTime(order.createdAt)) + "</small></div>",
          '<button class="mini-button ghost-button" type="button" data-paper-order-action="cancel" data-paper-order-id="' + escapeHtml(order.id) + '">Cancel</button>',
          "</div>",
        ].join("");
      }).join(""),
      "</div>",
    ].join("");
  }

  function renderPaperHistory() {
    if (!state.paper.history.length) {
      paperHistoryEl.innerHTML = '<h3>Recent paper trades</h3><p class="subtext">No paper trades yet.</p>';
      return;
    }
    paperHistoryEl.innerHTML = [
      "<h3>Recent paper trades</h3>",
      '<div class="paper-history-list">',
      state.paper.history.slice(0, 18).map(function (entry) {
        const pnl = Number(entry.pnl || 0);
        return [
          '<div class="paper-history-item">',
          "<div><strong>" + escapeHtml(entry.type + " " + String(entry.side || "").toUpperCase() + " " + entry.contracts + " @ " + formatCents(entry.priceCents)) + "</strong>",
          '<br><small>' + escapeHtml((entry.ticker || "KXBTC15M") + " / " + (entry.detail || "")) + "</small></div>",
          '<small class="' + (pnl >= 0 ? "pos" : "neg") + '">' + escapeHtml(signedPaperMoney(pnl)) + "<br>" + escapeHtml(formatTime(entry.time)) + "</small>",
          "</div>",
        ].join("");
      }).join(""),
      "</div>",
    ].join("");
  }

  function paperAutomationEntryLabel(position) {
    if (position.automation === "scalp") return "scalp avg group";
    if (position.automation === "research") return "research fade avg";
    if (position.automation === "sim-account") return "account SIM bot";
    return "limit";
  }

  function paperStrategyLabel(strategy) {
    if (strategy === "research") return "Research fade";
    if (strategy === "scalp") return "Scalp";
    if (strategy === "completion") return "Completion";
    if (strategy === "sim-account") return "Account SIM";
    return "Paper";
  }

  function paperMetric(label, value, detail, className) {
    return '<div class="paper-metric ' + escapeHtml(className || "") + '"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong><small>" + escapeHtml(detail || "") + "</small></div>";
  }

  function paperHeadlineCard(label, value, detail, className) {
    return '<div class="paper-headline-card ' + escapeHtml(className || "") + '"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong><small>" + escapeHtml(detail || "") + "</small></div>";
  }

  function paperPositionMark(position) {
    const bidCents = Number(position.lastBidCents);
    if (!Number.isFinite(bidCents) || bidCents <= 0) {
      return { value: 0, pnl: -Number(position.entryCost || 0) };
    }
    const price = bidCents / 100;
    const value = Math.max(0, Number(position.contracts || 0) * price - kalshiFeeDollars(position.contracts, price));
    return { value, pnl: value - Number(position.entryCost || 0) };
  }

  function paperOpenValue() {
    return state.paper.positions.reduce(function (sum, position) {
      return sum + paperPositionMark(position).value;
    }, 0);
  }

  function paperEquity() {
    return Number(state.paper.cash || 0) + paperOpenValue();
  }

  function paperReservedCash() {
    return state.paper.orders.reduce(function (sum, order) {
      if (order.action !== "buy") return sum;
      const price = clampNumber(order.limitCents, 1, 99) / 100;
      return sum + Number(order.contracts || 0) * price + kalshiFeeDollars(order.contracts, price);
    }, 0);
  }

  function paperAvailableCash() {
    return Math.max(0, Number(state.paper.cash || 0) - paperReservedCash());
  }

  function paperOpenAverageCents() {
    const totals = state.paper.positions.reduce(function (acc, position) {
      const contracts = Number(position.contracts || 0);
      acc.contracts += contracts;
      acc.cents += contracts * Number(position.entryCents || 0);
      return acc;
    }, { contracts: 0, cents: 0 });
    return totals.contracts > 0 ? totals.cents / totals.contracts : NaN;
  }

  function paperAverageBuyCents() {
    const totals = state.paper.history.reduce(function (acc, entry) {
      if (entry.type !== "BUY") return acc;
      const contracts = Number(entry.contracts || 0);
      acc.contracts += contracts;
      acc.cents += contracts * Number(entry.priceCents || 0);
      return acc;
    }, { contracts: 0, cents: 0 });
    return totals.contracts > 0 ? totals.cents / totals.contracts : NaN;
  }

  function paperOpenContractsTotal() {
    return state.paper.positions.reduce(function (sum, position) {
      return sum + Number(position.contracts || 0);
    }, 0);
  }

  function paperAvailableContractsForSell(ticker, side) {
    const open = paperOpenContracts(ticker, side);
    const reserved = state.paper.orders.reduce(function (sum, order) {
      return sum + (order.action === "sell" && order.ticker === ticker && order.side === side ? Number(order.contracts || 0) : 0);
    }, 0);
    return Math.max(0, open - reserved);
  }

  function paperOpenContracts(ticker, side) {
    return state.paper.positions.reduce(function (sum, position) {
      return sum + (position.ticker === ticker && position.side === side ? Number(position.contracts || 0) : 0);
    }, 0);
  }

  function maxPaperContracts(cash, entryCents) {
    const price = clampNumber(entryCents, 1, 99) / 100;
    let contracts = Math.floor(Number(cash || 0) / price);
    contracts = Math.min(1000, Math.max(0, contracts));
    while (contracts > 0) {
      const cost = contracts * price + kalshiFeeDollars(contracts, price);
      if (cost <= Number(cash || 0) + 0.00001) return contracts;
      contracts -= 1;
    }
    return 0;
  }

  function getCurrentPaperQuote(side) {
    const scan = state.scan || {};
    const rows = Array.isArray(scan.candidates) ? scan.candidates : [];
    const row = rows.find(function (candidate) { return candidate.side === side; });
    if (!row) return null;
    return {
      side,
      askCents: Number(row.askCents),
      bidCents: Number(row.bidCents),
      probability: Number(row.probability),
    };
  }

  function findPaperPosition(id) {
    return state.paper.positions.find(function (position) { return position.id === id; });
  }

  function removePaperPosition(id) {
    state.paper.positions = state.paper.positions.filter(function (position) { return position.id !== id; });
  }

  function removePaperOrder(id) {
    state.paper.orders = state.paper.orders.filter(function (order) { return order.id !== id; });
  }

  function cancelPaperOrder(id) {
    const order = state.paper.orders.find(function (item) { return item.id === id; });
    if (!order) return;
    removePaperOrder(id);
    addPaperHistory({
      type: "CANCEL",
      ticker: order.ticker,
      side: order.side,
      contracts: order.contracts,
      priceCents: order.limitCents,
      pnl: 0,
      detail: order.action.toUpperCase() + " paper limit canceled",
    });
    savePaperLedger();
    renderPaperBankroll();
    setPaperStatus("Paper limit canceled.", false);
  }

  function addPaperHistory(entry) {
    state.paper.history.unshift({
      ...entry,
      time: new Date().toISOString(),
    });
    state.paper.history = state.paper.history.slice(0, 100);
  }

  function setPaperStatus(message, error, tone) {
    if (state.paperUiMuted) return;
    paperStatusEl.textContent = message;
    paperStatusEl.className = error ? "neg" : (tone || "");
  }

  function cleanPaperCurrency(value) {
    return String(value || "SIM").replace(/[^a-z0-9_$.-]/gi, "").toUpperCase().slice(0, 12) || "SIM";
  }

  function centsInputValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : "";
  }

  function paperMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + state.paper.currency;
  }

  function paperMoneyFor(paper, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + cleanPaperCurrency(paper && paper.currency || "SIM");
  }

  function signedPaperMoney(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : number < 0 ? "-" : "";
    return sign + paperMoney(Math.abs(number));
  }

  function signedPaperMoneyFor(paper, value) {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : number < 0 ? "-" : "";
    return sign + paperMoneyFor(paper, Math.abs(number));
  }

  function normalizePaperLayout(layout) {
    const saved = layout || {};
    return {
      floating: saved.floating === true,
      x: Number.isFinite(Number(saved.x)) ? Number(saved.x) : null,
      y: Number.isFinite(Number(saved.y)) ? Number(saved.y) : null,
    };
  }

  function floatPaperPanel() {
    const rect = paperPanelEl.getBoundingClientRect();
    state.paper.layout.floating = true;
    state.paper.layout.x = Number.isFinite(Number(state.paper.layout.x)) ? Number(state.paper.layout.x) : Math.max(12, window.innerWidth - Math.min(720, rect.width || 720) - 22);
    state.paper.layout.y = Number.isFinite(Number(state.paper.layout.y)) ? Number(state.paper.layout.y) : 86;
    applyPaperLayout();
    savePaperLedger();
  }

  function dockPaperPanel() {
    state.paper.layout.floating = false;
    applyPaperLayout();
    savePaperLedger();
  }

  function applyPaperLayout() {
    paperPanelEl.classList.toggle("paper-floating", state.paper.layout.floating === true);
    if (!state.paper.layout.floating) {
      paperPanelEl.style.left = "";
      paperPanelEl.style.top = "";
      paperPanelEl.style.right = "";
      return;
    }
    const coords = boundedPaperCoords(state.paper.layout.x, state.paper.layout.y);
    state.paper.layout.x = coords.x;
    state.paper.layout.y = coords.y;
    paperPanelEl.style.left = coords.x + "px";
    paperPanelEl.style.top = coords.y + "px";
    paperPanelEl.style.right = "auto";
  }

  function beginPaperDrag(event) {
    if (!state.paper.layout.floating || !event.target.closest(".paper-drag-handle")) return;
    if (event.target.closest("button,input,select,a")) return;
    const rect = paperPanelEl.getBoundingClientRect();
    state.paperDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
    };
    paperPanelEl.setPointerCapture(event.pointerId);
  }

  function movePaperPanel(event) {
    if (!state.paperDrag || state.paperDrag.pointerId !== event.pointerId) return;
    const next = boundedPaperCoords(
      state.paperDrag.originX + event.clientX - state.paperDrag.startX,
      state.paperDrag.originY + event.clientY - state.paperDrag.startY
    );
    state.paper.layout.x = next.x;
    state.paper.layout.y = next.y;
    paperPanelEl.style.left = next.x + "px";
    paperPanelEl.style.top = next.y + "px";
  }

  function endPaperDrag(event) {
    if (!state.paperDrag || state.paperDrag.pointerId !== event.pointerId) return;
    state.paperDrag = null;
    savePaperLedger();
  }

  function boundedPaperCoords(x, y) {
    const rect = paperPanelEl.getBoundingClientRect();
    const width = Math.min(rect.width || 720, window.innerWidth - 24);
    const height = Math.min(rect.height || 520, window.innerHeight - 24);
    return {
      x: clampNumber(Number(x), 12, Math.max(12, window.innerWidth - width - 12)),
      y: clampNumber(Number(y), 12, Math.max(12, window.innerHeight - Math.min(height, 220) - 12)),
    };
  }

  function restoreAutoSettings() {
    const saved = JSON.parse(localStorage.getItem("kalshiBtcAutoPilot") || "{}");
    autoEnableInput.checked = saved.enabled === true;
    autoModeInput.value = saved.mode === "dry" ? "dry" : "confirm";
    autoMinEdgeInput.value = saved.minEdge || "8";
    autoFirstMinutesInput.value = saved.firstMinutes || "10";
    autoMaxCostInput.value = saved.maxCost || "1.25";
    updateAutoStatus(autoEnableInput.checked ? "Watcher armed for the next fresh market." : "Watcher is off.");
  }

  function saveAutoSettings() {
    localStorage.setItem("kalshiBtcAutoPilot", JSON.stringify({
      enabled: autoEnableInput.checked,
      mode: autoModeInput.value,
      minEdge: autoMinEdgeInput.value,
      firstMinutes: autoFirstMinutesInput.value,
      maxCost: autoMaxCostInput.value,
    }));
    if (!autoEnableInput.checked) {
      updateAutoStatus("Watcher is off.");
    } else {
      updateAutoStatus("Watcher armed for the next fresh market.");
    }
  }

  function evaluateAutoPilot(scan) {
    if (!autoEnableInput.checked || state.auto.running) return;
    const market = scan.market || {};
    const ticker = scan.ticker || "";
    const best = scan.best || {};
    if (!ticker || state.auto.lastTicker === ticker) return;
    const nowMs = Date.now();
    if (state.auto.lastAttemptTicker === ticker && nowMs - state.auto.lastAttemptAt < 15000) return;

    const secondsSinceOpen = Number(market.secondsSinceOpen);
    const firstWindowSeconds = Math.max(60, Number(autoFirstMinutesInput.value || 10) * 60);
    if (!Number.isFinite(secondsSinceOpen) || secondsSinceOpen < 0) return;
    if (secondsSinceOpen > firstWindowSeconds) {
      updateAutoStatus("Waiting for the next market; current one is past the entry window.");
      return;
    }

    const minEdge = Number(autoMinEdgeInput.value || 8) / 100;
    if (!Number.isFinite(Number(best.edge)) || Number(best.edge) < minEdge) {
      updateAutoStatus("Watching " + ticker + "; best edge " + pct(best.edge) + " is below " + pct(minEdge) + ".");
      return;
    }

    state.auto.running = true;
    state.auto.lastAttemptTicker = ticker;
    state.auto.lastAttemptAt = nowMs;
    runAutoPilotTicket(ticker, minEdge).finally(function () {
      state.auto.running = false;
    });
  }

  async function runAutoPilotTicket(ticker, minEdge) {
    const payload = {
      side: "",
      minEdge,
      maxCost: Number(autoMaxCostInput.value || 1.25),
      maxContracts: 1,
      minutes: 180,
    };
    try {
      const data = await requestTicketPreview(payload);
      if (!data.ok) {
        addAutoLog("Blocked " + ticker, (data.blockers || []).join(" / ") || "Ticket did not pass guardrails.", true);
        updateAutoStatus("Auto Pilot blocked this attempt; it will retry while the market is still fresh.");
        return;
      }
      state.auto.lastTicker = ticker;
      const ticket = data.ticket || {};
      const summary = String(ticket.side || "").toUpperCase()
        + " 1 @ " + formatCents(ticket.limitPriceCents)
        + " / edge " + pct(ticket.edge)
        + " / expiry " + pct(ticket.modelProbability);
      if (autoModeInput.value === "dry") {
        addAutoLog("Dry run " + ticker, summary + ". No order sent.", false);
        updateAutoStatus("Dry run logged for " + ticker + ".");
        return;
      }
      state.tradeTicket = data;
      if (state.tradeTicket.ticket) state.tradeTicket.ticket.requiredMinEdge = minEdge;
      renderTradeTicket(data);
      addAutoLog("Prepared " + ticker, summary + ". Final Buy is ready.", false);
      setTicketStatus("Auto Pilot prepared a one-contract ticket. Final Buy still needs your click.");
      updateAutoStatus("Prepared one-contract ticket for " + ticker + ".");
    } catch (error) {
      addAutoLog("Auto Pilot error", error.message || "Unable to prepare ticket.", true);
      updateAutoStatus("Auto Pilot hit an error while preparing the ticket.");
    }
  }

  function updateAutoStatus(message) {
    if (autoStatusEl) autoStatusEl.textContent = message;
  }

  function addAutoLog(title, detail, error) {
    const entry = {
      title,
      detail,
      error: Boolean(error),
      time: new Date().toISOString(),
    };
    state.auto.log.unshift(entry);
    state.auto.log = state.auto.log.slice(0, 18);
    renderAutoLog();
  }

  function renderAutoLog() {
    autoLogEl.innerHTML = state.auto.log.map(function (entry) {
      return [
        '<div class="auto-entry">',
        '<strong class="' + (entry.error ? "neg" : "pos") + '">' + escapeHtml(entry.title) + "</strong>",
        "<small>" + escapeHtml(formatTime(entry.time) + " / " + entry.detail) + "</small>",
        "</div>",
      ].join("");
    }).join("");
  }

  function startClockTicker() {
    if (state.clockTimer) return;
    state.clockTimer = setInterval(updateMarketClock, 250);
  }

  function syncMarketClock(scan) {
    const market = scan.market || {};
    const openMs = new Date(market.openTime || 0).getTime();
    const closeMs = new Date(market.closeTime || 0).getTime();
    const settlementStartMs = new Date(market.settlementAveragingStart || 0).getTime();
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || openMs <= 0 || closeMs <= openMs) {
      state.marketClock = null;
      updateMarketClock();
      return;
    }
    state.marketClock = {
      ticker: scan.ticker || "KXBTC15M",
      openMs,
      closeMs,
      settlementStartMs: Number.isFinite(settlementStartMs) && settlementStartMs > openMs ? settlementStartMs : closeMs - 60_000,
      generatedAtMs: new Date(market.clockTime || (scan.clock && scan.clock.clockTime) || scan.generatedAt || Date.now()).getTime(),
      clientReceivedAtMs: Date.now(),
      clockSource: market.clockSource || (scan.clock && scan.clock.clockSource) || "server clock",
      localClockOffsetMs: Number(market.localClockOffsetMs || 0),
      websocketClockAgeMs: Number(market.websocketClockAgeMs || (scan.clock && scan.clock.websocketClockAgeMs) || 0),
    };
    updateMarketClock();
  }

  function updateMarketClock() {
    if (!marketCountdownEl || !state.marketClock) {
      if (marketCountdownEl) marketCountdownEl.textContent = "--:--";
      if (marketPhaseEl) marketPhaseEl.textContent = "Waiting for active market";
      if (marketProgressEl) marketProgressEl.style.width = "0%";
      if (settlementProgressEl) settlementProgressEl.style.width = "0%";
      return;
    }
    const clock = state.marketClock;
    const generatedAtMs = Number(clock.generatedAtMs);
    const clientReceivedAtMs = Number(clock.clientReceivedAtMs);
    const now = Number.isFinite(generatedAtMs) && Number.isFinite(clientReceivedAtMs)
      ? generatedAtMs + (Date.now() - clientReceivedAtMs)
      : Date.now();
    const durationMs = Math.max(1, clock.closeMs - clock.openMs);
    const remainingSeconds = Math.max(0, Math.ceil((clock.closeMs - now) / 1000));
    const elapsedPct = clampNumber(((now - clock.openMs) / durationMs) * 100, 0, 100);
    const settlementPct = clampNumber(((clock.closeMs - clock.settlementStartMs) / durationMs) * 100, 0, 100);
    const settlementSeconds = Math.max(0, Math.ceil((clock.settlementStartMs - now) / 1000));
    const inSettlementAverage = now >= clock.settlementStartMs && now <= clock.closeMs;
    const beforeOpen = now < clock.openMs;

    marketCountdownEl.textContent = formatDuration(remainingSeconds);
    marketProgressEl.style.width = elapsedPct.toFixed(2) + "%";
    settlementProgressEl.style.width = settlementPct.toFixed(2) + "%";
    marketOpenLabelEl.textContent = "Open " + formatTime(clock.openMs);
    marketSettlementLabelEl.textContent = "Final avg " + formatTime(clock.settlementStartMs);
    marketCloseLabelEl.textContent = "Close " + formatTime(clock.closeMs);

    if (beforeOpen) {
      marketPhaseEl.textContent = "Market opens in " + formatDuration((clock.openMs - now) / 1000);
    } else if (remainingSeconds <= 0) {
      marketPhaseEl.textContent = "Closed; waiting for next 15m market";
    } else if (inSettlementAverage) {
      marketPhaseEl.textContent = "Final 60-second averaging window";
    } else {
      marketPhaseEl.textContent = "Trading window; final average begins in " + formatDuration(settlementSeconds);
    }

    eventWindowEl.textContent = remainingSeconds > 0
      ? "Closes " + formatTime(clock.closeMs) + " / " + formatDuration(remainingSeconds) + " left"
      : "Closed; waiting for next market";
    marketClockNoteEl.textContent = "Odds horizon right now: " + formatDuration(remainingSeconds) + ". Clock source: " + clock.clockSource + ". Offset vs browser: " + Math.round(clock.localClockOffsetMs || 0) + "ms. WS age: " + Math.round(clock.websocketClockAgeMs || 0) + "ms.";
  }

  function renderChart(scan) {
    const chart = scan.chart || {};
    const source = scan.source || {};
    const allPoints = Array.isArray(chart.points) ? chart.points : [];
    const openTime = new Date(chart.openTime || 0).getTime();
    const closeTime = new Date(chart.closeTime || 0).getTime();
    const latestRaw = allPoints[allPoints.length - 1] || null;
    const windowStart = Number.isFinite(openTime) && openTime > 0 ? openTime - 120_000 : Date.now() - 20 * 60_000;
    const windowEnd = Number.isFinite(closeTime) && closeTime > 0 ? closeTime + 20_000 : Date.now() + 30_000;
    let points = allPoints.filter(function (point) {
      return Number(point.timeMs) >= windowStart && Number(point.timeMs) <= windowEnd;
    });
    if (points.length < 3) points = allPoints.slice(-30);
    if (!points.length) {
      state.chartMeta = null;
      chartStage.innerHTML = '<p class="subtext">No BTC chart data yet.</p>';
      return;
    }
    const width = 1120;
    const height = 470;
    const pad = { left: 84, right: 164, top: 34, bottom: 48 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const values = points.flatMap(function (point) { return [point.low, point.high, point.close]; })
      .concat([chart.targetPrice, chart.currentPrice])
      .map(Number)
      .filter(Number.isFinite);
    const minValue = Math.min.apply(null, values);
    const maxValue = Math.max.apply(null, values);
    const span = Math.max(8, maxValue - minValue);
    const yStep = span <= 18 ? 2 : span <= 45 ? 5 : span <= 90 ? 10 : 25;
    const yMin = Math.floor((minValue - Math.max(4, span * 0.18)) / yStep) * yStep;
    const yMax = Math.ceil((maxValue + Math.max(4, span * 0.18)) / yStep) * yStep;
    const minTime = Math.min(windowStart, points[0].timeMs);
    const maxTime = Math.max(windowEnd, points[points.length - 1].timeMs);
    const xForTime = function (timeMs) {
      return pad.left + ((Number(timeMs) - minTime) / Math.max(1, maxTime - minTime)) * innerWidth;
    };
    const yForPrice = function (price) {
      return pad.top + (1 - ((Number(price) - yMin) / Math.max(1, yMax - yMin))) * innerHeight;
    };
    const path = points.map(function (point, index) {
      return (index ? "L" : "M") + xForTime(point.timeMs).toFixed(2) + " " + yForPrice(point.close).toFixed(2);
    }).join(" ");
    const ticks = [];
    for (let value = Math.ceil(yMin / yStep) * yStep; value <= yMax + 0.1; value += yStep) ticks.push(value);
    const xTicks = [];
    for (let time = Math.ceil(minTime / 60_000) * 60_000; time <= maxTime + 1; time += 3 * 60_000) {
      xTicks.push({ time: new Date(time).toISOString(), timeMs: time });
    }
    const targetY = yForPrice(chart.targetPrice);
    const latest = latestRaw || points[points.length - 1];
    const settleStart = new Date(chart.settlementAveragingStart || 0).getTime();
    const settleX = xForTime(settleStart);
    const closeX = xForTime(closeTime);
    const latestX = xForTime(latest.timeMs);
    const latestY = yForPrice(latest.close);
    const previousPoint = points.length > 1 ? points[points.length - 2] : latest;
    const previousX = xForTime(previousPoint.timeMs);
    const previousY = yForPrice(previousPoint.close);
    const planeAngle = Number.isFinite(previousX) && Number.isFinite(previousY)
      ? Math.atan2(latestY - previousY, latestX - previousX) * 180 / Math.PI
      : 0;
    const currentLabelY = clampNumber(latestY, pad.top + 24, height - pad.bottom - 10);
    const targetLabelY = clampNumber(targetY, pad.top + 44, height - pad.bottom - 28);
    const aboveTarget = Number(chart.currentPrice) >= Number(chart.targetPrice);
    const spotLabel = source.tickerAuthoritative ? "Kalshi BRTI spot" : "Live BTC proxy";
    const plan = state.executionPlan;
    const winZone = Number.isFinite(targetY) && plan
      ? plan.side === "yes"
        ? '<rect class="win-zone yes-zone" x="' + pad.left + '" y="' + pad.top + '" width="' + innerWidth + '" height="' + Math.max(0, targetY - pad.top) + '"></rect>'
        : '<rect class="win-zone no-zone" x="' + pad.left + '" y="' + targetY + '" width="' + innerWidth + '" height="' + Math.max(0, (height - pad.bottom) - targetY) + '"></rect>'
      : "";
    const entryStartX = plan ? xForTime(plan.timing.openMs) : NaN;
    const entryEndX = plan ? xForTime(plan.timing.entryEndMs) : NaN;
    const nowX = plan ? xForTime(plan.timing.nowMs) : NaN;
    const entryBand = plan && Number.isFinite(entryStartX) && Number.isFinite(entryEndX)
      ? '<rect class="entry-band" x="' + entryStartX + '" y="' + pad.top + '" width="' + Math.max(1, entryEndX - entryStartX) + '" height="' + innerHeight + '"></rect><text class="line-label entry-label" x="' + (entryStartX + 8) + '" y="' + (height - pad.bottom - 12) + '">entry window</text>'
      : "";
    const nowLine = plan && Number.isFinite(nowX)
      ? '<line class="now-line" x1="' + nowX + '" x2="' + nowX + '" y1="' + pad.top + '" y2="' + (height - pad.bottom) + '"></line><text class="line-label now-label" x="' + (nowX + 6) + '" y="' + (pad.top + 60) + '">now</text>'
      : "";
    const decisionCard = plan ? [
      '<div class="chart-decision-card ' + escapeHtml(plan.actionClass) + '">',
      "<span>" + escapeHtml(plan.actionLabel) + "</span>",
      "<strong>Entry " + escapeHtml(formatCents(plan.entry.limitCents)) + " max " + escapeHtml(formatCents(plan.entry.maxEntryCents)) + "</strong>",
      "<small>Expiry " + escapeHtml(pct(plan.expiry.probability)) + " / " + escapeHtml(plan.expiry.sigmaLabel) + " / sell " + escapeHtml(formatCents(plan.exit.sellLimitCents)) + "</small>",
      "</div>",
      '<div class="chart-hover-card" hidden></div>',
    ].join("") : '<div class="chart-hover-card" hidden></div>';
    chartStage.innerHTML = [
      '<div class="live-price-card">',
      "<span>" + escapeHtml(spotLabel) + "</span>",
      "<strong>" + escapeHtml(dollars(chart.currentPrice)) + "</strong>",
      '<small class="' + (aboveTarget ? "pos" : "neg") + '">' + escapeHtml((aboveTarget ? "above " : "below ") + signedDollars(Number(chart.currentPrice) - Number(chart.targetPrice)) + " vs target") + "</small>",
      "</div>",
      decisionCard,
      '<svg class="chart-svg" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Bitcoin price chart">',
      '<rect class="chart-bg" x="0" y="0" width="' + width + '" height="' + height + '"></rect>',
      winZone,
      Number.isFinite(settleX) && Number.isFinite(closeX) ? '<rect class="settle-band" x="' + settleX + '" y="' + pad.top + '" width="' + Math.max(2, closeX - settleX) + '" height="' + innerHeight + '"></rect>' : "",
      Number.isFinite(openTime) ? '<rect class="open-band" x="' + xForTime(openTime) + '" y="' + pad.top + '" width="' + Math.max(2, xForTime(closeTime) - xForTime(openTime)) + '" height="' + innerHeight + '"></rect>' : "",
      entryBand,
      ticks.map(function (value) {
        const y = yForPrice(value);
        return '<line class="grid major" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + y + '" y2="' + y + '"></line><text class="axis-label axis-left" x="' + (pad.left - 10) + '" y="' + (y + 4) + '" text-anchor="end">$' + formatNumber(value, 0) + '</text><text class="axis-label axis-right" x="' + (width - pad.right + 10) + '" y="' + (y + 4) + '">$' + formatNumber(value, 0) + "</text>";
      }).join(""),
      xTicks.map(function (point) {
        const x = xForTime(point.timeMs);
        return '<line class="grid" x1="' + x + '" x2="' + x + '" y1="' + pad.top + '" y2="' + (height - pad.bottom) + '"></line><text class="axis-label" x="' + x + '" y="' + (height - 12) + '">' + formatTime(point.time) + "</text>";
      }).join(""),
      '<line class="target-line" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + targetY + '" y2="' + targetY + '"></line>',
      '<rect class="price-label-bg target-bg" x="' + (width - pad.right + 8) + '" y="' + (targetLabelY - 17) + '" width="138" height="25" rx="7"></rect>',
      '<text class="line-label target-label" x="' + (width - pad.right + 18) + '" y="' + targetLabelY + '">Target ' + dollars(chart.targetPrice) + "</text>",
      '<path class="price-line" d="' + path + '"></path>',
      '<line class="current-line" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + latestY + '" y2="' + latestY + '"></line>',
      '<g class="current-plane" transform="translate(' + latestX + " " + latestY + ') rotate(' + planeAngle.toFixed(2) + ')"><path class="plane-shadow" d="M14 0 L-12 -8 L-6 0 L-12 8 Z"></path><path class="plane-body" d="M14 0 L-12 -8 L-6 0 L-12 8 Z"></path><path class="plane-wing" d="M-6 0 L-12 -8 L-2 -2 Z"></path></g>',
      '<rect class="price-label-bg current-bg" x="' + (width - pad.right + 8) + '" y="' + (currentLabelY - 17) + '" width="142" height="25" rx="7"></rect>',
      '<text class="line-label current-label" x="' + (width - pad.right + 18) + '" y="' + currentLabelY + '">' + dollars(latest.close) + "</text>",
      '<text class="last-price-tag" x="' + Math.min(width - pad.right - 172, latestX + 10) + '" y="' + (latestY - 12) + '">' + dollars(latest.close) + "</text>",
      '<text class="line-label" x="' + (pad.left + 8) + '" y="' + (pad.top + 16) + '">' + escapeHtml(chart.source || "BTC proxy") + "</text>",
      Number.isFinite(settleX) ? '<text class="line-label settle-label" x="' + Math.max(pad.left + 8, settleX + 6) + '" y="' + (pad.top + 38) + '">final 60s average</text>' : "",
      nowLine,
      "</svg>",
    ].join("");
    state.chartMeta = {
      points,
      width,
      height,
      pad,
      innerWidth,
      innerHeight,
      minTime,
      maxTime,
      targetPrice: Number(chart.targetPrice),
      openMs: openTime,
      entryEndMs: plan && plan.timing.entryEndMs,
      settleStartMs: settleStart,
      closeMs: closeTime,
      side: plan && plan.side,
    };
  }

  function handleChartHover(event) {
    const meta = state.chartMeta;
    const hover = chartStage.querySelector(".chart-hover-card");
    const svg = chartStage.querySelector(".chart-svg");
    if (!meta || !hover || !svg) return;
    const rect = svg.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      hideChartHover();
      return;
    }
    const viewX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * meta.width;
    const timeMs = meta.minTime + ((viewX - meta.pad.left) / Math.max(1, meta.innerWidth)) * (meta.maxTime - meta.minTime);
    const nearest = meta.points.reduce(function (best, point) {
      return Math.abs(Number(point.timeMs) - timeMs) < Math.abs(Number(best.timeMs) - timeMs) ? point : best;
    }, meta.points[0]);
    const price = Number(nearest.close);
    const zone = price >= meta.targetPrice ? "YES zone" : "NO zone";
    const timing = Number(nearest.timeMs) <= Number(meta.entryEndMs)
      ? "entry window"
      : Number(nearest.timeMs) >= Number(meta.settleStartMs)
        ? "final average"
        : "late window";
    const stageRect = chartStage.getBoundingClientRect();
    const maxLeft = Math.max(10, chartStage.clientWidth - 238);
    const maxTop = Math.max(10, chartStage.clientHeight - 118);
    hover.hidden = false;
    hover.style.left = Math.min(maxLeft, Math.max(10, event.clientX - stageRect.left + 14)) + "px";
    hover.style.top = Math.min(maxTop, Math.max(10, event.clientY - stageRect.top + 14)) + "px";
    hover.innerHTML = [
      "<strong>" + escapeHtml(formatTime(nearest.timeMs) + " / " + dollars(price)) + "</strong>",
      "<span>" + escapeHtml(zone + " / " + timing) + "</span>",
      "<small>" + escapeHtml("Distance " + signedDollars(price - meta.targetPrice) + " vs target") + "</small>",
    ].join("");
  }

  function hideChartHover() {
    const hover = chartStage.querySelector(".chart-hover-card");
    if (hover) hover.hidden = true;
  }

  function renderReasons(scan) {
    const model = scan.model || {};
    const reasons = Array.isArray(model.reasons) ? model.reasons : [];
    modelReasonsEl.innerHTML = [
      model.caveat ? "<p><strong>Data caveat:</strong> " + escapeHtml(model.caveat) + "</p>" : "",
      renderKalshiSpotMode(scan),
      renderQuoteMode(scan),
      "<p><strong>Expiry odds engine:</strong> calibrated YES " + escapeHtml(pct(model.yesProbability)) + ", raw final-average path YES " + escapeHtml(pct(model.rawYesProbability)) + ", Kalshi prior " + escapeHtml(pct(model.marketPriorYes)) + ", shrink " + escapeHtml(pct(model.calibrationWeight)) + ". These are settlement odds, independent of stop-loss or cash-out settings.</p>",
      "<p><strong>Sigma/time adjustment:</strong> YES z-score " + escapeHtml(formatSigma(model.z)) + "; " + escapeHtml(sideSigmaText("yes", model.z)) + ". Effective variance horizon " + escapeHtml(formatDuration(model.effectiveVarianceSeconds)) + " with " + escapeHtml(formatDuration(model.secondsToAverageStart)) + " until the final average starts.</p>",
      "<p><strong>Time model:</strong> " + escapeHtml(formatDuration(model.horizonSeconds)) + " to close, " + escapeHtml(formatDuration(model.secondsToAverageStart)) + " until the final average starts, effective variance horizon " + escapeHtml(formatDuration(model.effectiveVarianceSeconds)) + ".</p>",
      "<p><strong>Vol inputs:</strong> 5m " + escapeHtml(tinyPct(model.sigma5)) + ", 15m " + escapeHtml(tinyPct(model.sigma15)) + ", 60m " + escapeHtml(tinyPct(model.sigma60)) + ", EWMA " + escapeHtml(tinyPct(model.sigmaEwma)) + ", range " + escapeHtml(tinyPct(model.sigmaRange)) + " per minute.</p>",
      renderTickerComponents(scan),
      reasons.map(function (reason) { return "<p>" + escapeHtml(reason) + "</p>"; }).join(""),
    ].join("");
  }

  function renderTickerComponents(scan) {
    const source = scan.source || {};
    const components = Array.isArray(source.tickerComponents) ? source.tickerComponents : [];
    const referenceComponents = Array.isArray(source.compositeReferenceComponents) ? source.compositeReferenceComponents : [];
    const liveLabel = source.tickerAuthoritative ? "Live Kalshi spot" : "Live ticker blend";
    const livePart = components.length ? "<p><strong>" + liveLabel + ":</strong> " + components.map(function (item) {
      return escapeHtml(item.venue + " " + dollars(item.price));
    }).join(" / ") + ". Range " + escapeHtml(dollars(source.tickerDispersionDollars || 0)) + ".</p>" : "";
    const referencePart = referenceComponents.length ? "<p><strong>Exchange proxy cross-check:</strong> " + referenceComponents.map(function (item) {
      return escapeHtml(item.venue + " " + dollars(item.price));
    }).join(" / ") + ". Range " + escapeHtml(dollars(source.compositeReferenceRange || 0)) + ".</p>" : "";
    return livePart + referencePart;
  }

  function renderKalshiSpotMode(scan) {
    const source = scan.source || {};
    if (!source.tickerMode) return "";
    const label = source.tickerAuthoritative ? "Kalshi spot mode" : "Proxy mode";
    const cfError = source.tickerCfError ? " CF request note: " + source.tickerCfError : "";
    return "<p><strong>" + escapeHtml(label) + ":</strong> " + escapeHtml(source.tickerMode + cfError) + "</p>";
  }

  function renderQuoteMode(scan) {
    const market = scan.market || {};
    const source = scan.source || {};
    const parts = [
      market.quoteSource || "Kalshi quote source unknown",
      market.quoteUpdatedTime ? "updated " + formatTime(market.quoteUpdatedTime) : "",
      Number.isFinite(Number(market.quoteLatencyMs)) ? "age " + Number(market.quoteLatencyMs).toFixed(0) + "ms" : "",
      market.clockSource ? "clock " + market.clockSource : "",
      Number.isFinite(Number(market.localClockOffsetMs)) ? "browser offset " + Number(market.localClockOffsetMs).toFixed(0) + "ms" : "",
      source.kalshiWebsocketError ? "WS note: " + source.kalshiWebsocketError : "",
    ].filter(Boolean);
    return "<p><strong>Kalshi quote stream:</strong> " + escapeHtml(parts.join(" / ")) + "</p>";
  }

  function renderRules(scan) {
    const rules = scan.rules || {};
    const source = scan.source || {};
    rulesEl.innerHTML = [
      "<p><strong>" + escapeHtml(rules.settlementSource || "CF Benchmarks BRTI") + "</strong></p>",
      "<p>" + escapeHtml(rules.settlementSummary || "") + "</p>",
      rules.primary ? "<p>" + escapeHtml(rules.primary) + "</p>" : "",
      rules.secondary ? "<p>" + escapeHtml(rules.secondary) + "</p>" : "",
      source.keyHint ? "<p>" + escapeHtml(source.keyHint) + "</p>" : "",
    ].join("");
  }

  function metric(label, value, subtext, className) {
    return '<div class="metric ' + escapeHtml(className || "") + '"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong><small>" + escapeHtml(subtext || "") + "</small></div>";
  }

  function callLabel(value) {
    const labels = {
      "research-buy": "Research buy",
      "tiny-only": "Tiny only",
      "watch-proxy": "Watch proxy",
      "too-late": "Too late",
      "too-small": "Too small",
      avoid: "Avoid",
      pass: "Pass",
      "no-liquidity": "No liquidity",
    };
    return labels[value] || "Pass";
  }

  function callClass(value) {
    if (value === "research-buy" || value === "tiny-only") return "good";
    if (value === "avoid" || value === "too-late") return "bad";
    return "watch";
  }

  function modelSigmaSummary(model) {
    const z = Number(model && model.z);
    if (!Number.isFinite(z)) return "sigma n/a";
    return "YES z " + formatSigma(z);
  }

  function sideSigmaText(side, zValue) {
    const z = Number(zValue);
    if (!Number.isFinite(z)) return "sigma n/a";
    const isYes = String(side || "").toLowerCase() === "yes";
    const outOfMoney = isYes ? z > 0 : z < 0;
    const label = outOfMoney ? "OTM" : "ITM";
    return String(side || "").toUpperCase() + " " + label + " " + formatSigma(Math.abs(z));
  }

  function formatSigma(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return number.toFixed(2) + " sigma";
  }

  function pct(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return (number * 100).toFixed(1) + "%";
  }

  function tinyPct(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return (number * 100).toFixed(3) + "%";
  }

  function formatCents(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(number < 10 ? 2 : 1) + "c" : "n/a";
  }

  function formatWholeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0";
  }

  function dollars(value) {
    const number = Number(value);
    return Number.isFinite(number) ? "$" + number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "n/a";
  }

  function signedDollars(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : number < 0 ? "-" : "";
    return sign + dollars(Math.abs(number));
  }

  function formatNumber(value, places) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places }) : "n/a";
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "n/a";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function formatDuration(value) {
    const totalSeconds = Math.max(0, Math.ceil(Number(value) || 0));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function setStatus(message, error) {
    statusEl.textContent = message;
    statusEl.className = error ? "neg" : "";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}());
