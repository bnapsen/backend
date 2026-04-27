'use strict';

const KALSHI_API_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const DEFAULT_WEATHER_LAB_TIME_ZONE = 'America/Los_Angeles';

const WEATHER_LAB_LOCATIONS = Object.freeze([
  { series: 'KXHIGHNY', label: 'New York', lat: 40.78, lon: -73.97, stationId: 'KNYC', timeZone: 'America/New_York', stationHint: 'Central Park / NYC market' },
  { series: 'KXHIGHMIA', label: 'Miami', lat: 25.79, lon: -80.29, stationId: 'KMIA', timeZone: 'America/New_York', stationHint: 'Miami International Airport' },
  { series: 'KXHIGHDEN', label: 'Denver', lat: 39.86, lon: -104.67, stationId: 'KDEN', timeZone: 'America/Denver', stationHint: 'Denver airport area' },
  { series: 'KXHIGHLAX', label: 'Los Angeles', lat: 33.94, lon: -118.40, stationId: 'KLAX', timeZone: 'America/Los_Angeles', stationHint: 'Los Angeles airport area' },
  { series: 'KXHIGHTDAL', label: 'Dallas', lat: 32.85, lon: -96.85, stationId: 'KDAL', timeZone: 'America/Chicago', stationHint: 'Dallas airport area' },
  { series: 'KXHIGHTLV', label: 'Las Vegas', lat: 36.08, lon: -115.15, stationId: 'KLAS', timeZone: 'America/Los_Angeles', stationHint: 'Las Vegas airport area' },
  { series: 'KXHIGHTSEA', label: 'Seattle', lat: 47.45, lon: -122.31, stationId: 'KSEA', timeZone: 'America/Los_Angeles', stationHint: 'Seattle airport area' },
  { series: 'KXHIGHTNOLA', label: 'New Orleans', lat: 29.99, lon: -90.26, stationId: 'KMSY', timeZone: 'America/Chicago', stationHint: 'New Orleans airport area' },
  { series: 'KXHIGHTHOU', label: 'Houston', lat: 29.98, lon: -95.34, stationId: 'KIAH', timeZone: 'America/Chicago', stationHint: 'Houston airport area' },
  { series: 'KXHIGHTMIN', label: 'Minneapolis', lat: 44.88, lon: -93.22, stationId: 'KMSP', timeZone: 'America/Chicago', stationHint: 'Minneapolis airport area' },
]);

const WEATHER_MODEL_SIGMAS = Object.freeze({
  raw: 3,
  tight: 2,
  wide: 4,
});

function parseNumber(value, defaultValue = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function tomorrowIsoDate() {
  return addIsoDays(isoDateInTimeZone(new Date(), DEFAULT_WEATHER_LAB_TIME_ZONE), 1);
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  return tomorrowIsoDate();
}

function dateTickerPart(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid scan date: ${dateText}`);
  }

  const year = String(date.getUTCFullYear()).slice(-2);
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const day = String(date.getUTCDate());
  return `${year}${month}${day}`;
}

function isoDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = {};
  for (const part of parts) {
    byType[part.type] = part.value;
  }
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addIsoDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compareIsoDates(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function zonedDateTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const byType = {};
  for (const part of parts) {
    byType[part.type] = part.value;
  }
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function zonedDateTimeToUtc(dateText, timeZone, hour = 0, minute = 0, second = 0) {
  const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const targetLocalMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, second);
  let utcMs = targetLocalMs;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedDateTimeParts(new Date(utcMs), timeZone);
    const actualLocalMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = targetLocalMs - actualLocalMs;
    if (Math.abs(delta) < 1000) break;
    utcMs += delta;
  }
  return new Date(utcMs);
}

function fahrenheitFromCelsius(value) {
  const number = Number(value);
  return Number.isFinite(number) ? (number * 9 / 5) + 32 : null;
}

async function fetchJsonWithRetry(url, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'bnapsen-weather-lab/0.2',
        },
      });
      const text = await response.text();
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`GET ${url} failed: ${response.status}`);
        await delay(300 * attempt * attempt);
        continue;
      }
      if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status} ${text.slice(0, 220)}`);
      }
      return text ? JSON.parse(text) : {};
    } catch (error) {
      lastError = error;
      await delay(200 * attempt);
    }
  }
  throw lastError || new Error(`GET ${url} failed`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStationObservationContext(location, date) {
  const timeZone = location.timeZone || DEFAULT_WEATHER_LAB_TIME_ZONE;
  const today = isoDateInTimeZone(new Date(), timeZone);
  const dayComparison = compareIsoDates(date, today);
  const dayPhase = dayComparison < 0 ? 'past' : dayComparison === 0 ? 'today' : 'future';
  const nowParts = zonedDateTimeParts(new Date(), timeZone);
  const elapsedRatio = dayPhase === 'today'
    ? clamp((nowParts.hour * 60 + nowParts.minute) / 1440, 0, 1)
    : dayPhase === 'past' ? 1 : 0;
  const base = {
    stationId: location.stationId || null,
    stationHint: location.stationHint || '',
    timeZone,
    dayPhase,
    localDate: today,
    localHour: dayPhase === 'today' ? nowParts.hour + (nowParts.minute / 60) : null,
    elapsedRatio,
    observationCount: 0,
    observedHighF: null,
    observedHighTime: null,
    latestTempF: null,
    latestTime: null,
    source: location.stationId ? `NWS station ${location.stationId}` : 'No station configured',
    note: 'Station observations are a settlement proxy; final Kalshi settlement may use NWS climate reports and later corrections.',
  };

  if (!location.stationId || dayPhase === 'future') {
    return base;
  }

  const start = zonedDateTimeToUtc(date, timeZone, 0, 0, 0);
  const end = zonedDateTimeToUtc(addIsoDays(date, 1), timeZone, 0, 0, 0);
  if (!start || !end) {
    return Object.assign(base, { error: 'Unable to build local observation window.' });
  }

  try {
    const url = `https://api.weather.gov/stations/${encodeURIComponent(location.stationId)}/observations?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&limit=500`;
    const data = await fetchJsonWithRetry(url, 3);
    const observations = (data.features || [])
      .map((feature) => {
        const props = feature.properties || {};
        const tempF = fahrenheitFromCelsius(props.temperature && props.temperature.value);
        const timestamp = props.timestamp || '';
        return Number.isFinite(tempF) && timestamp ? {
          tempF,
          timestamp,
          textDescription: props.textDescription || '',
        } : null;
      })
      .filter(Boolean)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    const high = observations.reduce((best, item) => (!best || item.tempF > best.tempF ? item : best), null);
    const latest = observations.length ? observations[observations.length - 1] : null;
    return Object.assign(base, {
      observationCount: observations.length,
      observedHighF: high ? round(high.tempF, 1) : null,
      observedHighTime: high ? high.timestamp : null,
      latestTempF: latest ? round(latest.tempF, 1) : null,
      latestTime: latest ? latest.timestamp : null,
      latestDescription: latest ? latest.textDescription : '',
    });
  } catch (error) {
    return Object.assign(base, {
      error: error.message,
    });
  }
}

async function getKalshiMarkets(series, limit = 200) {
  const url = `${KALSHI_API_BASE_URL}/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=${limit}`;
  const data = await fetchJsonWithRetry(url);
  return Array.isArray(data.markets) ? data.markets : [];
}

async function getKalshiMarket(ticker) {
  const data = await fetchJsonWithRetry(`${KALSHI_API_BASE_URL}/markets/${encodeURIComponent(ticker)}`);
  return data.market || data;
}

async function resolveWeatherMarkets(tickers) {
  const uniqueTickers = [...new Set((tickers || []).map((ticker) => String(ticker || '').trim()).filter(Boolean))].slice(0, 80);
  const markets = await Promise.all(uniqueTickers.map(async (ticker) => {
    try {
      const market = await getKalshiMarket(ticker);
      return {
        ticker,
        ok: true,
        status: market.status || '',
        result: String(market.result || market.expiration_value || '').toLowerCase(),
        title: market.title || '',
        subtitle: market.yes_sub_title || market.subtitle || '',
        closeTime: market.close_time || null,
        expectedExpirationTime: market.expected_expiration_time || null,
        updatedTime: market.updated_time || null,
        lastPrice: marketPrice(market, 'last_price_dollars', 'last_price'),
        yesBid: marketPrice(market, 'yes_bid_dollars', 'yes_bid'),
        yesAsk: marketPrice(market, 'yes_ask_dollars', 'yes_ask'),
        noBid: marketPrice(market, 'no_bid_dollars', 'no_bid'),
        noAsk: marketPrice(market, 'no_ask_dollars', 'no_ask'),
      };
    } catch (error) {
      return {
        ticker,
        ok: false,
        error: error.message,
      };
    }
  }));

  return {
    asOf: new Date().toISOString(),
    markets,
  };
}

function marketPrice(market, dollarField, centsField) {
  if (market[dollarField] !== undefined && market[dollarField] !== null && market[dollarField] !== '') {
    return parseNumber(market[dollarField], 0);
  }
  if (market[centsField] !== undefined && market[centsField] !== null && market[centsField] !== '') {
    return parseNumber(market[centsField], 0) / 100;
  }
  return 0;
}

function marketSize(market, side) {
  const key = side === 'yes' ? 'yes_ask_size_fp' : 'no_ask_size_fp';
  const fallback = side === 'yes' ? 'yes_ask_size' : 'no_ask_size';
  const value = market[key] !== undefined ? market[key] : market[fallback];
  const size = parseNumber(value, 0);
  return size > 0 ? size : 25;
}

function marketPriorProbability(market, side, ask, bid) {
  const prices = [];
  if (bid > 0 && bid < 1) {
    prices.push({ value: bid, weight: 1 });
  }
  if (ask > 0 && ask < 1) {
    prices.push({ value: ask, weight: 1 });
  }
  const last = marketPrice(market, 'last_price_dollars', 'last_price');
  const sideLast = side === 'yes' ? last : 1 - last;
  if (sideLast > 0 && sideLast < 1) {
    prices.push({ value: sideLast, weight: 0.35 });
  }
  if (!prices.length) {
    return clamp(ask || 0.5, 0.01, 0.99);
  }
  const totalWeight = prices.reduce((sum, price) => sum + price.weight, 0);
  const weighted = prices.reduce((sum, price) => sum + price.value * price.weight, 0) / totalWeight;
  return clamp(weighted, 0.01, 0.99);
}

function kalshiFeeDollars(contracts, priceDollars) {
  return Math.ceil(0.07 * contracts * priceDollars * (1 - priceDollars) * 100) / 100;
}

function erfApprox(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return sign * y;
}

function normalCdf(value) {
  return 0.5 * (1 + erfApprox(value / Math.sqrt(2)));
}

function weatherProbability(range, meanHigh, sigma) {
  if (range.lowerBound === null || range.lowerBound === undefined) {
    return normalCdf((range.upperBound - meanHigh) / sigma);
  }
  if (range.upperBound === null || range.upperBound === undefined) {
    return 1 - normalCdf((range.lowerBound - meanHigh) / sigma);
  }
  return normalCdf((range.upperBound - meanHigh) / sigma) - normalCdf((range.lowerBound - meanHigh) / sigma);
}

function sameDayStationLockProbability(range, context, side) {
  const observations = context.observations || {};
  if (observations.dayPhase !== 'today' || observations.observedHighF === null || observations.error) {
    return null;
  }

  const observedHigh = Number(observations.observedHighF);
  if (!Number.isFinite(observedHigh)) {
    return null;
  }

  let yesProbability = null;
  if (range.upperBound !== null && range.upperBound !== undefined && observedHigh > range.upperBound) {
    yesProbability = 0.001;
  } else if ((range.upperBound === null || range.upperBound === undefined) && observedHigh >= range.lowerBound) {
    yesProbability = 0.999;
  }

  if (yesProbability === null) {
    return null;
  }

  return side === 'yes' ? yesProbability : 1 - yesProbability;
}

function calibrationMarketWeight(context, yesModel, weatherProbabilityValue, marketProbability) {
  const observations = context.observations || {};
  let weight = 0.72;

  if (yesModel.confidence === 'high') weight -= 0.08;
  if (yesModel.confidence === 'medium') weight += 0.03;
  if (yesModel.confidence === 'low') weight += 0.14;
  if (observations.dayPhase === 'today') weight -= 0.08;
  if (observations.dayPhase === 'future') weight += 0.08;
  if (context.regime && (context.regime.precipWords || context.regime.cloudWords)) weight += 0.05;

  const dispersion = Math.abs(Number(yesModel.tightProbability || 0) - Number(yesModel.wideProbability || 0));
  if (dispersion > 0.16) weight += 0.06;
  if (dispersion > 0.28) weight += 0.06;

  const divergence = Math.abs(weatherProbabilityValue - marketProbability);
  if (divergence > 0.15) weight += 0.08;
  if (divergence > 0.30) weight += 0.08;
  if (marketProbability < 0.08 || marketProbability > 0.92) weight += 0.04;

  return clamp(weight, 0.50, 0.92);
}

function calibrationDistanceCap(confidence, context, marketProbability) {
  const observations = context.observations || {};
  let cap = confidence === 'high' ? 0.10 : confidence === 'medium' ? 0.065 : 0.035;
  if (observations.dayPhase === 'today' && observations.observedHighF !== null && !observations.error) cap += 0.04;
  if (context.regime && (context.regime.precipWords || context.regime.cloudWords)) cap -= 0.015;
  if (marketProbability < 0.08 || marketProbability > 0.92) cap -= 0.02;
  return clamp(cap, 0.025, 0.16);
}

function calibrateSideProbability(weatherProbabilityValue, marketProbability, context, yesModel, range, side) {
  const reasons = [];
  const riskFlags = [];
  const stationLock = sameDayStationLockProbability(range, context, side);
  if (stationLock !== null) {
    reasons.push('Same-day station guardrail indicates this side is effectively decided before final NWS corrections.');
    riskFlags.push('Station-dominant calibration');
    return {
      probability: clamp(stationLock, 0.001, 0.999),
      marketProbability,
      weatherProbability: weatherProbabilityValue,
      marketWeight: 0,
      distanceCap: null,
      reasons,
      riskFlags,
    };
  }

  const marketWeight = calibrationMarketWeight(context, yesModel, weatherProbabilityValue, marketProbability);
  const distanceCap = calibrationDistanceCap(yesModel.confidence, context, marketProbability);
  let probability = (marketProbability * marketWeight) + (weatherProbabilityValue * (1 - marketWeight));
  const distance = probability - marketProbability;

  if (distance > distanceCap) {
    probability = marketProbability + distanceCap;
    riskFlags.push('Model edge capped by calibration');
  } else if (distance < -distanceCap) {
    probability = marketProbability - distanceCap;
    riskFlags.push('Model disagreement capped by calibration');
  }

  reasons.push(`Market prior ${(marketProbability * 100).toFixed(1)}%; weather-only model ${(weatherProbabilityValue * 100).toFixed(1)}%.`);
  reasons.push(`Calibration used ${(marketWeight * 100).toFixed(0)}% market weight and capped model-market separation at ${(distanceCap * 100).toFixed(1)} points.`);
  if (marketWeight >= 0.82) {
    riskFlags.push('Heavy market-prior shrink');
  }

  return {
    probability: clamp(probability, 0.005, 0.995),
    marketProbability,
    weatherProbability: weatherProbabilityValue,
    marketWeight,
    distanceCap,
    reasons,
    riskFlags,
  };
}

function getWeatherMarketRange(market) {
  const subtitle = String(market.yes_sub_title || market.yes_subtitle || market.subtitle || '');
  let match = subtitle.match(/([0-9]+(?:\.[0-9]+)?)\D+to\D+([0-9]+(?:\.[0-9]+)?)/i);
  if (match) {
    const low = Number(match[1]);
    const high = Number(match[2]);
    return {
      label: subtitle,
      kind: 'between',
      low,
      high,
      center: (low + high) / 2,
      lowerBound: low - 0.5,
      upperBound: high + 0.5,
    };
  }

  match = subtitle.match(/([0-9]+(?:\.[0-9]+)?)\D+or below/i);
  if (match) {
    const high = Number(match[1]);
    return {
      label: subtitle,
      kind: 'below',
      low: null,
      high,
      center: high - 1.5,
      lowerBound: null,
      upperBound: high + 0.5,
    };
  }

  match = subtitle.match(/([0-9]+(?:\.[0-9]+)?)\D+or above/i);
  if (match) {
    const low = Number(match[1]);
    return {
      label: subtitle,
      kind: 'above',
      low,
      high: null,
      center: low + 1.5,
      lowerBound: low - 0.5,
      upperBound: null,
    };
  }

  return null;
}

function applyObservedHighGuardrails(range, context, probability, reasons, riskFlags) {
  const observations = context.observations || {};
  if (observations.dayPhase !== 'today') {
    if (observations.stationId) {
      reasons.push(`Settlement proxy ${observations.stationId}: no same-day guardrail applied for ${observations.dayPhase || 'future'} market.`);
    }
    return probability;
  }

  if (observations.error) {
    riskFlags.push('Station observation unavailable');
    reasons.push(`Station observation fetch failed for ${observations.stationId || 'mapped station'}: ${observations.error}`);
    return probability * 0.82;
  }

  if (observations.observedHighF === null) {
    riskFlags.push('No observed high yet');
    reasons.push(`No valid ${observations.stationId || 'station'} temperature observations found for this local market day.`);
    return probability * 0.9;
  }

  const observedHigh = Number(observations.observedHighF);
  const latest = observations.latestTempF === null ? observedHigh : Number(observations.latestTempF);
  const remainingMax = observations.remainingHourlyMaxF === undefined
    ? context.forecast.remainingHourlyMax
    : observations.remainingHourlyMaxF;
  const elapsed = Number(observations.elapsedRatio || 0);
  const stationLabel = observations.stationId || 'mapped station';
  riskFlags.push('Same-day station guardrail');
  reasons.push(`${stationLabel} high so far ${observedHigh.toFixed(1)}F, latest ${latest.toFixed(1)}F, local day ${(elapsed * 100).toFixed(0)}% elapsed.`);

  if (range.upperBound !== null && range.upperBound !== undefined && observedHigh > range.upperBound) {
    reasons.push('Observed high is already above this bucket ceiling; YES is treated as effectively dead.');
    return 0.001;
  }

  if ((range.upperBound === null || range.upperBound === undefined) && observedHigh >= range.lowerBound) {
    reasons.push('Observed high has already crossed this above-threshold bucket; YES is treated as effectively locked unless observations are corrected.');
    return 0.999;
  }

  if (range.lowerBound === null || range.lowerBound === undefined) {
    const heatRoom = Number(range.upperBound) - Math.max(observedHigh, latest);
    if (remainingMax !== null && Number.isFinite(Number(remainingMax)) && Number(remainingMax) <= Number(range.upperBound)) {
      probability = Math.max(probability, clamp(0.58 + elapsed * 0.35, 0.58, 0.96));
      reasons.push('Remaining hourly forecast stays under the bucket ceiling, so below-threshold YES is boosted.');
    } else if (heatRoom <= 2 && elapsed < 0.75) {
      probability *= 0.72;
      riskFlags.push('Below bucket still vulnerable to afternoon heating');
    }
    return probability;
  }

  if (range.upperBound === null || range.upperBound === undefined) {
    const gap = Number(range.lowerBound) - Math.max(observedHigh, latest);
    if (gap > 0 && remainingMax !== null && Number.isFinite(Number(remainingMax)) && Number(remainingMax) < Number(range.lowerBound)) {
      probability *= elapsed > 0.55 ? 0.28 : 0.55;
      riskFlags.push('Above bucket needs forecast overperformance');
      reasons.push('Remaining hourly forecast does not reach the threshold.');
    } else if (gap > 4 && elapsed > 0.45) {
      probability *= 0.45;
      riskFlags.push('Large same-day temperature catch-up required');
    }
    return probability;
  }

  if (observedHigh >= range.lowerBound && observedHigh <= range.upperBound) {
    const heatRisk = remainingMax !== null && Number.isFinite(Number(remainingMax))
      ? Number(remainingMax) - Number(range.upperBound)
      : null;
    const holdProbability = heatRisk === null
      ? clamp(0.42 + elapsed * 0.35, 0.42, 0.82)
      : heatRisk <= 0
        ? clamp(0.58 + elapsed * 0.36, 0.58, 0.95)
        : clamp(0.72 - heatRisk * 0.16 - (1 - elapsed) * 0.18, 0.08, 0.74);
    probability = (probability * 0.35) + (holdProbability * 0.65);
    if (heatRisk !== null && heatRisk > 0) {
      riskFlags.push('Bucket can still be overshot');
      reasons.push(`Observed high is inside the bucket, but remaining hourly forecast allows about ${heatRisk.toFixed(1)}F of overshoot risk.`);
    } else {
      reasons.push('Observed high is inside the bucket and remaining hourly forecast does not exceed the ceiling.');
    }
    return probability;
  }

  if (observedHigh < range.lowerBound) {
    const gap = Number(range.lowerBound) - Math.max(observedHigh, latest);
    if (remainingMax !== null && Number.isFinite(Number(remainingMax)) && Number(remainingMax) < Number(range.lowerBound)) {
      probability *= elapsed > 0.45 ? 0.32 : 0.58;
      riskFlags.push('Bucket below observed/remaining trajectory');
      reasons.push('Observed high has not reached the bucket and remaining hourly forecast stays below it.');
    } else if (gap > 4 && elapsed > 0.45) {
      probability *= 0.5;
      riskFlags.push('Late-day catch-up required');
    }
  }

  return probability;
}

async function getWeatherLabContext(location, date) {
  const point = await fetchJsonWithRetry(`https://api.weather.gov/points/${location.lat},${location.lon}`);
  const hourly = await fetchJsonWithRetry(point.properties.forecastHourly);
  const daily = await fetchJsonWithRetry(point.properties.forecast);
  const observations = await getStationObservationContext(location, date);
  const dayHours = (hourly.properties.periods || []).filter((period) => String(period.startTime || '').startsWith(date));
  const temps = dayHours.map((period) => Number(period.temperature)).filter(Number.isFinite);
  const hourlyMax = temps.length ? Math.max(...temps) : null;
  const nowMs = Date.now();
  const remainingTemps = dayHours
    .filter((period) => Date.parse(String(period.endTime || period.startTime || '')) >= nowMs)
    .map((period) => Number(period.temperature))
    .filter(Number.isFinite);
  const remainingHourlyMax = remainingTemps.length ? Math.max(...remainingTemps) : null;
  observations.remainingHourlyMaxF = remainingHourlyMax;
  const dailyPeriod = (daily.properties.periods || []).find((period) => (
    String(period.startTime || '').startsWith(date)
    && (period.isDaytime || /day|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(String(period.name || '')))
  ));
  const dailyHigh = dailyPeriod && Number.isFinite(Number(dailyPeriod.temperature)) ? Number(dailyPeriod.temperature) : null;
  const highParts = [hourlyMax, dailyHigh].filter((value) => value !== null && Number.isFinite(value));
  if (!highParts.length) {
    throw new Error(`No NWS high forecast found for ${location.label} ${date}.`);
  }

  let meanHigh = highParts.reduce((sum, value) => sum + value, 0) / highParts.length;
  let forecastFinalHigh = meanHigh;
  if (observations.dayPhase === 'today' && observations.observedHighF !== null) {
    const projectedParts = [observations.observedHighF, remainingHourlyMax].filter((value) => value !== null && Number.isFinite(value));
    forecastFinalHigh = projectedParts.length ? Math.max(...projectedParts) : observations.observedHighF;
    if (dailyHigh !== null && observations.elapsedRatio < 0.42) {
      forecastFinalHigh = Math.max(forecastFinalHigh, (forecastFinalHigh * 0.7) + (dailyHigh * 0.3));
    }
    meanHigh = forecastFinalHigh;
  }
  const peakHours = dayHours.filter((period) => {
    const match = String(period.startTime || '').match(/T(\d{2})/);
    if (!match) return false;
    const hour = Number(match[1]);
    return hour >= 11 && hour <= 17;
  });
  const text = [
    dailyPeriod ? dailyPeriod.shortForecast : '',
    dailyPeriod ? dailyPeriod.detailedForecast : '',
    ...peakHours.map((period) => period.shortForecast || ''),
  ].join(' ').toLowerCase();
  const precipValues = dayHours
    .map((period) => period.probabilityOfPrecipitation && Number(period.probabilityOfPrecipitation.value))
    .filter(Number.isFinite);
  const maxPrecip = precipValues.length ? Math.max(...precipValues) : 0;
  const peakWindDirections = [...new Set(peakHours.map((period) => String(period.windDirection || '').trim()).filter(Boolean))];
  const hasDenverUpslope = peakWindDirections.some((direction) => /^(N|NE|NNE|ENE|E)$/i.test(direction));

  return {
    location,
    date,
    point: {
      gridId: point.properties.gridId,
      gridX: point.properties.gridX,
      gridY: point.properties.gridY,
      relativeLocation: point.properties.relativeLocation && point.properties.relativeLocation.properties,
    },
    forecast: {
      hourlyMax,
      remainingHourlyMax,
      dailyHigh,
      meanHigh,
      forecastFinalHigh,
      shortForecast: dailyPeriod ? dailyPeriod.shortForecast : null,
      detailedForecast: dailyPeriod ? dailyPeriod.detailedForecast : null,
    },
    observations,
    settlement: {
      stationId: location.stationId || null,
      stationHint: location.stationHint,
      sourceNote: 'Observation data is pulled from the mapped NWS station as a proxy. Kalshi settlement can depend on final NWS climate reports and corrections.',
    },
    regime: {
      maxPrecipProbability: maxPrecip,
      peakWindDirections,
      hasDenverUpslope,
      precipWords: /rain|shower|thunderstorm|drizzle|snow/.test(text),
      cloudWords: /cloud|overcast|fog|mist|haze/.test(text),
    },
  };
}

function adjustedWeatherProbability(range, context) {
  const meanHigh = Number(context.forecast.meanHigh);
  const raw = weatherProbability(range, meanHigh, WEATHER_MODEL_SIGMAS.raw);
  const tight = weatherProbability(range, meanHigh, WEATHER_MODEL_SIGMAS.tight);
  const wide = weatherProbability(range, meanHigh, WEATHER_MODEL_SIGMAS.wide);
  let probability = 0.45 * raw + 0.35 * tight + 0.20 * wide;
  const reasons = [
    `Raw sigma=${WEATHER_MODEL_SIGMAS.raw} model ${(raw * 100).toFixed(1)}%, tight sigma=${WEATHER_MODEL_SIGMAS.tight} ${(tight * 100).toFixed(1)}%, wide sigma=${WEATHER_MODEL_SIGMAS.wide} ${(wide * 100).toFixed(1)}%.`,
  ];
  const riskFlags = [];

  const center = Number(range.center);
  const aboveMean = center > meanHigh + 1;
  const belowMean = center < meanHigh - 1;
  const nearMean = Math.abs(center - meanHigh) <= 1;
  const wet = Number(context.regime.maxPrecipProbability) >= 40 || Boolean(context.regime.precipWords);
  const cloud = Boolean(context.regime.cloudWords);
  const upslope = context.location.series === 'KXHIGHDEN' && Boolean(context.regime.hasDenverUpslope);

  if (upslope && wet) {
    riskFlags.push('Denver upslope/rain regime');
    reasons.push('Denver N/NE/E upslope with precipitation can cap daytime highs; hotter buckets get discounted.');
  }

  if ((wet || cloud) && aboveMean) {
    probability *= upslope ? 0.68 : 0.78;
    riskFlags.push('Hotter-than-forecast bucket in wet/cloudy setup');
  } else if ((wet || cloud) && belowMean) {
    probability *= upslope ? 1.12 : 1.06;
    riskFlags.push('Cool-side bucket helped by wet/cloudy setup');
  }

  if (nearMean) {
    reasons.push('Bucket is near the NWS mean high, so the model treats it as a central forecast bucket.');
  }

  probability = applyObservedHighGuardrails(range, context, probability, reasons, riskFlags);

  const spreadPenalty = Math.min(0.28, Math.abs(tight - wide) * 0.8);
  let confidenceScore = 0.78 - spreadPenalty;
  if (wet) confidenceScore -= 0.08;
  if (upslope) confidenceScore -= 0.08;
  if (context.observations && context.observations.dayPhase === 'today') confidenceScore -= 0.06;
  if (context.observations && context.observations.error) confidenceScore -= 0.18;
  if (context.forecast.hourlyMax === null || context.forecast.dailyHigh === null) confidenceScore -= 0.12;
  confidenceScore = clamp(confidenceScore, 0.2, 0.9);
  const confidence = confidenceScore >= 0.68 ? 'high' : confidenceScore >= 0.48 ? 'medium' : 'low';
  if (confidence !== 'high') {
    riskFlags.push(`${confidence} model confidence`);
  }

  return {
    adjustedProbability: clamp(probability, 0.001, 0.999),
    rawProbability: raw,
    tightProbability: tight,
    wideProbability: wide,
    confidence,
    riskFlags,
    reasons,
  };
}

function shouldAuditOnlySameDay(context, range, side) {
  const observations = context.observations || {};
  if (observations.dayPhase !== 'today') return false;
  if (observations.error || observations.observedHighF === null) return true;

  const observedHigh = Number(observations.observedHighF);
  const remainingMax = Number(context.forecast.remainingHourlyMax);
  const hasRemainingMax = Number.isFinite(remainingMax);
  const elapsed = Number(observations.elapsedRatio || 0);

  if (range.kind === 'between') {
    const inside = observedHigh >= range.lowerBound && observedHigh <= range.upperBound;
    if (side === 'yes') {
      return !(inside && hasRemainingMax && remainingMax <= range.upperBound && elapsed >= 0.72);
    }
    if (observedHigh > range.upperBound) return false;
    if (hasRemainingMax && remainingMax < range.lowerBound) return false;
    return inside || elapsed < 0.55;
  }

  if (range.kind === 'below') {
    if (side === 'yes') {
      if (observedHigh > range.upperBound) return false;
      return !(hasRemainingMax && remainingMax <= range.upperBound && elapsed >= 0.65);
    }
    if (observedHigh > range.upperBound) return false;
    return elapsed < 0.65;
  }

  if (range.kind === 'above') {
    if (side === 'yes') {
      if (observedHigh >= range.lowerBound) return false;
      return elapsed < 0.65 || (hasRemainingMax && remainingMax < range.lowerBound);
    }
    if (observedHigh >= range.lowerBound) return false;
    return elapsed < 0.65;
  }

  return true;
}

function weatherRecommendation(edge, confidence, ask, probability, context, range, side, calibration) {
  const heavyShrink = calibration && calibration.marketWeight >= 0.84;
  if (edge <= -0.04) return 'avoid-or-sell';
  if (edge >= 0.03 && shouldAuditOnlySameDay(context, range, side)) return 'audit-only';
  if (edge >= 0.04 && heavyShrink) return 'audit-only';
  if (edge >= 0.06 && confidence !== 'low' && probability >= 0.10) return 'research-buy';
  if (edge >= 0.025 && confidence === 'high' && probability >= 0.06) return 'small-buy';
  if (edge >= 0.018 && confidence !== 'low') return 'tiny-only';
  return 'pass';
}

function kalshiMarketUrl(market, location) {
  const series = String(market.series_ticker || market.event_ticker || location.series || '').split('-')[0];
  const ticker = String(market.ticker || '');
  const eventTicker = String(market.event_ticker || '');
  const baseBySeries = {
    kxhighny: 'https://kalshi.com/markets/kxhighny/new-york-city-high-temperature',
    kxhighmia: 'https://kalshi.com/markets/kxhighmia/miami-high-temperature',
    kxhighden: 'https://kalshi.com/markets/kxhighden/denver-high-temperature',
    kxhighlax: 'https://kalshi.com/markets/kxhighlax/los-angeles-high-temperature',
    kxhightdal: 'https://kalshi.com/markets/kxhightdal/dallas-maximum-temperature',
    kxhightlv: 'https://kalshi.com/markets/kxhightlv/las-vegas-max-daily-temperature',
    kxhightsea: 'https://kalshi.com/markets/kxhightsea/seattle-maximum-temperature-daily',
    kxhightnola: 'https://kalshi.com/markets/kxhightnola/new-orleans-max-temp-daily',
    kxhighthou: 'https://kalshi.com/markets/kxhighthou/daily-high-temperature-houston',
    kxhightmin: 'https://kalshi.com/markets/kxhightmin/minneapolis-daily-high-temperature',
  };
  const base = baseBySeries[series.toLowerCase()] || `https://kalshi.com/markets/${series.toLowerCase()}`;
  const eventPath = eventTicker ? `/${eventTicker.toLowerCase()}` : '';
  const marketHash = ticker ? `#market=${encodeURIComponent(ticker)}` : '';
  return `${base}${eventPath}${marketHash}`;
}

function scoreWeatherCandidate(market, location, context, range, side, maxCost) {
  const ask = side === 'yes'
    ? marketPrice(market, 'yes_ask_dollars', 'yes_ask')
    : marketPrice(market, 'no_ask_dollars', 'no_ask');
  const bid = side === 'yes'
    ? marketPrice(market, 'yes_bid_dollars', 'yes_bid')
    : marketPrice(market, 'no_bid_dollars', 'no_bid');
  const size = marketSize(market, side);
  if (ask <= 0 || ask >= 1 || size < 1) {
    return null;
  }

  const yesModel = adjustedWeatherProbability(range, context);
  const weatherOnlyProbability = side === 'yes' ? yesModel.adjustedProbability : 1 - yesModel.adjustedProbability;
  const rawProbability = side === 'yes' ? yesModel.rawProbability : 1 - yesModel.rawProbability;
  const tightProbability = side === 'yes' ? yesModel.tightProbability : 1 - yesModel.tightProbability;
  const wideProbability = side === 'yes' ? yesModel.wideProbability : 1 - yesModel.wideProbability;
  const marketProbability = marketPriorProbability(market, side, ask, bid);
  const calibration = calibrateSideProbability(weatherOnlyProbability, marketProbability, context, yesModel, range, side);
  const probability = calibration.probability;
  const affordableContracts = Math.floor(maxCost / ask);
  const contracts = Math.max(1, Math.min(Math.floor(size), affordableContracts, 25));
  const fee = kalshiFeeDollars(contracts, ask);
  const cost = contracts * ask + fee;
  if (contracts < 1 || cost > maxCost + 0.00001) {
    return null;
  }

  const breakEven = cost / contracts;
  const edge = probability - breakEven;
  const recommendation = weatherRecommendation(edge, yesModel.confidence, ask, probability, context, range, side, calibration);
  const rankByRecommendation = {
    'research-buy': 4,
    'small-buy': 3,
    'tiny-only': 2,
    'audit-only': 1.5,
    pass: 1,
    'avoid-or-sell': 0,
  };

  return {
    ticker: market.ticker,
    eventTicker: market.event_ticker,
    series: location.series,
    location: location.label,
    stationHint: location.stationHint,
    side,
    subtitle: market.yes_sub_title,
    title: market.title,
    range: {
      label: range.label,
      kind: range.kind,
      low: range.low,
      high: range.high,
      center: range.center,
    },
    price: {
      ask,
      bid,
      askCents: Math.round(ask * 100),
      bidCents: Math.round(bid * 100),
      askSize: round(size, 2),
      last: marketPrice(market, 'last_price_dollars', 'last_price'),
    },
    probability: round(probability),
    weatherProbability: round(weatherOnlyProbability),
    marketProbability: round(marketProbability),
    rawProbability: round(rawProbability),
    tightProbability: round(tightProbability),
    wideProbability: round(wideProbability),
    breakEven: round(breakEven),
    adjustedEdge: round(edge),
    rawEdge: round(rawProbability - breakEven),
    weatherEdge: round(weatherOnlyProbability - breakEven),
    calibration: {
      marketWeight: round(calibration.marketWeight),
      distanceCap: calibration.distanceCap === null ? null : round(calibration.distanceCap),
      notes: calibration.reasons,
    },
    confidence: yesModel.confidence,
    riskFlags: [...yesModel.riskFlags, ...calibration.riskFlags],
    recommendation,
    rank: rankByRecommendation[recommendation] || 0,
    suggested: {
      contracts,
      maxCost: round(cost, 2),
      fee: round(fee, 2),
      maxPriceCents: Math.round(ask * 100),
      modelEv: round(contracts * edge, 2),
    },
    context: {
      meanHigh: context.forecast.meanHigh,
      hourlyMax: context.forecast.hourlyMax,
      remainingHourlyMax: context.forecast.remainingHourlyMax,
      dailyHigh: context.forecast.dailyHigh,
      forecastFinalHigh: context.forecast.forecastFinalHigh,
      shortForecast: context.forecast.shortForecast,
      detailedForecast: context.forecast.detailedForecast,
      maxPrecipProbability: context.regime.maxPrecipProbability,
      peakWindDirections: context.regime.peakWindDirections,
      observations: context.observations,
      settlement: context.settlement,
    },
    closeTime: market.close_time,
    expectedExpirationTime: market.expected_expiration_time,
    url: kalshiMarketUrl(market, location),
    rationale: [
      `${location.label} NWS model high ${Number(context.forecast.meanHigh).toFixed(1)}F from hourly max ${context.forecast.hourlyMax}F, remaining hourly max ${context.forecast.remainingHourlyMax}F, and daily high ${context.forecast.dailyHigh}F.`,
      `${location.stationId || 'Mapped station'} observation proxy: ${context.observations.observedHighF === null ? 'no observed high yet' : `${context.observations.observedHighF}F high so far`}; ${context.settlement.sourceNote}`,
      `${side.toUpperCase()} calibrated probability: ${(probability * 100).toFixed(1)}%; weather-only ${(weatherOnlyProbability * 100).toFixed(1)}%; market prior ${(marketProbability * 100).toFixed(1)}%; fee-adjusted break-even ${(breakEven * 100).toFixed(1)}%.`,
      ...yesModel.reasons,
      ...calibration.reasons,
    ],
  };
}

async function scanWeatherMarkets(options = {}) {
  const date = normalizeDate(options.date);
  const minEdge = clamp(parseNumber(options.minEdge, 0.03), -0.5, 0.5);
  const maxCost = clamp(parseNumber(options.maxCost, 3), 0.1, 100);
  const includeNegative = Boolean(options.includeNegative);
  const datePart = dateTickerPart(date);
  const candidates = [];
  const contexts = [];
  const errors = [];

  for (const location of WEATHER_LAB_LOCATIONS) {
    try {
      const context = await getWeatherLabContext(location, date);
      contexts.push(context);
      const markets = await getKalshiMarkets(location.series);
      for (const market of markets) {
        if (!String(market.ticker || '').includes(datePart)) {
          continue;
        }

        const range = getWeatherMarketRange(market);
        if (!range) {
          continue;
        }

        for (const side of ['yes', 'no']) {
          const candidate = scoreWeatherCandidate(market, location, context, range, side, maxCost);
          if (candidate && (includeNegative || candidate.adjustedEdge >= minEdge)) {
            candidates.push(candidate);
          }
        }
      }
    } catch (error) {
      errors.push({
        location: location.label,
        series: location.series,
        message: error.message,
      });
    }
  }

  candidates.sort((a, b) => (b.rank - a.rank) || (b.adjustedEdge - a.adjustedEdge));

  return {
    asOf: new Date().toISOString(),
    date,
    assumptions: {
      rawSigmaF: WEATHER_MODEL_SIGMAS.raw,
      tightSigmaF: WEATHER_MODEL_SIGMAS.tight,
      wideSigmaF: WEATHER_MODEL_SIGMAS.wide,
      calibration: 'Weather-only odds are shrunk toward a Kalshi market prior and capped unless same-day station data is decisive.',
      knownFailureModes: [
        'NWS forecast error is not perfectly normal.',
        'Local station settlement can differ from the mapped forecast point.',
        'Weather regime, clouds, precipitation, and wind shifts can bias the high.',
        'Kalshi prices include trader information the weather model may not have.',
        'Large model-market gaps are capped until the audit ledger proves calibration.',
      ],
      note: 'Weather Lab now reports calibrated research odds, not true odds or guaranteed edge.',
    },
    filters: {
      minEdge,
      maxCost,
      includeNegative,
    },
    contexts,
    candidates,
    errors,
  };
}

module.exports = {
  WEATHER_LAB_LOCATIONS,
  resolveWeatherMarkets,
  scanWeatherMarkets,
};
