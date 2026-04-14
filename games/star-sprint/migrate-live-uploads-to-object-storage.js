#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createSongMediaManager,
  sanitizeSongFileName,
} = require('./song-media.js');
const {
  createClipMediaManager,
} = require('./clip-media.js');
const { createSongsStore } = require('./songs-store.js');
const { createClipsStore } = require('./clips-store.js');

const LIVE_API_BASE = String(process.env.LIVE_API_BASE || 'https://backend-ujaa.onrender.com').replace(/\/+$/, '');

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

async function readBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function absoluteMediaUrl(relativeOrAbsolute) {
  return new URL(String(relativeOrAbsolute || ''), `${LIVE_API_BASE}/`).toString();
}

async function main() {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-object-migrate-'));
  const songMediaManager = createSongMediaManager({ dataDir: tempDataDir });
  const clipMediaManager = createClipMediaManager({ dataDir: tempDataDir });
  const songsStore = createSongsStore({ dataDir: tempDataDir, maxSongs: 400 });
  const clipsStore = createClipsStore({ dataDir: tempDataDir, maxClips: 800, maxVisibleClips: 800 });
  const migrationManifest = {
    base: LIVE_API_BASE,
    migratedAt: new Date().toISOString(),
    songs: [],
    clips: [],
  };

  try {
    await songsStore.init();
    await clipsStore.init();

    const [songsPayload, clipsPayload] = await Promise.all([
      readJson(`${LIVE_API_BASE}/api/songs`),
      readJson(`${LIVE_API_BASE}/api/clips`),
    ]);

    const communitySongs = Array.isArray(songsPayload.songs)
      ? songsPayload.songs.filter((song) => song && song.source === 'community')
      : [];
    const communityClips = Array.isArray(clipsPayload.clips)
      ? clipsPayload.clips.filter((clip) => clip && clip.source === 'community')
      : [];

    for (const song of communitySongs) {
      if (await songsStore.findSongById(song.id)) {
        continue;
      }

      const audioBuffer = await readBuffer(absoluteMediaUrl(song.audioPath));
      const persistedMedia = await songMediaManager.persistUpload({
        originalFileName: sanitizeSongFileName(song.originalFileName || `${song.id}.wav`) || `${song.id}.wav`,
        mimeType: song.mimeType || 'audio/wav',
        buffer: audioBuffer,
      });

      await songsStore.insertSong({
        id: song.id,
        deleteToken: '',
        title: song.title,
        artist: song.artist,
        uploaderName: song.uploaderName,
        description: song.description,
        createdAt: song.createdAt,
        sizeBytes: song.sizeBytes,
        mimeType: song.mimeType,
        storageProvider: persistedMedia.storageProvider,
        audioStorageKey: persistedMedia.audioStorageKey,
        fileName: song.originalFileName,
        status: 'active',
      });

      migrationManifest.songs.push({
        id: song.id,
        title: song.title,
        audioStorageKey: persistedMedia.audioStorageKey,
      });
    }

    for (const clip of communityClips) {
      if (await clipsStore.findClipById(clip.id)) {
        continue;
      }

      const clipBuffer = await readBuffer(absoluteMediaUrl(clip.videoPath));
      const processedClip = await clipMediaManager.processUpload({
        originalFileName: `${clip.id}.mp4`,
        mimeType: clip.mimeType || 'video/mp4',
        sizeBytes: clipBuffer.length,
        buffer: clipBuffer,
      });

      const deleteToken = crypto.randomBytes(24).toString('hex');
      await clipsStore.insertClip({
        id: clip.id,
        deleteToken,
        title: clip.title,
        caption: clip.caption,
        uploaderName: clip.uploaderName,
        createdAt: clip.createdAt,
        durationSeconds: processedClip.durationSeconds,
        sizeBytes: processedClip.sizeBytes,
        mimeType: processedClip.mimeType,
        width: processedClip.width,
        height: processedClip.height,
        storageProvider: processedClip.storageProvider,
        videoStorageKey: processedClip.videoStorageKey,
        posterStorageKey: processedClip.posterStorageKey,
        reportCount: 0,
        status: 'active',
      });

      migrationManifest.clips.push({
        id: clip.id,
        title: clip.title,
        deleteToken,
        videoStorageKey: processedClip.videoStorageKey,
        posterStorageKey: processedClip.posterStorageKey,
      });
    }

    const manifestPath = path.join(process.cwd(), 'migration-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(migrationManifest, null, 2));
    console.log(JSON.stringify({
      ok: true,
      songsMigrated: migrationManifest.songs.length,
      clipsMigrated: migrationManifest.clips.length,
      manifestPath,
    }));
  } finally {
    await Promise.allSettled([
      songsStore.close(),
      clipsStore.close(),
    ]);
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
