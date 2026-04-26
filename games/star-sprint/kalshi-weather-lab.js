'use strict';

const KALSHI_API_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

const WEATHER_LAB_LOCATIONS = Object.freeze([
  { series: 'KXHIGHNY', label: 'New York', lat: 40.78, lon: -73.97, stationHint: 'Central Park / NYC market' },
  { series: 'KXHIGHMIA', label: 'Miami', lat: 25.79, lon: -80.29, stationHint: 'Miami International Airport' },
  { series: 'KXHIGHDEN', label: 'Denver', lat: 39.86, lon: -104.67, stationHint: 'Denver airport area' },
  { series: 'KXHIGHLAX', label: 'Los Angeles', lat: 33.94, lon: -118.40, stationHint: 'Los Angeles airport area' },
  { series: 'KXHIGHTDAL', label: 'Dallas', lat: 32.85, lon: -96.85, stationHint: 'Dallas airport area' },
  { series: 'KXHIGHTLV', label: 'Las Vegas', lat: 36.08, lon: -115.15, stationHint: 'Las Vegas airport area' },
  { series: 'KXHIGHTSEA', label: 'Seattle', lat: 47.45, lon: -122.31, stationHint: 'Seattle airport area' },
  { series: 'KXHIGHTNOLA', label: 'New Orleans', lat: 29.99, lon: -90.26, stationHint: 'New Orleans airport area' },
  { series: 'KXHIGHTHOU', label: 'Houston', lat: 29.98, lon: -95.34, stationHint: 'Houston airport area' },
  { series: 'KXHIGHTMIN', label: 'Minneapolis', lat: 44.88, lon: -93.22, stationHint: 'Minneapolis airport area' },
]);

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
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

async function getKalshiMarkets(series, limit = 200) {
  const url = `${KALSHI_API_BASE_URL}/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=${limit}`;
  const data = await fetchJsonWithRetry(url);
  return Array.isArray(data.markets) ? data.markets : [];
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

async function getWeatherLabContext(location, date) {
  const point = await fetchJsonWithRetry(`https://api.weather.gov/points/${location.lat},${location.lon}`);
  const hourly = await fetchJsonWithRetry(point.properties.forecastHourly);
  const daily = await fetchJsonWithRetry(point.properties.forecast);
  const dayHours = (hourly.properties.periods || []).filter((period) => String(period.startTime || '').startsWith(date));
  const temps = dayHours.map((period) => Number(period.temperature)).filter(Number.isFinite);
  const hourlyMax = temps.length ? Math.max(...temps) : null;
  const dailyPeriod = (daily.properties.periods || []).find((period) => (
    String(period.startTime || '').startsWith(date)
    && (period.isDaytime || /day|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(String(period.name || '')))
  ));
  const dailyHigh = dailyPeriod && Number.isFinite(Number(dailyPeriod.temperature)) ? Number(dailyPeriod.temperature) : null;
  const highParts = [hourlyMax, dailyHigh].filter((value) => value !== null && Number.isFinite(value));
  if (!highParts.length) {
    throw new Error(`No NWS high forecast found for ${location.label} ${date}.`);
  }

  const meanHigh = highParts.reduce((sum, value) => sum + value, 0) / highParts.length;
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
      dailyHigh,
      meanHigh,
      shortForecast: dailyPeriod ? dailyPeriod.shortForecast : null,
      detailedForecast: dailyPeriod ? dailyPeriod.detailedForecast : null,
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
  const raw = weatherProbability(range, meanHigh, 3);
  const tight = weatherProbability(range, meanHigh, 2);
  const wide = weatherProbability(range, meanHigh, 4);
  let probability = 0.45 * raw + 0.35 * tight + 0.20 * wide;
  const reasons = [
    `Raw sigma=3 model ${(raw * 100).toFixed(1)}%, tight sigma=2 ${(tight * 100).toFixed(1)}%, wide sigma=4 ${(wide * 100).toFixed(1)}%.`,
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

  const spreadPenalty = Math.min(0.28, Math.abs(tight - wide) * 0.8);
  let confidenceScore = 0.78 - spreadPenalty;
  if (wet) confidenceScore -= 0.08;
  if (upslope) confidenceScore -= 0.08;
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

function weatherRecommendation(edge, confidence, ask, probability) {
  if (edge >= 0.12 && confidence !== 'low' && probability >= 0.12) return 'research-buy';
  if (edge >= 0.06 && confidence === 'high') return 'small-buy';
  if (edge >= 0.03 && ask <= 0.05) return 'tiny-only';
  if (edge <= -0.04) return 'avoid-or-sell';
  return 'pass';
}

function kalshiMarketUrl(market, location) {
  const series = String(market.series_ticker || market.event_ticker || location.series || '').split('-')[0];
  const ticker = String(market.ticker || '').toLowerCase();
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
  return ticker ? `${base}#${ticker}` : base;
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
  const probability = side === 'yes' ? yesModel.adjustedProbability : 1 - yesModel.adjustedProbability;
  const rawProbability = side === 'yes' ? yesModel.rawProbability : 1 - yesModel.rawProbability;
  const tightProbability = side === 'yes' ? yesModel.tightProbability : 1 - yesModel.tightProbability;
  const wideProbability = side === 'yes' ? yesModel.wideProbability : 1 - yesModel.wideProbability;
  const affordableContracts = Math.floor(maxCost / ask);
  const contracts = Math.max(1, Math.min(Math.floor(size), affordableContracts, 25));
  const fee = kalshiFeeDollars(contracts, ask);
  const cost = contracts * ask + fee;
  if (contracts < 1 || cost > maxCost + 0.00001) {
    return null;
  }

  const breakEven = cost / contracts;
  const edge = probability - breakEven;
  const recommendation = weatherRecommendation(edge, yesModel.confidence, ask, probability);
  const rankByRecommendation = {
    'research-buy': 4,
    'small-buy': 3,
    'tiny-only': 2,
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
    rawProbability: round(rawProbability),
    tightProbability: round(tightProbability),
    wideProbability: round(wideProbability),
    breakEven: round(breakEven),
    adjustedEdge: round(edge),
    rawEdge: round(rawProbability - breakEven),
    confidence: yesModel.confidence,
    riskFlags: yesModel.riskFlags,
    recommendation,
    rank: rankByRecommendation[recommendation] || 0,
    suggested: {
      contracts,
      maxCost: round(cost, 2),
      fee: round(fee, 2),
      maxPriceCents: Math.round(ask * 100),
    },
    context: {
      meanHigh: context.forecast.meanHigh,
      hourlyMax: context.forecast.hourlyMax,
      dailyHigh: context.forecast.dailyHigh,
      shortForecast: context.forecast.shortForecast,
      detailedForecast: context.forecast.detailedForecast,
      maxPrecipProbability: context.regime.maxPrecipProbability,
      peakWindDirections: context.regime.peakWindDirections,
    },
    closeTime: market.close_time,
    expectedExpirationTime: market.expected_expiration_time,
    url: kalshiMarketUrl(market, location),
    rationale: [
      `${location.label} NWS mean high ${Number(context.forecast.meanHigh).toFixed(1)}F from hourly max ${context.forecast.hourlyMax}F and daily high ${context.forecast.dailyHigh}F.`,
      `${side.toUpperCase()} fair probability after weather adjustments: ${(probability * 100).toFixed(1)}%; fee-adjusted break-even: ${(breakEven * 100).toFixed(1)}%.`,
      ...yesModel.reasons,
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
      rawSigmaF: 3,
      tightSigmaF: 2,
      wideSigmaF: 4,
      note: 'Weather Lab blends raw normal models and weather-regime penalties. It is a research model, not proof of edge.',
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
  scanWeatherMarkets,
};
