'use strict';

const { Firestore } = require('@google-cloud/firestore');
const ScrapRunner = require('./scraprunner-core.js');

const DEFAULT_PROFILE_COLLECTION = 'scraprunnerProfiles';
const DEFAULT_RUN_COLLECTION = 'scraprunnerRuns';
const MAX_RECENT_RUNS = 12;
const MAX_LEADERBOARD = 100;

function nowIso() {
  return new Date().toISOString();
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, fallback = '', maxLength = 120) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function normalizeCents(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function normalizeUser(user) {
  const uid = cleanText(user && user.uid, '', 160);
  if (!uid) {
    const error = new Error('A signed-in AP account is required for ScrapRunner.');
    error.code = 'scraprunner/missing-user';
    throw error;
  }
  return {
    uid,
    email: cleanText(user && user.email, '', 180),
    displayName: cleanText(user && user.displayName, 'AP runner', 100),
    picture: cleanText(user && user.picture, '', 500),
  };
}

function dayKey(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).reduce((carry, part) => {
      carry[part.type] = part.value;
      return carry;
    }, {});
    if (parts.year && parts.month && parts.day) {
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  } catch {
    // UTC is fine for local development if the runtime lacks the time zone.
  }
  return date.toISOString().slice(0, 10);
}

function previousDayKey(key) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function defaultStats() {
  return {
    runs: 0,
    extractions: 0,
    scrap: 0,
    kills: 0,
    score: 0,
    earnedCents: 0,
    bestRewardCents: 0,
    bestScrap: 0,
    bestKills: 0,
    bestScore: 0,
  };
}

function defaultProfile(user) {
  const createdAt = nowIso();
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    picture: user.picture,
    upgrades: ScrapRunner.cleanUpgradeLevels(),
    unlockedZones: ['rust-yard'],
    stats: defaultStats(),
    daily: {
      lastClaimDayKey: '',
      streak: 0,
      bestStreak: 0,
    },
    missions: {
      dayKey: '',
      items: [],
    },
    achievements: [],
    recentRuns: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeMissionItem(item) {
  return {
    id: cleanText(item && item.id, '', 80),
    kind: cleanText(item && item.kind, 'scrap', 40),
    label: cleanText(item && item.label, 'Mission', 120),
    target: Math.max(1, Math.floor(Number(item && item.target) || 1)),
    progress: Math.max(0, Math.floor(Number(item && item.progress) || 0)),
    rewardCents: Math.max(0, normalizeCents(item && item.rewardCents)),
    claimed: item && item.claimed === true,
  };
}

function ensureMissions(profile, key = dayKey()) {
  const missions = profile.missions && typeof profile.missions === 'object'
    ? profile.missions
    : { dayKey: '', items: [] };
  if (missions.dayKey === key && Array.isArray(missions.items) && missions.items.length) {
    profile.missions = {
      dayKey: key,
      items: missions.items.map(normalizeMissionItem),
    };
    return profile;
  }
  profile.missions = {
    dayKey: key,
    items: ScrapRunner.dailyMissionTemplates(key).map((item) => normalizeMissionItem({
      ...item,
      progress: 0,
      claimed: false,
    })),
  };
  return profile;
}

function normalizeProfile(data, user) {
  const base = defaultProfile(user);
  const source = data && typeof data === 'object' ? data : {};
  const upgrades = ScrapRunner.cleanUpgradeLevels(source.upgrades);
  const unlockedZones = Array.isArray(source.unlockedZones)
    ? source.unlockedZones.map(ScrapRunner.normalizeZoneId)
    : base.unlockedZones;
  const uniqueZones = Array.from(new Set(['rust-yard', ...unlockedZones]));
  const stats = { ...defaultStats(), ...(source.stats && typeof source.stats === 'object' ? source.stats : {}) };
  for (const key of Object.keys(stats)) {
    stats[key] = Math.max(0, normalizeCents(stats[key]));
  }
  const achievements = Array.isArray(source.achievements)
    ? source.achievements.map((id) => cleanText(id, '', 80)).filter(Boolean)
    : [];
  const recentRuns = Array.isArray(source.recentRuns)
    ? source.recentRuns.slice(0, MAX_RECENT_RUNS).map(publicRun)
    : [];
  const profile = {
    ...base,
    ...source,
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    picture: user.picture,
    upgrades,
    unlockedZones: uniqueZones,
    stats,
    daily: {
      lastClaimDayKey: cleanText(source.daily && source.daily.lastClaimDayKey, '', 30),
      streak: Math.max(0, Math.floor(Number(source.daily && source.daily.streak) || 0)),
      bestStreak: Math.max(0, Math.floor(Number(source.daily && source.daily.bestStreak) || 0)),
    },
    achievements,
    recentRuns,
    createdAt: cleanText(source.createdAt, base.createdAt, 40),
    updatedAt: cleanText(source.updatedAt, base.updatedAt, 40),
  };
  return ensureMissions(profile);
}

function publicRun(run) {
  return {
    id: cleanText(run && run.id, '', 120),
    runId: cleanText(run && run.runId, '', 120),
    uid: cleanText(run && run.uid, '', 160),
    displayName: cleanText(run && run.displayName, 'AP runner', 100),
    zoneId: ScrapRunner.normalizeZoneId(run && run.zoneId),
    zoneName: cleanText(run && run.zoneName, 'Rust Yard', 80),
    scrap: Math.max(0, Math.round(Number(run && run.scrap) || 0)),
    kills: Math.max(0, Math.round(Number(run && run.kills) || 0)),
    score: Math.max(0, Math.round(Number(run && run.score) || 0)),
    durationSeconds: Math.max(0, Number(run && run.durationSeconds) || 0),
    timeLeftSeconds: Math.max(0, Math.round(Number(run && run.timeLeftSeconds) || 0)),
    rewardCents: Math.max(0, normalizeCents(run && run.rewardCents)),
    extracted: run && run.extracted === true,
    createdAt: cleanText(run && run.createdAt, nowIso(), 40),
  };
}

function publicUpgrade(profile, def) {
  const level = Math.max(0, Math.floor(Number(profile.upgrades && profile.upgrades[def.id]) || 0));
  return {
    ...def,
    level,
    nextCostCents: ScrapRunner.upgradeCostCents(def.id, level),
  };
}

function publicProfile(profile) {
  const zones = ScrapRunner.ZONES.map((zone) => ({
    ...zone,
    unlocked: profile.unlockedZones.includes(zone.id),
  }));
  const achievements = ScrapRunner.ACHIEVEMENTS.map((achievement) => ({
    ...achievement,
    unlocked: profile.achievements.includes(achievement.id),
  }));
  return {
    ...cloneValue(profile),
    zones,
    upgradesList: ScrapRunner.UPGRADE_DEFS.map((def) => publicUpgrade(profile, def)),
    achievementsList: achievements,
  };
}

function updateAchievements(profile, run) {
  const unlocked = new Set(profile.achievements || []);
  for (const achievement of ScrapRunner.ACHIEVEMENTS) {
    if (unlocked.has(achievement.id)) {
      continue;
    }
    if (achievement.stat && Number(profile.stats[achievement.stat] || 0) >= achievement.target) {
      unlocked.add(achievement.id);
      continue;
    }
    if (achievement.runStat && Number(run && run[achievement.runStat] || 0) >= achievement.target) {
      unlocked.add(achievement.id);
      continue;
    }
    if (achievement.runZone && run && run.zoneId === achievement.runZone && run.extracted) {
      unlocked.add(achievement.id);
    }
  }
  profile.achievements = Array.from(unlocked);
}

function applyRunToProfile(profile, runSource) {
  const run = publicRun(runSource);
  const stats = { ...defaultStats(), ...(profile.stats || {}) };
  stats.runs += 1;
  stats.extractions += run.extracted ? 1 : 0;
  stats.scrap += run.scrap;
  stats.kills += run.kills;
  stats.score += run.score;
  stats.earnedCents += run.rewardCents;
  stats.bestRewardCents = Math.max(stats.bestRewardCents, run.rewardCents);
  stats.bestScrap = Math.max(stats.bestScrap, run.scrap);
  stats.bestKills = Math.max(stats.bestKills, run.kills);
  stats.bestScore = Math.max(stats.bestScore, run.score);
  profile.stats = stats;

  ensureMissions(profile);
  for (const mission of profile.missions.items) {
    if (mission.claimed) {
      continue;
    }
    const add = mission.kind === 'scrap'
      ? run.scrap
      : mission.kind === 'kills'
        ? run.kills
        : mission.kind === 'extractions' && run.extracted
          ? 1
          : 0;
    mission.progress = Math.min(mission.target, mission.progress + add);
  }

  updateAchievements(profile, run);
  profile.recentRuns = [run, ...(profile.recentRuns || [])].slice(0, MAX_RECENT_RUNS);
  profile.updatedAt = nowIso();
  return { profile, run };
}

function createScrapRunnerStore({
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
  profileCollectionName = process.env.SCRAPRUNNER_PROFILE_COLLECTION || DEFAULT_PROFILE_COLLECTION,
  runCollectionName = process.env.SCRAPRUNNER_RUN_COLLECTION || DEFAULT_RUN_COLLECTION,
} = {}) {
  const enabled = Boolean(String(projectId || '').trim());
  const firestore = enabled
    ? new Firestore({
      projectId,
      ignoreUndefinedProperties: true,
    })
    : null;
  const memoryProfiles = new Map();
  const memoryLeaderboard = [];

  async function getOrCreateProfile(userSource) {
    const user = normalizeUser(userSource);
    if (!enabled) {
      if (!memoryProfiles.has(user.uid)) {
        memoryProfiles.set(user.uid, defaultProfile(user));
      }
      const profile = normalizeProfile(memoryProfiles.get(user.uid), user);
      memoryProfiles.set(user.uid, profile);
      return publicProfile(profile);
    }

    const ref = firestore.collection(profileCollectionName).doc(user.uid);
    let profile = null;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      profile = normalizeProfile(snapshot.exists ? snapshot.data() : null, user);
      transaction.set(ref, profile, { merge: false });
    });
    return publicProfile(profile);
  }

  async function saveProfile(userSource, mutator) {
    const user = normalizeUser(userSource);
    if (!enabled) {
      const current = normalizeProfile(memoryProfiles.get(user.uid), user);
      const next = normalizeProfile(await mutator(cloneValue(current), user) || current, user);
      memoryProfiles.set(user.uid, next);
      return publicProfile(next);
    }

    const ref = firestore.collection(profileCollectionName).doc(user.uid);
    let profile = null;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = normalizeProfile(snapshot.exists ? snapshot.data() : null, user);
      profile = normalizeProfile(await mutator(current, user) || current, user);
      transaction.set(ref, profile, { merge: false });
    });
    return publicProfile(profile);
  }

  async function recordRun(userSource, runSource) {
    const user = normalizeUser(userSource);
    let recordedRun = null;
    const profile = await saveProfile(user, (current) => {
      const result = applyRunToProfile(current, {
        ...runSource,
        uid: user.uid,
        displayName: user.displayName,
      });
      recordedRun = result.run;
      return result.profile;
    });

    if (recordedRun && recordedRun.extracted) {
      if (enabled) {
        await firestore.collection(runCollectionName).doc(recordedRun.id || `${recordedRun.runId}-${user.uid}`).set(recordedRun, { merge: false });
      } else {
        memoryLeaderboard.unshift(recordedRun);
        memoryLeaderboard.sort((a, b) => b.rewardCents - a.rewardCents || b.score - a.score);
        memoryLeaderboard.splice(MAX_LEADERBOARD);
      }
    }

    return {
      profile,
      run: recordedRun,
    };
  }

  async function purchaseUpgrade(userSource, upgradeId) {
    const cleanId = cleanText(upgradeId, '', 40);
    const def = ScrapRunner.UPGRADE_BY_ID[cleanId];
    if (!def) {
      const error = new Error('Unknown ScrapRunner upgrade.');
      error.code = 'scraprunner/unknown-upgrade';
      throw error;
    }
    let costCents = 0;
    const profile = await saveProfile(userSource, (current) => {
      const level = Math.max(0, Math.floor(Number(current.upgrades[cleanId]) || 0));
      if (level >= def.maxLevel) {
        const error = new Error('That upgrade is already maxed.');
        error.code = 'scraprunner/upgrade-maxed';
        throw error;
      }
      costCents = ScrapRunner.upgradeCostCents(cleanId, level);
      current.upgrades[cleanId] = level + 1;
      current.updatedAt = nowIso();
      return current;
    });
    return { profile, costCents, upgradeId: cleanId };
  }

  async function unlockZone(userSource, zoneId) {
    const cleanId = ScrapRunner.normalizeZoneId(zoneId);
    const zone = ScrapRunner.ZONE_BY_ID[cleanId];
    let costCents = 0;
    const profile = await saveProfile(userSource, (current) => {
      if (current.unlockedZones.includes(cleanId)) {
        const error = new Error('That zone is already unlocked.');
        error.code = 'scraprunner/zone-unlocked';
        throw error;
      }
      costCents = Math.max(0, normalizeCents(zone.unlockCostCents));
      current.unlockedZones = Array.from(new Set([...current.unlockedZones, cleanId]));
      current.updatedAt = nowIso();
      return current;
    });
    return { profile, costCents, zoneId: cleanId };
  }

  async function claimDaily(userSource) {
    const today = dayKey();
    let rewardCents = 0;
    const profile = await saveProfile(userSource, (current) => {
      if (current.daily.lastClaimDayKey === today) {
        const error = new Error('Daily reward already claimed.');
        error.code = 'scraprunner/daily-claimed';
        throw error;
      }
      const continued = current.daily.lastClaimDayKey === previousDayKey(today);
      const streak = continued ? current.daily.streak + 1 : 1;
      rewardCents = 500 + Math.min(6, streak - 1) * 125;
      current.daily = {
        lastClaimDayKey: today,
        streak,
        bestStreak: Math.max(current.daily.bestStreak || 0, streak),
      };
      current.updatedAt = nowIso();
      return current;
    });
    return { profile, rewardCents, dayKey: today };
  }

  async function claimMission(userSource, missionId) {
    const cleanId = cleanText(missionId, '', 80);
    let rewardCents = 0;
    const profile = await saveProfile(userSource, (current) => {
      ensureMissions(current);
      const mission = current.missions.items.find((item) => item.id === cleanId);
      if (!mission) {
        const error = new Error('Mission not found.');
        error.code = 'scraprunner/mission-not-found';
        throw error;
      }
      if (mission.claimed) {
        const error = new Error('Mission reward already claimed.');
        error.code = 'scraprunner/mission-claimed';
        throw error;
      }
      if (mission.progress < mission.target) {
        const error = new Error('Mission is not complete yet.');
        error.code = 'scraprunner/mission-incomplete';
        throw error;
      }
      rewardCents = Math.max(0, normalizeCents(mission.rewardCents));
      mission.claimed = true;
      current.updatedAt = nowIso();
      return current;
    });
    return { profile, rewardCents, missionId: cleanId };
  }

  async function leaderboard(limit = 20) {
    const count = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
    if (!enabled) {
      return memoryLeaderboard.slice(0, count).map(publicRun);
    }
    const snapshot = await firestore
      .collection(runCollectionName)
      .orderBy('rewardCents', 'desc')
      .limit(Math.min(MAX_LEADERBOARD, Math.max(count, 20)))
      .get();
    return snapshot.docs
      .map((doc) => publicRun(doc.data()))
      .sort((a, b) => b.rewardCents - a.rewardCents || b.score - a.score)
      .slice(0, count);
  }

  return {
    enabled,
    getOrCreateProfile,
    recordRun,
    purchaseUpgrade,
    unlockZone,
    claimDaily,
    claimMission,
    leaderboard,
  };
}

module.exports = {
  createScrapRunnerStore,
};
