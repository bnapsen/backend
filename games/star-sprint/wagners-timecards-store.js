'use strict';

const { Firestore } = require('@google-cloud/firestore');

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createWagnersTimecardsStore({
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
  collectionName = process.env.WAGNERS_TIMECARD_COLLECTION || 'wagnersTimecards',
} = {}) {
  const enabled = Boolean(String(projectId || '').trim());
  const firestore = enabled
    ? new Firestore({
      projectId,
      ignoreUndefinedProperties: true,
    })
    : null;

  function assertEnabled() {
    if (!enabled || !firestore) {
      const error = new Error('Timecard storage is not configured.');
      error.code = 'timecards/storage-disabled';
      throw error;
    }
  }

  function collection() {
    assertEnabled();
    return firestore.collection(collectionName);
  }

  async function submitTimecard(timecard) {
    assertEnabled();
    const now = new Date().toISOString();
    const id = String(timecard && timecard.id || '').trim();
    const docRef = id ? collection().doc(id) : collection().doc();
    const payload = {
      ...cloneValue(timecard),
      id: docRef.id,
      status: 'submitted',
      submittedAt: String(timecard && timecard.submittedAt || now),
      updatedAt: now,
    };
    await docRef.set(payload, { merge: true });
    return payload;
  }

  async function listForUser(userId, { limit = 30 } = {}) {
    assertEnabled();
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
    const snapshot = await collection()
      .where('ownerUserId', '==', String(userId || ''))
      .orderBy('submittedAt', 'desc')
      .limit(safeLimit)
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async function listAll({ limit = 200 } = {}) {
    assertEnabled();
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const snapshot = await collection()
      .orderBy('submittedAt', 'desc')
      .limit(safeLimit)
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async function updateStatus(id, patch) {
    assertEnabled();
    const docId = String(id || '').trim();
    if (!docId) {
      const error = new Error('Timecard id is required.');
      error.code = 'timecards/missing-id';
      throw error;
    }
    const docRef = collection().doc(docId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      const error = new Error('Timecard not found.');
      error.code = 'timecards/not-found';
      throw error;
    }
    const payload = {
      ...cloneValue(patch || {}),
      updatedAt: new Date().toISOString(),
    };
    await docRef.set(payload, { merge: true });
    const updated = await docRef.get();
    return { id: updated.id, ...updated.data() };
  }

  return {
    enabled,
    collectionName,
    submitTimecard,
    listForUser,
    listAll,
    updateStatus,
  };
}

module.exports = {
  createWagnersTimecardsStore,
};
