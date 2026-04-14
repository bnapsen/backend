'use strict';

const fs = require('fs');
const path = require('path');
const { createS3JsonStore } = require('./s3-json-store.js');

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function reviewSort(left, right) {
  return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
}

function reviewRecord(record) {
  return {
    id: String(record.id || ''),
    name: String(record.name || ''),
    car: String(record.car || ''),
    rating: Number(record.rating || 0),
    message: String(record.message || ''),
    createdAt: String(record.createdAt || ''),
  };
}

function createReviewsStore({ dataDir, maxReviews = 100, maxVisibleReviews = 30 }) {
  const reviewsFile = path.join(dataDir, 'reviews.json');
  const metadataStore = createS3JsonStore();
  const usesObjectStorage = metadataStore.enabled;

  function ensureLocalDataDir() {
    ensureDirectory(dataDir);
  }

  function readLocalReviews() {
    if (!fs.existsSync(reviewsFile)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(reviewsFile, 'utf8'));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((entry) => entry && typeof entry === 'object')
        .map(reviewRecord)
        .sort(reviewSort)
        .slice(0, maxReviews);
    } catch (error) {
      console.error('Failed to read stored reviews:', error.message);
      return [];
    }
  }

  async function readObjectStorageReviews() {
    const parsed = await metadataStore.readJson('reviews/metadata/reviews.json', []);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map(reviewRecord)
      .sort(reviewSort)
      .slice(0, maxReviews);
  }

  function writeLocalReviews(reviews) {
    ensureLocalDataDir();
    const nextReviews = reviews
      .map(reviewRecord)
      .sort(reviewSort)
      .slice(0, maxReviews);
    const tempFile = `${reviewsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(nextReviews, null, 2));
    fs.renameSync(tempFile, reviewsFile);
    return nextReviews;
  }

  async function writeObjectStorageReviews(reviews) {
    const nextReviews = reviews
      .map(reviewRecord)
      .sort(reviewSort)
      .slice(0, maxReviews);
    await metadataStore.writeJson('reviews/metadata/reviews.json', nextReviews);
    return nextReviews;
  }

  async function importLocalReviewsToObjectStorage() {
    const localReviews = readLocalReviews();
    if (!localReviews.length) {
      return;
    }

    const remoteReviews = await readObjectStorageReviews();
    const byId = new Map();
    for (const review of [...remoteReviews, ...localReviews]) {
      byId.set(review.id, reviewRecord(review));
    }

    await writeObjectStorageReviews([...byId.values()]);
  }

  async function init() {
    if (usesObjectStorage) {
      await metadataStore.ensureReady();
      await importLocalReviewsToObjectStorage();
      return;
    }

    ensureLocalDataDir();
  }

  async function listVisibleReviews(limit = maxVisibleReviews) {
    if (usesObjectStorage) {
      return (await readObjectStorageReviews()).slice(0, limit);
    }

    return readLocalReviews().slice(0, limit);
  }

  async function insertReview(review) {
    const nextReview = reviewRecord(review);

    if (usesObjectStorage) {
      const nextReviews = await writeObjectStorageReviews([nextReview, ...await readObjectStorageReviews()]);
      return {
        review: nextReviews.find((entry) => entry.id === nextReview.id) || nextReview,
        visibleReviews: nextReviews.slice(0, maxVisibleReviews),
      };
    }

    const nextReviews = writeLocalReviews([nextReview, ...readLocalReviews()]);
    return {
      review: nextReviews.find((entry) => entry.id === nextReview.id) || nextReview,
      visibleReviews: nextReviews.slice(0, maxVisibleReviews),
    };
  }

  return {
    usesObjectStorage,
    init,
    listVisibleReviews,
    insertReview,
  };
}

module.exports = {
  createReviewsStore,
};
