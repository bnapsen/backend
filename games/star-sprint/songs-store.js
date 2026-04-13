'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function songSort(left, right) {
  return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
}

function songRecord(record) {
  const storageProvider = String(
    record.storageProvider ||
    (record.storage === 'uploaded' ? 'local' : record.storage || 'local'),
  ).toLowerCase();

  return {
    id: String(record.id || ''),
    deleteToken: String(record.deleteToken || ''),
    title: String(record.title || ''),
    artist: String(record.artist || ''),
    uploaderName: String(record.uploaderName || ''),
    description: String(record.description || ''),
    createdAt: String(record.createdAt || ''),
    sizeBytes: Number(record.sizeBytes || 0),
    mimeType: String(record.mimeType || ''),
    storageProvider: storageProvider === 's3' ? 's3' : 'local',
    audioStorageKey: String(record.audioStorageKey || record.storageName || ''),
    fileName: String(record.fileName || ''),
    status: String(record.status || 'active'),
  };
}

function createSongsStore({ dataDir, databaseUrl = '', maxSongs = 80, maxVisibleSongs = 40 }) {
  const songsFile = path.join(dataDir, 'songs.json');
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

  function readLocalSongs() {
    if (!fs.existsSync(songsFile)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(songsFile, 'utf8'));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((entry) => entry && typeof entry === 'object')
        .map(songRecord)
        .sort(songSort)
        .slice(0, maxSongs);
    } catch (error) {
      console.error('Failed to read stored songs:', error.message);
      return [];
    }
  }

  function writeLocalSongs(songs) {
    ensureLocalDataDir();
    const nextSongs = songs
      .map(songRecord)
      .sort(songSort)
      .slice(0, maxSongs);
    const tempFile = `${songsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(nextSongs, null, 2));
    fs.renameSync(tempFile, songsFile);
    return nextSongs;
  }

  async function importLocalSongsToPostgres() {
    const localSongs = readLocalSongs();
    if (!localSongs.length) {
      return;
    }

    for (const song of localSongs) {
      await pool.query(
        `INSERT INTO songs (
          id,
          delete_token,
          title,
          artist,
          uploader_name,
          description,
          created_at,
          size_bytes,
          mime_type,
          storage_provider,
          audio_storage_key,
          file_name,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          song.id,
          song.deleteToken,
          song.title,
          song.artist,
          song.uploaderName,
          song.description,
          song.createdAt,
          song.sizeBytes,
          song.mimeType,
          song.storageProvider,
          song.audioStorageKey,
          song.fileName,
          song.status,
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
      CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        delete_token TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        uploader_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        size_bytes BIGINT NOT NULL,
        mime_type TEXT NOT NULL,
        storage_provider TEXT NOT NULL DEFAULT 'local',
        audio_storage_key TEXT NOT NULL,
        file_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS songs_active_created_at_idx
      ON songs (status, created_at DESC);
    `);

    await importLocalSongsToPostgres();
  }

  async function listStoredSongs(limit = maxSongs) {
    if (!pool) {
      return readLocalSongs()
        .filter((song) => song.status === 'active')
        .slice(0, limit);
    }

    const result = await pool.query(
      `SELECT
        id,
        delete_token,
        title,
        artist,
        uploader_name,
        description,
        created_at,
        size_bytes,
        mime_type,
        storage_provider,
        audio_storage_key,
        file_name,
        status
      FROM songs
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => songRecord({
      id: row.id,
      deleteToken: row.delete_token,
      title: row.title,
      artist: row.artist,
      uploaderName: row.uploader_name,
      description: row.description,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      sizeBytes: row.size_bytes,
      mimeType: row.mime_type,
      storageProvider: row.storage_provider,
      audioStorageKey: row.audio_storage_key,
      fileName: row.file_name,
      status: row.status,
    }));
  }

  async function listVisibleSongs(limit = maxVisibleSongs) {
    return listStoredSongs(limit);
  }

  async function insertSong(song) {
    const nextSong = songRecord(song);
    if (!pool) {
      const nextSongs = writeLocalSongs([nextSong, ...readLocalSongs()]);
      return nextSongs.find((entry) => entry.id === nextSong.id) || nextSong;
    }

    await pool.query(
      `INSERT INTO songs (
        id,
        delete_token,
        title,
        artist,
        uploader_name,
        description,
        created_at,
        size_bytes,
        mime_type,
        storage_provider,
        audio_storage_key,
        file_name,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )`,
      [
        nextSong.id,
        nextSong.deleteToken,
        nextSong.title,
        nextSong.artist,
        nextSong.uploaderName,
        nextSong.description,
        nextSong.createdAt,
        nextSong.sizeBytes,
        nextSong.mimeType,
        nextSong.storageProvider,
        nextSong.audioStorageKey,
        nextSong.fileName,
        nextSong.status,
      ],
    );

    return nextSong;
  }

  async function findSongById(songId) {
    const safeSongId = String(songId || '').trim();
    if (!safeSongId) {
      return null;
    }

    if (!pool) {
      return readLocalSongs().find((song) => song.id === safeSongId) || null;
    }

    const result = await pool.query(
      `SELECT
        id,
        delete_token,
        title,
        artist,
        uploader_name,
        description,
        created_at,
        size_bytes,
        mime_type,
        storage_provider,
        audio_storage_key,
        file_name,
        status
      FROM songs
      WHERE id = $1
      LIMIT 1`,
      [safeSongId],
    );

    const row = result.rows[0];
    return row ? songRecord({
      id: row.id,
      deleteToken: row.delete_token,
      title: row.title,
      artist: row.artist,
      uploaderName: row.uploader_name,
      description: row.description,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      sizeBytes: row.size_bytes,
      mimeType: row.mime_type,
      storageProvider: row.storage_provider,
      audioStorageKey: row.audio_storage_key,
      fileName: row.file_name,
      status: row.status,
    }) : null;
  }

  async function deleteSong(songId) {
    const safeSongId = String(songId || '').trim();
    if (!safeSongId) {
      return null;
    }

    if (!pool) {
      const songs = readLocalSongs();
      const removedSong = songs.find((song) => song.id === safeSongId) || null;
      if (!removedSong) {
        return null;
      }
      writeLocalSongs(songs.filter((song) => song.id !== safeSongId));
      return removedSong;
    }

    const result = await pool.query(
      `DELETE FROM songs
      WHERE id = $1
      RETURNING
        id,
        delete_token,
        title,
        artist,
        uploader_name,
        description,
        created_at,
        size_bytes,
        mime_type,
        storage_provider,
        audio_storage_key,
        file_name,
        status`,
      [safeSongId],
    );

    const row = result.rows[0];
    return row ? songRecord({
      id: row.id,
      deleteToken: row.delete_token,
      title: row.title,
      artist: row.artist,
      uploaderName: row.uploader_name,
      description: row.description,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      sizeBytes: row.size_bytes,
      mimeType: row.mime_type,
      storageProvider: row.storage_provider,
      audioStorageKey: row.audio_storage_key,
      fileName: row.file_name,
      status: row.status,
    }) : null;
  }

  async function close() {
    if (pool) {
      await pool.end();
    }
  }

  return {
    init,
    listStoredSongs,
    listVisibleSongs,
    insertSong,
    findSongById,
    deleteSong,
    close,
    usesPostgres,
  };
}

module.exports = {
  createSongsStore,
};
