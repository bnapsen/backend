'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createS3JsonStore } = require('./s3-json-store.js');

const MAX_PUBLIC_CLIP_COMMENTS = 10;
const MAX_STORED_CLIP_COMMENTS = 200;

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function clipSort(left, right) {
  return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
}

function normalizeLimit(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.floor(numericValue)
    : 0;
}

function normalizeEmoji(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .slice(0, 12);
}

function normalizeEmojiCounts(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const nextCounts = {};
  for (const [emoji, count] of Object.entries(raw)) {
    const safeEmoji = normalizeEmoji(emoji);
    const safeCount = Number(count || 0);
    if (!safeEmoji || !Number.isFinite(safeCount) || safeCount <= 0) {
      continue;
    }
    nextCounts[safeEmoji] = Math.floor(safeCount);
  }
  return nextCounts;
}

function commentSort(left, right) {
  return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
}

function commentRecord(record) {
  return {
    id: String(record.id || ''),
    authorName: String(record.authorName || record.uploaderName || 'Guest viewer'),
    body: String(record.body || record.message || ''),
    emoji: normalizeEmoji(record.emoji || ''),
    createdAt: String(record.createdAt || ''),
  };
}

function clipRecord(record) {
  return {
    id: String(record.id || ''),
    deleteToken: String(record.deleteToken || ''),
    title: String(record.title || ''),
    caption: String(record.caption || ''),
    uploaderName: String(record.uploaderName || ''),
    createdAt: String(record.createdAt || ''),
    durationSeconds: Number(record.durationSeconds || 0),
    sizeBytes: Number(record.sizeBytes || 0),
    mimeType: String(record.mimeType || ''),
    width: Number(record.width || 0),
    height: Number(record.height || 0),
    storageProvider: String(record.storageProvider || 'local'),
    videoStorageKey: String(record.videoStorageKey || ''),
    posterStorageKey: String(record.posterStorageKey || ''),
    reportCount: Number(record.reportCount || 0),
    status: String(record.status || 'active'),
    viewCount: Number(record.viewCount || 0),
    likeCount: Number(record.likeCount || 0),
    dislikeCount: Number(record.dislikeCount || 0),
    emojiCounts: normalizeEmojiCounts(record.emojiCounts),
    commentCount: Number(record.commentCount || 0),
    comments: Array.isArray(record.comments)
      ? record.comments.map(commentRecord).filter((comment) => comment.id)
      : [],
  };
}

function hashViewerToken(token) {
  const safeToken = String(token || '').trim();
  if (!safeToken) {
    return '';
  }
  return crypto.createHash('sha256').update(safeToken).digest('hex');
}

function normalizeInteractionBucket(record) {
  const source = record && typeof record === 'object' ? record : {};
  const nextBucket = {};

  for (const [clipId, rawEntry] of Object.entries(source)) {
    const safeClipId = String(clipId || '').trim();
    if (!safeClipId) {
      continue;
    }

    const viewHashes = Array.isArray(rawEntry && rawEntry.viewHashes)
      ? [...new Set(
        rawEntry.viewHashes
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      )]
      : [];

    const voteSource = rawEntry && typeof rawEntry.voteMap === 'object' ? rawEntry.voteMap : {};
    const voteMap = {};
    for (const [viewerHash, rawValue] of Object.entries(voteSource)) {
      const safeViewerHash = String(viewerHash || '').trim();
      const reaction = parseStoredReaction(rawValue);
      if (!safeViewerHash || !reaction) {
        continue;
      }
      voteMap[safeViewerHash] = serializeStoredReaction(reaction);
    }

    nextBucket[safeClipId] = {
      viewHashes,
      voteMap,
    };
  }

  return nextBucket;
}

function normalizeCommentsBucket(record) {
  const source = record && typeof record === 'object' ? record : {};
  const nextBucket = {};

  for (const [clipId, rawComments] of Object.entries(source)) {
    const safeClipId = String(clipId || '').trim();
    if (!safeClipId || !Array.isArray(rawComments)) {
      continue;
    }

    nextBucket[safeClipId] = rawComments
      .map(commentRecord)
      .filter((comment) => comment.id && (comment.body || comment.emoji))
      .sort(commentSort)
      .slice(0, MAX_STORED_CLIP_COMMENTS);
  }

  return nextBucket;
}

function buildReactionSummary(voteMap) {
  const summary = {
    likeCount: 0,
    dislikeCount: 0,
    emojiCounts: {},
  };

  for (const rawValue of Object.values(voteMap || {})) {
    const reaction = parseStoredReaction(rawValue);
    if (!reaction) {
      continue;
    }

    if (reaction.type === 'like') {
      summary.likeCount += 1;
      continue;
    }

    if (reaction.type === 'dislike') {
      summary.dislikeCount += 1;
      continue;
    }

    if (reaction.type === 'emoji' && reaction.emoji) {
      summary.emojiCounts[reaction.emoji] = Number(summary.emojiCounts[reaction.emoji] || 0) + 1;
    }
  }

  return summary;
}

function normalizeReactionInput(reactionType, emoji = '') {
  const safeType = String(reactionType || '').trim().toLowerCase();
  if (safeType === 'like' || safeType === 'dislike') {
    return { type: safeType, emoji: '' };
  }
  if (safeType === 'emoji') {
    const safeEmoji = normalizeEmoji(emoji);
    return safeEmoji ? { type: 'emoji', emoji: safeEmoji } : null;
  }
  return null;
}

function serializeStoredReaction(reaction) {
  if (!reaction) {
    return '';
  }
  if (reaction.type === 'like' || reaction.type === 'dislike') {
    return reaction.type;
  }
  if (reaction.type === 'emoji' && reaction.emoji) {
    return `emoji:${reaction.emoji}`;
  }
  return '';
}

function parseStoredReaction(rawValue) {
  const safeValue = String(rawValue || '').trim();
  if (safeValue === 'like' || safeValue === 'dislike') {
    return { type: safeValue, emoji: '' };
  }
  if (safeValue.startsWith('emoji:')) {
    const emoji = normalizeEmoji(safeValue.slice(6));
    return emoji ? { type: 'emoji', emoji } : null;
  }
  return null;
}

function publicReaction(reaction) {
  return reaction ? { type: reaction.type, emoji: reaction.emoji || '' } : null;
}

function decorateClip(baseClip, interactionBucket, commentsBucket) {
  const clip = clipRecord(baseClip);
  const interaction = interactionBucket && interactionBucket[clip.id]
    ? interactionBucket[clip.id]
    : { viewHashes: [], voteMap: {} };
  const comments = Array.isArray(commentsBucket && commentsBucket[clip.id])
    ? commentsBucket[clip.id].slice().sort(commentSort)
    : [];
  const reactionSummary = buildReactionSummary(interaction.voteMap);

  return clipRecord({
    ...clip,
    viewCount: Array.isArray(interaction.viewHashes) ? interaction.viewHashes.length : 0,
    likeCount: reactionSummary.likeCount,
    dislikeCount: reactionSummary.dislikeCount,
    emojiCounts: reactionSummary.emojiCounts,
    commentCount: comments.length,
    comments: comments.slice(0, MAX_PUBLIC_CLIP_COMMENTS),
  });
}

function mapPostgresClipRow(row) {
  if (!row) {
    return null;
  }

  return clipRecord({
    id: row.id,
    deleteToken: row.delete_token,
    title: row.title,
    caption: row.caption,
    uploaderName: row.uploader_name,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    durationSeconds: row.duration_seconds,
    sizeBytes: row.size_bytes,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    storageProvider: row.storage_provider,
    videoStorageKey: row.video_storage_key,
    posterStorageKey: row.poster_storage_key,
    reportCount: row.report_count,
    status: row.status,
  });
}

function mapPostgresCommentRow(row) {
  return commentRecord({
    id: row.id,
    authorName: row.author_name,
    body: row.body,
    emoji: row.emoji,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  });
}

function createClipsStore({ dataDir, databaseUrl = '', maxClips = 0, maxVisibleClips = 80 }) {
  const clipsFile = path.join(dataDir, 'clips.json');
  const reportsFile = path.join(dataDir, 'clip-reports.json');
  const interactionsFile = path.join(dataDir, 'clip-interactions.json');
  const commentsFile = path.join(dataDir, 'clip-comments.json');
  const metadataStore = createS3JsonStore();
  const usesObjectStorage = metadataStore.enabled;
  const usesPostgres = !usesObjectStorage && Boolean(String(databaseUrl || '').trim());
  const storedClipLimit = normalizeLimit(maxClips);
  const visibleClipLimit = normalizeLimit(maxVisibleClips);
  const pool = usesPostgres
    ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : undefined,
    })
    : null;

  function ensureLocalDataDir() {
    ensureDirectory(dataDir);
  }

  function applyStoredClipLimit(clips) {
    const sortedClips = clips
      .map(clipRecord)
      .sort(clipSort);

    return storedClipLimit
      ? sortedClips.slice(0, storedClipLimit)
      : sortedClips;
  }

  function applyVisibleClipLimit(clips, limit = visibleClipLimit) {
    const normalizedLimit = normalizeLimit(limit);
    return normalizedLimit
      ? clips.slice(0, normalizedLimit)
      : clips;
  }

  function readLocalClips() {
    if (!fs.existsSync(clipsFile)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(clipsFile, 'utf8'));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return applyStoredClipLimit(parsed);
    } catch (error) {
      console.error('Failed to read clips metadata:', error.message);
      return [];
    }
  }

  async function readObjectStorageClips() {
    const parsed = await metadataStore.readJson('clips/metadata/clips.json', []);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return applyStoredClipLimit(parsed);
  }

  function writeLocalClips(clips) {
    ensureLocalDataDir();
    const nextClips = applyStoredClipLimit(clips);
    const tempFile = `${clipsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(nextClips, null, 2));
    fs.renameSync(tempFile, clipsFile);
    return nextClips;
  }

  async function writeObjectStorageClips(clips) {
    const nextClips = applyStoredClipLimit(clips);
    await metadataStore.writeJson('clips/metadata/clips.json', nextClips);
    return nextClips;
  }

  function readLocalReports() {
    if (!fs.existsSync(reportsFile)) {
      return {};
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(reportsFile, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.error('Failed to read clip report data:', error.message);
      return {};
    }
  }

  async function readObjectStorageReports() {
    const parsed = await metadataStore.readJson('clips/metadata/reports.json', {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function writeLocalReports(reports) {
    ensureLocalDataDir();
    const tempFile = `${reportsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(reports, null, 2));
    fs.renameSync(tempFile, reportsFile);
  }

  async function writeObjectStorageReports(reports) {
    await metadataStore.writeJson('clips/metadata/reports.json', reports && typeof reports === 'object' ? reports : {});
  }

  function readLocalInteractions() {
    if (!fs.existsSync(interactionsFile)) {
      return {};
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
      return normalizeInteractionBucket(parsed);
    } catch (error) {
      console.error('Failed to read clip interactions:', error.message);
      return {};
    }
  }

  async function readObjectStorageInteractions() {
    const parsed = await metadataStore.readJson('clips/metadata/interactions.json', {});
    return normalizeInteractionBucket(parsed);
  }

  function writeLocalInteractions(interactions) {
    ensureLocalDataDir();
    const tempFile = `${interactionsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(normalizeInteractionBucket(interactions), null, 2));
    fs.renameSync(tempFile, interactionsFile);
  }

  async function writeObjectStorageInteractions(interactions) {
    await metadataStore.writeJson('clips/metadata/interactions.json', normalizeInteractionBucket(interactions));
  }

  function readLocalComments() {
    if (!fs.existsSync(commentsFile)) {
      return {};
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(commentsFile, 'utf8'));
      return normalizeCommentsBucket(parsed);
    } catch (error) {
      console.error('Failed to read clip comments:', error.message);
      return {};
    }
  }

  async function readObjectStorageComments() {
    const parsed = await metadataStore.readJson('clips/metadata/comments.json', {});
    return normalizeCommentsBucket(parsed);
  }

  function writeLocalComments(comments) {
    ensureLocalDataDir();
    const tempFile = `${commentsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(normalizeCommentsBucket(comments), null, 2));
    fs.renameSync(tempFile, commentsFile);
  }

  async function writeObjectStorageComments(comments) {
    await metadataStore.writeJson('clips/metadata/comments.json', normalizeCommentsBucket(comments));
  }

  async function importLocalClipsToObjectStorage() {
    const localClips = readLocalClips();
    const localReports = readLocalReports();
    const localInteractions = readLocalInteractions();
    const localComments = readLocalComments();
    if (
      !localClips.length &&
      !Object.keys(localReports).length &&
      !Object.keys(localInteractions).length &&
      !Object.keys(localComments).length
    ) {
      return;
    }

    const remoteClips = await readObjectStorageClips();
    const remoteReports = await readObjectStorageReports();
    const remoteInteractions = await readObjectStorageInteractions();
    const remoteComments = await readObjectStorageComments();

    const clipMap = new Map();
    for (const clip of [...remoteClips, ...localClips]) {
      clipMap.set(clip.id, clipRecord(clip));
    }

    const mergedReports = { ...remoteReports };
    for (const [clipId, reportHashes] of Object.entries(localReports)) {
      const seenHashes = new Set([
        ...(Array.isArray(remoteReports[clipId]) ? remoteReports[clipId] : []),
        ...(Array.isArray(reportHashes) ? reportHashes : []),
      ]);
      mergedReports[clipId] = [...seenHashes];
    }

    const mergedInteractions = normalizeInteractionBucket(remoteInteractions);
    for (const [clipId, interaction] of Object.entries(localInteractions)) {
      const existing = mergedInteractions[clipId] || { viewHashes: [], voteMap: {} };
      mergedInteractions[clipId] = {
        viewHashes: [...new Set([...(existing.viewHashes || []), ...(interaction.viewHashes || [])])],
        voteMap: {
          ...(existing.voteMap || {}),
          ...(interaction.voteMap || {}),
        },
      };
    }

    const mergedComments = normalizeCommentsBucket(remoteComments);
    for (const [clipId, comments] of Object.entries(localComments)) {
      mergedComments[clipId] = [
        ...(Array.isArray(mergedComments[clipId]) ? mergedComments[clipId] : []),
        ...(Array.isArray(comments) ? comments : []),
      ]
        .map(commentRecord)
        .filter((comment) => comment.id && (comment.body || comment.emoji))
        .sort(commentSort)
        .slice(0, MAX_STORED_CLIP_COMMENTS);
    }

    await writeObjectStorageClips([...clipMap.values()]);
    await writeObjectStorageReports(mergedReports);
    await writeObjectStorageInteractions(mergedInteractions);
    await writeObjectStorageComments(mergedComments);
  }

  async function importLocalClipsToPostgres() {
    const localClips = readLocalClips();
    if (!localClips.length) {
      return;
    }

    for (const clip of localClips) {
      await pool.query(
        `INSERT INTO clips (
          id,
          delete_token,
          title,
          caption,
          uploader_name,
          created_at,
          duration_seconds,
          size_bytes,
          mime_type,
          width,
          height,
          storage_provider,
          video_storage_key,
          poster_storage_key,
          report_count,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          clip.id,
          clip.deleteToken,
          clip.title,
          clip.caption,
          clip.uploaderName,
          clip.createdAt,
          clip.durationSeconds,
          clip.sizeBytes,
          clip.mimeType,
          clip.width,
          clip.height,
          clip.storageProvider,
          clip.videoStorageKey,
          clip.posterStorageKey,
          clip.reportCount,
          clip.status,
        ],
      );
    }
  }

  async function init() {
    if (usesObjectStorage) {
      await metadataStore.ensureReady();
      await importLocalClipsToObjectStorage();
      return;
    }

    if (!pool) {
      ensureLocalDataDir();
      return;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS clips (
        id TEXT PRIMARY KEY,
        delete_token TEXT NOT NULL,
        title TEXT NOT NULL,
        caption TEXT NOT NULL DEFAULT '',
        uploader_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration_seconds DOUBLE PRECISION NOT NULL,
        size_bytes BIGINT NOT NULL,
        mime_type TEXT NOT NULL,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        storage_provider TEXT NOT NULL DEFAULT 'local',
        video_storage_key TEXT NOT NULL,
        poster_storage_key TEXT NOT NULL,
        report_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS clips_active_created_at_idx
      ON clips (status, created_at DESC);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS clip_reports (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        reporter_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS clip_reports_unique_reporter_idx
      ON clip_reports (clip_id, reporter_hash);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS clip_views (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        viewer_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS clip_views_unique_viewer_idx
      ON clip_views (clip_id, viewer_hash);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS clip_reactions (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        viewer_hash TEXT NOT NULL,
        reaction_type TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS clip_reactions_unique_viewer_idx
      ON clip_reactions (clip_id, viewer_hash);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS clip_comments (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        commenter_hash TEXT NOT NULL,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        emoji TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS clip_comments_clip_created_idx
      ON clip_comments (clip_id, created_at DESC);
    `);

    await importLocalClipsToPostgres();
  }

  async function decoratePostgresClips(baseClips) {
    if (!baseClips.length) {
      return [];
    }

    const clipIds = baseClips.map((clip) => clip.id);
    const [viewResult, reactionResult, commentCountResult, commentsResult] = await Promise.all([
      pool.query(
        `SELECT clip_id, COUNT(*)::INT AS view_count
        FROM clip_views
        WHERE clip_id = ANY($1::text[])
        GROUP BY clip_id`,
        [clipIds],
      ),
      pool.query(
        `SELECT clip_id, reaction_type, emoji, COUNT(*)::INT AS reaction_count
        FROM clip_reactions
        WHERE clip_id = ANY($1::text[])
        GROUP BY clip_id, reaction_type, emoji`,
        [clipIds],
      ),
      pool.query(
        `SELECT clip_id, COUNT(*)::INT AS comment_count
        FROM clip_comments
        WHERE clip_id = ANY($1::text[])
        GROUP BY clip_id`,
        [clipIds],
      ),
      pool.query(
        `SELECT id, clip_id, author_name, body, emoji, created_at
        FROM clip_comments
        WHERE clip_id = ANY($1::text[])
        ORDER BY created_at DESC`,
        [clipIds],
      ),
    ]);

    const viewCounts = new Map();
    for (const row of viewResult.rows) {
      viewCounts.set(String(row.clip_id), Number(row.view_count || 0));
    }

    const reactionSummaryMap = new Map();
    for (const row of reactionResult.rows) {
      const clipId = String(row.clip_id);
      const summary = reactionSummaryMap.get(clipId) || {
        likeCount: 0,
        dislikeCount: 0,
        emojiCounts: {},
      };
      const reactionType = String(row.reaction_type || '');
      const reactionCount = Number(row.reaction_count || 0);
      if (reactionType === 'like') {
        summary.likeCount += reactionCount;
      } else if (reactionType === 'dislike') {
        summary.dislikeCount += reactionCount;
      } else if (reactionType === 'emoji') {
        const emoji = normalizeEmoji(row.emoji || '');
        if (emoji) {
          summary.emojiCounts[emoji] = Number(summary.emojiCounts[emoji] || 0) + reactionCount;
        }
      }
      reactionSummaryMap.set(clipId, summary);
    }

    const commentCounts = new Map();
    for (const row of commentCountResult.rows) {
      commentCounts.set(String(row.clip_id), Number(row.comment_count || 0));
    }

    const commentsMap = new Map();
    for (const row of commentsResult.rows) {
      const clipId = String(row.clip_id);
      const comments = commentsMap.get(clipId) || [];
      if (comments.length < MAX_PUBLIC_CLIP_COMMENTS) {
        comments.push(mapPostgresCommentRow(row));
      }
      commentsMap.set(clipId, comments);
    }

    return baseClips.map((clip) => {
      const reactionSummary = reactionSummaryMap.get(clip.id) || {
        likeCount: 0,
        dislikeCount: 0,
        emojiCounts: {},
      };
      return clipRecord({
        ...clip,
        viewCount: viewCounts.get(clip.id) || 0,
        likeCount: reactionSummary.likeCount,
        dislikeCount: reactionSummary.dislikeCount,
        emojiCounts: reactionSummary.emojiCounts,
        commentCount: commentCounts.get(clip.id) || 0,
        comments: commentsMap.get(clip.id) || [],
      });
    });
  }

  async function listVisibleClips(limit = visibleClipLimit) {
    if (usesObjectStorage) {
      const [clips, interactions, comments] = await Promise.all([
        readObjectStorageClips(),
        readObjectStorageInteractions(),
        readObjectStorageComments(),
      ]);
      return applyVisibleClipLimit(
        clips
          .filter((clip) => clip.status === 'active')
          .map((clip) => decorateClip(clip, interactions, comments)),
        limit,
      );
    }

    if (!pool) {
      const clips = readLocalClips();
      const interactions = readLocalInteractions();
      const comments = readLocalComments();
      return applyVisibleClipLimit(
        clips
          .filter((clip) => clip.status === 'active')
          .map((clip) => decorateClip(clip, interactions, comments)),
        limit,
      );
    }

    const normalizedLimit = normalizeLimit(limit);
    const limitClause = normalizedLimit ? '\n      LIMIT $1' : '';
    const queryArgs = normalizedLimit ? [normalizedLimit] : [];

    const result = await pool.query(
      `SELECT
        id,
        delete_token,
        title,
        caption,
        uploader_name,
        created_at,
        duration_seconds,
        size_bytes,
        mime_type,
        width,
        height,
        storage_provider,
        video_storage_key,
        poster_storage_key,
        report_count,
        status
      FROM clips
      WHERE status = 'active'
      ORDER BY created_at DESC${limitClause}`,
      queryArgs,
    );

    return decoratePostgresClips(result.rows.map(mapPostgresClipRow));
  }

  async function getStorageStats() {
    if (usesObjectStorage) {
      const activeClips = (await readObjectStorageClips()).filter((clip) => clip.status === 'active');
      return {
        storedClipCount: activeClips.length,
        visibleClipCount: applyVisibleClipLimit(activeClips).length,
        totalVideoBytes: activeClips.reduce((total, clip) => total + Number(clip.sizeBytes || 0), 0),
        storedClipLimit: storedClipLimit || null,
        visibleClipLimit: visibleClipLimit || null,
        storageMode: 'object-storage',
      };
    }

    if (!pool) {
      const activeClips = readLocalClips().filter((clip) => clip.status === 'active');
      return {
        storedClipCount: activeClips.length,
        visibleClipCount: applyVisibleClipLimit(activeClips).length,
        totalVideoBytes: activeClips.reduce((total, clip) => total + Number(clip.sizeBytes || 0), 0),
        storedClipLimit: storedClipLimit || null,
        visibleClipLimit: visibleClipLimit || null,
        storageMode: 'local',
      };
    }

    const result = await pool.query(
      `SELECT
        COUNT(*)::INT AS stored_clip_count,
        COALESCE(SUM(size_bytes), 0)::BIGINT AS total_video_bytes
      FROM clips
      WHERE status = 'active'`,
    );

    const row = result.rows[0] || {};
    const storedClipCount = Number(row.stored_clip_count || 0);
    return {
      storedClipCount,
      visibleClipCount: visibleClipLimit
        ? Math.min(storedClipCount, visibleClipLimit)
        : storedClipCount,
      totalVideoBytes: Number(row.total_video_bytes || 0),
      storedClipLimit: storedClipLimit || null,
      visibleClipLimit: visibleClipLimit || null,
      storageMode: 'postgres',
    };
  }

  async function insertClip(clip) {
    const nextClip = clipRecord(clip);
    if (usesObjectStorage) {
      const nextClips = await writeObjectStorageClips([nextClip, ...await readObjectStorageClips()]);
      return decorateClip(
        nextClips.find((entry) => entry.id === nextClip.id) || nextClip,
        await readObjectStorageInteractions(),
        await readObjectStorageComments(),
      );
    }

    if (!pool) {
      const nextClips = writeLocalClips([nextClip, ...readLocalClips()]);
      return decorateClip(
        nextClips.find((entry) => entry.id === nextClip.id) || nextClip,
        readLocalInteractions(),
        readLocalComments(),
      );
    }

    await pool.query(
      `INSERT INTO clips (
        id,
        delete_token,
        title,
        caption,
        uploader_name,
        created_at,
        duration_seconds,
        size_bytes,
        mime_type,
        width,
        height,
        storage_provider,
        video_storage_key,
        poster_storage_key,
        report_count,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )`,
      [
        nextClip.id,
        nextClip.deleteToken,
        nextClip.title,
        nextClip.caption,
        nextClip.uploaderName,
        nextClip.createdAt,
        nextClip.durationSeconds,
        nextClip.sizeBytes,
        nextClip.mimeType,
        nextClip.width,
        nextClip.height,
        nextClip.storageProvider,
        nextClip.videoStorageKey,
        nextClip.posterStorageKey,
        nextClip.reportCount,
        nextClip.status,
      ],
    );

    return nextClip;
  }

  async function findClipById(clipId) {
    const safeClipId = String(clipId || '').trim();
    if (!safeClipId) {
      return null;
    }

    if (usesObjectStorage) {
      const [clips, interactions, comments] = await Promise.all([
        readObjectStorageClips(),
        readObjectStorageInteractions(),
        readObjectStorageComments(),
      ]);
      const clip = clips.find((entry) => entry.id === safeClipId) || null;
      return clip ? decorateClip(clip, interactions, comments) : null;
    }

    if (!pool) {
      const clips = readLocalClips();
      const clip = clips.find((entry) => entry.id === safeClipId) || null;
      return clip ? decorateClip(clip, readLocalInteractions(), readLocalComments()) : null;
    }

    const result = await pool.query(
      `SELECT
        id,
        delete_token,
        title,
        caption,
        uploader_name,
        created_at,
        duration_seconds,
        size_bytes,
        mime_type,
        width,
        height,
        storage_provider,
        video_storage_key,
        poster_storage_key,
        report_count,
        status
      FROM clips
      WHERE id = $1
      LIMIT 1`,
      [safeClipId],
    );

    const clip = mapPostgresClipRow(result.rows[0]);
    if (!clip) {
      return null;
    }

    const [decoratedClip] = await decoratePostgresClips([clip]);
    return decoratedClip || null;
  }

  async function deleteClip(clipId) {
    const safeClipId = String(clipId || '').trim();
    if (!safeClipId) {
      return null;
    }

    if (usesObjectStorage) {
      const clips = await readObjectStorageClips();
      const removedClip = clips.find((clip) => clip.id === safeClipId) || null;
      if (!removedClip) {
        return null;
      }
      await writeObjectStorageClips(clips.filter((clip) => clip.id !== safeClipId));
      const reports = await readObjectStorageReports();
      delete reports[safeClipId];
      await writeObjectStorageReports(reports);
      const interactions = await readObjectStorageInteractions();
      delete interactions[safeClipId];
      await writeObjectStorageInteractions(interactions);
      const comments = await readObjectStorageComments();
      delete comments[safeClipId];
      await writeObjectStorageComments(comments);
      return removedClip;
    }

    if (!pool) {
      const clips = readLocalClips();
      const removedClip = clips.find((clip) => clip.id === safeClipId) || null;
      if (!removedClip) {
        return null;
      }
      writeLocalClips(clips.filter((clip) => clip.id !== safeClipId));
      const reports = readLocalReports();
      delete reports[safeClipId];
      writeLocalReports(reports);
      const interactions = readLocalInteractions();
      delete interactions[safeClipId];
      writeLocalInteractions(interactions);
      const comments = readLocalComments();
      delete comments[safeClipId];
      writeLocalComments(comments);
      return removedClip;
    }

    const result = await pool.query(
      `DELETE FROM clips
      WHERE id = $1
      RETURNING
        id,
        delete_token,
        title,
        caption,
        uploader_name,
        created_at,
        duration_seconds,
        size_bytes,
        mime_type,
        width,
        height,
        storage_provider,
        video_storage_key,
        poster_storage_key,
        report_count,
        status`,
      [safeClipId],
    );

    return mapPostgresClipRow(result.rows[0]);
  }

  async function registerReport(clipId, reporterToken) {
    const safeClipId = String(clipId || '').trim();
    const reporterHash = hashViewerToken(reporterToken);

    if (!safeClipId || !reporterHash) {
      return { clip: null, alreadyReported: false };
    }

    if (usesObjectStorage) {
      const clips = await readObjectStorageClips();
      const targetClip = clips.find((clip) => clip.id === safeClipId && clip.status === 'active');
      if (!targetClip) {
        return { clip: null, alreadyReported: false };
      }

      const reports = await readObjectStorageReports();
      const seenHashes = new Set(Array.isArray(reports[safeClipId]) ? reports[safeClipId] : []);
      if (seenHashes.has(reporterHash)) {
        return {
          clip: decorateClip(targetClip, await readObjectStorageInteractions(), await readObjectStorageComments()),
          alreadyReported: true,
        };
      }

      seenHashes.add(reporterHash);
      reports[safeClipId] = [...seenHashes];
      await writeObjectStorageReports(reports);

      targetClip.reportCount += 1;
      await writeObjectStorageClips(clips);
      return {
        clip: decorateClip(targetClip, await readObjectStorageInteractions(), await readObjectStorageComments()),
        alreadyReported: false,
      };
    }

    if (!pool) {
      const clips = readLocalClips();
      const targetClip = clips.find((clip) => clip.id === safeClipId && clip.status === 'active');
      if (!targetClip) {
        return { clip: null, alreadyReported: false };
      }

      const reports = readLocalReports();
      const seenHashes = new Set(Array.isArray(reports[safeClipId]) ? reports[safeClipId] : []);
      if (seenHashes.has(reporterHash)) {
        return {
          clip: decorateClip(targetClip, readLocalInteractions(), readLocalComments()),
          alreadyReported: true,
        };
      }

      seenHashes.add(reporterHash);
      reports[safeClipId] = [...seenHashes];
      writeLocalReports(reports);

      targetClip.reportCount += 1;
      writeLocalClips(clips);
      return {
        clip: decorateClip(targetClip, readLocalInteractions(), readLocalComments()),
        alreadyReported: false,
      };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clipResult = await client.query(
        `SELECT
          id,
          delete_token,
          title,
          caption,
          uploader_name,
          created_at,
          duration_seconds,
          size_bytes,
          mime_type,
          width,
          height,
          storage_provider,
          video_storage_key,
          poster_storage_key,
          report_count,
          status
        FROM clips
        WHERE id = $1 AND status = 'active'
        LIMIT 1`,
        [safeClipId],
      );

      const row = clipResult.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { clip: null, alreadyReported: false };
      }

      const insertReport = await client.query(
        `INSERT INTO clip_reports (id, clip_id, reporter_hash)
        VALUES ($1, $2, $3)
        ON CONFLICT (clip_id, reporter_hash) DO NOTHING`,
        [crypto.randomUUID(), safeClipId, reporterHash],
      );

      let updatedRow = row;
      let alreadyReported = false;
      if (insertReport.rowCount > 0) {
        const updatedClip = await client.query(
          `UPDATE clips
          SET report_count = report_count + 1
          WHERE id = $1
          RETURNING
            id,
            delete_token,
            title,
            caption,
            uploader_name,
            created_at,
            duration_seconds,
            size_bytes,
            mime_type,
            width,
            height,
            storage_provider,
            video_storage_key,
            poster_storage_key,
            report_count,
            status`,
          [safeClipId],
        );
        updatedRow = updatedClip.rows[0];
      } else {
        alreadyReported = true;
      }

      await client.query('COMMIT');
      const [clip] = await decoratePostgresClips([mapPostgresClipRow(updatedRow)]);
      return {
        clip,
        alreadyReported,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function registerView(clipId, viewerToken) {
    const safeClipId = String(clipId || '').trim();
    const viewerHash = hashViewerToken(viewerToken);
    if (!safeClipId || !viewerHash) {
      return { clip: null, countedView: false };
    }

    if (usesObjectStorage) {
      const [clips, interactions, comments] = await Promise.all([
        readObjectStorageClips(),
        readObjectStorageInteractions(),
        readObjectStorageComments(),
      ]);
      const targetClip = clips.find((clip) => clip.id === safeClipId && clip.status === 'active');
      if (!targetClip) {
        return { clip: null, countedView: false };
      }

      const interaction = interactions[safeClipId] || { viewHashes: [], voteMap: {} };
      const seenViews = new Set(interaction.viewHashes || []);
      if (seenViews.has(viewerHash)) {
        return { clip: decorateClip(targetClip, interactions, comments), countedView: false };
      }

      seenViews.add(viewerHash);
      interactions[safeClipId] = {
        viewHashes: [...seenViews],
        voteMap: interaction.voteMap || {},
      };
      await writeObjectStorageInteractions(interactions);
      return { clip: decorateClip(targetClip, interactions, comments), countedView: true };
    }

    if (!pool) {
      const clips = readLocalClips();
      const interactions = readLocalInteractions();
      const comments = readLocalComments();
      const targetClip = clips.find((clip) => clip.id === safeClipId && clip.status === 'active');
      if (!targetClip) {
        return { clip: null, countedView: false };
      }

      const interaction = interactions[safeClipId] || { viewHashes: [], voteMap: {} };
      const seenViews = new Set(interaction.viewHashes || []);
      if (seenViews.has(viewerHash)) {
        return { clip: decorateClip(targetClip, interactions, comments), countedView: false };
      }

      seenViews.add(viewerHash);
      interactions[safeClipId] = {
        viewHashes: [...seenViews],
        voteMap: interaction.voteMap || {},
      };
      writeLocalInteractions(interactions);
      return { clip: decorateClip(targetClip, interactions, comments), countedView: true };
    }

    const insertView = await pool.query(
      `INSERT INTO clip_views (id, clip_id, viewer_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (clip_id, viewer_hash) DO NOTHING`,
      [crypto.randomUUID(), safeClipId, viewerHash],
    );

    const clip = await findClipById(safeClipId);
    return {
      clip,
      countedView: insertView.rowCount > 0,
    };
  }

  async function registerReaction(clipId, viewerToken, reactionType, emoji = '') {
    const safeClipId = String(clipId || '').trim();
    const viewerHash = hashViewerToken(viewerToken);
    const requestedReaction = normalizeReactionInput(reactionType, emoji);
    if (!safeClipId || !viewerHash) {
      return { clip: null, activeReaction: null };
    }

    if (usesObjectStorage) {
      const [clips, interactions, comments] = await Promise.all([
        readObjectStorageClips(),
        readObjectStorageInteractions(),
        readObjectStorageComments(),
      ]);
      const targetClip = clips.find((clip) => clip.id === safeClipId && clip.status === 'active');
      if (!targetClip) {
        return { clip: null, activeReaction: null };
      }

      const interaction = interactions[safeClipId] || { viewHashes: [], voteMap: {} };
      const currentReaction = parseStoredReaction(interaction.voteMap[viewerHash]);
      const requestedValue = serializeStoredReaction(requestedReaction);
      const currentValue = serializeStoredReaction(currentReaction);
      let nextReaction = requestedReaction;

      if (!requestedReaction || (requestedValue && requestedValue === currentValue)) {
        delete interaction.voteMap[viewerHash];
        nextReaction = null;
      } else {
        interaction.voteMap[viewerHash] = requestedValue;
      }

      interactions[safeClipId] = interaction;
      await writeObjectStorageInteractions(interactions);
      return {
        clip: decorateClip(targetClip, interactions, comments),
        activeReaction: publicReaction(nextReaction),
      };
    }

    if (!pool) {
      const clips = readLocalClips();
      const interactions = readLocalInteractions();
      const comments = readLocalComments();
      const targetClip = clips.find((clip) => clip.id === safeClipId && clip.status === 'active');
      if (!targetClip) {
        return { clip: null, activeReaction: null };
      }

      const interaction = interactions[safeClipId] || { viewHashes: [], voteMap: {} };
      const currentReaction = parseStoredReaction(interaction.voteMap[viewerHash]);
      const requestedValue = serializeStoredReaction(requestedReaction);
      const currentValue = serializeStoredReaction(currentReaction);
      let nextReaction = requestedReaction;

      if (!requestedReaction || (requestedValue && requestedValue === currentValue)) {
        delete interaction.voteMap[viewerHash];
        nextReaction = null;
      } else {
        interaction.voteMap[viewerHash] = requestedValue;
      }

      interactions[safeClipId] = interaction;
      writeLocalInteractions(interactions);
      return {
        clip: decorateClip(targetClip, interactions, comments),
        activeReaction: publicReaction(nextReaction),
      };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clipResult = await client.query(
        'SELECT id FROM clips WHERE id = $1 AND status = $2 LIMIT 1',
        [safeClipId, 'active'],
      );
      if (!clipResult.rows[0]) {
        await client.query('ROLLBACK');
        return { clip: null, activeReaction: null };
      }

      const existingReactionResult = await client.query(
        `SELECT reaction_type, emoji
        FROM clip_reactions
        WHERE clip_id = $1 AND viewer_hash = $2
        LIMIT 1`,
        [safeClipId, viewerHash],
      );
      const currentReaction = existingReactionResult.rows[0]
        ? normalizeReactionInput(
          existingReactionResult.rows[0].reaction_type,
          existingReactionResult.rows[0].emoji,
        )
        : null;
      const currentValue = serializeStoredReaction(currentReaction);
      const requestedValue = serializeStoredReaction(requestedReaction);

      let nextReaction = requestedReaction;
      if (!requestedReaction || (requestedValue && requestedValue === currentValue)) {
        await client.query(
          'DELETE FROM clip_reactions WHERE clip_id = $1 AND viewer_hash = $2',
          [safeClipId, viewerHash],
        );
        nextReaction = null;
      } else {
        await client.query(
          `INSERT INTO clip_reactions (
            id,
            clip_id,
            viewer_hash,
            reaction_type,
            emoji,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, NOW(), NOW()
          )
          ON CONFLICT (clip_id, viewer_hash) DO UPDATE SET
            reaction_type = EXCLUDED.reaction_type,
            emoji = EXCLUDED.emoji,
            updated_at = NOW()`,
          [
            crypto.randomUUID(),
            safeClipId,
            viewerHash,
            requestedReaction.type,
            requestedReaction.emoji || '',
          ],
        );
      }

      await client.query('COMMIT');
      return {
        clip: await findClipById(safeClipId),
        activeReaction: publicReaction(nextReaction),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function addComment(clipId, commenterToken, { authorName = 'Guest viewer', body = '', emoji = '' } = {}) {
    const safeClipId = String(clipId || '').trim();
    const commenterHash = hashViewerToken(commenterToken);
    const nextComment = commentRecord({
      id: crypto.randomUUID(),
      authorName,
      body,
      emoji,
      createdAt: new Date().toISOString(),
    });

    if (!safeClipId || !commenterHash || (!nextComment.body && !nextComment.emoji)) {
      return { clip: null, comment: null };
    }

    if (usesObjectStorage) {
      const [clips, interactions, comments] = await Promise.all([
        readObjectStorageClips(),
        readObjectStorageInteractions(),
        readObjectStorageComments(),
      ]);
      const targetClip = clips.find((clip) => clip.id === safeClipId && clip.status === 'active');
      if (!targetClip) {
        return { clip: null, comment: null };
      }

      comments[safeClipId] = [
        nextComment,
        ...(Array.isArray(comments[safeClipId]) ? comments[safeClipId] : []),
      ]
        .map(commentRecord)
        .filter((comment) => comment.id && (comment.body || comment.emoji))
        .sort(commentSort)
        .slice(0, MAX_STORED_CLIP_COMMENTS);

      await writeObjectStorageComments(comments);
      return {
        clip: decorateClip(targetClip, interactions, comments),
        comment: nextComment,
      };
    }

    if (!pool) {
      const clips = readLocalClips();
      const interactions = readLocalInteractions();
      const comments = readLocalComments();
      const targetClip = clips.find((clip) => clip.id === safeClipId && clip.status === 'active');
      if (!targetClip) {
        return { clip: null, comment: null };
      }

      comments[safeClipId] = [
        nextComment,
        ...(Array.isArray(comments[safeClipId]) ? comments[safeClipId] : []),
      ]
        .map(commentRecord)
        .filter((comment) => comment.id && (comment.body || comment.emoji))
        .sort(commentSort)
        .slice(0, MAX_STORED_CLIP_COMMENTS);

      writeLocalComments(comments);
      return {
        clip: decorateClip(targetClip, interactions, comments),
        comment: nextComment,
      };
    }

    await pool.query(
      `INSERT INTO clip_comments (
        id,
        clip_id,
        commenter_hash,
        author_name,
        body,
        emoji,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      )`,
      [
        nextComment.id,
        safeClipId,
        commenterHash,
        nextComment.authorName,
        nextComment.body,
        nextComment.emoji,
        nextComment.createdAt,
      ],
    );

    return {
      clip: await findClipById(safeClipId),
      comment: nextComment,
    };
  }

  async function close() {
    if (pool) {
      await pool.end();
    }
  }

  return {
    init,
    listVisibleClips,
    getStorageStats,
    insertClip,
    findClipById,
    deleteClip,
    registerReport,
    registerView,
    registerReaction,
    addComment,
    close,
    usesObjectStorage,
    usesPostgres,
  };
}

module.exports = {
  createClipsStore,
};
