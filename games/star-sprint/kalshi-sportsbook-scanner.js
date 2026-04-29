'use strict';

const KALSHI_API_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const ODDS_API_BASE_URL = 'https://api.the-odds-api.com/v4';
const DEFAULT_SPORTS = Object.freeze([
  'basketball_nba',
  'baseball_mlb',
  'icehockey_nhl',
]);
const DEFAULT_BOOKMAKERS = Object.freeze([
  'draftkings',
  'fanduel',
  'betmgm',
  'caesars',
  'espnbet',
  'fanatics',
]);
const SPORT_LABELS = Object.freeze({
  americanfootball_nfl: 'NFL',
  basketball_nba: 'NBA',
  baseball_mlb: 'MLB',
  icehockey_nhl: 'NHL',
  soccer_epl: 'EPL',
  soccer_usa_mls: 'MLS',
});
const SPORTS_EVENT_RE = /(^KX(NBA|NHL|MLB|NFL|EPL|MLS|SOCCER|TENNIS|GOLF|UFC|F1)|SPORT|wins by over|points scored|runs scored|goals scored|both teams to score|lightning|stars|knights|lakers|yankees|dodgers|mets|cubs|wild)/i;
const KALSHI_CACHE_MS = 3_000;
const ODDS_CACHE_MS = 20_000;
const MAX_KALSHI_MARKETS = 1_200;
const MAX_ASSOCIATED_MARKETS = 260;
const MAX_ODDS_SPORTS = 5;
const DEFAULT_KALSHI_LIMIT = 320;
const kalshiPageCache = new Map();
const kalshiTickerCache = new Map();
const oddsCache = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, places = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function normalizeCsv(value, fallback, maxItems) {
  const raw = String(value || '').trim();
  const items = raw ? raw.split(/[\s,]+/) : fallback;
  const seen = new Set();
  return items
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, maxItems);
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 8_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Request failed ${response.status}: ${body.slice(0, 160)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchKalshiMarketPages(limit) {
  const maxMarkets = clamp(Math.floor(parseNumber(limit, DEFAULT_KALSHI_LIMIT)), 50, MAX_KALSHI_MARKETS);
  const cacheKey = String(maxMarkets);
  const cached = kalshiPageCache.get(cacheKey);
  if (cached && Date.now() - cached.at < KALSHI_CACHE_MS) {
    return cached.markets;
  }

  const markets = [];
  let cursor = '';
  while (markets.length < maxMarkets) {
    const params = new URLSearchParams({
      status: 'open',
      limit: String(Math.min(1000, maxMarkets - markets.length)),
    });
    if (cursor) params.set('cursor', cursor);
    const data = await fetchJson(`${KALSHI_API_BASE_URL}/markets?${params.toString()}`);
    const page = Array.isArray(data.markets) ? data.markets : [];
    markets.push(...page);
    cursor = String(data.cursor || '').trim();
    if (!cursor || page.length === 0) break;
  }

  kalshiPageCache.set(cacheKey, { at: Date.now(), markets });
  return markets;
}

async function fetchKalshiMarketByTicker(ticker) {
  const id = String(ticker || '').trim().toUpperCase();
  if (!id) return null;
  const cached = kalshiTickerCache.get(id);
  if (cached && Date.now() - cached.at < KALSHI_CACHE_MS) {
    return cached.market;
  }
  try {
    const data = await fetchJson(`${KALSHI_API_BASE_URL}/markets/${encodeURIComponent(id)}`);
    const market = data.market || data;
    kalshiTickerCache.set(id, { at: Date.now(), market });
    return market;
  } catch (error) {
    kalshiTickerCache.set(id, { at: Date.now(), market: null });
    return null;
  }
}

async function fetchAssociatedMarkets(markets) {
  const tickers = [];
  const seen = new Set();
  for (const market of markets) {
    const legs = Array.isArray(market.mve_selected_legs) ? market.mve_selected_legs : [];
    for (const leg of legs) {
      const ticker = String(leg.market_ticker || '').trim().toUpperCase();
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      tickers.push(ticker);
      if (tickers.length >= MAX_ASSOCIATED_MARKETS) break;
    }
    if (tickers.length >= MAX_ASSOCIATED_MARKETS) break;
  }

  const marketsByTicker = [];
  for (let i = 0; i < tickers.length; i += 12) {
    const batch = tickers.slice(i, i + 12);
    const results = await Promise.all(batch.map(fetchKalshiMarketByTicker));
    for (const market of results) {
      if (market) marketsByTicker.push(market);
    }
  }
  return marketsByTicker;
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
  return size > 0 ? size : 0;
}

function kalshiFeeDollars(priceDollars) {
  if (!Number.isFinite(priceDollars) || priceDollars <= 0 || priceDollars >= 1) return 0;
  return Math.ceil(0.07 * priceDollars * (1 - priceDollars) * 100) / 100;
}

function subtitle(market) {
  return String(market.yes_sub_title || market.yes_subtitle || market.subtitle || market.title || '').trim();
}

function isSportsMarket(market) {
  const haystack = [
    market.ticker,
    market.event_ticker,
    market.series_ticker,
    market.category,
    market.title,
    market.yes_sub_title,
    market.no_sub_title,
    market.rules_primary,
  ].join(' ');
  return SPORTS_EVENT_RE.test(haystack);
}

function isTradableTopOfBook(market) {
  const yesAsk = marketPrice(market, 'yes_ask_dollars', 'yes_ask');
  const noAsk = marketPrice(market, 'no_ask_dollars', 'no_ask');
  return (yesAsk > 0.001 && yesAsk < 0.999) || (noAsk > 0.001 && noAsk < 0.999);
}

function parseLegText(text) {
  const clean = String(text || '').trim();
  const sideMatch = clean.match(/^(yes|no)\s+(.+)$/i);
  const legSide = sideMatch ? sideMatch[1].toLowerCase() : 'yes';
  const description = (sideMatch ? sideMatch[2] : clean).trim();
  const lower = description.toLowerCase();
  const totalMatch = description.match(/\bOver\s+([\d.]+)\s+(points|runs|goals)\s+scored/i);
  const spreadMatch = description.match(/(.+?)\s+wins by over\s+([\d.]+)\s+(points|runs|goals)/i);
  const propMatch = description.match(/^([^:]+):\s*([\d.]+)\+/);
  let type = 'moneyline';
  let point = null;
  let unit = '';
  let participant = description;
  let outcome = legSide === 'no' ? `Not ${description}` : description;

  if (/both teams to score/i.test(description)) {
    type = 'both_teams_to_score';
    outcome = legSide === 'no' ? 'No both teams score' : 'Both teams score';
  } else if (totalMatch) {
    type = 'total';
    point = parseNumber(totalMatch[1], null);
    unit = totalMatch[2].toLowerCase();
    participant = 'Game total';
    outcome = legSide === 'no' ? 'Under' : 'Over';
  } else if (spreadMatch) {
    type = 'spread';
    participant = spreadMatch[1].trim();
    point = parseNumber(spreadMatch[2], null);
    unit = spreadMatch[3].toLowerCase();
    outcome = legSide === 'no' ? `${participant} not by ${point}+` : `${participant} by ${point}+`;
  } else if (propMatch) {
    type = 'player_prop';
    participant = propMatch[1].trim();
    point = parseNumber(propMatch[2], null);
    outcome = legSide === 'no' ? `${participant} under ${point}` : `${participant} ${point}+`;
  } else if (lower.startsWith('over ')) {
    type = 'total';
    participant = 'Game total';
    outcome = legSide === 'no' ? 'Under' : 'Over';
  }

  return {
    raw: clean,
    legSide,
    type,
    participant,
    point,
    unit,
    outcome,
    description,
  };
}

function parseKalshiLegs(market) {
  const text = subtitle(market);
  const parts = text
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const parsedFromTitle = parts.map(parseLegText);
  const selected = Array.isArray(market.mve_selected_legs) ? market.mve_selected_legs : [];
  if (!selected.length) return parsedFromTitle;
  return parsedFromTitle.map((leg, index) => ({
    ...leg,
    eventTicker: selected[index] && selected[index].event_ticker ? selected[index].event_ticker : '',
    marketTicker: selected[index] && selected[index].market_ticker ? selected[index].market_ticker : '',
  }));
}

function matchabilityForLegs(legs, market) {
  const eventTicker = String(market.event_ticker || market.ticker || '').toUpperCase();
  if (legs.length === 1 && /KX(NBA|NHL|MLB)/.test(eventTicker) && ['moneyline', 'spread', 'total'].includes(legs[0].type)) {
    return 'clean';
  }
  if (legs.length === 1 && ['moneyline', 'spread', 'total', 'both_teams_to_score'].includes(legs[0].type)) {
    return 'manual';
  }
  if (legs.length <= 3) return 'parlay';
  return 'long-parlay';
}

function kalshiMarketUrl(market) {
  const eventTicker = String(market.event_ticker || '').toLowerCase();
  const series = String(market.series_ticker || eventTicker.split('-')[0] || '').toLowerCase();
  const ticker = String(market.ticker || '');
  if (series && eventTicker) {
    return `https://kalshi.com/markets/${series}/${eventTicker}#market=${encodeURIComponent(ticker)}`;
  }
  return `https://kalshi.com/markets#market=${encodeURIComponent(ticker)}`;
}

function normalizeKalshiMarket(market, source = 'kalshi') {
  const yesAsk = marketPrice(market, 'yes_ask_dollars', 'yes_ask');
  const noAsk = marketPrice(market, 'no_ask_dollars', 'no_ask');
  const yesFee = kalshiFeeDollars(yesAsk);
  const noFee = kalshiFeeDollars(noAsk);
  const legs = parseKalshiLegs(market);
  return {
    source,
    ticker: String(market.ticker || ''),
    eventTicker: String(market.event_ticker || ''),
    seriesTicker: String(market.series_ticker || '').toUpperCase(),
    title: String(market.title || subtitle(market) || market.ticker || ''),
    subtitle: subtitle(market),
    yesAsk,
    noAsk,
    yesBid: marketPrice(market, 'yes_bid_dollars', 'yes_bid'),
    noBid: marketPrice(market, 'no_bid_dollars', 'no_bid'),
    yesAskSize: marketSize(market, 'yes', 'ask'),
    noAskSize: marketSize(market, 'no', 'ask'),
    yesAllIn: round(yesAsk + yesFee, 4),
    noAllIn: round(noAsk + noFee, 4),
    yesFee,
    noFee,
    expectedExpirationTime: market.expected_expiration_time || market.occurrence_datetime || market.close_time || '',
    closeTime: market.close_time || market.expiration_time || '',
    rules: String(market.rules_primary || ''),
    legs,
    legCount: legs.length,
    matchability: matchabilityForLegs(legs, market),
    url: kalshiMarketUrl(market),
  };
}

function americanToDecimal(american) {
  const odds = Number(american);
  if (!Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

function impliedProbabilityFromAmerican(american) {
  const decimal = americanToDecimal(american);
  if (!decimal) return null;
  return 1 / decimal;
}

function normalizeBookmakers(value) {
  return normalizeCsv(value, DEFAULT_BOOKMAKERS, 12)
    .map((bookmaker) => bookmaker.replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean);
}

function normalizeSports(value) {
  return normalizeCsv(value, DEFAULT_SPORTS, MAX_ODDS_SPORTS)
    .map((sport) => sport.replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean);
}

async function fetchSportsbookOddsForSport(sport, bookmakers) {
  const apiKey = String(process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY || '').trim();
  if (!apiKey) return { configured: false, events: [], error: '' };
  const bookParam = normalizeBookmakers(bookmakers).join(',');
  const params = new URLSearchParams({
    apiKey,
    markets: 'h2h,spreads,totals',
    oddsFormat: 'american',
    dateFormat: 'iso',
  });
  if (bookParam) {
    params.set('bookmakers', bookParam);
  } else {
    params.set('regions', 'us');
  }
  const cacheKey = `${sport}:${bookParam || 'us'}`;
  const cached = oddsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ODDS_CACHE_MS) {
    return { configured: true, events: cached.events, error: '' };
  }
  const data = await fetchJson(`${ODDS_API_BASE_URL}/sports/${sport}/odds/?${params.toString()}`, {
    timeoutMs: 10_000,
  });
  const events = Array.isArray(data) ? data : [];
  oddsCache.set(cacheKey, { at: Date.now(), events });
  return { configured: true, events, error: '' };
}

function groupKeyForOutcome(marketKey, outcome) {
  if (marketKey === 'totals') {
    return `${marketKey}:${parseNumber(outcome.point, 0)}`;
  }
  if (marketKey === 'spreads') {
    return `${marketKey}:${Math.abs(parseNumber(outcome.point, 0))}`;
  }
  return marketKey;
}

function flattenSportsbookEvent(event, sportKey) {
  const rows = [];
  const sportTitle = SPORT_LABELS[sportKey] || String(event.sport_title || sportKey || '').toUpperCase();
  const game = `${event.away_team || 'Away'} at ${event.home_team || 'Home'}`;
  for (const bookmaker of Array.isArray(event.bookmakers) ? event.bookmakers : []) {
    for (const market of Array.isArray(bookmaker.markets) ? bookmaker.markets : []) {
      const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
      const groups = new Map();
      for (const outcome of outcomes) {
        const implied = impliedProbabilityFromAmerican(outcome.price);
        if (!implied) continue;
        const key = groupKeyForOutcome(market.key, outcome);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ ...outcome, implied });
      }
      for (const group of groups.values()) {
        const totalImplied = group.reduce((sum, outcome) => sum + outcome.implied, 0);
        for (const outcome of group) {
          const noVig = totalImplied > 0 ? outcome.implied / totalImplied : null;
          rows.push({
            sportKey,
            sportTitle,
            eventId: String(event.id || ''),
            commenceTime: event.commence_time || '',
            homeTeam: event.home_team || '',
            awayTeam: event.away_team || '',
            game,
            bookmakerKey: bookmaker.key || '',
            bookmakerTitle: bookmaker.title || bookmaker.key || '',
            marketKey: market.key || '',
            marketTitle: market.key === 'h2h' ? 'Moneyline' : market.key === 'spreads' ? 'Spread' : 'Total',
            outcome: outcome.name || '',
            description: outcome.description || '',
            point: outcome.point === undefined ? null : outcome.point,
            americanOdds: outcome.price,
            decimalOdds: round(americanToDecimal(outcome.price), 4),
            impliedProbability: round(outcome.implied, 4),
            noVigProbability: noVig === null ? null : round(noVig, 4),
            holdPct: round(Math.max(0, totalImplied - 1) * 100, 2),
            lastUpdate: market.last_update || bookmaker.last_update || '',
          });
        }
      }
    }
  }
  return rows;
}

async function fetchSportsbookBoard({ sports, bookmakers }) {
  const selectedSports = normalizeSports(sports);
  const selectedBookmakers = normalizeBookmakers(bookmakers);
  const apiKey = String(process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY || '').trim();
  if (!apiKey) {
    return {
      configured: false,
      sports: selectedSports,
      bookmakers: selectedBookmakers,
      rows: [],
      errors: [],
      note: 'Set THE_ODDS_API_KEY or ODDS_API_KEY on the backend to enable live sportsbook lines. Manual calculator still works.',
    };
  }

  const rows = [];
  const errors = [];
  for (const sport of selectedSports) {
    try {
      const result = await fetchSportsbookOddsForSport(sport, selectedBookmakers.join(','));
      for (const event of result.events) {
        rows.push(...flattenSportsbookEvent(event, sport));
      }
    } catch (error) {
      errors.push({ sport, error: error.message });
    }
  }

  rows.sort((a, b) => {
    const timeDiff = new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime();
    if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
    return String(a.game).localeCompare(String(b.game));
  });

  return {
    configured: true,
    sports: selectedSports,
    bookmakers: selectedBookmakers,
    rows: rows.slice(0, 600),
    errors,
    note: '',
  };
}

function compactText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roughMatchScore(kalshi, sportsbook) {
  if (!kalshi.legs || kalshi.legs.length !== 1) return 0;
  const leg = kalshi.legs[0];
  let score = 0;
  const rowText = compactText(`${sportsbook.game} ${sportsbook.outcome} ${sportsbook.marketTitle} ${sportsbook.point || ''}`);
  const participantTokens = compactText(leg.participant).split(' ').filter((token) => token.length >= 3);
  for (const token of participantTokens) {
    if (rowText.includes(token)) score += 0.12;
  }
  if (leg.type === 'total' && sportsbook.marketKey === 'totals') score += 0.35;
  if (leg.type === 'spread' && sportsbook.marketKey === 'spreads') score += 0.35;
  if (leg.type === 'moneyline' && sportsbook.marketKey === 'h2h') score += 0.25;
  if (leg.point !== null && sportsbook.point !== null && Math.abs(Number(leg.point) - Number(sportsbook.point)) < 0.01) {
    score += 0.25;
  }
  const outcomeText = compactText(leg.outcome);
  if (outcomeText && rowText.includes(outcomeText.split(' ')[0] || '')) score += 0.08;
  return clamp(score, 0, 1);
}

function buildRoughMatches(kalshiMarkets, sportsbookRows) {
  const matches = [];
  for (const kalshi of kalshiMarkets) {
    if (!kalshi.legs || kalshi.legs.length !== 1) continue;
    let best = null;
    for (const row of sportsbookRows) {
      const score = roughMatchScore(kalshi, row);
      if (score < 0.45) continue;
      if (!best || score > best.score) {
        best = { score, sportsbook: row };
      }
    }
    if (best) {
      const bookProb = best.sportsbook.noVigProbability || best.sportsbook.impliedProbability || 0;
      const allIn = kalshi.yesAllIn || kalshi.yesAsk;
      matches.push({
        score: round(best.score, 3),
        kalshi,
        sportsbook: best.sportsbook,
        referenceProbability: bookProb,
        yesEdge: round(bookProb - allIn, 4),
      });
    }
  }
  return matches
    .sort((a, b) => b.yesEdge - a.yesEdge || b.score - a.score)
    .slice(0, 40);
}

async function scanSportsbookCrossCheck(options = {}) {
  const kalshiLimit = clamp(Math.floor(parseNumber(options.kalshiLimit, DEFAULT_KALSHI_LIMIT)), 50, MAX_KALSHI_MARKETS);
  const rawMarkets = await fetchKalshiMarketPages(kalshiLimit);
  const sportsLike = rawMarkets.filter((market) => isSportsMarket(market));
  const associatedMarkets = await fetchAssociatedMarkets(sportsLike);
  const unique = new Map();
  for (const market of [...associatedMarkets, ...sportsLike]) {
    if (!market || !isSportsMarket(market) || !isTradableTopOfBook(market)) continue;
    const ticker = String(market.ticker || '').trim();
    if (!ticker || unique.has(ticker)) continue;
    unique.set(ticker, normalizeKalshiMarket(
      market,
      Array.isArray(market.mve_selected_legs) && market.mve_selected_legs.length ? 'kalshi-parlay' : 'kalshi-direct',
    ));
  }
  const kalshiMarkets = Array.from(unique.values())
    .sort((a, b) => {
      const rank = { clean: 0, manual: 1, parlay: 2, 'long-parlay': 3 };
      const rankDiff = (rank[a.matchability] || 9) - (rank[b.matchability] || 9);
      if (rankDiff !== 0) return rankDiff;
      return (b.yesAskSize + b.noAskSize) - (a.yesAskSize + a.noAskSize);
    })
    .slice(0, 220);

  const sportsbook = await fetchSportsbookBoard({
    sports: options.sports,
    bookmakers: options.bookmakers,
  });
  const matches = buildRoughMatches(kalshiMarkets, sportsbook.rows || []);

  return {
    ok: true,
    asOf: new Date().toISOString(),
    kalshi: {
      scannedMarkets: rawMarkets.length,
      sportsLike: sportsLike.length,
      associatedMarkets: associatedMarkets.length,
      markets: kalshiMarkets,
    },
    sportsbook,
    matches,
    notes: [
      'The scanner treats sportsbook odds as reference prices unless an exact same-settlement opposite side is entered in the calculator.',
      'Kalshi multivariate sports contracts are often parlays. Their legs can be audited, but the full parlay needs sportsbook parlay pricing to call it an arb.',
      'Featured sportsbook markets are h2h, spreads, and totals because those are the most common, most comparable lines.',
    ],
  };
}

module.exports = {
  americanToDecimal,
  impliedProbabilityFromAmerican,
  scanSportsbookCrossCheck,
};
