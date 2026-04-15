'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = require('@aws-sdk/client-s3');
const { Storage } = require('@google-cloud/storage');

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

function storageProviderForEntry(storageProvider) {
  return String(storageProvider || '').toLowerCase() === 's3' ? 's3' : 'local';
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
  const rawClipBucket = String(process.env.S3_BUCKET || '').trim();
  const publicClipBucket = String(process.env.CLIP_PUBLIC_BUCKET || '').trim();
  const directPlaybackBaseUrl = String(
    process.env.CLIP_PUBLIC_BASE_URL
      || (publicClipBucket ? `https://storage.googleapis.com/${publicClipBucket}` : ''),
  ).trim().replace(/\/$/, '');
  const usesGoogleStorage = s3Enabled
    && /storage\.googleapis\.com/i.test(String(process.env.S3_ENDPOINT || 'https://storage.googleapis.com'));
  const storageClient = usesGoogleStorage
    ? new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined })
    : null;
  const directUploadsEnabled = Boolean(storageClient && rawClipBucket);

  const s3Client = s3Enabled
    ? new S3Client({
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    })
    : null;
  const bucketReadyPromises = new Map();

  function ensureClipDirs() {
    ensureDirectory(clipsRootDir);
    ensureDirectory(tempDir);
    if (!s3Enabled) {
      ensureDirectory(videosDir);
      ensureDirectory(postersDir);
    }
  }

  function bucketNameForAsset(assetType) {
    if ((assetType === 'video' || assetType === 'poster') && publicClipBucket) {
      return publicClipBucket;
    }
    return rawClipBucket;
  }

  async function ensureBucket(bucketName = rawClipBucket) {
    if (!s3Enabled) {
      return;
    }
    if (!bucketName) {
      throw new Error('Object storage bucket is not configured.');
    }
    if (!bucketReadyPromises.has(bucketName)) {
      bucketReadyPromises.set(bucketName, (async () => {
        try {
          await s3Client.send(new HeadBucketCommand({
            Bucket: bucketName,
          }));
        } catch (error) {
          const statusCode = Number(error && error.$metadata && error.$metadata.httpStatusCode);
          const errorName = String(error && error.name || '');
          if (statusCode !== 404 && errorName !== 'NotFound' && errorName !== 'NoSuchBucket') {
            throw error;
          }
          await s3Client.send(new CreateBucketCommand({
            Bucket: bucketName,
          }));
        }
      })().catch((error) => {
        bucketReadyPromises.delete(bucketName);
        throw error;
      }));
    }
    await bucketReadyPromises.get(bucketName);
  }

  function prefixedKey(assetType, safeKeyName) {
    if (assetType === 'video') {
      return `clips/videos/${safeKeyName}`;
    }
    if (assetType === 'poster') {
      return `clips/posters/${safeKeyName}`;
    }
    if (assetType === 'raw') {
      return `clips/raw/${safeKeyName}`;
    }
    throw new Error(`Unsupported clip asset type: ${assetType}`);
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
        '-t', '60',
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
      const bucketName = bucketNameForAsset(assetType);
      await ensureBucket(bucketName);
      const body = await fs.promises.readFile(tempPath);
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: prefixedKey(assetType, safeKeyName),
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

  async function writeAssetToTemp(assetType, rawProvider, rawKey, outputPath) {
    const provider = storageProviderForEntry(rawProvider);
    const safeKeyName = safeMediaKey(rawKey);
    if (!safeKeyName) {
      const error = new Error('Clip media not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (provider !== 's3') {
      const targetDir = assetType === 'video' ? videosDir : postersDir;
      await fs.promises.copyFile(path.join(targetDir, safeKeyName), outputPath);
      return outputPath;
    }

    const bucketName = bucketNameForAsset(assetType);
    await ensureBucket(bucketName);
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: prefixedKey(assetType, safeKeyName),
    }));
    const body = await response.Body.transformToByteArray();
    await fs.promises.writeFile(outputPath, Buffer.from(body));
    return outputPath;
  }

  function storageUriForClipAsset(assetType, clip) {
    const provider = storageProviderForEntry(clip && clip.storageProvider);
    const safeKeyName = assetType === 'video'
      ? safeMediaKey(clip && clip.videoStorageKey)
      : safeMediaKey(clip && clip.posterStorageKey);
    if (!safeKeyName) {
      return '';
    }

    if (provider === 's3' && bucketNameForAsset(assetType)) {
      return `gs://${bucketNameForAsset(assetType)}/${prefixedKey(assetType, safeKeyName)}`;
    }

    if (provider !== 's3') {
      const targetDir = assetType === 'video' ? videosDir : postersDir;
      return path.join(targetDir, safeKeyName);
    }

    return '';
  }

  async function processTempUpload(tempInputPath) {
    ensureClipDirs();

    const tempVideoOutputPath = path.join(tempDir, `${crypto.randomUUID()}.mp4`);
    const tempPosterOutputPath = path.join(tempDir, `${crypto.randomUUID()}.jpg`);

    let measured = null;
    try {
      measured = await probeVideoFile(tempInputPath);
      if (measured.durationSeconds > 60.4) {
        throw new Error('Videos must be 60 seconds or shorter.');
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
        fs.promises.rm(tempVideoOutputPath, { force: true }),
        fs.promises.rm(tempPosterOutputPath, { force: true }),
      ]);
    }
  }

  async function processUpload(uploadedFile) {
    const inputExtension = path.extname(String(uploadedFile.originalFileName || '')).toLowerCase() || '.mp4';
    const tempInputPath = path.join(tempDir, `${crypto.randomUUID()}${inputExtension}`);
    await fs.promises.writeFile(tempInputPath, uploadedFile.buffer);
    try {
      return await processTempUpload(tempInputPath);
    } finally {
      await fs.promises.rm(tempInputPath, { force: true });
    }
  }

  async function createDirectUploadSession({
    rawUploadKey,
    mimeType,
    sizeBytes,
    originalFileName,
  }) {
    const safeKeyName = safeMediaKey(rawUploadKey);
    if (!safeKeyName) {
      throw new Error('Invalid upload key.');
    }
    if (!directUploadsEnabled) {
      throw new Error('Direct cloud uploads are not available on this backend.');
    }
    const objectName = prefixedKey('raw', safeKeyName);
    const fileHandle = storageClient.bucket(rawClipBucket).file(objectName);
    const expiresAt = Date.now() + (15 * 60 * 1000);
    const [uploadUrl] = await fileHandle.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType: String(mimeType || 'application/octet-stream'),
    });
    if (!uploadUrl) {
      throw new Error('Unable to create a cloud upload session.');
    }

    return {
      uploadUrl,
      expiresAt,
    };
  }

  async function inspectRawUpload(rawUploadKey) {
    const safeKeyName = safeMediaKey(rawUploadKey);
    if (!safeKeyName) {
      const error = new Error('Uploaded clip file was not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (!s3Enabled) {
      const filePath = path.join(tempDir, safeKeyName);
      const stats = await fs.promises.stat(filePath);
      return {
        sizeBytes: stats.size,
        mimeType: contentTypeForClipFile(safeKeyName),
      };
    }

    await ensureBucket();
    const response = await s3Client.send(new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: prefixedKey('raw', safeKeyName),
    }));

    return {
      sizeBytes: Number(response.ContentLength || 0),
      mimeType: String(response.ContentType || contentTypeForClipFile(safeKeyName)),
    };
  }

  async function processRawUpload(rawUploadKey, originalFileName = '') {
    const safeKeyName = safeMediaKey(rawUploadKey);
    if (!safeKeyName) {
      const error = new Error('Uploaded clip file was not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }

    ensureClipDirs();
    const inputExtension = path.extname(String(originalFileName || '')).toLowerCase()
      || path.extname(safeKeyName).toLowerCase()
      || '.mp4';
    const tempInputPath = path.join(tempDir, `${crypto.randomUUID()}${inputExtension}`);

    if (!s3Enabled) {
      await fs.promises.copyFile(path.join(tempDir, safeKeyName), tempInputPath);
    } else {
      await ensureBucket();
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: prefixedKey('raw', safeKeyName),
      }));
      const body = await response.Body.transformToByteArray();
      await fs.promises.writeFile(tempInputPath, Buffer.from(body));
    }

    try {
      return await processTempUpload(tempInputPath);
    } finally {
      await fs.promises.rm(tempInputPath, { force: true });
    }
  }

  async function deleteRawUpload(rawUploadKey) {
    const safeKeyName = safeMediaKey(rawUploadKey);
    if (!safeKeyName) {
      return;
    }

    if (!s3Enabled) {
      await fs.promises.rm(path.join(tempDir, safeKeyName), { force: true });
      return;
    }

    await ensureBucket();
    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: prefixedKey('raw', safeKeyName),
    }));
  }

  function publicClipMedia(clip) {
    const provider = storageProviderForEntry(clip.storageProvider);
    const safeVideoKey = safeMediaKey(clip && clip.videoStorageKey);
    const safePosterKey = safeMediaKey(clip && clip.posterStorageKey);
    if (provider === 's3' && directPlaybackBaseUrl) {
      return {
        videoPath: safeVideoKey ? `${directPlaybackBaseUrl}/${prefixedKey('video', safeVideoKey)}` : '',
        posterPath: safePosterKey ? `${directPlaybackBaseUrl}/${prefixedKey('poster', safePosterKey)}` : '',
      };
    }
    return {
      videoPath: `/media/clips/${provider}/videos/${encodeURIComponent(String(clip.videoStorageKey || ''))}`,
      posterPath: `/media/clips/${provider}/posters/${encodeURIComponent(String(clip.posterStorageKey || ''))}`,
    };
  }

  async function deleteClipAssets(clip) {
    const provider = storageProviderForEntry(clip.storageProvider);
    const safeVideoKey = safeMediaKey(clip.videoStorageKey);
    const safePosterKey = safeMediaKey(clip.posterStorageKey);
      if (provider === 's3') {
        const videoBucket = bucketNameForAsset('video');
        const posterBucket = bucketNameForAsset('poster');
        await Promise.all([
          ensureBucket(videoBucket),
          ensureBucket(posterBucket),
        ]);
        const commands = [];
        if (safeVideoKey) {
          commands.push(s3Client.send(new DeleteObjectCommand({
            Bucket: videoBucket,
            Key: prefixedKey('video', safeVideoKey),
          })));
        }
        if (safePosterKey) {
          commands.push(s3Client.send(new DeleteObjectCommand({
            Bucket: posterBucket,
            Key: prefixedKey('poster', safePosterKey),
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

  async function streamAsset(req, res, assetType, rawProvider, rawKey, streamLocalFile) {
    const provider = storageProviderForEntry(rawProvider);
    const safeKeyName = safeMediaKey(rawKey);
    if (!safeKeyName) {
      const error = new Error('Clip media not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (provider !== 's3') {
      const targetDir = assetType === 'video' ? videosDir : postersDir;
      const filePath = path.join(targetDir, safeKeyName);
      streamLocalFile(req, res, filePath, assetType === 'video' ? 'video/mp4' : 'image/jpeg');
      return;
    }

      const bucketName = bucketNameForAsset(assetType);
      await ensureBucket(bucketName);
      const range = assetType === 'video' ? String(req.headers.range || '').trim() : '';
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: prefixedKey(assetType, safeKeyName),
        Range: range || undefined,
      }));

    const headers = {
      'Content-Type': assetType === 'video' ? 'video/mp4' : 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': assetType === 'video' ? 'bytes' : 'none',
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
    console.log(`Clip media storage: ${s3Enabled ? 's3-compatible object storage' : 'local persistent disk'}`);
  }

    return {
      createDirectUploadSession,
      inspectRawUpload,
      processRawUpload,
      deleteRawUpload,
      processUpload,
      publicClipMedia,
    deleteClipAssets,
    streamAsset,
    writeAssetToTemp,
    storageUriForClipAsset,
    ensureClipDirs,
    ensureBucket,
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
