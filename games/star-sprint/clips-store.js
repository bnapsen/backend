'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function clipSort(left, right) {
  return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
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
  };
}

function createClipsStore({ dataDir, databaseUrl = '', maxClips = 300, maxVisibleClips = 80 }) {
  const clipsFile = path.join(dataDir, 'clips.json');
  const reportsFile = path.join(dataDir, 'clip-reports.json');
  const usesPostgres = Boolean(String(databaseUrl || '').trim());
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

  function readLocalClips() {
    if (!fs.existsSync(clipsFile)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(clipsFile, 'utf8'));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map(clipRecord).sort(clipSort).slice(0, maxClips);
    } catch (error) {
      console.error('Failed to read clips metadata:', error.message);
      return [];
    }
  }

  function writeLocalClips(clips) {
    ensureLocalDataDir();
    const nextClips = clips
      .map(clipRecord)
      .sort(clipSort)
      .slice(0, maxClips);
    const tempFile = `${clipsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(nextClips, null, 2));
    fs.renameSync(tempFile, clipsFile);
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

  function writeLocalReports(reports) {
    ensureLocalDataDir();
    const tempFile = `${reportsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(reports, null, 2));
    fs.renameSync(tempFile, reportsFile);
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

    await importLocalClipsToPostgres();
  }

  async function listVisibleClips(limit = maxVisibleClips) {
    if (!pool) {
      return readLocalClips()
        .filter((clip) => clip.status === 'active')
        .slice(0, limit);
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
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => clipRecord({
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
    }));
  }

  async function insertClip(clip) {
    const nextClip = clipRecord(clip);
    if (!pool) {
      const nextClips = writeLocalClips([nextClip, ...readLocalClips()]);
      return nextClips.find((entry) => entry.id === nextClip.id) || nextClip;
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

    if (!pool) {
      return readLocalClips().find((clip) => clip.id === safeClipId) || null;
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

    const row = result.rows[0];
    return row ? clipRecord({
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
    }) : null;
  }

  async function deleteClip(clipId) {
    const safeClipId = String(clipId || '').trim();
    if (!safeClipId) {
      return null;
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

    const row = result.rows[0];
    return row ? clipRecord({
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
    }) : null;
  }

  async function registerReport(clipId, reporterToken) {
    const safeClipId = String(clipId || '').trim();
    const reporterHash = crypto.createHash('sha256')
      .update(String(reporterToken || '').trim())
      .digest('hex');

    if (!safeClipId || !reporterHash) {
      return { clip: null, alreadyReported: false };
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
        return { clip: targetClip, alreadyReported: true };
      }

      seenHashes.add(reporterHash);
      reports[safeClipId] = [...seenHashes];
      writeLocalReports(reports);

      targetClip.reportCount += 1;
      writeLocalClips(clips);
      return { clip: targetClip, alreadyReported: false };
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
      return {
        clip: clipRecord({
          id: updatedRow.id,
          deleteToken: updatedRow.delete_token,
          title: updatedRow.title,
          caption: updatedRow.caption,
          uploaderName: updatedRow.uploader_name,
          createdAt: updatedRow.created_at instanceof Date ? updatedRow.created_at.toISOString() : updatedRow.created_at,
          durationSeconds: updatedRow.duration_seconds,
          sizeBytes: updatedRow.size_bytes,
          mimeType: updatedRow.mime_type,
          width: updatedRow.width,
          height: updatedRow.height,
          storageProvider: updatedRow.storage_provider,
          videoStorageKey: updatedRow.video_storage_key,
          posterStorageKey: updatedRow.poster_storage_key,
          reportCount: updatedRow.report_count,
          status: updatedRow.status,
        }),
        alreadyReported,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function close() {
    if (pool) {
      await pool.end();
    }
  }

  return {
    init,
    listVisibleClips,
    insertClip,
    findClipById,
    deleteClip,
    registerReport,
    close,
    usesPostgres,
  };
}

module.exports = {
  createClipsStore,
};
