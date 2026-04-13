'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = require('@aws-sdk/client-s3');

const SONG_EXTENSION_TO_MIME = new Map([
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav'],
]);

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeSongFileName(raw) {
  return path.basename(String(raw || ''))
    .replace(/[^\w.\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function inferSongTitle(fileName) {
  const extension = path.extname(String(fileName || ''));
  return path.basename(String(fileName || ''), extension)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Untitled Upload';
}

function normalizeSongUploadType(fileName, mimeType) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  const allowedMimeType = SONG_EXTENSION_TO_MIME.get(extension);
  if (!allowedMimeType) {
    return null;
  }

  const normalizedMimeType = String(mimeType || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();

  if (!normalizedMimeType) {
    return {
      extension,
      mimeType: allowedMimeType,
    };
  }

  const allowedMimeTypes = new Set([allowedMimeType]);
  if (allowedMimeType === 'audio/wav') {
    allowedMimeTypes.add('audio/x-wav');
    allowedMimeTypes.add('audio/wave');
  }
  if (allowedMimeType === 'audio/mpeg') {
    allowedMimeTypes.add('audio/mp3');
    allowedMimeTypes.add('audio/x-mp3');
  }
  if (allowedMimeType === 'audio/mp4') {
    allowedMimeTypes.add('audio/x-m4a');
  }

  if (!allowedMimeTypes.has(normalizedMimeType)) {
    return null;
  }

  return {
    extension,
    mimeType: allowedMimeType,
  };
}

function contentTypeForSongFile(fileName, fallback = 'application/octet-stream') {
  return SONG_EXTENSION_TO_MIME.get(path.extname(String(fileName || '')).toLowerCase()) || fallback;
}

function safeMediaKey(raw) {
  const key = path.basename(String(raw || '').trim());
  return key && key === String(raw || '').trim() ? key : '';
}

function storageProviderForEntry(storageProvider) {
  return String(storageProvider || '').toLowerCase() === 's3' ? 's3' : 'local';
}

function createSongMediaManager({ dataDir }) {
  const songsDir = path.join(dataDir, 'songs');
  const s3Enabled = Boolean(
    process.env.S3_BUCKET &&
    process.env.S3_REGION &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY,
  );

  const s3Client = s3Enabled
    ? new S3Client({
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    })
    : null;

  let bucketReadyPromise = null;

  function ensureSongDirs() {
    if (!s3Enabled) {
      ensureDirectory(songsDir);
    }
  }

  async function ensureBucket() {
    if (!s3Enabled) {
      return;
    }
    if (!bucketReadyPromise) {
      bucketReadyPromise = (async () => {
        try {
          await s3Client.send(new HeadBucketCommand({
            Bucket: process.env.S3_BUCKET,
          }));
        } catch (error) {
          const statusCode = Number(error && error.$metadata && error.$metadata.httpStatusCode);
          const errorName = String(error && error.name || '');
          if (statusCode !== 404 && errorName !== 'NotFound' && errorName !== 'NoSuchBucket') {
            throw error;
          }
          await s3Client.send(new CreateBucketCommand({
            Bucket: process.env.S3_BUCKET,
          }));
        }
      })().catch((error) => {
        bucketReadyPromise = null;
        throw error;
      });
    }
    await bucketReadyPromise;
  }

  async function persistUpload(songFile) {
    const extension = path.extname(String(songFile.originalFileName || '')).toLowerCase() || '.mp3';
    const storageKey = `${Date.now()}-${crypto.randomUUID()}${extension}`;

    if (s3Enabled) {
      await ensureBucket();
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `songs/audio/${storageKey}`,
        Body: songFile.buffer,
        ContentType: songFile.mimeType || contentTypeForSongFile(storageKey),
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return {
        storageProvider: 's3',
        audioStorageKey: storageKey,
      };
    }

    ensureSongDirs();
    const tempPath = path.join(songsDir, `${storageKey}.tmp`);
    const finalPath = path.join(songsDir, storageKey);
    await fs.promises.writeFile(tempPath, songFile.buffer);
    await fs.promises.rename(tempPath, finalPath);
    return {
      storageProvider: 'local',
      audioStorageKey: storageKey,
    };
  }

  function publicSongMedia(song) {
    const provider = storageProviderForEntry(song.storageProvider);
    const safeKeyName = safeMediaKey(song.audioStorageKey);
    return {
      audioPath: `/media/songs/${provider}/${encodeURIComponent(safeKeyName)}`,
    };
  }

  async function deleteSongAsset(song) {
    const provider = storageProviderForEntry(song.storageProvider);
    const safeKeyName = safeMediaKey(song.audioStorageKey);
    if (!safeKeyName) {
      return;
    }

    if (provider === 's3') {
      await ensureBucket();
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `songs/audio/${safeKeyName}`,
      }));
      return;
    }

    await fs.promises.rm(path.join(songsDir, safeKeyName), { force: true });
  }

  async function streamAsset(req, res, rawProvider, rawKey, streamLocalFile) {
    const provider = storageProviderForEntry(rawProvider);
    const safeKeyName = safeMediaKey(rawKey);
    if (!safeKeyName) {
      const error = new Error('Song not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (provider !== 's3') {
      streamLocalFile(req, res, path.join(songsDir, safeKeyName), contentTypeForSongFile(safeKeyName));
      return;
    }

    await ensureBucket();
    const range = String(req.headers.range || '').trim();
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: `songs/audio/${safeKeyName}`,
      Range: range || undefined,
    }));

    const headers = {
      'Content-Type': contentTypeForSongFile(safeKeyName),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      Vary: 'Origin',
    };

    if (response.ContentLength != null) {
      headers['Content-Length'] = String(response.ContentLength);
    }
    if (response.ContentRange) {
      headers['Content-Range'] = String(response.ContentRange);
    }

    res.writeHead(response.ContentRange ? 206 : 200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    response.Body.pipe(res);
  }

  function logConfiguration() {
    console.log(`Song media storage: ${s3Enabled ? 's3-compatible object storage' : 'local persistent disk'}`);
  }

  return {
    ensureSongDirs,
    ensureBucket,
    persistUpload,
    publicSongMedia,
    deleteSongAsset,
    streamAsset,
    logConfiguration,
  };
}

module.exports = {
  createSongMediaManager,
  sanitizeSongFileName,
  inferSongTitle,
  normalizeSongUploadType,
  contentTypeForSongFile,
};
