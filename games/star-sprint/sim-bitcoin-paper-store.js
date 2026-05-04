'use strict';

const crypto = require('crypto');
const { Firestore } = require('@google-cloud/firestore');

const DEFAULT_COLLECTION = 'simBitcoinPaperPositions';
const DEFAULT_STATE_COLLECTION = 'simBitcoinPaperState';
const MAX_CONTRACTS = 1000;
const MIN_PRICE_CENTS = 1;
const MAX_PRICE_CENTS = 99;
const MAX_STATE_BYTES = 240_000;

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
  return firestore.collection(collectionName).doc(cleanText(user && user.uid, '', 160).replace(/[\/.#\[\]]/g, '_'));
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

function createSimBitcoinPaperStore({
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
  collectionName = process.env.SIM_BITCOIN_PAPER_COLLECTION || DEFAULT_COLLECTION,
  stateCollectionName = process.env.SIM_BITCOIN_PAPER_STATE_COLLECTION || DEFAULT_STATE_COLLECTION,
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
