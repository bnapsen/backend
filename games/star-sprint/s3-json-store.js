'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = require('@aws-sdk/client-s3');

function normalizeConfig(overrides = {}) {
  return {
    bucket: String(overrides.bucket || process.env.S3_BUCKET || '').trim(),
    region: String(overrides.region || process.env.S3_REGION || '').trim(),
    endpoint: String(overrides.endpoint || process.env.S3_ENDPOINT || '').trim(),
    accessKeyId: String(overrides.accessKeyId || process.env.S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(overrides.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY || '').trim(),
    forcePathStyle: String(
      overrides.forcePathStyle != null ? overrides.forcePathStyle : (process.env.S3_FORCE_PATH_STYLE || ''),
    ).toLowerCase() === 'true',
  };
}

function safeObjectKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^\/+/, '');
}

function createS3JsonStore(overrides = {}) {
  const config = normalizeConfig(overrides);
  const enabled = Boolean(
    config.bucket &&
    config.region &&
    config.endpoint &&
    config.accessKeyId &&
    config.secretAccessKey
  );

  const client = enabled
    ? new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    : null;

  let bucketReadyPromise = null;

  async function ensureReady() {
    if (!enabled) {
      return;
    }

    if (!bucketReadyPromise) {
      bucketReadyPromise = (async () => {
        try {
          await client.send(new HeadBucketCommand({
            Bucket: config.bucket,
          }));
        } catch (error) {
          const statusCode = Number(error && error.$metadata && error.$metadata.httpStatusCode);
          const errorName = String(error && error.name || '');
          if (statusCode !== 404 && errorName !== 'NotFound' && errorName !== 'NoSuchBucket') {
            throw error;
          }

          await client.send(new CreateBucketCommand({
            Bucket: config.bucket,
          }));
        }
      })().catch((error) => {
        bucketReadyPromise = null;
        throw error;
      });
    }

    await bucketReadyPromise;
  }

  async function readJson(key, fallbackValue) {
    if (!enabled) {
      return fallbackValue;
    }

    await ensureReady();
    const safeKey = safeObjectKey(key);
    if (!safeKey) {
      return fallbackValue;
    }

    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: safeKey,
      }));
      const jsonText = await response.Body.transformToString();
      return JSON.parse(jsonText);
    } catch (error) {
      const statusCode = Number(error && error.$metadata && error.$metadata.httpStatusCode);
      const errorName = String(error && error.name || '');
      if (statusCode === 404 || errorName === 'NoSuchKey' || errorName === 'NotFound') {
        return fallbackValue;
      }
      throw error;
    }
  }

  async function writeJson(key, value) {
    if (!enabled) {
      return;
    }

    await ensureReady();
    const safeKey = safeObjectKey(key);
    if (!safeKey) {
      throw new Error('Invalid metadata key.');
    }

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: safeKey,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-store',
    }));
  }

  return {
    enabled,
    ensureReady,
    readJson,
    writeJson,
  };
}

module.exports = {
  createS3JsonStore,
};
