'use strict';

const KALSHI_API_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const DEFAULT_SERIES = Object.freeze([
  'KXBTC15M',
  'KXHIGHNY',
  'KXHIGHMIA',
  'KXHIGHDEN',
  'KXHIGHLAX',
  'KXHIGHTDAL',
  'KXHIGHTLV',
  'KXHIGHTSEA',
  'KXHIGHTNOLA',
  'KXHIGHTHOU',
  'KXHIGHTMIN',
  'INX',
  'NASDAQ100',
]);
const MARKET_CACHE_MS = 2_500;
const MAX_SERIES = 18;
const MAX_MARKETS_PER_SERIES = 320;
const DEFAULT_MIN_NET = 0.005;
const marketCache = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function parseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSeriesList(value) {
  const raw = String(value || '').trim();
  const list = raw
    ? raw.split(/[\s,]+/)
    : DEFAULT_SERIES;
  const seen = new Set();
  return list
    .map((series) => String(series || '').replace(/[^a-z0-9]/gi, '').toUpperCase())
    .filter(Boolean)
    .filter((series) => {
      if (seen.has(series)) return false;
      seen.add(series);
      return true;
    })
    .slice(0, MAX_SERIES);
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 6_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Kalshi request failed ${response.status}: ${body.slice(0, 160)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getKalshiMarketsForSeries(series, maxMarkets) {
  const cacheKey = `${series}:${maxMarkets}`;
  const cached = marketCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MARKET_CACHE_MS) {
    return cached.markets;
  }

  const markets = [];
  let cursor = '';
  while (markets.length < maxMarkets) {
    const params = new URLSearchParams({
      series_ticker: series,
      status: 'open',
      limit: String(Math.min(200, maxMarkets - markets.length)),
    });
    if (cursor) {
      params.set('cursor', cursor);
    }
    const data = await fetchJson(`${KALSHI_API_BASE_URL}/markets?${params.toString()}`);
    const page = Array.isArray(data.markets) ? data.markets : [];
    markets.push(...page);
    cursor = String(data.cursor || '').trim();
    if (!cursor || page.length === 0) {
      break;
    }
  }

  marketCache.set(cacheKey, { at: Date.now(), markets });
  return markets;
}

function marketPrice(market, dollarField, centsField) {
  const dollarValue = market[dollarField];
  if (dollarValue !== undefined && dollarValue !== null && dollarValue !== '') {
    return clamp(parseNumber(dollarValue, 0), 0, 1);
  }
  const centsValue = market[centsField];
  if (centsValue !== undefined && centsValue !== null && centsValue !== '') {
    return clamp(parseNumber(centsValue, 0) / 100, 0, 1);
  }
  return 0;
}

function marketSize(market, side, bookSide = 'ask') {
  const key = `${side}_${bookSide}_size_fp`;
  const fallback = `${side}_${bookSide}_size`;
  const size = parseNumber(market[key] !== undefined ? market[key] : market[fallback], 0);
  return size > 0 ? size : 1;
}

function feeRateForMarket(market) {
  const series = String(market.series_ticker || market.ticker || '').toUpperCase();
  return series.startsWith('INX') || series.startsWith('NASDAQ100') ? 0.035 : 0.07;
}

function kalshiFeeDollars(contracts, priceDollars, rate = 0.07) {
  if (!Number.isFinite(priceDollars) || priceDollars <= 0 || priceDollars >= 1) return 0;
  return Math.ceil(rate * contracts * priceDollars * (1 - priceDollars) * 100) / 100;
}

function subtitle(market) {
  return String(market.yes_sub_title || market.yes_subtitle || market.subtitle || '').trim();
}

function marketLabel(market) {
  const sub = subtitle(market);
  return sub ? `${market.title || market.ticker} / ${sub}` : String(market.title || market.ticker || '');
}

function normalizeMarket(market) {
  const yesAsk = marketPrice(market, 'yes_ask_dollars', 'yes_ask');
  const yesBid = marketPrice(market, 'yes_bid_dollars', 'yes_bid');
  const noAsk = marketPrice(market, 'no_ask_dollars', 'no_ask');
  const noBid = marketPrice(market, 'no_bid_dollars', 'no_bid');
  return {
    raw: market,
    ticker: String(market.ticker || ''),
    eventTicker: String(market.event_ticker || ''),
    seriesTicker: String(market.series_ticker || '').toUpperCase(),
    title: String(market.title || ''),
    subtitle: subtitle(market),
    status: String(market.status || ''),
    closeTime: market.close_time || market.expiration_time || '',
    yesAsk,
    yesBid,
    noAsk,
    noBid,
    yesAskSize: marketSize(market, 'yes', 'ask'),
    noAskSize: marketSize(market, 'no', 'ask'),
    lastPrice: marketPrice(market, 'last_price_dollars', 'last_price'),
    volume: parseNumber(market.volume || market.volume_24h || 0, 0),
    openInterest: parseNumber(market.open_interest || 0, 0),
  };
}

function legFor(market, side) {
  const price = side === 'yes' ? market.yesAsk : market.noAsk;
  const size = side === 'yes' ? market.yesAskSize : market.noAskSize;
  return {
    ticker: market.ticker,
    eventTicker: market.eventTicker,
    seriesTicker: market.seriesTicker,
    label: marketLabel(market.raw),
    side,
    price,
    size,
    feeRate: feeRateForMarket(market.raw),
    url: kalshiMarketUrl(market),
  };
}

function kalshiMarketUrl(market) {
  const series = String(market.seriesTicker || market.eventTicker || '').toLowerCase();
  const eventTicker = String(market.eventTicker || '').toLowerCase();
  const hash = market.ticker ? `#market=${encodeURIComponent(market.ticker)}` : '';
  if (series && eventTicker) {
    return `https://kalshi.com/markets/${series}/${eventTicker}${hash}`;
  }
  return `https://kalshi.com/markets${hash}`;
}

function legFee(leg, contracts = 1) {
  return kalshiFeeDollars(contracts, leg.price, leg.feeRate);
}

function buildOpportunity({
  type,
  subtype,
  title,
  summary,
  eventTicker,
  legs,
  minPayout,
  variableUpside = false,
  severity = 'research',
  why = [],
  riskFlags = [],
}) {
  if (!Array.isArray(legs) || !legs.length) return null;
  if (legs.some((leg) => !(leg.price > 0 && leg.price < 1))) return null;

  const contractCount = 1;
  const subtotal = legs.reduce((sum, leg) => sum + leg.price * contractCount, 0);
  const fees = legs.reduce((sum, leg) => sum + legFee(leg, contractCount), 0);
  const totalCost = subtotal + fees;
  const netProfit = minPayout - totalCost;
  const maxContracts = Math.max(1, Math.floor(Math.min(...legs.map((leg) => leg.size || 1))));
  const edgePct = minPayout > 0 ? netProfit / minPayout : 0;
  const roiPct = totalCost > 0 ? netProfit / totalCost : 0;

  return {
    id: `${type}:${legs.map((leg) => `${leg.side}-${leg.ticker}`).join('|')}`,
    type,
    subtype,
    severity,
    title,
    summary,
    eventTicker,
    minPayout: round(minPayout, 4),
    variableUpside,
    subtotal: round(subtotal, 4),
    fees: round(fees, 4),
    totalCost: round(totalCost, 4),
    netProfit: round(netProfit, 4),
    edgePct: round(edgePct, 4),
    roiPct: round(roiPct, 4),
    maxContracts,
    maxTheoreticalNet: round(netProfit * maxContracts, 4),
    legs: legs.map((leg) => ({
      ...leg,
      price: round(leg.price, 4),
      fee: round(legFee(leg), 4),
      size: round(leg.size, 2),
    })),
    why,
    riskFlags: [
      'Top-of-book only',
      'Requires all legs to fill before prices move',
      ...riskFlags,
    ],
    kalshiUrl: legs[0] ? legs[0].url : 'https://kalshi.com/markets',
  };
}

function parseRange(market) {
  const text = `${market.subtitle} ${market.title}`.replace(/,/g, '');
  let match = text.match(/(-?\d+(?:\.\d+)?)\D+to\D+(-?\d+(?:\.\d+)?)/i);
  if (match) {
    const low = Number(match[1]);
    const high = Number(match[2]);
    return {
      kind: 'between',
      low,
      high,
      lowerBound: low - 0.5,
      upperBound: high + 0.5,
    };
  }

  match = text.match(/(-?\d+(?:\.\d+)?)\D*(?:or|and)\D*above/i) || text.match(/above\D*(-?\d+(?:\.\d+)?)/i);
  if (match) {
    const low = Number(match[1]);
    return {
      kind: 'above',
      low,
      high: null,
      lowerBound: low - 0.5,
      upperBound: Infinity,
    };
  }

  match = text.match(/(-?\d+(?:\.\d+)?)\D*(?:or|and)\D*below/i) || text.match(/below\D*(-?\d+(?:\.\d+)?)/i);
  if (match) {
    const high = Number(match[1]);
    return {
      kind: 'below',
      low: null,
      high,
      lowerBound: -Infinity,
      upperBound: high + 0.5,
    };
  }

  return null;
}

function parseThreshold(market) {
  const text = `${market.subtitle} ${market.title}`.replace(/,/g, '');
  let match = text.match(/(?:>|above|over|at least)\D*(-?\d+(?:\.\d+)?)/i);
  if (match) {
    return { direction: 'above', threshold: Number(match[1]) };
  }
  match = text.match(/(-?\d+(?:\.\d+)?)\D*(?:or|and)\D*above/i);
  if (match) {
    return { direction: 'above', threshold: Number(match[1]) };
  }
  match = text.match(/(?:<|below|under|at most)\D*(-?\d+(?:\.\d+)?)/i);
  if (match) {
    return { direction: 'below', threshold: Number(match[1]) };
  }
  match = text.match(/(-?\d+(?:\.\d+)?)\D*(?:or|and)\D*below/i);
  if (match) {
    return { direction: 'below', threshold: Number(match[1]) };
  }
  return null;
}

function rangesOverlap(left, right) {
  return left.lowerBound < right.upperBound && right.lowerBound < left.upperBound;
}

function isCompleteRangeBook(ranges) {
  if (!ranges.length) return false;
  const sorted = [...ranges].sort((a, b) => a.range.lowerBound - b.range.lowerBound);
  if (sorted[0].range.lowerBound !== -Infinity) return false;
  if (sorted[sorted.length - 1].range.upperBound !== Infinity) return false;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index].range;
    const next = sorted[index + 1].range;
    if (Math.abs(current.upperBound - next.lowerBound) > 1.01) {
      return false;
    }
  }
  return true;
}

function groupByEvent(markets) {
  const groups = new Map();
  for (const market of markets) {
    const key = market.eventTicker || market.ticker;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(market);
  }
  return groups;
}

function scanSameMarketComplements(markets) {
  const opportunities = [];
  for (const market of markets) {
    opportunities.push(buildOpportunity({
      type: 'same-market',
      subtype: 'yes-no-complement',
      severity: 'hard',
      title: market.title || market.ticker,
      summary: 'Buy YES and NO on the same contract for a guaranteed $1 payout.',
      eventTicker: market.eventTicker,
      legs: [legFor(market, 'yes'), legFor(market, 'no')],
      minPayout: 1,
      why: [
        'A YES/NO pair on the same binary contract must pay exactly $1 before fees.',
        'If the all-in cost is below $1, the difference is a pure top-of-book inconsistency.',
      ],
    }));
  }
  return opportunities.filter(Boolean);
}

function scanCompleteRangeBooks(eventGroups) {
  const opportunities = [];
  for (const [eventTicker, markets] of eventGroups.entries()) {
    const ranged = markets
      .map((market) => ({ market, range: parseRange(market) }))
      .filter((entry) => entry.range);
    if (ranged.length < 3 || !isCompleteRangeBook(ranged)) {
      continue;
    }
    const legs = ranged.map((entry) => legFor(entry.market, 'yes'));
    opportunities.push(buildOpportunity({
      type: 'complete-set',
      subtype: 'complete-range-book',
      severity: 'hard',
      title: markets[0].title || eventTicker,
      summary: 'Buy YES on every detected range in a complete event book.',
      eventTicker,
      legs,
      minPayout: 1,
      why: [
        'The detected ranges cover below, middle, and above without gaps.',
        'Exactly one complete range should resolve YES, so the basket pays $1.',
      ],
      riskFlags: ['Range completeness inferred from market subtitles'],
    }));
  }
  return opportunities.filter(Boolean);
}

function scanThresholdDominance(eventGroups) {
  const opportunities = [];
  for (const [eventTicker, markets] of eventGroups.entries()) {
    const thresholds = markets
      .map((market) => ({ market, threshold: parseThreshold(market) }))
      .filter((entry) => entry.threshold);

    for (let leftIndex = 0; leftIndex < thresholds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < thresholds.length; rightIndex += 1) {
        const left = thresholds[leftIndex];
        const right = thresholds[rightIndex];
        if (left.threshold.direction !== right.threshold.direction) {
          continue;
        }

        let superset = null;
        let subset = null;
        if (left.threshold.direction === 'above') {
          superset = left.threshold.threshold < right.threshold.threshold ? left : right;
          subset = superset === left ? right : left;
        } else {
          superset = left.threshold.threshold > right.threshold.threshold ? left : right;
          subset = superset === left ? right : left;
        }

        opportunities.push(buildOpportunity({
          type: 'threshold',
          subtype: `${left.threshold.direction}-dominance`,
          severity: 'hard',
          title: superset.market.title || eventTicker,
          summary: `Buy YES on broader ${left.threshold.direction} threshold and NO on narrower threshold.`,
          eventTicker,
          legs: [legFor(superset.market, 'yes'), legFor(subset.market, 'no')],
          minPayout: 1,
          variableUpside: true,
          why: [
            'If the narrower threshold wins, the broader threshold also wins.',
            'YES broader plus NO narrower pays at least $1, and can pay $2 in the middle band.',
          ],
        }));
      }
    }
  }
  return opportunities.filter(Boolean);
}

function scanMutuallyExclusiveRanges(eventGroups) {
  const opportunities = [];
  for (const [eventTicker, markets] of eventGroups.entries()) {
    const ranged = markets
      .map((market) => ({ market, range: parseRange(market) }))
      .filter((entry) => entry.range);

    for (let leftIndex = 0; leftIndex < ranged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ranged.length; rightIndex += 1) {
        const left = ranged[leftIndex];
        const right = ranged[rightIndex];
        if (rangesOverlap(left.range, right.range)) {
          continue;
        }
        opportunities.push(buildOpportunity({
          type: 'exclusive',
          subtype: 'range-no-pair',
          severity: 'hard',
          title: left.market.title || eventTicker,
          summary: 'Buy NO on two non-overlapping range outcomes.',
          eventTicker,
          legs: [legFor(left.market, 'no'), legFor(right.market, 'no')],
          minPayout: 1,
          variableUpside: true,
          why: [
            'Two non-overlapping ranges cannot both resolve YES.',
            'Buying NO on both pays at least $1 and can pay $2 if neither range wins.',
          ],
          riskFlags: ['Range exclusivity inferred from market subtitles'],
        }));
      }
    }
  }
  return opportunities.filter(Boolean);
}

function rankOpportunities(opportunities, minNet) {
  const unique = new Map();
  for (const opportunity of opportunities.filter(Boolean)) {
    const existing = unique.get(opportunity.id);
    if (!existing || opportunity.netProfit > existing.netProfit) {
      unique.set(opportunity.id, opportunity);
    }
  }
  const all = Array.from(unique.values())
    .sort((left, right) => right.netProfit - left.netProfit || right.roiPct - left.roiPct);
  return {
    opportunities: all.filter((opportunity) => opportunity.netProfit >= minNet),
    nearMisses: all.filter((opportunity) => opportunity.netProfit < minNet).slice(0, 40),
    best: all[0] || null,
  };
}

async function scanKalshiConsistency(options = {}) {
  const seriesList = normalizeSeriesList(options.series);
  const maxMarketsPerSeries = Math.floor(clamp(parseNumber(options.maxMarketsPerSeries, 160), 25, MAX_MARKETS_PER_SERIES));
  const minNet = clamp(parseNumber(options.minNet, DEFAULT_MIN_NET), -0.5, 0.5);
  const errors = [];
  const marketPages = await Promise.all(seriesList.map(async (series) => {
    try {
      return {
        series,
        markets: await getKalshiMarketsForSeries(series, maxMarketsPerSeries),
      };
    } catch (error) {
      errors.push({ series, error: error.message });
      return { series, markets: [] };
    }
  }));

  const markets = marketPages
    .flatMap((page) => page.markets)
    .map(normalizeMarket)
    .filter((market) => market.ticker && market.status !== 'closed');
  const eventGroups = groupByEvent(markets);
  const rawCandidates = [
    ...scanSameMarketComplements(markets),
    ...scanCompleteRangeBooks(eventGroups),
    ...scanThresholdDominance(eventGroups),
    ...scanMutuallyExclusiveRanges(eventGroups),
  ];
  const ranked = rankOpportunities(rawCandidates, minNet);
  const hardCount = ranked.opportunities.filter((opportunity) => opportunity.severity === 'hard').length;

  return {
    ok: true,
    asOf: new Date().toISOString(),
    source: 'Kalshi public markets API',
    series: seriesList,
    scannedMarkets: markets.length,
    scannedEvents: eventGroups.size,
    rawCandidateCount: rawCandidates.length,
    hardCount,
    minNet: round(minNet, 4),
    bestNetProfit: ranked.best ? ranked.best.netProfit : 0,
    opportunities: ranked.opportunities.slice(0, 80),
    nearMisses: ranked.nearMisses,
    errors,
    notes: [
      'Scanner uses the current top-of-book ask and Kalshi fee formula.',
      'An alert is executable only if every listed leg fills at or below the shown price.',
      'No forecasting model is used in hard consistency checks.',
    ],
  };
}

module.exports = {
  scanKalshiConsistency,
};
