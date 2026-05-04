'use strict';

const crypto = require('crypto');
const { Firestore } = require('@google-cloud/firestore');

const DEFAULT_COLLECTION = 'simBitcoinPaperPositions';
const DEFAULT_STATE_COLLECTION = 'simBitcoinPaperState';
const DEFAULT_BOT_COLLECTION = 'simBitcoinPaperBots';
const DEFAULT_BOT_ID = 'server-bot-main';
const MAX_CONTRACTS = 1000;
const MIN_PRICE_CENTS = 1;
const MAX_PRICE_CENTS = 99;
const MAX_STATE_BYTES = 240_000;
const MAX_BOT_BYTES = 360_000;
const MAX_BOT_POSITIONS = 400;
const MAX_BOT_HISTORY = 240;

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, fallback = '', maxLength = 160) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function normalizeCents(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeContracts(value) {
  return clamp(Math.floor(Number(value || 0)), 1, MAX_CONTRACTS);
}

function normalizePriceCents(value) {
  return clamp(Math.round(Number(value || 0)), MIN_PRICE_CENTS, MAX_PRICE_CENTS);
}

function kalshiFeeCents(contracts, priceCents) {
  const count = normalizeContracts(contracts);
  const price = normalizePriceCents(priceCents) / 100;
  return Math.max(0, Math.ceil(0.07 * count * price * (1 - price) * 100));
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeDocId(value) {
  return cleanText(value, '', 180).replace(/[\/.#\[\]]/g, '_');
}

function normalizeBotId(value) {
  return cleanText(value, DEFAULT_BOT_ID, 80).replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || DEFAULT_BOT_ID;
}

function publicBotPosition(position) {
  const source = position || {};
  const contracts = Math.max(0, Math.floor(Number(source.contracts || 0)));
  const entryCostCents = normalizeCents(source.entryCostCents);
  const markValueCents = normalizeCents(source.markValueCents);
  return {
    id: cleanText(source.id, '', 100),
    status: cleanText(source.status, 'open', 40),
    ticker: cleanText(source.ticker, '', 120),
    side: cleanText(source.side, 'yes', 10),
    contracts,
    originalContracts: Math.max(contracts, Math.floor(Number(source.originalContracts || contracts))),
    entryCents: normalizePriceCents(source.entryCents || 1),
    entryFeeCents: normalizeCents(source.entryFeeCents),
    entryCost: entryCostCents / 100,
    entryCostCents,
    openedAt: cleanText(source.openedAt, '', 40),
    updatedAt: cleanText(source.updatedAt, '', 40),
    closedAt: cleanText(source.closedAt, '', 40),
    closeTime: cleanText(source.closeTime, '', 40),
    targetPrice: Number(source.targetPrice),
    entrySpot: Number(source.entrySpot),
    lastSpot: Number(source.lastSpot),
    lastBidCents: normalizeCents(source.lastBidCents),
    lastAskCents: normalizeCents(source.lastAskCents),
    markValue: markValueCents / 100,
    markValueCents,
    pnlCents: normalizeCents(source.pnlCents, markValueCents - entryCostCents),
    settlementMethod: cleanText(source.settlementMethod, '', 120),
  };
}

function publicPosition(position) {
  const source = position || {};
  const contracts = Math.max(0, Math.floor(Number(source.contracts || 0)));
  const entryCostCents = normalizeCents(source.entryCostCents);
  return {
    id: cleanText(source.id, '', 100),
    uid: cleanText(source.uid, '', 160),
    status: cleanText(source.status, 'open', 40),
    ticker: cleanText(source.ticker, '', 120),
    side: cleanText(source.side, 'yes', 10),
    contracts,
    originalContracts: Math.max(contracts, Math.floor(Number(source.originalContracts || contracts))),
    entryCents: normalizePriceCents(source.entryCents || 1),
    entryFeeCents: normalizeCents(source.entryFeeCents),
    entryCost: entryCostCents / 100,
    entryCostCents,
    openedAt: cleanText(source.openedAt, '', 40),
    updatedAt: cleanText(source.updatedAt, '', 40),
    closedAt: cleanText(source.closedAt, '', 40),
    closeTime: cleanText(source.closeTime, '', 40),
    targetPrice: Number(source.targetPrice),
    entrySpot: Number(source.entrySpot),
    finalSpot: Number(source.finalSpot),
    settlementMethod: cleanText(source.settlementMethod, '', 120),
  };
}

function positionRef(firestore, collectionName, id) {
  return firestore.collection(collectionName).doc(id);
}

function stateRef(firestore, collectionName, user) {
  return firestore.collection(collectionName).doc(safeDocId(user && user.uid));
}

function botDocId(userOrUid, id) {
  const uid = typeof userOrUid === 'string' ? userOrUid : userOrUid && userOrUid.uid;
  return `${safeDocId(uid)}__${normalizeBotId(id)}`;
}

function botRef(firestore, collectionName, userOrUid, id) {
  return firestore.collection(collectionName).doc(botDocId(userOrUid, id));
}

function normalizeAccountState(raw) {
  const cloned = cloneValue(raw || {});
  const json = JSON.stringify(cloned);
  if (json.length > MAX_STATE_BYTES) {
    const error = new Error('Bitcoin paper account state is too large to save.');
    error.code = 'sim-bitcoin/state-too-large';
    throw error;
  }
  return cloned;
}

function normalizeBotHistory(history) {
  return (Array.isArray(history) ? history : []).slice(0, MAX_BOT_HISTORY).map((entry) => ({
    time: cleanText(entry && entry.time, nowIso(), 40),
    type: cleanText(entry && entry.type, 'note', 40),
    ticker: cleanText(entry && entry.ticker, '', 120),
    side: cleanText(entry && entry.side, '', 10),
    contracts: Math.max(0, Math.floor(Number(entry && entry.contracts || 0))),
    priceCents: normalizeCents(entry && entry.priceCents),
    feeCents: normalizeCents(entry && entry.feeCents),
    cashCents: normalizeCents(entry && entry.cashCents),
    pnlCents: normalizeCents(entry && entry.pnlCents),
    detail: cleanText(entry && entry.detail, '', 240),
  }));
}

function normalizeBotPositions(positions) {
  return (Array.isArray(positions) ? positions : []).slice(0, MAX_BOT_POSITIONS).map((position) => ({
    ...publicBotPosition(position),
    id: cleanText(position && position.id, crypto.randomUUID(), 100),
    status: cleanText(position && position.status, 'open', 40),
    entryCostCents: normalizeCents(position && position.entryCostCents),
    markValueCents: normalizeCents(position && position.markValueCents),
    pnlCents: normalizeCents(position && position.pnlCents),
  }));
}

function normalizeBotObjectMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return cloneValue(value);
}

function normalizeBotState(raw, user, id = DEFAULT_BOT_ID) {
  const source = raw || {};
  const uid = cleanText((user && user.uid) || source.uid, '', 160);
  if (!uid) {
    const error = new Error('Authentication token did not include a user id.');
    error.code = 'sim-bitcoin/missing-uid';
    throw error;
  }
  const botId = normalizeBotId(id || source.id);
  const now = nowIso();
  const startingBankrollCents = clamp(normalizeCents(source.startingBankrollCents, 100000), 100, 100000000);
  const bot = {
    id: botId,
    uid,
    user: {
      uid,
      email: cleanText((user && user.email) || source.user && source.user.email, '', 160),
      displayName: cleanText((user && user.displayName) || source.user && source.user.displayName, 'AP member', 80),
      picture: cleanText((user && user.picture) || source.user && source.user.picture, '', 400),
      provider: cleanText((user && user.provider) || source.user && source.user.provider, '', 80),
    },
    name: cleanText(source.name, 'Bitcoin 15m Server Bot', 80),
    enabled: source.enabled === true,
    startingBankrollCents,
    cashCents: clamp(normalizeCents(source.cashCents, startingBankrollCents), 0, 100000000),
    settings: normalizeBotObjectMap(source.settings),
    positions: normalizeBotPositions(source.positions),
    history: normalizeBotHistory(source.history),
    fills: normalizeBotObjectMap(source.fills),
    lastAttemptAt: normalizeBotObjectMap(source.lastAttemptAt),
    lastAttemptAtMs: normalizeCents(source.lastAttemptAtMs),
    lastRunAt: cleanText(source.lastRunAt, '', 40),
    lastMessage: cleanText(source.lastMessage, '', 280),
    lastTone: cleanText(source.lastTone, '', 40),
    lastScanTicker: cleanText(source.lastScanTicker, '', 120),
    createdAt: cleanText(source.createdAt, now, 40),
    updatedAt: cleanText(source.updatedAt, now, 40),
  };
  const json = JSON.stringify(bot);
  if (json.length > MAX_BOT_BYTES) {
    const error = new Error('Bitcoin server bot state is too large to save.');
    error.code = 'sim-bitcoin/bot-too-large';
    throw error;
  }
  return bot;
}

function publicBot(bot) {
  const state = normalizeBotState(bot, { uid: bot && bot.uid }, bot && bot.id);
  const openPositions = state.positions.filter((position) => position.status === 'open');
  const openRiskCents = openPositions.reduce((sum, position) => sum + normalizeCents(position.entryCostCents), 0);
  const openValueCents = openPositions.reduce((sum, position) => sum + normalizeCents(position.markValueCents), 0);
  const openContracts = openPositions.reduce((sum, position) => sum + Math.max(0, Math.floor(Number(position.contracts || 0))), 0);
  const equityCents = normalizeCents(state.cashCents) + openValueCents;
  return {
    ...state,
    startingBankroll: state.startingBankrollCents / 100,
    cash: state.cashCents / 100,
    openRisk: openRiskCents / 100,
    openRiskCents,
    openValue: openValueCents / 100,
    openValueCents,
    openContracts,
    equity: equityCents / 100,
    equityCents,
    pnl: (equityCents - state.startingBankrollCents) / 100,
    pnlCents: equityCents - state.startingBankrollCents,
    positions: state.positions.map(publicBotPosition),
    history: state.history.slice(0, MAX_BOT_HISTORY),
  };
}

function createSimBitcoinPaperStore({
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
  collectionName = process.env.SIM_BITCOIN_PAPER_COLLECTION || DEFAULT_COLLECTION,
  stateCollectionName = process.env.SIM_BITCOIN_PAPER_STATE_COLLECTION || DEFAULT_STATE_COLLECTION,
  botCollectionName = process.env.SIM_BITCOIN_PAPER_BOT_COLLECTION || DEFAULT_BOT_COLLECTION,
  simWalletStore,
} = {}) {
  if (!simWalletStore || typeof simWalletStore.transactWallet !== 'function') {
    throw new Error('A SIM wallet store with transactWallet is required.');
  }

  const enabled = Boolean(String(projectId || '').trim());
  const firestore = enabled
    ? new Firestore({
      projectId,
      ignoreUndefinedProperties: true,
    })
    : null;
  const memoryPositions = new Map();
  const memoryStates = new Map();
  const memoryBots = new Map();

  async function readAccountState(user) {
    const uid = cleanText(user && user.uid, '', 160);
    if (!uid) return null;
    if (!enabled) {
      const state = memoryStates.get(uid);
      return state ? cloneValue(state) : null;
    }
    const snapshot = await stateRef(firestore, stateCollectionName, user).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    return data && data.uid === uid && data.state ? cloneValue(data.state) : null;
  }

  async function saveAccountState(user, state) {
    const uid = cleanText(user && user.uid, '', 160);
    if (!uid) {
      const error = new Error('Authentication token did not include a user id.');
      error.code = 'sim-bitcoin/missing-uid';
      throw error;
    }
    const savedAt = nowIso();
    const cleanState = normalizeAccountState({
      ...(state || {}),
      savedAt,
    });
    if (!enabled) {
      memoryStates.set(uid, cloneValue(cleanState));
      return cloneValue(cleanState);
    }
    await stateRef(firestore, stateCollectionName, user).set({
      uid,
      state: cleanState,
      updatedAt: savedAt,
    }, { merge: false });
    return cloneValue(cleanState);
  }

  async function readBot(user, id = DEFAULT_BOT_ID) {
    const uid = cleanText(user && user.uid, '', 160);
    if (!uid) return null;
    const cleanId = normalizeBotId(id);
    if (!enabled) {
      const bot = memoryBots.get(botDocId(uid, cleanId));
      return bot ? publicBot(bot) : publicBot(normalizeBotState({ id: cleanId }, user, cleanId));
    }
    const snapshot = await botRef(firestore, botCollectionName, user, cleanId).get();
    if (!snapshot.exists) {
      return publicBot(normalizeBotState({ id: cleanId }, user, cleanId));
    }
    const data = snapshot.data() || {};
    return data && data.uid === uid ? publicBot(data) : null;
  }

  async function saveBot(user, patch = {}, id = DEFAULT_BOT_ID) {
    const cleanId = normalizeBotId(id || patch.id);
    let previous = null;
    if (!enabled) {
      previous = memoryBots.get(botDocId(user && user.uid, cleanId));
    } else {
      const snapshot = await botRef(firestore, botCollectionName, user, cleanId).get();
      previous = snapshot.exists ? snapshot.data() : null;
    }
    const now = nowIso();
    const next = normalizeBotState({
      ...(previous || {}),
      ...(patch || {}),
      id: cleanId,
      updatedAt: now,
      createdAt: previous && previous.createdAt || patch.createdAt || now,
    }, user, cleanId);
    if (!enabled) {
      memoryBots.set(botDocId(user && user.uid, cleanId), cloneValue(next));
      return publicBot(next);
    }
    await botRef(firestore, botCollectionName, user, cleanId).set(next, { merge: false });
    return publicBot(next);
  }

  async function saveBotDocument(bot) {
    const next = normalizeBotState({
      ...(bot || {}),
      updatedAt: nowIso(),
    }, { uid: bot && bot.uid }, bot && bot.id);
    if (!enabled) {
      memoryBots.set(botDocId(next.uid, next.id), cloneValue(next));
      return publicBot(next);
    }
    await botRef(firestore, botCollectionName, next.uid, next.id).set(next, { merge: false });
    return publicBot(next);
  }

  async function listEnabledBots(limit = 60) {
    const count = clamp(Math.floor(Number(limit || 60)), 1, 250);
    if (!enabled) {
      return Array.from(memoryBots.values())
        .filter((bot) => bot && bot.enabled === true)
        .slice(0, count)
        .map((bot) => normalizeBotState(bot, { uid: bot.uid }, bot.id));
    }
    const snapshot = await firestore.collection(botCollectionName)
      .where('enabled', '==', true)
      .limit(count)
      .get();
    return snapshot.docs.map((doc) => normalizeBotState(doc.data() || {}, { uid: doc.data() && doc.data().uid }, doc.data() && doc.data().id));
  }

  async function listRunnableBots(limit = 60) {
    const count = clamp(Math.floor(Number(limit || 60)), 1, 250);
    const isRunnable = (bot) => bot && (
      bot.enabled === true
      || (Array.isArray(bot.positions) && bot.positions.some((position) => position && position.status === 'open' && Number(position.contracts || 0) > 0))
    );
    if (!enabled) {
      return Array.from(memoryBots.values())
        .filter(isRunnable)
        .slice(0, count)
        .map((bot) => normalizeBotState(bot, { uid: bot.uid }, bot.id));
    }
    const snapshot = await firestore.collection(botCollectionName)
      .limit(Math.min(500, count * 5))
      .get();
    return snapshot.docs
      .map((doc) => doc.data() || {})
      .filter(isRunnable)
      .slice(0, count)
      .map((bot) => normalizeBotState(bot, { uid: bot.uid }, bot.id));
  }

  async function readPosition(user, id) {
    const cleanId = cleanText(id, '', 100);
    if (!cleanId) return null;
    if (!enabled) {
      const position = memoryPositions.get(cleanId);
      return position && position.uid === user.uid ? publicPosition(position) : null;
    }
    const snapshot = await positionRef(firestore, collectionName, cleanId).get();
    if (!snapshot.exists) return null;
    const position = snapshot.data();
    return position && position.uid === user.uid ? publicPosition(position) : null;
  }

  async function openPosition(user, order) {
    const side = cleanText(order.side, 'yes', 10).toLowerCase() === 'no' ? 'no' : 'yes';
    const contracts = normalizeContracts(order.contracts);
    const entryCents = normalizePriceCents(order.entryCents);
    const entryFeeCents = kalshiFeeCents(contracts, entryCents);
    const entryCostCents = contracts * entryCents + entryFeeCents;
    const openedAt = nowIso();
    const position = {
      id: crypto.randomUUID(),
      uid: user.uid,
      status: 'open',
      ticker: cleanText(order.ticker, '', 120),
      side,
      contracts,
      originalContracts: contracts,
      entryCents,
      entryFeeCents,
      entryCostCents,
      openedAt,
      updatedAt: openedAt,
      closeTime: cleanText(order.closeTime, '', 40),
      targetPrice: Number(order.targetPrice),
      entrySpot: Number(order.entrySpot),
      source: 'bitcoin-15m-paper',
    };

    const tx = await simWalletStore.transactWallet(user, async (wallet, context) => {
      const walletData = context.applyAdjustment(wallet, {
        amountCents: -entryCostCents,
        source: 'bitcoin-15m-paper-secure',
        action: 'buy',
        note: 'Bitcoin 15-minute secure paper buy',
        metadata: {
          positionId: position.id,
          ticker: position.ticker,
          side: position.side,
          contracts,
          priceCents: entryCents,
          feeCents: entryFeeCents,
        },
      });
      if (context.enabled) {
        context.transaction.set(positionRef(context.firestore, collectionName, position.id), position);
      } else {
        memoryPositions.set(position.id, cloneValue(position));
      }
      return {
        walletData,
        result: { position: publicPosition(position) },
      };
    });

    return {
      wallet: tx.wallet,
      position: tx.result.position,
      fill: {
        action: 'buy',
        priceCents: entryCents,
        feeCents: entryFeeCents,
        costCents: entryCostCents,
      },
    };
  }

  async function sellPosition(user, sellOrder) {
    const positionId = cleanText(sellOrder.positionId, '', 100);
    const requestedContracts = normalizeContracts(sellOrder.contracts);
    const priceCents = normalizePriceCents(sellOrder.priceCents);
    let publicNextPosition = null;
    let fill = null;

    const tx = await simWalletStore.transactWallet(user, async (wallet, context) => {
      let position = null;
      let ref = null;
      if (context.enabled) {
        ref = positionRef(context.firestore, collectionName, positionId);
        const snapshot = await context.transaction.get(ref);
        position = snapshot.exists ? snapshot.data() : null;
      } else {
        position = memoryPositions.get(positionId);
      }
      if (!position || position.uid !== user.uid || position.status !== 'open') {
        const error = new Error('That SIM paper position is not open.');
        error.code = 'sim-bitcoin/position-not-open';
        throw error;
      }

      const openContracts = Math.max(0, Math.floor(Number(position.contracts || 0)));
      const soldContracts = Math.min(openContracts, requestedContracts);
      if (soldContracts <= 0) {
        const error = new Error('No contracts are available to sell.');
        error.code = 'sim-bitcoin/no-contracts';
        throw error;
      }

      const ratio = openContracts > 0 ? soldContracts / openContracts : 0;
      const costSliceCents = Math.round(normalizeCents(position.entryCostCents) * ratio);
      const exitFeeCents = kalshiFeeCents(soldContracts, priceCents);
      const proceedsCents = Math.max(0, soldContracts * priceCents - exitFeeCents);
      const updatedAt = nowIso();
      const nextPosition = {
        ...position,
        contracts: openContracts - soldContracts,
        entryCostCents: normalizeCents(position.entryCostCents) - costSliceCents,
        entryFeeCents: Math.max(0, normalizeCents(position.entryFeeCents) - Math.round(normalizeCents(position.entryFeeCents) * ratio)),
        updatedAt,
      };
      if (nextPosition.contracts <= 0) {
        nextPosition.status = 'sold';
        nextPosition.closedAt = updatedAt;
      }

      const walletData = context.applyAdjustment(wallet, {
        amountCents: proceedsCents,
        source: 'bitcoin-15m-paper-secure',
        action: 'sell',
        note: 'Bitcoin 15-minute secure paper sell',
        metadata: {
          positionId,
          ticker: position.ticker,
          side: position.side,
          contracts: soldContracts,
          priceCents,
          feeCents: exitFeeCents,
          pnlCents: proceedsCents - costSliceCents,
        },
      });

      if (context.enabled) {
        context.transaction.set(ref, nextPosition, { merge: false });
      } else {
        memoryPositions.set(positionId, cloneValue(nextPosition));
      }

      publicNextPosition = publicPosition(nextPosition);
      fill = {
        action: 'sell',
        priceCents,
        contracts: soldContracts,
        feeCents: exitFeeCents,
        proceedsCents,
        pnlCents: proceedsCents - costSliceCents,
      };

      return {
        walletData,
        result: {
          position: publicNextPosition,
          fill,
        },
      };
    });

    return {
      wallet: tx.wallet,
      position: tx.result.position,
      fill: tx.result.fill,
    };
  }

  async function settlePosition(user, settlement) {
    const positionId = cleanText(settlement.positionId, '', 100);
    const finalSpot = Number(settlement.finalSpot);
    const targetPrice = Number(settlement.targetPrice);
    const method = cleanText(settlement.method, 'server spot at settlement request', 120);
    let publicNextPosition = null;
    let fill = null;

    if (!Number.isFinite(finalSpot) || !Number.isFinite(targetPrice)) {
      const error = new Error('Server settlement price is unavailable.');
      error.code = 'sim-bitcoin/no-settlement-price';
      throw error;
    }

    const tx = await simWalletStore.transactWallet(user, async (wallet, context) => {
      let position = null;
      let ref = null;
      if (context.enabled) {
        ref = positionRef(context.firestore, collectionName, positionId);
        const snapshot = await context.transaction.get(ref);
        position = snapshot.exists ? snapshot.data() : null;
      } else {
        position = memoryPositions.get(positionId);
      }
      if (!position || position.uid !== user.uid || position.status !== 'open') {
        const error = new Error('That SIM paper position is not open.');
        error.code = 'sim-bitcoin/position-not-open';
        throw error;
      }

      const contracts = Math.max(0, Math.floor(Number(position.contracts || 0)));
      const wins = position.side === 'yes' ? finalSpot >= targetPrice : finalSpot < targetPrice;
      const payoutCents = wins ? contracts * 100 : 0;
      const entryCostCents = normalizeCents(position.entryCostCents);
      const closedAt = nowIso();
      const nextPosition = {
        ...position,
        contracts: 0,
        status: wins ? 'won' : 'lost',
        updatedAt: closedAt,
        closedAt,
        finalSpot,
        targetPrice,
        settlementMethod: method,
      };

      const walletData = payoutCents > 0
        ? context.applyAdjustment(wallet, {
          amountCents: payoutCents,
          source: 'bitcoin-15m-paper-secure',
          action: 'settlement',
          note: 'Bitcoin 15-minute secure paper settlement',
          metadata: {
            positionId,
            ticker: position.ticker,
            side: position.side,
            contracts,
            won: wins,
            payoutCents,
            pnlCents: payoutCents - entryCostCents,
            finalSpot,
            targetPrice,
            method,
          },
        })
        : wallet;

      if (context.enabled) {
        context.transaction.set(ref, nextPosition, { merge: false });
      } else {
        memoryPositions.set(positionId, cloneValue(nextPosition));
      }

      publicNextPosition = publicPosition(nextPosition);
      fill = {
        action: 'settlement',
        contracts,
        won: wins,
        payoutCents,
        pnlCents: payoutCents - entryCostCents,
        finalSpot,
        targetPrice,
        method,
      };

      return {
        walletData,
        result: {
          position: publicNextPosition,
          fill,
        },
      };
    });

    return {
      wallet: tx.wallet,
      position: tx.result.position,
      fill: tx.result.fill,
    };
  }

  return {
    enabled,
    readAccountState,
    saveAccountState,
    readBot,
    saveBot,
    saveBotDocument,
    listEnabledBots,
    listRunnableBots,
    readPosition,
    openPosition,
    sellPosition,
    settlePosition,
  };
}

module.exports = {
  createSimBitcoinPaperStore,
  kalshiFeeCents,
};
