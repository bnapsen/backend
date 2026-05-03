'use strict';

const crypto = require('crypto');
const { Firestore } = require('@google-cloud/firestore');

const DEFAULT_CURRENCY = 'SIM';
const DEFAULT_STARTING_BALANCE = 1000;
const MAX_RECENT_TRANSACTIONS = 80;
const MAX_ABS_ADJUSTMENT_CENTS = 100000000;

function nowIso() {
  return new Date().toISOString();
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, fallback = '', maxLength = 120) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function dollarsToCents(value, fallbackCents = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : fallbackCents;
}

function normalizeCents(value, fallbackCents = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallbackCents;
}

function safeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(value).slice(0, 2400));
  } catch {
    return {};
  }
}

function normalizeUser(user) {
  const uid = cleanText(user && user.uid, '', 160);
  if (!uid) {
    const error = new Error('A signed-in account is required for SIM.');
    error.code = 'sim/missing-user';
    throw error;
  }
  return {
    uid,
    email: cleanText(user && user.email, '', 180),
    displayName: cleanText(user && user.displayName, 'AP member', 120),
    picture: cleanText(user && user.picture, '', 500),
    provider: cleanText(user && user.provider, '', 80),
  };
}

function publicTransaction(entry) {
  const amountCents = normalizeCents(entry && entry.amountCents);
  const balanceAfterCents = normalizeCents(entry && entry.balanceAfterCents);
  return {
    id: cleanText(entry && entry.id, '', 90),
    createdAt: cleanText(entry && entry.createdAt, '', 40),
    source: cleanText(entry && entry.source, 'site', 80),
    action: cleanText(entry && entry.action, 'adjust', 80),
    note: cleanText(entry && entry.note, '', 180),
    amount: amountCents / 100,
    amountCents,
    balanceAfter: balanceAfterCents / 100,
    balanceAfterCents,
    metadata: safeMetadata(entry && entry.metadata),
  };
}

function publicKillRewards(source) {
  const rewards = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const games = rewards.games && typeof rewards.games === 'object' && !Array.isArray(rewards.games)
    ? rewards.games
    : {};
  const publicGames = {};
  for (const [game, entry] of Object.entries(games)) {
    publicGames[cleanText(game, 'game', 60)] = {
      kills: Math.max(0, Math.floor(Number(entry && entry.kills) || 0)),
      pendingKills: Math.max(0, Math.floor(Number(entry && entry.pendingKills) || 0)),
      rewardCents: normalizeCents(entry && entry.rewardCents),
      reward: normalizeCents(entry && entry.rewardCents) / 100,
    };
  }
  return {
    dayKey: cleanText(rewards.dayKey, '', 30),
    lastUpdatedDayKey: cleanText(rewards.lastUpdatedDayKey, '', 30),
    totalRewardCents: normalizeCents(rewards.totalRewardCents),
    totalReward: normalizeCents(rewards.totalRewardCents) / 100,
    games: publicGames,
  };
}

function publicWallet(wallet) {
  const balanceCents = normalizeCents(wallet && wallet.balanceCents);
  const startingBalanceCents = normalizeCents(wallet && wallet.startingBalanceCents);
  const transactions = Array.isArray(wallet && wallet.recentTransactions)
    ? wallet.recentTransactions.slice(0, MAX_RECENT_TRANSACTIONS).map(publicTransaction)
    : [];
  return {
    uid: cleanText(wallet && wallet.uid, '', 160),
    currency: DEFAULT_CURRENCY,
    balance: balanceCents / 100,
    balanceCents,
    startingBalance: startingBalanceCents / 100,
    startingBalanceCents,
    killRewards: publicKillRewards(wallet && wallet.killRewards),
    createdAt: cleanText(wallet && wallet.createdAt, '', 40),
    updatedAt: cleanText(wallet && wallet.updatedAt, '', 40),
    recentTransactions: transactions,
  };
}

function normalizeWalletDocument(data, user, startingBalanceCents) {
  const createdAt = cleanText(data && data.createdAt, nowIso(), 40);
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    picture: user.picture,
    provider: user.provider,
    currency: DEFAULT_CURRENCY,
    balanceCents: normalizeCents(data && data.balanceCents, startingBalanceCents),
    startingBalanceCents: normalizeCents(data && data.startingBalanceCents, startingBalanceCents),
    killRewards: publicKillRewards(data && data.killRewards),
    createdAt,
    updatedAt: cleanText(data && data.updatedAt, createdAt, 40),
    recentTransactions: Array.isArray(data && data.recentTransactions)
      ? data.recentTransactions.slice(0, MAX_RECENT_TRANSACTIONS).map(publicTransaction)
      : [],
  };
}

function initialWallet(user, startingBalanceCents) {
  const createdAt = nowIso();
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    picture: user.picture,
    provider: user.provider,
    currency: DEFAULT_CURRENCY,
    balanceCents: startingBalanceCents,
    startingBalanceCents,
    killRewards: publicKillRewards(),
    createdAt,
    updatedAt: createdAt,
    recentTransactions: [{
      id: crypto.randomUUID(),
      createdAt,
      source: 'account',
      action: 'signup-grant',
      note: 'Starting SIM grant',
      amountCents: startingBalanceCents,
      balanceAfterCents: startingBalanceCents,
      metadata: {},
    }],
  };
}

function adjustmentAmountCents(adjustment) {
  const source = adjustment || {};
  const amountCents = Object.prototype.hasOwnProperty.call(source, 'amountCents')
    ? normalizeCents(source.amountCents, NaN)
    : dollarsToCents(source.amount, NaN);
  if (!Number.isFinite(amountCents) || amountCents === 0) {
    const error = new Error('SIM adjustment must be a non-zero amount.');
    error.code = 'sim/invalid-amount';
    throw error;
  }
  if (Math.abs(amountCents) > MAX_ABS_ADJUSTMENT_CENTS) {
    const error = new Error('SIM adjustment is too large.');
    error.code = 'sim/invalid-amount';
    throw error;
  }
  return amountCents;
}

function applyAdjustment(wallet, adjustment) {
  const amountCents = adjustmentAmountCents(adjustment);
  const balanceAfterCents = normalizeCents(wallet.balanceCents) + amountCents;
  if (balanceAfterCents < 0 && adjustment && adjustment.allowNegative !== true) {
    const error = new Error('Not enough SIM for that action.');
    error.code = 'sim/insufficient-funds';
    throw error;
  }
  const createdAt = nowIso();
  const entry = {
    id: crypto.randomUUID(),
    createdAt,
    source: cleanText(adjustment && adjustment.source, 'site', 80),
    action: cleanText(adjustment && adjustment.action, 'adjust', 80),
    note: cleanText(adjustment && adjustment.note, '', 180),
    amountCents,
    balanceAfterCents,
    metadata: safeMetadata(adjustment && adjustment.metadata),
  };
  return {
    ...wallet,
    balanceCents: balanceAfterCents,
    updatedAt: createdAt,
    recentTransactions: [entry].concat(wallet.recentTransactions || []).slice(0, MAX_RECENT_TRANSACTIONS),
  };
}

function createSimWalletStore({
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
  collectionName = process.env.SIM_WALLET_FIRESTORE_COLLECTION || 'simWallets',
  startingBalance = process.env.SIM_STARTING_BALANCE || DEFAULT_STARTING_BALANCE,
} = {}) {
  const enabled = Boolean(String(projectId || '').trim());
  const firestore = enabled
    ? new Firestore({
      projectId,
      ignoreUndefinedProperties: true,
    })
    : null;
  const memoryWallets = new Map();
  const startingBalanceCents = Math.max(0, dollarsToCents(startingBalance, DEFAULT_STARTING_BALANCE * 100));

  async function getOrCreateWallet(userSource) {
    const user = normalizeUser(userSource);
    if (!enabled) {
      if (!memoryWallets.has(user.uid)) {
        memoryWallets.set(user.uid, initialWallet(user, startingBalanceCents));
      }
      return publicWallet(memoryWallets.get(user.uid));
    }

    const walletRef = firestore.collection(collectionName).doc(user.uid);
    let walletData = null;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(walletRef);
      walletData = snapshot.exists
        ? normalizeWalletDocument(snapshot.data(), user, startingBalanceCents)
        : initialWallet(user, startingBalanceCents);
      transaction.set(walletRef, walletData, { merge: false });
    });
    return publicWallet(walletData);
  }

  async function adjustWallet(userSource, adjustment) {
    const user = normalizeUser(userSource);
    if (!enabled) {
      if (!memoryWallets.has(user.uid)) {
        memoryWallets.set(user.uid, initialWallet(user, startingBalanceCents));
      }
      const nextWallet = applyAdjustment(cloneValue(memoryWallets.get(user.uid)), adjustment);
      memoryWallets.set(user.uid, nextWallet);
      return publicWallet(nextWallet);
    }

    const walletRef = firestore.collection(collectionName).doc(user.uid);
    let walletData = null;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(walletRef);
      const currentWallet = snapshot.exists
        ? normalizeWalletDocument(snapshot.data(), user, startingBalanceCents)
        : initialWallet(user, startingBalanceCents);
      walletData = applyAdjustment(currentWallet, adjustment);
      transaction.set(walletRef, walletData, { merge: false });
    });
    return publicWallet(walletData);
  }

  async function transactWallet(userSource, mutator) {
    const user = normalizeUser(userSource);
    if (typeof mutator !== 'function') {
      const error = new Error('SIM wallet transaction mutator is required.');
      error.code = 'sim/invalid-transaction';
      throw error;
    }

    if (!enabled) {
      if (!memoryWallets.has(user.uid)) {
        memoryWallets.set(user.uid, initialWallet(user, startingBalanceCents));
      }
      const currentWallet = cloneValue(memoryWallets.get(user.uid));
      const outcome = await mutator(currentWallet, {
        enabled: false,
        user,
        applyAdjustment,
        publicWallet,
      }) || {};
      const walletData = outcome.walletData || currentWallet;
      memoryWallets.set(user.uid, walletData);
      return {
        wallet: publicWallet(walletData),
        result: outcome.result || null,
      };
    }

    const walletRef = firestore.collection(collectionName).doc(user.uid);
    let walletData = null;
    let result = null;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(walletRef);
      const currentWallet = snapshot.exists
        ? normalizeWalletDocument(snapshot.data(), user, startingBalanceCents)
        : initialWallet(user, startingBalanceCents);
      const outcome = await mutator(currentWallet, {
        enabled: true,
        firestore,
        transaction,
        walletRef,
        user,
        applyAdjustment,
        publicWallet,
      }) || {};
      walletData = outcome.walletData || currentWallet;
      result = outcome.result || null;
      transaction.set(walletRef, walletData, { merge: false });
    });
    return {
      wallet: publicWallet(walletData),
      result,
    };
  }

  return {
    enabled,
    currency: DEFAULT_CURRENCY,
    startingBalanceCents,
    getOrCreateWallet,
    adjustWallet,
    transactWallet,
  };
}

module.exports = {
  createSimWalletStore,
};
