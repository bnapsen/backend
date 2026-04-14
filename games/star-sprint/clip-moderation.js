'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const ffmpegStatic = require('ffmpeg-static');
const { GoogleAuth } = require('google-auth-library');

const execFile = promisify(childProcess.execFile);
const GOOGLE_API_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const LIKELIHOOD_SCORE = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5,
};

const DEFAULT_REJECT_TERMS = [
  'child porn',
  'sexual assault',
  'rape',
  'kill yourself',
  'how to make a bomb',
];
const DEFAULT_REVIEW_TERMS = [
  'nazi',
  'terrorist',
  'suicide',
  'meth',
  'cocaine',
  'heroin',
  'copyrighted music',
  'full movie',
  'full episode',
];

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeTerms(rawTerms, fallbackTerms) {
  const source = String(rawTerms || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return source.length ? source : fallbackTerms;
}

function likelihoodValue(rawLikelihood) {
  return LIKELIHOOD_SCORE[String(rawLikelihood || '').toUpperCase()] || 0;
}

function likelihoodName(score) {
  return Object.entries(LIKELIHOOD_SCORE).find(([, value]) => value === score)?.[0] || 'UNKNOWN';
}

function snippet(text, maxLength = 220) {
  const safeText = String(text || '').trim();
  return safeText.length > maxLength
    ? `${safeText.slice(0, maxLength - 1)}...`
    : safeText;
}

async function runMediaTool(binaryPath, args) {
  const { stdout, stderr } = await execFile(binaryPath, args, {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout, stderr };
}

function createClipModerationService({ clipMediaManager, dataDir }) {
  const tempRootDir = path.join(dataDir, 'clips', 'moderation-tmp');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
  const moderationEnabled = String(process.env.CLIP_MODERATION_ENABLED || 'true').toLowerCase() !== 'false';
  const googleAuth = moderationEnabled
    ? new GoogleAuth({ scopes: [GOOGLE_API_SCOPE] })
    : null;
  const rejectTerms = normalizeTerms(process.env.CLIP_MODERATION_REJECT_TERMS, DEFAULT_REJECT_TERMS);
  const reviewTerms = normalizeTerms(process.env.CLIP_MODERATION_REVIEW_TERMS, DEFAULT_REVIEW_TERMS);

  async function googleJsonFetch(url, body, { method = 'POST' } = {}) {
    const client = await googleAuth.getClient();
    const accessToken = await client.getAccessToken();
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken.token || accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(
        json && json.error && json.error.message
          ? json.error.message
          : `Google API request failed with ${response.status}.`,
      );
      error.status = response.status;
      throw error;
    }
    return json;
  }

  async function extractFrames(videoPath, durationSeconds) {
    ensureDirectory(tempRootDir);
    const captureMoments = [0.2, 0.5, 0.8]
      .map((ratio) => Math.max(0.2, Math.min(durationSeconds * ratio, Math.max(0.3, durationSeconds - 0.2))));
    const framePaths = [];

    for (const captureTime of captureMoments) {
      const framePath = path.join(tempRootDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
      await runMediaTool(ffmpegPath, [
        '-y',
        '-ss', captureTime.toFixed(2),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', "scale='min(720,iw)':-2:force_original_aspect_ratio=decrease",
        framePath,
      ]);
      framePaths.push(framePath);
    }

    return framePaths;
  }

  async function analyzeFrames(framePaths) {
    if (!framePaths.length) {
      return [];
    }

    const requests = [];
    for (const framePath of framePaths) {
      const frameBuffer = await fs.promises.readFile(framePath);
      requests.push({
        image: { content: frameBuffer.toString('base64') },
        features: [{ type: 'SAFE_SEARCH_DETECTION' }],
      });
    }

    const response = await googleJsonFetch(
      'https://vision.googleapis.com/v1/images:annotate',
      { requests },
    );

    return Array.isArray(response.responses)
      ? response.responses.map((entry, index) => ({
        index,
        safeSearch: entry.safeSearchAnnotation || {},
      }))
      : [];
  }

  async function analyzeExplicitContent(videoGsUri) {
    if (!videoGsUri || !videoGsUri.startsWith('gs://')) {
      return {
        available: false,
        maxLikelihood: 'UNKNOWN',
        maxLikelihoodScore: 0,
      };
    }

    const operation = await googleJsonFetch(
      'https://videointelligence.googleapis.com/v1/videos:annotate',
      {
        inputUri: videoGsUri,
        features: ['EXPLICIT_CONTENT_DETECTION'],
      },
    );

    const operationName = String(operation.name || '');
    if (!operationName) {
      throw new Error('Video Intelligence did not return an operation name.');
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const pollResponse = await googleJsonFetch(
        `https://videointelligence.googleapis.com/v1/operations/${encodeURIComponent(operationName)}`,
        null,
        { method: 'GET' },
      );
      if (!pollResponse.done) {
        continue;
      }

      const frames = (((pollResponse.response || {}).annotationResults || [])[0] || {}).explicitAnnotation?.frames || [];
      const maxFrame = frames.reduce((best, frame) => {
        const nextScore = likelihoodValue(frame.pornographyLikelihood);
        return nextScore > best.score
          ? { score: nextScore, likelihood: String(frame.pornographyLikelihood || 'UNKNOWN') }
          : best;
      }, { score: 0, likelihood: 'UNKNOWN' });

      return {
        available: true,
        maxLikelihood: maxFrame.likelihood,
        maxLikelihoodScore: maxFrame.score,
        frameCount: frames.length,
      };
    }

    throw new Error('Video explicit-content scan timed out.');
  }

  async function transcribeAudio(videoPath) {
    ensureDirectory(tempRootDir);
    const audioPath = path.join(tempRootDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.flac`);
    try {
      await runMediaTool(ffmpegPath, [
        '-y',
        '-i', videoPath,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'flac',
        audioPath,
      ]);
    } catch (error) {
      return {
        available: false,
        transcript: '',
        flaggedTerms: [],
      };
    }

    try {
      const audioBuffer = await fs.promises.readFile(audioPath);
      const response = await googleJsonFetch(
        'https://speech.googleapis.com/v1/speech:recognize',
        {
          config: {
            encoding: 'FLAC',
            sampleRateHertz: 16000,
            languageCode: 'en-US',
            enableAutomaticPunctuation: true,
            profanityFilter: true,
            model: 'latest_short',
          },
          audio: {
            content: audioBuffer.toString('base64'),
          },
        },
      );
      const transcript = ((response.results || [])
        .map((result) => (((result.alternatives || [])[0] || {}).transcript || '').trim())
        .filter(Boolean)
        .join(' ')).trim();
      const lowerTranscript = transcript.toLowerCase();
      const flaggedTerms = [];

      rejectTerms.forEach((term) => {
        if (lowerTranscript.includes(term)) {
          flaggedTerms.push({ term, severity: 'reject' });
        }
      });
      reviewTerms.forEach((term) => {
        if (lowerTranscript.includes(term)) {
          flaggedTerms.push({ term, severity: 'review' });
        }
      });

      return {
        available: true,
        transcript,
        flaggedTerms,
      };
    } finally {
      await fs.promises.rm(audioPath, { force: true });
    }
  }

  function evaluateFrameSafety(frameAnnotations) {
    const summary = {
      adult: 0,
      violence: 0,
      racy: 0,
      medical: 0,
    };

    frameAnnotations.forEach((frame) => {
      const safeSearch = frame.safeSearch || {};
      summary.adult = Math.max(summary.adult, likelihoodValue(safeSearch.adult));
      summary.violence = Math.max(summary.violence, likelihoodValue(safeSearch.violence));
      summary.racy = Math.max(summary.racy, likelihoodValue(safeSearch.racy));
      summary.medical = Math.max(summary.medical, likelihoodValue(safeSearch.medical));
    });

  return {
    maxAdult: likelihoodName(summary.adult),
      maxViolence: likelihoodName(summary.violence),
      maxRacy: likelihoodName(summary.racy),
      maxMedical: likelihoodName(summary.medical),
      maxAdultScore: summary.adult,
      maxViolenceScore: summary.violence,
      maxRacyScore: summary.racy,
    maxMedicalScore: summary.medical,
  };
  }

function buildDecision({
  frameSafety,
  explicitContent,
  transcriptResult,
  scanErrors,
}) {
  const rejectReasons = [];
  const reviewReasons = [];
  const strongReviewTerms = new Set(['nazi', 'terrorist', 'suicide']);

  if (explicitContent.available && explicitContent.maxLikelihoodScore >= 5) {
    rejectReasons.push(`Video explicit-content score was ${explicitContent.maxLikelihood}.`);
  } else if (explicitContent.available && explicitContent.maxLikelihoodScore >= 4) {
    reviewReasons.push(`Video explicit-content score was ${explicitContent.maxLikelihood}.`);
  }

  if (frameSafety.maxAdultScore >= 5) {
    rejectReasons.push(`Frame safety flagged adult content as ${frameSafety.maxAdult}.`);
  } else if (frameSafety.maxAdultScore >= 4) {
    reviewReasons.push(`Frame safety flagged adult content as ${frameSafety.maxAdult}.`);
  }

  if (frameSafety.maxRacyScore >= 5) {
    reviewReasons.push(`Frame safety flagged racy content as ${frameSafety.maxRacy}.`);
  }

  if (frameSafety.maxViolenceScore >= 5) {
    reviewReasons.push(`Frame safety flagged violence as ${frameSafety.maxViolence}.`);
  }

  const transcriptRejectTerms = transcriptResult.flaggedTerms.filter((entry) => entry.severity === 'reject');
  const transcriptReviewTerms = transcriptResult.flaggedTerms.filter((entry) => entry.severity === 'review');

  transcriptRejectTerms.forEach((entry) => {
    rejectReasons.push(`Transcript matched restricted phrase "${entry.term}".`);
  });

  const strongTranscriptReviewTerms = transcriptReviewTerms.filter((entry) => strongReviewTerms.has(entry.term));
  const softTranscriptReviewTerms = transcriptReviewTerms.filter((entry) => !strongReviewTerms.has(entry.term));

  strongTranscriptReviewTerms.forEach((entry) => {
    reviewReasons.push(`Transcript matched review phrase "${entry.term}".`);
  });

  if (softTranscriptReviewTerms.length >= 2) {
    reviewReasons.push(
      `Transcript matched multiple review phrases (${softTranscriptReviewTerms.map((entry) => `"${entry.term}"`).join(', ')}).`,
    );
  }

  if (rejectReasons.length) {
    return {
      status: 'rejected',
      moderationState: 'rejected',
      moderationSummary: 'The automated moderation scan rejected this upload.',
      moderationReasons: rejectReasons,
    };
  }

  if (reviewReasons.length) {
    return {
      status: 'review',
      moderationState: 'flagged',
      moderationSummary: 'The automated moderation scan sent this clip to review.',
      moderationReasons: reviewReasons,
    };
  }

  return {
    status: 'active',
    moderationState: 'approved',
    moderationSummary: scanErrors.length
      ? 'Automated moderation checks passed. Some supplemental scans were unavailable, but nothing severe was detected.'
      : 'Automated moderation checks passed.',
    moderationReasons: [],
  };
}

  async function moderateClip(clip) {
    if (!clip) {
      throw new Error('Clip is required for moderation.');
    }

    if (!moderationEnabled) {
      return {
        status: 'active',
        moderationState: 'approved',
        moderationSummary: 'Moderation disabled by configuration.',
        moderationReasons: [],
        moderationDetails: {},
        moderationUpdatedAt: new Date().toISOString(),
      };
    }

    ensureDirectory(tempRootDir);
    const tempVideoPath = path.join(tempRootDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`);
    const scanErrors = [];
    let framePaths = [];

    try {
      await clipMediaManager.writeAssetToTemp('video', clip.storageProvider, clip.videoStorageKey, tempVideoPath);
      const durationSeconds = Number(clip.durationSeconds || 0);
      framePaths = await extractFrames(tempVideoPath, durationSeconds);
      const videoGsUri = clipMediaManager.storageUriForClipAsset('video', clip);

      let frameAnnotations = [];
      let explicitContent = {
        available: false,
        maxLikelihood: 'UNKNOWN',
        maxLikelihoodScore: 0,
      };
      let transcriptResult = {
        available: false,
        transcript: '',
        flaggedTerms: [],
      };

      try {
        frameAnnotations = await analyzeFrames(framePaths);
      } catch (error) {
        scanErrors.push(`Frame safety scan was unavailable: ${error.message}`);
      }

      try {
        explicitContent = await analyzeExplicitContent(videoGsUri);
      } catch (error) {
        scanErrors.push(`Video explicit-content scan was unavailable: ${error.message}`);
      }

      try {
        transcriptResult = await transcribeAudio(tempVideoPath);
      } catch (error) {
        scanErrors.push(`Transcript scan was unavailable: ${error.message}`);
      }

      const frameSafety = evaluateFrameSafety(frameAnnotations);
      const decision = buildDecision({
        frameSafety,
        explicitContent,
        transcriptResult,
        scanErrors,
      });

      return {
        ...decision,
        moderationDetails: {
          frameSafety,
          explicitContent,
          transcript: {
            available: transcriptResult.available,
            textSnippet: snippet(transcriptResult.transcript),
            flaggedTerms: transcriptResult.flaggedTerms,
          },
          scanErrors,
        },
        moderationUpdatedAt: new Date().toISOString(),
      };
    } finally {
      await Promise.allSettled([
        fs.promises.rm(tempVideoPath, { force: true }),
        ...framePaths.map((framePath) => fs.promises.rm(framePath, { force: true })),
      ]);
    }
  }

  return {
    moderationEnabled,
    moderateClip,
  };
}

module.exports = {
  createClipModerationService,
};
