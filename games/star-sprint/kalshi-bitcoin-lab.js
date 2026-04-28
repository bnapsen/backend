'use strict';

const crypto = require('crypto');
const fs = require('fs');
let WebSocket = null;
try {
  WebSocket = require('ws');
} catch (error) {
  WebSocket = null;
}

const KALSHI_API_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_WS_URL = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
const KALSHI_WS_PATH = '/trade-api/ws/v2';
const COINBASE_API_BASE_URL = 'https://api.exchange.coinbase.com';
const KRAKEN_API_BASE_URL = 'https://api.kraken.com/0/public';
const BITSTAMP_API_BASE_URL = 'https://www.bitstamp.net/api/v2';
const GEMINI_API_BASE_URL = 'https://api.gemini.com/v1';
const CF_BENCHMARKS_API_BASE_URL = 'https://www.cfbenchmarks.com/api/v1';
const BTC_15M_SERIES = 'KXBTC15M';
const COINBASE_PRODUCT = 'BTC-USD';
const DEFAULT_MAX_COST = 5;
const DEFAULT_MIN_EDGE = 0.02;
const MARKET_CACHE_MS = 450;
const MARKET_DETAIL_CACHE_MS = 250;
const WS_QUOTE_FRESH_MS = 2_000;
const TICKER_CACHE_MS = 300;
const CANDLE_CACHE_MS = 8_000;
const bitcoinCache = {
  markets: null,
  marketsAt: 0,
  marketDetails: new Map(),
  ticker: null,
  tickerAt: 0,
  tickerPromise: null,
  candles: new Map(),
};
const kalshiTickerWs = {
  socket: null,
  ticker: '',
  quote: null,
  status: 'idle',
  error: '',
  reconnectAt: 0,
  connectedAt: 0,
  lastMessageAt: 0,
  subscriptionId: 1,
};
const kalshiPrivateKeyCache = {
  source: '',
  value: '',
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

function cfBenchmarksConfigured() {
  return Boolean(process.env.CF_BENCHMARKS_USERNAME && process.env.CF_BENCHMARKS_API_KEY);
}

function cfBenchmarksAuthHeader() {
  const username = String(process.env.CF_BENCHMARKS_USERNAME || '');
  const key = String(process.env.CF_BENCHMARKS_API_KEY || '');
  return `Basic ${Buffer.from(`${username}:${key}`).toString('base64')}`;
}

function kalshiPrivateKeyPem() {
  const inline = String(process.env.KALSHI_PRIVATE_KEY_PEM || '').trim();
  if (inline) {
    const source = `inline:${inline.length}`;
    if (kalshiPrivateKeyCache.source !== source) {
      kalshiPrivateKeyCache.source = source;
      kalshiPrivateKeyCache.value = inline.replace(/\\n/g, '\n');
    }
    return kalshiPrivateKeyCache.value;
  }
  const keyPath = String(process.env.KALSHI_PRIVATE_KEY_PATH || '').trim();
  if (!keyPath) return '';
  if (kalshiPrivateKeyCache.source === `path:${keyPath}`) return kalshiPrivateKeyCache.value;
  try {
    kalshiPrivateKeyCache.source = `path:${keyPath}`;
    kalshiPrivateKeyCache.value = fs.readFileSync(keyPath, 'utf8');
    return kalshiPrivateKeyCache.value;
  } catch (error) {
    kalshiPrivateKeyCache.source = '';
    kalshiPrivateKeyCache.value = '';
    kalshiTickerWs.error = `Unable to read KALSHI_PRIVATE_KEY_PATH: ${error.message}`;
    return '';
  }
}

function kalshiWebsocketConfigured() {
  return Boolean(WebSocket && process.env.KALSHI_API_KEY_ID && kalshiPrivateKeyPem());
}

function signKalshiText(text) {
  const key = kalshiPrivateKeyPem();
  if (!key) return '';
  const signature = crypto.sign('sha256', Buffer.from(text), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString('base64');
}

function kalshiWsHeaders() {
  const timestamp = String(Date.now());
  return {
    'Content-Type': 'application/json',
    'KALSHI-ACCESS-KEY': String(process.env.KALSHI_API_KEY_ID || ''),
    'KALSHI-ACCESS-SIGNATURE': signKalshiText(`${timestamp}GET${KALSHI_WS_PATH}`),
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
  };
}

function normalizeTimestamp(value) {
  if (value == null || value === '') return isoDate(Date.now());
  const number = Number(value);
  if (Number.isFinite(number)) {
    if (number > 1e12) return isoDate(number);
    if (number > 1e9) return isoDate(number * 1000);
  }
  return isoDate(value) || isoDate(Date.now());
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 5_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    ...fetchOptions,
    signal: fetchOptions.signal || controller.signal,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'BNAPSN-Kalshi-Bitcoin-Lab/1.0',
      ...(fetchOptions.headers || {}),
    },
  }).finally(() => {
    clearTimeout(timer);
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

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return 0;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function weightedAverage(parts) {
  const finite = parts.filter((part) => Number.isFinite(part.value) && part.value > 0 && Number.isFinite(part.weight) && part.weight > 0);
  const weight = finite.reduce((sum, part) => sum + part.weight, 0);
  if (!weight) return 0;
  return finite.reduce((sum, part) => sum + part.value * part.weight, 0) / weight;
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

function selectActiveBitcoinMarket(markets, now) {
  const usable = Array.isArray(markets) ? markets : [];
  const active = usable.find((market) => {
    const open = new Date(market.open_time || 0).getTime();
    const close = new Date(market.close_time || 0).getTime();
    return open <= now + 1_500 && close > now + 250;
  });
  if (active) return active;
  return usable.find((market) => {
    const close = new Date(market.close_time || 0).getTime();
    return close > now + 250;
  }) || null;
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
  const active = selectActiveBitcoinMarket(usable, now);
  bitcoinCache.markets = { markets: usable, active };
  bitcoinCache.marketsAt = nowMs;
  return bitcoinCache.markets;
}

function complementPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) ? round(clamp(1 - price, 0, 1), 4).toFixed(4) : '';
}

function normalizeKalshiQuoteMessage(message) {
  const yesBid = marketPrice(message, 'yes_bid_dollars', 'yes_bid');
  const yesAsk = marketPrice(message, 'yes_ask_dollars', 'yes_ask');
  const noBid = marketPrice(message, 'no_bid_dollars', 'no_bid') || Number(complementPrice(yesAsk));
  const noAsk = marketPrice(message, 'no_ask_dollars', 'no_ask') || Number(complementPrice(yesBid));
  return {
    yes_bid_dollars: Number.isFinite(yesBid) ? yesBid.toFixed(4) : '',
    yes_ask_dollars: Number.isFinite(yesAsk) ? yesAsk.toFixed(4) : '',
    no_bid_dollars: Number.isFinite(noBid) ? noBid.toFixed(4) : '',
    no_ask_dollars: Number.isFinite(noAsk) ? noAsk.toFixed(4) : '',
    last_price_dollars: message.price_dollars || message.last_price_dollars || '',
    yes_bid_size_fp: message.yes_bid_size_fp || '',
    yes_ask_size_fp: message.yes_ask_size_fp || '',
    no_bid_size_fp: message.no_bid_size_fp || message.yes_ask_size_fp || '',
    no_ask_size_fp: message.no_ask_size_fp || message.yes_bid_size_fp || '',
    quoteUpdatedTime: normalizeTimestamp(message.ts_ms || message.ts || message.time || Date.now()),
  };
}

function currentKalshiWsQuote(ticker) {
  if (!kalshiTickerWs.quote || kalshiTickerWs.ticker !== ticker) return null;
  const quoteAgeMs = Date.now() - new Date(kalshiTickerWs.quote.quoteReceivedAt || 0).getTime();
  if (!Number.isFinite(quoteAgeMs) || quoteAgeMs > WS_QUOTE_FRESH_MS) return null;
  return {
    ...kalshiTickerWs.quote.fields,
    quoteSource: 'Kalshi WebSocket ticker',
    quoteTransport: 'websocket',
    quoteLatencyMs: Math.max(0, Date.now() - new Date(kalshiTickerWs.quote.quoteUpdatedTime || Date.now()).getTime()),
    quoteReceivedAt: kalshiTickerWs.quote.quoteReceivedAt,
  };
}

function connectKalshiTickerWebsocket(ticker) {
  if (!ticker || !kalshiWebsocketConfigured()) return;
  if (kalshiTickerWs.ticker === ticker && kalshiTickerWs.socket && kalshiTickerWs.socket.readyState <= WebSocket.OPEN) return;
  if (Date.now() < kalshiTickerWs.reconnectAt) return;

  if (kalshiTickerWs.socket) {
    try {
      kalshiTickerWs.socket.close();
    } catch (error) {
      // Ignore close errors during ticker rotation.
    }
  }

  kalshiTickerWs.ticker = ticker;
  kalshiTickerWs.quote = null;
  kalshiTickerWs.status = 'connecting';
  kalshiTickerWs.error = '';

  let socket;
  try {
    socket = new WebSocket(KALSHI_WS_URL, { headers: kalshiWsHeaders() });
  } catch (error) {
    kalshiTickerWs.status = 'error';
    kalshiTickerWs.error = error.message;
    kalshiTickerWs.reconnectAt = Date.now() + 10_000;
    return;
  }
  kalshiTickerWs.socket = socket;

  socket.on('open', () => {
    kalshiTickerWs.status = 'connected';
    kalshiTickerWs.connectedAt = Date.now();
    socket.send(JSON.stringify({
      id: kalshiTickerWs.subscriptionId,
      cmd: 'subscribe',
      params: {
        channels: ['ticker'],
        market_ticker: ticker,
      },
    }));
    kalshiTickerWs.subscriptionId += 1;
  });

  socket.on('message', (raw) => {
    kalshiTickerWs.lastMessageAt = Date.now();
    let data = null;
    try {
      data = JSON.parse(String(raw));
    } catch (error) {
      return;
    }
    if (data.type === 'error') {
      kalshiTickerWs.status = 'error';
      kalshiTickerWs.error = data.msg && data.msg.msg ? data.msg.msg : 'Kalshi WebSocket error';
      return;
    }
    if (data.type !== 'ticker' || !data.msg || data.msg.market_ticker !== kalshiTickerWs.ticker) return;
    const fields = normalizeKalshiQuoteMessage(data.msg);
    kalshiTickerWs.quote = {
      fields,
      quoteUpdatedTime: fields.quoteUpdatedTime,
      quoteReceivedAt: isoDate(Date.now()),
    };
  });

  socket.on('error', (error) => {
    kalshiTickerWs.status = 'error';
    kalshiTickerWs.error = error.message;
  });

  socket.on('close', () => {
    if (kalshiTickerWs.socket === socket) {
      kalshiTickerWs.status = 'closed';
      kalshiTickerWs.socket = null;
      kalshiTickerWs.reconnectAt = Date.now() + 2_000;
    }
  });
}

async function getFreshKalshiMarket(market) {
  if (!market || !market.ticker) return market;
  connectKalshiTickerWebsocket(market.ticker);
  const wsQuote = currentKalshiWsQuote(market.ticker);
  const cached = bitcoinCache.marketDetails.get(market.ticker);
  const nowMs = Date.now();
  let freshMarket = cached && nowMs - cached.at < MARKET_DETAIL_CACHE_MS ? cached.market : null;
  if (!freshMarket) {
    try {
      const data = await fetchJson(`${KALSHI_API_BASE_URL}/markets/${encodeURIComponent(market.ticker)}`, { timeoutMs: 1_800 });
      freshMarket = data && data.market ? data.market : market;
      bitcoinCache.marketDetails.set(market.ticker, { at: Date.now(), market: freshMarket });
    } catch (error) {
      freshMarket = cached ? cached.market : market;
    }
  }
  const quoteFields = wsQuote || {
    quoteSource: 'Kalshi REST market detail',
    quoteTransport: 'rest',
    quoteUpdatedTime: isoDate(Date.now()),
    quoteReceivedAt: isoDate(Date.now()),
    quoteLatencyMs: 0,
  };
  return {
    ...market,
    ...freshMarket,
    ...quoteFields,
  };
}

async function getCoinbaseTicker() {
  const data = await fetchJson(`${COINBASE_API_BASE_URL}/products/${COINBASE_PRODUCT}/ticker`, { timeoutMs: 1_800 });
  return {
    venue: 'Coinbase',
    price: Number(data.price),
    bid: Number(data.bid),
    ask: Number(data.ask),
    time: isoDate(data.time || Date.now()),
  };
}

async function getKrakenTicker() {
  const data = await fetchJson(`${KRAKEN_API_BASE_URL}/Ticker?pair=XBTUSD`, { timeoutMs: 1_800 });
  const result = data && data.result ? data.result[Object.keys(data.result)[0]] : null;
  return {
    venue: 'Kraken',
    price: Number(result && result.c && result.c[0]),
    bid: Number(result && result.b && result.b[0]),
    ask: Number(result && result.a && result.a[0]),
    time: isoDate(Date.now()),
  };
}

async function getBitstampTicker() {
  const data = await fetchJson(`${BITSTAMP_API_BASE_URL}/ticker/btcusd/`, { timeoutMs: 1_800 });
  return {
    venue: 'Bitstamp',
    price: Number(data.last),
    bid: Number(data.bid),
    ask: Number(data.ask),
    time: isoDate(Number(data.timestamp) * 1000 || Date.now()),
  };
}

async function getGeminiTicker() {
  const data = await fetchJson(`${GEMINI_API_BASE_URL}/pubticker/btcusd`, { timeoutMs: 1_800 });
  return {
    venue: 'Gemini',
    price: Number(data.last),
    bid: Number(data.bid),
    ask: Number(data.ask),
    time: isoDate(Date.now()),
  };
}

function firstNumericField(record, fields) {
  if (!record || typeof record !== 'object') return null;
  for (const field of fields) {
    const value = Number(record[field]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function recordText(record) {
  if (!record || typeof record !== 'object') return '';
  return [
    record.id,
    record.symbol,
    record.ticker,
    record.index,
    record.index_id,
    record.indexId,
    record.name,
    record.index_name,
    record.indexName,
    record.description,
  ].filter(Boolean).join(' ').toUpperCase();
}

function brtiMatchScore(record) {
  const text = recordText(record);
  if (/\bBRTI\b/.test(text)) return 3;
  if (text.includes('BITCOIN REAL TIME INDEX') || text.includes('BITCOIN REAL-TIME INDEX')) return 2;
  if (text.includes('BTC') && text.includes('REAL TIME')) return 1;
  return 0;
}

function extractCfTimestamp(record) {
  if (!record || typeof record !== 'object') return isoDate(Date.now());
  const fields = [
    'time',
    'timestamp',
    'last_updated',
    'lastUpdated',
    'calculation_time',
    'calculationTime',
    'as_of',
    'asOf',
    'date',
  ];
  for (const field of fields) {
    if (record[field] != null) return normalizeTimestamp(record[field]);
  }
  return isoDate(Date.now());
}

function findCfBrtiValue(payload) {
  const priceFields = [
    'value',
    'price',
    'level',
    'last',
    'close',
    'index_value',
    'indexValue',
    'rate',
    'settlement',
  ];
  const queue = [{ value: payload, parent: null, key: '' }];
  const seen = new WeakSet();
  const candidates = [];

  while (queue.length) {
    const item = queue.shift();
    const value = item.value;
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (!Array.isArray(value)) {
      const directPrice = firstNumericField(value, priceFields);
      const score = brtiMatchScore(value);
      if (score && directPrice) {
        candidates.push({ score, price: directPrice, record: value });
      }

      Object.entries(value).forEach(([key, child]) => {
        const keyUpper = key.toUpperCase();
        if (/\bBRTI\b/.test(keyUpper)) {
          const direct = Number(child);
          if (Number.isFinite(direct) && direct > 0) {
            candidates.push({ score: 4, price: direct, record: value });
          } else {
            const nestedPrice = firstNumericField(child, priceFields);
            if (nestedPrice) candidates.push({ score: 4, price: nestedPrice, record: child });
          }
        }
        if (child && typeof child === 'object') queue.push({ value: child, parent: value, key });
      });
    } else {
      value.forEach((child, index) => queue.push({ value: child, parent: value, key: String(index) }));
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] || null;
}

async function getCfBenchmarksTicker() {
  if (!cfBenchmarksConfigured()) {
    throw new Error('CF Benchmarks credentials are not configured.');
  }
  const data = await fetchJson(`${CF_BENCHMARKS_API_BASE_URL}/latest_values`, {
    timeoutMs: 1_800,
    headers: {
      Authorization: cfBenchmarksAuthHeader(),
    },
  });
  const match = findCfBrtiValue(data);
  if (!match || !Number.isFinite(match.price) || match.price <= 0) {
    throw new Error('CF Benchmarks latest_values did not include a usable BRTI value.');
  }
  const time = extractCfTimestamp(match.record);
  return {
    venue: 'CF Benchmarks BRTI',
    price: match.price,
    bid: match.price,
    ask: match.price,
    time,
    source: 'CF Benchmarks BRTI',
    sourceCount: 1,
    sources: [{
      venue: 'CF Benchmarks BRTI',
      price: round(match.price, 2),
      bid: round(match.price, 2),
      ask: round(match.price, 2),
      time,
    }],
    dispersionDollars: 0,
    dispersionPct: 0,
    authoritative: true,
    kalshiAligned: true,
  };
}

function normalizeTickerQuote(quote) {
  const price = Number(quote && quote.price);
  const bid = Number(quote && quote.bid);
  const ask = Number(quote && quote.ask);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    venue: String(quote.venue || 'Unknown'),
    price,
    bid: Number.isFinite(bid) && bid > 0 ? bid : price,
    ask: Number.isFinite(ask) && ask > 0 ? ask : price,
    time: quote.time || isoDate(Date.now()),
  };
}

function compositeTicker(quotes) {
  const usable = quotes.map(normalizeTickerQuote).filter(Boolean);
  if (!usable.length) {
    throw new Error('No live BTC/USD quote sources returned usable data.');
  }
  const prices = usable.map((quote) => quote.price);
  const bids = usable.map((quote) => quote.bid);
  const asks = usable.map((quote) => quote.ask);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const price = median(prices);
  const bid = median(bids);
  const ask = median(asks);
  const times = usable.map((quote) => new Date(quote.time || 0).getTime()).filter(Number.isFinite);
  return {
    price,
    bid,
    ask,
    time: isoDate(times.length ? Math.max(...times) : Date.now()),
    source: usable.length > 1 ? 'Composite BTC-USD proxy' : `${usable[0].venue} BTC-USD proxy`,
    sourceCount: usable.length,
    sources: usable.map((quote) => ({
      venue: quote.venue,
      price: round(quote.price, 2),
      bid: round(quote.bid, 2),
      ask: round(quote.ask, 2),
      time: quote.time,
    })),
    dispersionDollars: maxPrice - minPrice,
    dispersionPct: price > 0 ? (maxPrice - minPrice) / price : 0,
  };
}

async function getBitcoinTicker() {
  const nowMs = Date.now();
  if (bitcoinCache.ticker && nowMs - bitcoinCache.tickerAt < TICKER_CACHE_MS) {
    return bitcoinCache.ticker;
  }
  if (bitcoinCache.tickerPromise) {
    return bitcoinCache.tickerPromise;
  }
  const proxyPromise = Promise.allSettled([
    getCoinbaseTicker(),
    getKrakenTicker(),
    getBitstampTicker(),
    getGeminiTicker(),
  ]).then((results) => {
    const quotes = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    return compositeTicker(quotes);
  });
  const cfPromise = cfBenchmarksConfigured() ? getCfBenchmarksTicker() : Promise.resolve(null);

  bitcoinCache.tickerPromise = Promise.allSettled([cfPromise, proxyPromise]).then((results) => {
    const cfResult = results[0];
    const proxyResult = results[1];
    const cfTicker = cfResult.status === 'fulfilled' ? cfResult.value : null;
    const proxyTicker = proxyResult.status === 'fulfilled' ? proxyResult.value : null;
    if (!cfTicker && !proxyTicker) {
      const error = cfResult.status === 'rejected' ? cfResult.reason : proxyResult.reason;
      throw error || new Error('No Bitcoin ticker source available.');
    }
    const ticker = cfTicker ? {
      ...cfTicker,
      compositeReference: proxyTicker || null,
      compositeReferenceError: proxyResult.status === 'rejected' ? proxyResult.reason.message : '',
    } : {
      ...proxyTicker,
      cfBenchmarksError: cfResult.status === 'rejected' ? cfResult.reason.message : '',
    };
    bitcoinCache.ticker = ticker;
    bitcoinCache.tickerAt = Date.now();
    return ticker;
  }).catch((error) => {
    if (bitcoinCache.ticker) {
      return {
        ...bitcoinCache.ticker,
        stale: true,
        source: `${bitcoinCache.ticker.source || 'BTC-USD proxy'} stale fallback`,
        error: error.message,
      };
    }
    throw error;
  }).finally(() => {
    bitcoinCache.tickerPromise = null;
  });
  return bitcoinCache.tickerPromise;
}

function tickerQualityPenalty(ticker) {
  if (ticker && (ticker.authoritative || ticker.kalshiAligned)) return 0;
  const count = Number(ticker && ticker.sourceCount || 0);
  const dispersionPct = Number(ticker && ticker.dispersionPct || 0);
  if (count >= 3 && dispersionPct <= 0.0008) return 0;
  if (count >= 2 && dispersionPct <= 0.0015) return 0.05;
  return 0.12;
}

function tickerSourceObject(ticker) {
  const count = Number(ticker && ticker.sourceCount || 0);
  const dispersion = Number(ticker && ticker.dispersionDollars || 0);
  const reference = ticker && ticker.compositeReference ? ticker.compositeReference : null;
  const referenceDispersion = Number(reference && reference.dispersionDollars || 0);
  const authoritative = Boolean(ticker && (ticker.authoritative || ticker.kalshiAligned));
  const mode = authoritative
    ? 'CF Benchmarks BRTI is configured and is being used as the live spot source for this tick.'
    : 'Kalshi public API gives the exact market target and rules, but not the live BRTI spot. Live spot is a composite exchange proxy until CF Benchmarks credentials are configured.';
  return {
    tickerSource: ticker && ticker.source ? ticker.source : 'Composite BTC-USD proxy',
    tickerSummary: authoritative
      ? 'Kalshi-aligned BRTI spot; exchange proxy kept as a cross-check.'
      : `${count || 1} spot sources; range $${dispersion.toFixed(2)}`,
    tickerComponents: Array.isArray(ticker && ticker.sources) ? ticker.sources : [],
    tickerDispersionDollars: round(dispersion, 2),
    tickerDispersionPct: round(Number(ticker && ticker.dispersionPct || 0), 6),
    tickerStale: Boolean(ticker && ticker.stale),
    tickerAuthoritative: authoritative,
    tickerKalshiAligned: authoritative,
    tickerMode: mode,
    tickerCfError: ticker && ticker.cfBenchmarksError ? ticker.cfBenchmarksError : '',
    compositeReferencePrice: reference ? round(reference.price, 2) : null,
    compositeReferenceSource: reference ? reference.source : '',
    compositeReferenceRange: reference ? round(referenceDispersion, 2) : null,
    compositeReferenceComponents: reference && Array.isArray(reference.sources) ? reference.sources : [],
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

function ewmaStdev(values, lambda = 0.94) {
  if (!values.length) return 0;
  let variance = values[0] ** 2;
  for (let index = 1; index < values.length; index += 1) {
    variance = lambda * variance + (1 - lambda) * (values[index] ** 2);
  }
  return Math.sqrt(Math.max(0, variance));
}

function rangeSigmaPerMinute(points, lookback) {
  const ranges = points.slice(-lookback)
    .map((point) => {
      const high = Number(point.high);
      const low = Number(point.low);
      return high > 0 && low > 0 && high >= low ? Math.log(high / low) / Math.sqrt(4 * Math.log(2)) : 0;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  return average(ranges);
}

function volatilityProfile(points) {
  const closes = points.map((point) => point.close).filter((value) => Number.isFinite(value) && value > 0);
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push(Math.log(closes[index] / closes[index - 1]));
  }
  const sigma5 = stdev(returns.slice(-5));
  const sigma15 = stdev(returns.slice(-15));
  const sigma60 = stdev(returns.slice(-60));
  const sigma180 = stdev(returns.slice(-180));
  const sigmaEwma = ewmaStdev(returns.slice(-120));
  const sigmaRange = rangeSigmaPerMinute(points, 45);
  const blended = weightedAverage([
    { value: sigma5, weight: 0.12 },
    { value: sigma15, weight: 0.23 },
    { value: sigma60, weight: 0.28 },
    { value: sigma180, weight: 0.10 },
    { value: sigmaEwma, weight: 0.17 },
    { value: sigmaRange, weight: 0.10 },
  ]);
  const sigmaPerMinute = Math.max(blended, 0.00065);
  return {
    closes,
    returns,
    sigmaPerMinute,
    sigma5,
    sigma15,
    sigma60,
    sigma180,
    sigmaEwma,
    sigmaRange,
  };
}

function marketYesPrior(market) {
  const yesBid = marketPrice(market, 'yes_bid_dollars', 'yes_bid');
  const yesAsk = marketPrice(market, 'yes_ask_dollars', 'yes_ask');
  const noBid = marketPrice(market, 'no_bid_dollars', 'no_bid');
  const noAsk = marketPrice(market, 'no_ask_dollars', 'no_ask');
  const bidCandidates = [yesBid, 1 - noAsk].filter((value) => Number.isFinite(value) && value > 0 && value < 1);
  const askCandidates = [yesAsk, 1 - noBid].filter((value) => Number.isFinite(value) && value > 0 && value < 1);
  const bid = bidCandidates.length ? Math.max(...bidCandidates) : 0;
  const ask = askCandidates.length ? Math.min(...askCandidates) : 1;
  const midpoint = bid > 0 && ask < 1 && ask >= bid
    ? (bid + ask) / 2
    : average([yesBid, yesAsk, 1 - noBid, 1 - noAsk].filter((value) => value > 0 && value < 1));
  return {
    probability: clamp(midpoint || 0.5, 0.001, 0.999),
    bid: clamp(bid, 0, 1),
    ask: clamp(ask, 0, 1),
    spread: ask >= bid ? ask - bid : Math.max(0, yesAsk - yesBid),
  };
}

function calibrationWeight({ dataGrade, secondsToClose, marketSpread, sigmaEffective, tickerPenalty = 0 }) {
  const proxyPenalty = dataGrade === 'settlement-grade' ? 0.06 : 0.24;
  const nearSettlementPenalty = secondsToClose <= 75 ? 0.15 : secondsToClose <= 180 ? 0.08 : 0.02;
  const spreadPenalty = clamp(Number(marketSpread || 0) * 1.5, 0, 0.14);
  const lowVolPenalty = Number(sigmaEffective || 0) < 0.0015 ? 0.06 : 0;
  return clamp(0.12 + proxyPenalty + nearSettlementPenalty + spreadPenalty + lowVolPenalty + tickerPenalty, 0.12, 0.7);
}

function estimateSettlementAverage({ currentPrice, targetPrice, points, secondsToClose, settlementWindowSeconds }) {
  const horizonSeconds = clamp(secondsToClose, 0, 15 * 60);
  const settlementLength = clamp(settlementWindowSeconds, 1, 60);
  const secondsToAverageStart = Math.max(0, horizonSeconds - settlementLength);
  const averagingRemainingSeconds = clamp(Math.min(horizonSeconds, settlementLength), 1, settlementLength);
  const settlementElapsedSeconds = Math.max(0, settlementLength - horizonSeconds);
  const latestTimeMs = points.length ? Number(points[points.length - 1].timeMs) : Date.now();
  const settlementStartMs = latestTimeMs - settlementElapsedSeconds * 1000;
  const elapsedPoints = points.filter((point) => Number(point.timeMs) >= settlementStartMs && Number(point.close) > 0);
  const elapsedSettlementAverage = elapsedPoints.length ? average(elapsedPoints.map((point) => Number(point.close))) : currentPrice;
  const adjustedTargetPrice = settlementElapsedSeconds > 0
    ? ((targetPrice * settlementLength) - (elapsedSettlementAverage * settlementElapsedSeconds)) / averagingRemainingSeconds
    : targetPrice;
  return {
    horizonSeconds,
    settlementLength,
    secondsToAverageStart,
    averagingRemainingSeconds,
    settlementElapsedSeconds,
    elapsedSettlementAverage,
    adjustedTargetPrice,
    effectiveVarianceSeconds: secondsToAverageStart + averagingRemainingSeconds / 3,
    meanObservationSeconds: secondsToAverageStart + averagingRemainingSeconds / 2,
  };
}

function estimateBitcoinProbability({ currentPrice, targetPrice, points, secondsToClose, market, dataGrade, proxyBid, proxyAsk, tickerPenalty = 0, settlementWindowSeconds = 60 }) {
  const profile = volatilityProfile(points);
  const closes = profile.closes;
  const sigmaPerMinute = profile.sigmaPerMinute;
  const sigmaPerSecond = sigmaPerMinute / Math.sqrt(60);
  const settlement = estimateSettlementAverage({
    currentPrice,
    targetPrice,
    points,
    secondsToClose,
    settlementWindowSeconds,
  });
  const horizonSeconds = clamp(secondsToClose, 1, 15 * 60);
  const microstructureNoise = Math.max(0.00003, Math.abs(Number(proxyAsk || 0) - Number(proxyBid || 0)) / Math.max(1, currentPrice) / 2);
  const sigmaHorizon = Math.sqrt(
    (sigmaPerSecond * Math.sqrt(Math.max(1, settlement.effectiveVarianceSeconds))) ** 2
    + microstructureNoise ** 2
  );
  const momentumLookback = Math.min(5, closes.length - 1);
  const momentumReturn = momentumLookback > 0
    ? Math.log(closes[closes.length - 1] / closes[closes.length - 1 - momentumLookback])
    : 0;
  const driftPerSecond = clamp((momentumReturn / Math.max(1, momentumLookback * 60)) * 0.20, -0.00001, 0.00001);
  const meanLogMove = driftPerSecond * settlement.meanObservationSeconds;
  let rawYesProbability = settlement.adjustedTargetPrice <= 0 ? 0.999 : 0.001;
  let z = 10;
  if (settlement.adjustedTargetPrice > 0) {
    const logDistance = Math.log(settlement.adjustedTargetPrice / currentPrice);
    z = (logDistance - meanLogMove) / Math.max(0.00001, sigmaHorizon);
    rawYesProbability = clamp(1 - normalCdf(z), 0.001, 0.999);
  }
  const prior = marketYesPrior(market);
  const priorWeight = calibrationWeight({
    dataGrade,
    secondsToClose: horizonSeconds,
    marketSpread: prior.spread,
    sigmaEffective: sigmaHorizon,
    tickerPenalty,
  });
  const yesProbability = clamp((rawYesProbability * (1 - priorWeight)) + (prior.probability * priorWeight), 0.001, 0.999);
  const annualizedVol = sigmaPerMinute * Math.sqrt(525600);
  const spotLabel = dataGrade === 'settlement-grade' ? 'Current Kalshi-aligned BRTI spot' : 'Current proxy price';
  return {
    yesProbability,
    noProbability: 1 - yesProbability,
    rawYesProbability,
    rawNoProbability: 1 - rawYesProbability,
    marketPriorYes: prior.probability,
    marketPriorNo: 1 - prior.probability,
    marketPriorSpread: prior.spread,
    calibrationWeight: priorWeight,
    tickerPenalty,
    sigmaPerMinute,
    sigma5: profile.sigma5,
    sigma15: profile.sigma15,
    sigma60: profile.sigma60,
    sigma180: profile.sigma180,
    sigmaEwma: profile.sigmaEwma,
    sigmaRange: profile.sigmaRange,
    sigmaHorizon,
    horizonSeconds,
    effectiveVarianceSeconds: settlement.effectiveVarianceSeconds,
    secondsToAverageStart: settlement.secondsToAverageStart,
    averagingRemainingSeconds: settlement.averagingRemainingSeconds,
    settlementElapsedSeconds: settlement.settlementElapsedSeconds,
    elapsedSettlementAverage: settlement.elapsedSettlementAverage,
    adjustedTargetPrice: settlement.adjustedTargetPrice,
    annualizedVol,
    momentumReturn,
    driftPerSecond,
    z,
    reasons: [
      `${spotLabel} ${currentPrice.toFixed(2)} versus Kalshi target ${targetPrice.toFixed(2)}.`,
      `Horizon ${Math.round(horizonSeconds)} seconds; final-average effective variance horizon ${Math.round(settlement.effectiveVarianceSeconds)} seconds.`,
      `Blended 1-minute realized sigma ${(sigmaPerMinute * 100).toFixed(3)}% from 5m/15m/60m/EWMA/range inputs.`,
      `Momentum input is ${(momentumReturn * 100).toFixed(3)}% over the last ${momentumLookback} minutes, shrunk to 20% weight.`,
      `Raw final-average path odds ${(rawYesProbability * 100).toFixed(1)}% YES; Kalshi midpoint prior ${(prior.probability * 100).toFixed(1)}%; calibration weight ${(priorWeight * 100).toFixed(0)}%.`,
      dataGrade === 'settlement-grade'
        ? 'Settlement is the final 60-second CF Benchmarks BRTI average; the live spot source is CF Benchmarks BRTI for this tick.'
        : 'Settlement is the final 60-second CF Benchmarks BRTI average; this model uses an exchange composite proxy because Kalshi public REST does not publish the live BRTI spot.',
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

function scoreSide({ market, side, probability, rawProbability, maxCost, minEdge, secondsToClose, dataGrade }) {
  const quote = sideQuote(market, side);
  if (!Number.isFinite(quote.ask) || quote.ask <= 0 || quote.ask >= 1) {
    return {
      ...quote,
      probability,
      rawProbability,
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
      rawProbability: round(rawProbability),
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
    rawProbability: round(rawProbability),
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
  const marketSet = await getBitcoin15mMarkets();
  const [{ market, markets }, ticker, candles] = await Promise.all([
    marketSet.active
      ? getFreshKalshiMarket(marketSet.active).then((freshMarket) => ({ market: freshMarket, markets: marketSet.markets }))
      : Promise.resolve({ market: null, markets: marketSet.markets }),
    getBitcoinTicker(),
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
  const source = sourceStatus();
  const dataGrade = ticker && (ticker.authoritative || ticker.kalshiAligned) ? 'settlement-grade' : 'proxy';
  const probability = estimateBitcoinProbability({
    currentPrice,
    targetPrice,
    points: chartPoints,
    secondsToClose,
    market,
    dataGrade,
    proxyBid: ticker.bid,
    proxyAsk: ticker.ask,
    tickerPenalty: tickerQualityPenalty(ticker),
  });
  const candidates = [
    scoreSide({
      market,
      side: 'yes',
      probability: probability.yesProbability,
      rawProbability: probability.rawYesProbability,
      maxCost,
      minEdge,
      secondsToClose,
      dataGrade,
    }),
    scoreSide({
      market,
      side: 'no',
      probability: probability.noProbability,
      rawProbability: probability.rawNoProbability,
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
    source: {
      ...source,
      ...tickerSourceObject(ticker),
    },
    market: {
      targetPrice: round(targetPrice, 2),
      currentPrice: round(currentPrice, 2),
      proxyBid: round(ticker.bid, 2),
      proxyAsk: round(ticker.ask, 2),
      proxySource: ticker.source,
      proxySourceCount: Number(ticker.sourceCount || 1),
      proxyDispersionDollars: round(Number(ticker.dispersionDollars || 0), 2),
      proxyDispersionPct: round(Number(ticker.dispersionPct || 0), 6),
      proxyComponents: Array.isArray(ticker.sources) ? ticker.sources : [],
      compositeReferencePrice: ticker.compositeReference ? round(ticker.compositeReference.price, 2) : null,
      compositeReferenceSource: ticker.compositeReference ? ticker.compositeReference.source : '',
      compositeReferenceDispersionDollars: ticker.compositeReference ? round(Number(ticker.compositeReference.dispersionDollars || 0), 2) : null,
      proxyTime: ticker.time,
      quoteSource: market.quoteSource || 'Kalshi REST market detail',
      quoteTransport: market.quoteTransport || 'rest',
      quoteUpdatedTime: market.quoteUpdatedTime || normalizeTimestamp(market.updated_time || Date.now()),
      quoteReceivedAt: market.quoteReceivedAt || isoDate(Date.now()),
      quoteLatencyMs: round(parseNumber(market.quoteLatencyMs, 0), 0),
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
      rawYesProbability: round(probability.rawYesProbability),
      rawNoProbability: round(probability.rawNoProbability),
      marketPriorYes: round(probability.marketPriorYes),
      marketPriorNo: round(probability.marketPriorNo),
      marketPriorSpread: round(probability.marketPriorSpread),
      calibrationWeight: round(probability.calibrationWeight),
      tickerPenalty: round(probability.tickerPenalty),
      sigmaPerMinute: round(probability.sigmaPerMinute, 6),
      sigma5: round(probability.sigma5, 6),
      sigma15: round(probability.sigma15, 6),
      sigma60: round(probability.sigma60, 6),
      sigma180: round(probability.sigma180, 6),
      sigmaEwma: round(probability.sigmaEwma, 6),
      sigmaRange: round(probability.sigmaRange, 6),
      sigmaHorizon: round(probability.sigmaHorizon, 6),
      horizonSeconds: round(probability.horizonSeconds, 1),
      effectiveVarianceSeconds: round(probability.effectiveVarianceSeconds, 1),
      secondsToAverageStart: round(probability.secondsToAverageStart, 1),
      averagingRemainingSeconds: round(probability.averagingRemainingSeconds, 1),
      settlementElapsedSeconds: round(probability.settlementElapsedSeconds, 1),
      elapsedSettlementAverage: round(probability.elapsedSettlementAverage, 2),
      adjustedTargetPrice: round(probability.adjustedTargetPrice, 2),
      annualizedVol: round(probability.annualizedVol, 4),
      momentumReturn: round(probability.momentumReturn, 6),
      driftPerSecond: round(probability.driftPerSecond, 8),
      z: round(probability.z, 4),
      dataGrade,
      caveat: dataGrade === 'settlement-grade'
        ? 'Using configured settlement-grade source.'
        : `Using ${ticker.source} as a proxy for CF Benchmarks BRTI. Treat edges as research-only until calibrated.`,
      reasons: probability.reasons,
    },
    candidates,
    best: candidates[0] || null,
    chart: {
      product: COINBASE_PRODUCT,
      source: ticker.authoritative ? `${ticker.source} live / Coinbase history` : ticker.source,
      authoritative: Boolean(ticker.authoritative || ticker.kalshiAligned),
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
  const cfConfigured = cfBenchmarksConfigured();
  const wsConfigured = kalshiWebsocketConfigured();
  return {
    kalshiPublicRest: true,
    kalshiWebsocketConfigured: wsConfigured,
    kalshiWebsocketStatus: wsConfigured ? kalshiTickerWs.status : 'not-configured',
    kalshiWebsocketConnected: Boolean(kalshiTickerWs.socket && kalshiTickerWs.socket.readyState === WebSocket.OPEN),
    kalshiWebsocketLastMessageAt: kalshiTickerWs.lastMessageAt ? isoDate(kalshiTickerWs.lastMessageAt) : '',
    kalshiWebsocketError: kalshiTickerWs.error || '',
    cfBenchmarksConfigured: cfConfigured,
    settlementSource: 'CF Benchmarks BRTI',
    chartSource: cfConfigured
      ? 'CF Benchmarks BRTI'
      : 'Composite BTC-USD proxy',
    keyHint: 'Kalshi public REST gives the exact 15-minute target and settlement rules, but not the live BRTI spot. Kalshi bid/ask uses authenticated WebSocket ticker updates when KALSHI_API_KEY_ID plus a private key are configured; otherwise it rapid-polls the current market detail endpoint. Set licensed CF_BENCHMARKS_USERNAME and CF_BENCHMARKS_API_KEY to use the same CF Benchmarks BRTI spot source Kalshi settles against.',
  };
}

module.exports = {
  BTC_15M_SERIES,
  scanBitcoin15m,
};
