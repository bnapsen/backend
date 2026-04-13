'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const execFile = promisify(childProcess.execFile);

const VIDEO_EXTENSION_TO_MIME = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.3gp', 'video/3gpp'],
  ['.3gpp', 'video/3gpp'],
]);
const VIDEO_MIME_TO_EXTENSION = new Map([
  ['video/mp4', '.mp4'],
  ['video/x-m4v', '.m4v'],
  ['video/quicktime', '.mov'],
  ['video/webm', '.webm'],
  ['video/3gpp', '.3gp'],
  ['video/3gp', '.3gp'],
]);

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeClipFileName(raw) {
  return String(raw || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function inferClipTitle(fileName) {
  return String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Untitled Clip';
}

function normalizeClipUploadType(fileName, mimeType) {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  const extension = path.extname(String(fileName || '')).toLowerCase();
  const inferredExtension = VIDEO_EXTENSION_TO_MIME.has(extension)
    ? extension
    : VIDEO_MIME_TO_EXTENSION.get(normalizedMimeType || '') || '';
  const allowedMimeType = VIDEO_EXTENSION_TO_MIME.get(inferredExtension);

  if (!allowedMimeType) {
    return null;
  }

  if (!normalizedMimeType || normalizedMimeType.startsWith('video/')) {
    return {
      extension: inferredExtension,
      mimeType: allowedMimeType,
    };
  }

  return null;
}

function contentTypeForClipFile(fileName, fallback = 'application/octet-stream') {
  return VIDEO_EXTENSION_TO_MIME.get(path.extname(String(fileName || '')).toLowerCase()) || fallback;
}

function safeMediaKey(raw) {
  const key = path.basename(String(raw || '').trim());
  return key && key === String(raw || '').trim() ? key : '';
}

function createClipMediaManager({ dataDir }) {
  const clipsRootDir = path.join(dataDir, 'clips');
  const tempDir = path.join(clipsRootDir, 'tmp');
  const videosDir = path.join(clipsRootDir, 'videos');
  const postersDir = path.join(clipsRootDir, 'posters');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
  const ffprobePath = process.env.FFPROBE_PATH || ffprobeStatic.path || 'ffprobe';

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

  function ensureClipDirs() {
    ensureDirectory(clipsRootDir);
    ensureDirectory(tempDir);
    if (!s3Enabled) {
      ensureDirectory(videosDir);
      ensureDirectory(postersDir);
    }
  }

  async function runMediaTool(binaryPath, args) {
    try {
      const { stdout, stderr } = await execFile(binaryPath, args, {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      return {
        stdout,
        stderr,
      };
    } catch (error) {
      const stderr = error.stderr || error.stdout || error.message;
      throw new Error(stderr || `${path.basename(binaryPath)} failed.`);
    }
  }

  async function probeVideoFile(filePath) {
    const { stdout } = await runMediaTool(ffprobePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    const parsed = JSON.parse(stdout || '{}');
    const videoStream = Array.isArray(parsed.streams)
      ? parsed.streams.find((stream) => stream && stream.codec_type === 'video')
      : null;

    if (!videoStream) {
      throw new Error('That upload does not contain a readable video stream.');
    }

    const durationSeconds = Number(videoStream.duration || (parsed.format && parsed.format.duration) || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('That video could not be measured.');
    }

    return {
      durationSeconds,
      width: Number(videoStream.width || 0),
      height: Number(videoStream.height || 0),
    };
  }

  async function transcodeVideoToMp4(inputPath, outputPath) {
    await runMediaTool(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-ar', '48000',
      '-t', '30',
      outputPath,
    ]);
  }

  async function generatePosterFrame(inputPath, outputPath, durationSeconds) {
    const captureTime = Math.max(0.2, Math.min(durationSeconds * 0.25, 2.5));
    await runMediaTool(ffmpegPath, [
      '-y',
      '-ss', captureTime.toFixed(2),
      '-i', inputPath,
      '-frames:v', '1',
      '-vf', "scale='min(720,iw)':-2:force_original_aspect_ratio=decrease",
      outputPath,
    ]);
  }

  async function writeAssetFromTemp(tempPath, assetType, key, contentType) {
    const safeKeyName = safeMediaKey(key);
    if (!safeKeyName) {
      throw new Error('Invalid media key.');
    }

    if (s3Enabled) {
      const prefix = assetType === 'video' ? 'clips/videos' : 'clips/posters';
      const body = await fs.promises.readFile(tempPath);
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `${prefix}/${safeKeyName}`,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return;
    }

    const targetDir = assetType === 'video' ? videosDir : postersDir;
    ensureDirectory(targetDir);
    await fs.promises.rename(tempPath, path.join(targetDir, safeKeyName));
  }

  async function processUpload(uploadedFile) {
    ensureClipDirs();

    const inputExtension = path.extname(String(uploadedFile.originalFileName || '')).toLowerCase() || '.mp4';
    const tempInputPath = path.join(tempDir, `${crypto.randomUUID()}${inputExtension}`);
    const tempVideoOutputPath = path.join(tempDir, `${crypto.randomUUID()}.mp4`);
    const tempPosterOutputPath = path.join(tempDir, `${crypto.randomUUID()}.jpg`);

    await fs.promises.writeFile(tempInputPath, uploadedFile.buffer);

    let measured = null;
    try {
      measured = await probeVideoFile(tempInputPath);
      if (measured.durationSeconds > 30.4) {
        throw new Error('Videos must be 30 seconds or shorter.');
      }

      await transcodeVideoToMp4(tempInputPath, tempVideoOutputPath);
      const transcodedMeasure = await probeVideoFile(tempVideoOutputPath);
      await generatePosterFrame(tempVideoOutputPath, tempPosterOutputPath, transcodedMeasure.durationSeconds);
      const transcodedStats = await fs.promises.stat(tempVideoOutputPath);

      const storageStem = `${Date.now()}-${crypto.randomUUID()}`;
      const videoStorageKey = `${storageStem}.mp4`;
      const posterStorageKey = `${storageStem}.jpg`;

      await writeAssetFromTemp(tempVideoOutputPath, 'video', videoStorageKey, 'video/mp4');
      await writeAssetFromTemp(tempPosterOutputPath, 'poster', posterStorageKey, 'image/jpeg');

      return {
        durationSeconds: transcodedMeasure.durationSeconds,
        width: transcodedMeasure.width,
        height: transcodedMeasure.height,
        sizeBytes: transcodedStats.size,
        mimeType: 'video/mp4',
        storageProvider: s3Enabled ? 's3' : 'local',
        videoStorageKey,
        posterStorageKey,
      };
    } finally {
      await Promise.allSettled([
        fs.promises.rm(tempInputPath, { force: true }),
        fs.promises.rm(tempVideoOutputPath, { force: true }),
        fs.promises.rm(tempPosterOutputPath, { force: true }),
      ]);
    }
  }

  function publicClipMedia(clip) {
    return {
      videoPath: `/media/clips/videos/${encodeURIComponent(String(clip.videoStorageKey || ''))}`,
      posterPath: `/media/clips/posters/${encodeURIComponent(String(clip.posterStorageKey || ''))}`,
    };
  }

  async function deleteClipAssets(clip) {
    const safeVideoKey = safeMediaKey(clip.videoStorageKey);
    const safePosterKey = safeMediaKey(clip.posterStorageKey);
    if (s3Enabled) {
      const commands = [];
      if (safeVideoKey) {
        commands.push(s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: `clips/videos/${safeVideoKey}`,
        })));
      }
      if (safePosterKey) {
        commands.push(s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: `clips/posters/${safePosterKey}`,
        })));
      }
      await Promise.allSettled(commands);
      return;
    }

    await Promise.allSettled([
      safeVideoKey ? fs.promises.rm(path.join(videosDir, safeVideoKey), { force: true }) : Promise.resolve(),
      safePosterKey ? fs.promises.rm(path.join(postersDir, safePosterKey), { force: true }) : Promise.resolve(),
    ]);
  }

  async function streamAsset(req, res, assetType, rawKey, streamLocalFile) {
    const safeKeyName = safeMediaKey(rawKey);
    if (!safeKeyName) {
      const error = new Error('Clip media not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (!s3Enabled) {
      const targetDir = assetType === 'video' ? videosDir : postersDir;
      const filePath = path.join(targetDir, safeKeyName);
      streamLocalFile(req, res, filePath, assetType === 'video' ? 'video/mp4' : 'image/jpeg');
      return;
    }

    const prefix = assetType === 'video' ? 'clips/videos' : 'clips/posters';
    const range = assetType === 'video' ? String(req.headers.range || '').trim() : '';
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: `${prefix}/${safeKeyName}`,
      Range: range || undefined,
    }));

    const headers = {
      'Content-Type': assetType === 'video' ? 'video/mp4' : 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': assetType === 'video' ? 'bytes' : 'none',
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
    console.log(`Clip media storage: ${s3Enabled ? 's3-compatible object storage' : 'local persistent disk'}`);
  }

  return {
    processUpload,
    publicClipMedia,
    deleteClipAssets,
    streamAsset,
    ensureClipDirs,
    logConfiguration,
  };
}

module.exports = {
  createClipMediaManager,
  sanitizeClipFileName,
  inferClipTitle,
  normalizeClipUploadType,
  contentTypeForClipFile,
};
