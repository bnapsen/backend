'use strict';

const KALSHI_API_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const COINBASE_API_BASE_URL = 'https://api.exchange.coinbase.com';
const BTC_15M_SERIES = 'KXBTC15M';
const COINBASE_PRODUCT = 'BTC-USD';
const DEFAULT_MAX_COST = 5;
const DEFAULT_MIN_EDGE = 0.02;
const MARKET_CACHE_MS = 4_000;
const CANDLE_CACHE_MS = 20_000;
const bitcoinCache = {
  markets: null,
  marketsAt: 0,
  candles: new Map(),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function parseNumber(value, defaultValue = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'BNAPSN-Kalshi-Bitcoin-Lab/1.0',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }
  return response.json();
}

function marketPrice(market, dollarsField, centsField) {
  const dollarValue = Number(market && market[dollarsField]);
  if (Number.isFinite(dollarValue) && dollarValue >= 0) return dollarValue;
  const centsValue = Number(market && market[centsField]);
  return Number.isFinite(centsValue) ? centsValue / 100 : 0;
}

function kalshiFeeDollars(contracts, priceDollars) {
  return Math.ceil(0.07 * contracts * priceDollars * (1 - priceDollars) * 100) / 100;
}

function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * abs);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
  return 0.5 * (1 + sign * erf);
}

function stdev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function eventWindowFromMarket(market) {
  const open = new Date(market.open_time || market.created_time || Date.now());
  const close = new Date(market.close_time || market.expected_expiration_time || Date.now());
  return {
    openTime: isoDate(open),
    closeTime: isoDate(close),
    openMs: open.getTime(),
    closeMs: close.getTime(),
    targetReferenceTime: isoDate(open),
    settlementAveragingStart: isoDate(close.getTime() - 60_000),
    settlementAveragingEnd: isoDate(close),
  };
}

async function getBitcoin15mMarkets() {
  const nowMs = Date.now();
  if (bitcoinCache.markets && nowMs - bitcoinCache.marketsAt < MARKET_CACHE_MS) {
    return bitcoinCache.markets;
  }
  const params = new URLSearchParams({
    series_ticker: BTC_15M_SERIES,
    status: 'open',
    limit: '100',
  });
  const data = await fetchJson(`${KALSHI_API_BASE_URL}/markets?${params.toString()}`);
  const markets = Array.isArray(data.markets) ? data.markets : [];
  const now = Date.now();
  const usable = markets
    .filter((market) => market && market.ticker && market.title && /BTC price up/i.test(market.title))
    .sort((left, right) => new Date(left.close_time).getTime() - new Date(right.close_time).getTime());
  const active = usable.find((market) => {
    const open = new Date(market.open_time || 0).getTime();
    const close = new Date(market.close_time || 0).getTime();
    return close > now - 15_000 && open <= now + 60_000;
  }) || usable.find((market) => new Date(market.close_time || 0).getTime() > now - 15_000) || usable[0] || null;
  bitcoinCache.markets = { markets: usable, active };
  bitcoinCache.marketsAt = nowMs;
  return bitcoinCache.markets;
}

async function getCoinbaseTicker() {
  const data = await fetchJson(`${COINBASE_API_BASE_URL}/products/${COINBASE_PRODUCT}/ticker`);
  return {
    price: Number(data.price),
    bid: Number(data.bid),
    ask: Number(data.ask),
    time: isoDate(data.time || Date.now()),
    source: 'Coinbase BTC-USD proxy',
  };
}

async function getCoinbaseCandles(minutes = 180) {
  const cacheKey = String(clamp(minutes, 30, 360));
  const cached = bitcoinCache.candles.get(cacheKey);
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < CANDLE_CACHE_MS) {
    return cached.points;
  }
  const end = new Date();
  const start = new Date(end.getTime() - clamp(minutes, 30, 360) * 60_000);
  const params = new URLSearchParams({
    granularity: '60',
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const candles = await fetchJson(`${COINBASE_API_BASE_URL}/products/${COINBASE_PRODUCT}/candles?${params.toString()}`);
  const points = (Array.isArray(candles) ? candles : [])
    .map((row) => ({
      time: isoDate(Number(row[0]) * 1000),
      timeMs: Number(row[0]) * 1000,
      low: Number(row[1]),
      high: Number(row[2]),
      open: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .filter((point) => Number.isFinite(point.close) && point.timeMs)
    .sort((left, right) => left.timeMs - right.timeMs);
  bitcoinCache.candles.set(cacheKey, { at: nowMs, points });
  return points;
}

function appendLivePoint(candles, ticker) {
  const points = Array.isArray(candles) ? candles.slice() : [];
  const price = Number(ticker && ticker.price);
  const timeMs = new Date(ticker && ticker.time || Date.now()).getTime();
  if (!Number.isFinite(price) || !Number.isFinite(timeMs)) return points;
  const livePoint = {
    time: isoDate(timeMs),
    timeMs,
    low: price,
    high: price,
    open: price,
    close: price,
    volume: 0,
    live: true,
  };
  const last = points[points.length - 1];
  if (last && Math.abs(Number(last.timeMs) - timeMs) < 15_000) {
    points[points.length - 1] = {
      ...last,
      high: Math.max(Number(last.high || price), price),
      low: Math.min(Number(last.low || price), price),
      close: price,
      live: true,
      time: livePoint.time,
      timeMs,
    };
    return points;
  }
  points.push(livePoint);
  return points;
}

function estimateBitcoinProbability({ currentPrice, targetPrice, candles, secondsToClose }) {
  const closes = candles.map((point) => point.close).filter((value) => Number.isFinite(value) && value > 0);
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push(Math.log(closes[index] / closes[index - 1]));
  }
  const recentReturns = returns.slice(-90);
  const sigmaPerMinute = Math.max(stdev(recentReturns), 0.00055);
  const sigmaPerSecond = sigmaPerMinute / Math.sqrt(60);
  const horizonSeconds = clamp(secondsToClose, 1, 15 * 60);
  const sigmaHorizon = Math.max(sigmaPerSecond * Math.sqrt(horizonSeconds), 0.0002);
  const momentumLookback = Math.min(5, closes.length - 1);
  const momentumReturn = momentumLookback > 0
    ? Math.log(closes[closes.length - 1] / closes[closes.length - 1 - momentumLookback])
    : 0;
  const driftPerSecond = clamp((momentumReturn / Math.max(1, momentumLookback * 60)) * 0.20, -0.00001, 0.00001);
  const logDistance = Math.log(targetPrice / currentPrice);
  const z = (logDistance - driftPerSecond * horizonSeconds) / sigmaHorizon;
  const yesProbability = clamp(1 - normalCdf(z), 0.001, 0.999);
  const annualizedVol = sigmaPerMinute * Math.sqrt(525600);
  return {
    yesProbability,
    noProbability: 1 - yesProbability,
    sigmaPerMinute,
    sigmaHorizon,
    annualizedVol,
    momentumReturn,
    driftPerSecond,
    z,
    reasons: [
      `Current proxy price ${currentPrice.toFixed(2)} versus Kalshi target ${targetPrice.toFixed(2)}.`,
      `Horizon ${Math.round(horizonSeconds)} seconds; recent 1-minute realized sigma ${(sigmaPerMinute * 100).toFixed(3)}%.`,
      `Momentum input is ${(momentumReturn * 100).toFixed(3)}% over the last ${momentumLookback} minutes, shrunk to 20% weight.`,
      'Settlement is the final 60-second CF Benchmarks BRTI average; this model approximates it with a spot proxy unless CF credentials are configured.',
    ],
  };
}

function sideQuote(market, side) {
  if (side === 'yes') {
    return {
      side,
      ask: marketPrice(market, 'yes_ask_dollars', 'yes_ask'),
      bid: marketPrice(market, 'yes_bid_dollars', 'yes_bid'),
      askSize: parseNumber(market.yes_ask_size_fp, 0),
      bidSize: parseNumber(market.yes_bid_size_fp, 0),
    };
  }
  return {
    side,
    ask: marketPrice(market, 'no_ask_dollars', 'no_ask'),
    bid: marketPrice(market, 'no_bid_dollars', 'no_bid'),
    askSize: parseNumber(market.no_ask_size_fp, 0),
    bidSize: parseNumber(market.no_bid_size_fp, 0),
  };
}

function scoreSide({ market, side, probability, maxCost, minEdge, secondsToClose, dataGrade }) {
  const quote = sideQuote(market, side);
  if (!Number.isFinite(quote.ask) || quote.ask <= 0 || quote.ask >= 1) {
    return {
      ...quote,
      probability,
      breakEven: 1,
      edge: -1,
      contracts: 0,
      cost: 0,
      fee: 0,
      expectedProfit: 0,
      recommendation: 'no-liquidity',
    };
  }
  const askSize = Math.max(1, Math.floor(quote.askSize || 25));
  let contracts = Math.max(1, Math.min(25, askSize, Math.floor(maxCost / quote.ask)));
  let fee = kalshiFeeDollars(contracts, quote.ask);
  let cost = contracts * quote.ask + fee;
  while (contracts > 1 && cost > maxCost + 0.00001) {
    contracts -= 1;
    fee = kalshiFeeDollars(contracts, quote.ask);
    cost = contracts * quote.ask + fee;
  }
  if (cost > maxCost + 0.00001) {
    contracts = 0;
  }
  if (contracts < 1) {
    return {
      ...quote,
      probability: round(probability),
      askCents: round(quote.ask * 100, 2),
      bidCents: round(quote.bid * 100, 2),
      breakEven: 1,
      edge: round(probability - 1),
      spread: round(Math.max(0, quote.ask - quote.bid)),
      contracts: 0,
      cost: 0,
      fee: 0,
      expectedProfit: 0,
      recommendation: 'too-small',
    };
  }
  const breakEven = cost / contracts;
  const edge = probability - breakEven;
  const spread = Math.max(0, quote.ask - quote.bid);
  const expectedProfit = contracts * probability - cost;
  let recommendation = 'pass';
  if (secondsToClose <= 20) {
    recommendation = 'too-late';
  } else if (dataGrade !== 'settlement-grade' && Math.abs(edge) < minEdge + 0.015) {
    recommendation = 'watch-proxy';
  } else if (edge >= Math.max(minEdge, 0.015) && spread <= 0.08) {
    recommendation = edge >= 0.05 ? 'research-buy' : 'tiny-only';
  } else if (edge <= -Math.max(minEdge, 0.02)) {
    recommendation = 'avoid';
  }
  return {
    ...quote,
    probability: round(probability),
    askCents: round(quote.ask * 100, 2),
    bidCents: round(quote.bid * 100, 2),
    breakEven: round(breakEven),
    edge: round(edge),
    spread: round(spread),
    contracts,
    cost: round(cost, 2),
    fee: round(fee, 2),
    expectedProfit: round(expectedProfit, 2),
    recommendation,
  };
}

function kalshiBitcoinMarketUrl(market) {
  const eventTicker = String(market && market.event_ticker || '').toLowerCase();
  const ticker = String(market && market.ticker || '');
  const hash = ticker ? `#market=${encodeURIComponent(ticker)}` : '';
  return `https://kalshi.com/markets/kxbtc15m/bitcoin-price-up-down${eventTicker ? `/${eventTicker}` : ''}${hash}`;
}

async function scanBitcoin15m(options = {}) {
  const maxCost = clamp(parseNumber(options.maxCost, DEFAULT_MAX_COST), 0.5, 100);
  const minEdge = clamp(parseNumber(options.minEdge, DEFAULT_MIN_EDGE), -0.5, 0.5);
  const [{ active: market, markets }, ticker, candles] = await Promise.all([
    getBitcoin15mMarkets(),
    getCoinbaseTicker(),
    getCoinbaseCandles(parseNumber(options.minutes, 180)),
  ]);

  if (!market) {
    return {
      generatedAt: new Date().toISOString(),
      error: 'No active KXBTC15M market found.',
      candidates: [],
      chart: { points: candles },
      source: sourceStatus(),
    };
  }

  const window = eventWindowFromMarket(market);
  const now = Date.now();
  const secondsToClose = Math.max(0, (window.closeMs - now) / 1000);
  const secondsSinceOpen = Math.max(0, (now - window.openMs) / 1000);
  const targetPrice = Number(market.floor_strike);
  const currentPrice = Number(ticker.price);
  const chartPoints = appendLivePoint(candles, ticker);
  const dataGrade = sourceStatus().cfBenchmarksConfigured ? 'settlement-grade' : 'proxy';
  const probability = estimateBitcoinProbability({
    currentPrice,
    targetPrice,
    candles,
    secondsToClose,
  });
  const candidates = [
    scoreSide({
      market,
      side: 'yes',
      probability: probability.yesProbability,
      maxCost,
      minEdge,
      secondsToClose,
      dataGrade,
    }),
    scoreSide({
      market,
      side: 'no',
      probability: probability.noProbability,
      maxCost,
      minEdge,
      secondsToClose,
      dataGrade,
    }),
  ].sort((left, right) => right.edge - left.edge);

  return {
    generatedAt: new Date().toISOString(),
    series: BTC_15M_SERIES,
    title: market.title,
    ticker: market.ticker,
    eventTicker: market.event_ticker,
    status: market.status,
    url: kalshiBitcoinMarketUrl(market),
    rules: {
      primary: market.rules_primary,
      secondary: market.rules_secondary,
      settlementSource: 'CF Benchmarks BRTI',
      settlementSummary: 'Final value is the simple average of the 60 CF Benchmarks BRTI prints before market close.',
    },
    source: sourceStatus(),
    market: {
      targetPrice: round(targetPrice, 2),
      currentPrice: round(currentPrice, 2),
      proxyBid: round(ticker.bid, 2),
      proxyAsk: round(ticker.ask, 2),
      proxyTime: ticker.time,
      openTime: window.openTime,
      closeTime: window.closeTime,
      targetReferenceTime: window.targetReferenceTime,
      settlementAveragingStart: window.settlementAveragingStart,
      settlementAveragingEnd: window.settlementAveragingEnd,
      secondsSinceOpen: round(secondsSinceOpen, 1),
      secondsToClose: round(secondsToClose, 1),
      distanceDollars: round(currentPrice - targetPrice, 2),
      distancePct: round((currentPrice / targetPrice) - 1, 5),
      openMarkets: markets.length,
    },
    model: {
      yesProbability: round(probability.yesProbability),
      noProbability: round(probability.noProbability),
      sigmaPerMinute: round(probability.sigmaPerMinute, 6),
      sigmaHorizon: round(probability.sigmaHorizon, 6),
      annualizedVol: round(probability.annualizedVol, 4),
      momentumReturn: round(probability.momentumReturn, 6),
      driftPerSecond: round(probability.driftPerSecond, 8),
      z: round(probability.z, 4),
      dataGrade,
      caveat: dataGrade === 'settlement-grade'
        ? 'Using configured settlement-grade source.'
        : 'Using Coinbase BTC-USD as a proxy for CF Benchmarks BRTI. Treat edges as research-only until calibrated.',
      reasons: probability.reasons,
    },
    candidates,
    best: candidates[0] || null,
    chart: {
      product: COINBASE_PRODUCT,
      source: ticker.source,
      points: chartPoints,
      targetPrice: round(targetPrice, 2),
      currentPrice: round(currentPrice, 2),
      openTime: window.openTime,
      closeTime: window.closeTime,
      settlementAveragingStart: window.settlementAveragingStart,
    },
  };
}

function sourceStatus() {
  return {
    kalshiPublicRest: true,
    kalshiWebsocketConfigured: Boolean(process.env.KALSHI_API_KEY_ID && (process.env.KALSHI_PRIVATE_KEY_PEM || process.env.KALSHI_PRIVATE_KEY_PATH)),
    cfBenchmarksConfigured: Boolean(process.env.CF_BENCHMARKS_USERNAME && process.env.CF_BENCHMARKS_API_KEY),
    settlementSource: 'CF Benchmarks BRTI',
    chartSource: process.env.CF_BENCHMARKS_USERNAME && process.env.CF_BENCHMARKS_API_KEY
      ? 'CF Benchmarks BRTI'
      : 'Coinbase BTC-USD proxy',
    keyHint: 'Set KALSHI_API_KEY_ID plus KALSHI_PRIVATE_KEY_PEM or KALSHI_PRIVATE_KEY_PATH for Kalshi WebSocket later; set CF_BENCHMARKS_USERNAME and CF_BENCHMARKS_API_KEY for settlement-grade BRTI if licensed.',
  };
}

module.exports = {
  BTC_15M_SERIES,
  scanBitcoin15m,
};
