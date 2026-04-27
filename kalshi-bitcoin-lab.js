(function () {
  "use strict";

  const PROD_API_BASE = "https://nova-arcade-backend-1000121513328.us-central1.run.app";
  const state = {
    scan: null,
    stream: null,
    fallbackTimer: null,
  };

  const form = document.querySelector("#scan-form");
  const statusEl = document.querySelector("#status");
  const summaryEl = document.querySelector("#summary");
  const rowsEl = document.querySelector("#candidate-rows");
  const chartStage = document.querySelector("#chart-stage");
  const chartSourceEl = document.querySelector("#chart-source");
  const keyStatusEl = document.querySelector("#key-status");
  const eventTitleEl = document.querySelector("#event-title");
  const eventWindowEl = document.querySelector("#event-window");
  const kalshiLinkEl = document.querySelector("#kalshi-link");
  const clockLabelEl = document.querySelector("#clock-label");
  const recommendationLabelEl = document.querySelector("#recommendation-label");
  const modelReasonsEl = document.querySelector("#model-reasons");
  const rulesEl = document.querySelector("#rules");
  const minEdgeInput = document.querySelector("#min-edge");
  const maxCostInput = document.querySelector("#max-cost");
  const accessTokenInput = document.querySelector("#access-token");
  const streamToggle = document.querySelector("#stream-toggle");

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    restart();
  });
  streamToggle.addEventListener("change", restart);
  accessTokenInput.value = localStorage.getItem("kalshiLabToken") || "";
  accessTokenInput.addEventListener("input", function () {
    localStorage.setItem("kalshiLabToken", accessTokenInput.value.trim());
  });

  restart();

  function restart() {
    stopStream();
    if (streamToggle.checked && window.EventSource) {
      startStream();
    } else {
      loadScan();
      state.fallbackTimer = setInterval(loadScan, 2000);
    }
  }

  function stopStream() {
    if (state.stream) {
      state.stream.close();
      state.stream = null;
    }
    if (state.fallbackTimer) {
      clearInterval(state.fallbackTimer);
      state.fallbackTimer = null;
    }
  }

  function startStream() {
    setStatus("Opening live stream...");
    const source = new EventSource(bitcoinEndpoint("/api/kalshi/bitcoin/stream"));
    state.stream = source;
    source.addEventListener("scan", function (event) {
      try {
        render(JSON.parse(event.data));
        setStatus("Live stream connected - refreshing about every 1.5s.");
      } catch (error) {
        setStatus("Live stream returned malformed data.", true);
      }
    });
    source.addEventListener("error", function () {
      setStatus("Live stream paused; falling back to polling.", true);
      stopStream();
      loadScan();
      state.fallbackTimer = setInterval(loadScan, 2000);
    });
  }

  async function loadScan() {
    try {
      setStatus("Refreshing Bitcoin market...");
      render(await fetchJson(bitcoinEndpoint("/api/kalshi/bitcoin/scan")));
      setStatus(streamToggle.checked ? "Polling live every 2s." : "Manual refresh complete.");
    } catch (error) {
      setStatus(error.message || "Unable to load Bitcoin scan.", true);
    }
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }

  function bitcoinEndpoint(path) {
    const params = new URLSearchParams({
      minEdge: String(Number(minEdgeInput.value || 0) / 100),
      maxCost: String(Number(maxCostInput.value || 5)),
      minutes: "180",
    });
    const token = accessTokenInput.value.trim();
    if (token) params.set("token", token);
    return defaultApiBase() + path + "?" + params.toString();
  }

  function defaultApiBase() {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "nova-arcade-backend-1000121513328.us-central1.run.app") {
      return window.location.origin;
    }
    return PROD_API_BASE;
  }

  function render(scan) {
    state.scan = scan;
    if (scan.error) {
      setStatus(scan.error, true);
    }
    renderSummary(scan);
    renderMarketStrip(scan);
    renderCandidates(scan);
    renderChart(scan);
    renderReasons(scan);
    renderRules(scan);
  }

  function renderSummary(scan) {
    const market = scan.market || {};
    const model = scan.model || {};
    const best = scan.best || {};
    summaryEl.innerHTML = [
      metric("Live BTC proxy", dollars(market.currentPrice), "Bid " + dollars(market.proxyBid) + " / ask " + dollars(market.proxyAsk), "price-metric"),
      metric("Kalshi target", dollars(market.targetPrice), "Distance " + signedDollars(market.distanceDollars)),
      metric("Model YES", pct(model.yesProbability), "NO " + pct(model.noProbability)),
      metric("Best call", callLabel(best.recommendation), best.side ? best.side.toUpperCase() + " edge " + pct(best.edge) : "No candidate"),
    ].join("");
  }

  function renderMarketStrip(scan) {
    const source = scan.source || {};
    const market = scan.market || {};
    chartSourceEl.textContent = source.chartSource || "Unknown";
    keyStatusEl.textContent = [
      source.cfBenchmarksConfigured ? "CF key configured" : "CF key not configured",
      source.kalshiWebsocketConfigured ? "Kalshi WS configured" : "Kalshi WS not configured",
    ].join(" / ");
    eventTitleEl.textContent = scan.ticker || "KXBTC15M";
    eventWindowEl.textContent = market.closeTime ? "Closes " + formatTime(market.closeTime) + " / " + Math.max(0, Math.round(Number(market.secondsToClose || 0))) + "s left" : "Waiting";
    clockLabelEl.textContent = scan.generatedAt ? "Updated " + formatTime(scan.generatedAt) : "--";
    if (scan.url) kalshiLinkEl.href = scan.url;
  }

  function renderCandidates(scan) {
    const rows = Array.isArray(scan.candidates) ? scan.candidates : [];
    recommendationLabelEl.textContent = rows[0] ? callLabel(rows[0].recommendation) : "No market";
    rowsEl.innerHTML = rows.map(function (row) {
      const edgeClass = Number(row.edge || 0) >= 0 ? "pos" : "neg";
      return [
        "<tr>",
        '<td><span class="side-pill ' + escapeHtml(row.side) + '">' + escapeHtml(String(row.side || "").toUpperCase()) + "</span></td>",
        "<td>" + formatCents(row.askCents) + '<br><span class="subtext">bid ' + formatCents(row.bidCents) + " / spread " + pct(row.spread) + "</span></td>",
        "<td>" + pct(row.probability) + "</td>",
        "<td>" + pct(row.breakEven) + '<br><span class="subtext">incl fee</span></td>',
        '<td class="' + edgeClass + '">' + pct(row.edge) + "</td>",
        '<td class="' + (Number(row.expectedProfit || 0) >= 0 ? "pos" : "neg") + '">' + signedDollars(row.expectedProfit) + "</td>",
        "<td>" + row.contracts + '<br><span class="subtext">' + dollars(row.cost) + " cost / " + dollars(row.fee) + " fee</span></td>",
        '<td><span class="call-pill ' + callClass(row.recommendation) + '">' + escapeHtml(callLabel(row.recommendation)) + "</span></td>",
        "</tr>",
      ].join("");
    }).join("");
  }

  function renderChart(scan) {
    const chart = scan.chart || {};
    const allPoints = Array.isArray(chart.points) ? chart.points : [];
    const openTime = new Date(chart.openTime || 0).getTime();
    const closeTime = new Date(chart.closeTime || 0).getTime();
    const latestRaw = allPoints[allPoints.length - 1] || null;
    const windowStart = Number.isFinite(openTime) && openTime > 0 ? openTime - 120_000 : Date.now() - 20 * 60_000;
    const windowEnd = Number.isFinite(closeTime) && closeTime > 0 ? closeTime + 20_000 : Date.now() + 30_000;
    let points = allPoints.filter(function (point) {
      return Number(point.timeMs) >= windowStart && Number(point.timeMs) <= windowEnd;
    });
    if (points.length < 3) points = allPoints.slice(-30);
    if (!points.length) {
      chartStage.innerHTML = '<p class="subtext">No BTC chart data yet.</p>';
      return;
    }
    const width = 1120;
    const height = 470;
    const pad = { left: 84, right: 164, top: 34, bottom: 48 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const values = points.flatMap(function (point) { return [point.low, point.high, point.close]; })
      .concat([chart.targetPrice, chart.currentPrice])
      .map(Number)
      .filter(Number.isFinite);
    const minValue = Math.min.apply(null, values);
    const maxValue = Math.max.apply(null, values);
    const span = Math.max(8, maxValue - minValue);
    const yStep = span <= 18 ? 2 : span <= 45 ? 5 : span <= 90 ? 10 : 25;
    const yMin = Math.floor((minValue - Math.max(4, span * 0.18)) / yStep) * yStep;
    const yMax = Math.ceil((maxValue + Math.max(4, span * 0.18)) / yStep) * yStep;
    const minTime = Math.min(windowStart, points[0].timeMs);
    const maxTime = Math.max(windowEnd, points[points.length - 1].timeMs);
    const xForTime = function (timeMs) {
      return pad.left + ((Number(timeMs) - minTime) / Math.max(1, maxTime - minTime)) * innerWidth;
    };
    const yForPrice = function (price) {
      return pad.top + (1 - ((Number(price) - yMin) / Math.max(1, yMax - yMin))) * innerHeight;
    };
    const path = points.map(function (point, index) {
      return (index ? "L" : "M") + xForTime(point.timeMs).toFixed(2) + " " + yForPrice(point.close).toFixed(2);
    }).join(" ");
    const ticks = [];
    for (let value = Math.ceil(yMin / yStep) * yStep; value <= yMax + 0.1; value += yStep) ticks.push(value);
    const xTicks = [];
    for (let time = Math.ceil(minTime / 60_000) * 60_000; time <= maxTime + 1; time += 3 * 60_000) {
      xTicks.push({ time: new Date(time).toISOString(), timeMs: time });
    }
    const targetY = yForPrice(chart.targetPrice);
    const latest = latestRaw || points[points.length - 1];
    const settleStart = new Date(chart.settlementAveragingStart || 0).getTime();
    const settleX = xForTime(settleStart);
    const closeX = xForTime(closeTime);
    const latestX = xForTime(latest.timeMs);
    const latestY = yForPrice(latest.close);
    const currentLabelY = clampNumber(latestY, pad.top + 24, height - pad.bottom - 10);
    const targetLabelY = clampNumber(targetY, pad.top + 44, height - pad.bottom - 28);
    const aboveTarget = Number(chart.currentPrice) >= Number(chart.targetPrice);
    chartStage.innerHTML = [
      '<div class="live-price-card">',
      "<span>Live BTC proxy</span>",
      "<strong>" + escapeHtml(dollars(chart.currentPrice)) + "</strong>",
      '<small class="' + (aboveTarget ? "pos" : "neg") + '">' + escapeHtml((aboveTarget ? "above " : "below ") + signedDollars(Number(chart.currentPrice) - Number(chart.targetPrice)) + " vs target") + "</small>",
      "</div>",
      '<svg class="chart-svg" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Bitcoin price chart">',
      '<rect class="chart-bg" x="0" y="0" width="' + width + '" height="' + height + '"></rect>',
      Number.isFinite(settleX) && Number.isFinite(closeX) ? '<rect class="settle-band" x="' + settleX + '" y="' + pad.top + '" width="' + Math.max(2, closeX - settleX) + '" height="' + innerHeight + '"></rect>' : "",
      Number.isFinite(openTime) ? '<rect class="open-band" x="' + xForTime(openTime) + '" y="' + pad.top + '" width="' + Math.max(2, xForTime(closeTime) - xForTime(openTime)) + '" height="' + innerHeight + '"></rect>' : "",
      ticks.map(function (value) {
        const y = yForPrice(value);
        return '<line class="grid major" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + y + '" y2="' + y + '"></line><text class="axis-label axis-left" x="' + (pad.left - 10) + '" y="' + (y + 4) + '" text-anchor="end">$' + formatNumber(value, 0) + '</text><text class="axis-label axis-right" x="' + (width - pad.right + 10) + '" y="' + (y + 4) + '">$' + formatNumber(value, 0) + "</text>";
      }).join(""),
      xTicks.map(function (point) {
        const x = xForTime(point.timeMs);
        return '<line class="grid" x1="' + x + '" x2="' + x + '" y1="' + pad.top + '" y2="' + (height - pad.bottom) + '"></line><text class="axis-label" x="' + x + '" y="' + (height - 12) + '">' + formatTime(point.time) + "</text>";
      }).join(""),
      '<line class="target-line" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + targetY + '" y2="' + targetY + '"></line>',
      '<rect class="price-label-bg target-bg" x="' + (width - pad.right + 8) + '" y="' + (targetLabelY - 17) + '" width="138" height="25" rx="7"></rect>',
      '<text class="line-label target-label" x="' + (width - pad.right + 18) + '" y="' + targetLabelY + '">Target ' + dollars(chart.targetPrice) + "</text>",
      '<path class="price-line" d="' + path + '"></path>',
      '<line class="current-line" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + latestY + '" y2="' + latestY + '"></line>',
      '<circle class="current-dot" cx="' + latestX + '" cy="' + latestY + '" r="7"></circle>',
      '<rect class="price-label-bg current-bg" x="' + (width - pad.right + 8) + '" y="' + (currentLabelY - 17) + '" width="142" height="25" rx="7"></rect>',
      '<text class="line-label current-label" x="' + (width - pad.right + 18) + '" y="' + currentLabelY + '">' + dollars(latest.close) + "</text>",
      '<text class="last-price-tag" x="' + Math.min(width - pad.right - 172, latestX + 10) + '" y="' + (latestY - 12) + '">' + dollars(latest.close) + "</text>",
      '<text class="line-label" x="' + (pad.left + 8) + '" y="' + (pad.top + 16) + '">' + escapeHtml(chart.source || "BTC proxy") + "</text>",
      Number.isFinite(settleX) ? '<text class="line-label settle-label" x="' + Math.max(pad.left + 8, settleX + 6) + '" y="' + (pad.top + 38) + '">final 60s average</text>' : "",
      "</svg>",
    ].join("");
  }

  function renderReasons(scan) {
    const model = scan.model || {};
    const reasons = Array.isArray(model.reasons) ? model.reasons : [];
    modelReasonsEl.innerHTML = [
      model.caveat ? "<p><strong>Data caveat:</strong> " + escapeHtml(model.caveat) + "</p>" : "",
      reasons.map(function (reason) { return "<p>" + escapeHtml(reason) + "</p>"; }).join(""),
    ].join("");
  }

  function renderRules(scan) {
    const rules = scan.rules || {};
    const source = scan.source || {};
    rulesEl.innerHTML = [
      "<p><strong>" + escapeHtml(rules.settlementSource || "CF Benchmarks BRTI") + "</strong></p>",
      "<p>" + escapeHtml(rules.settlementSummary || "") + "</p>",
      rules.primary ? "<p>" + escapeHtml(rules.primary) + "</p>" : "",
      rules.secondary ? "<p>" + escapeHtml(rules.secondary) + "</p>" : "",
      source.keyHint ? "<p>" + escapeHtml(source.keyHint) + "</p>" : "",
    ].join("");
  }

  function metric(label, value, subtext, className) {
    return '<div class="metric ' + escapeHtml(className || "") + '"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong><small>" + escapeHtml(subtext || "") + "</small></div>";
  }

  function callLabel(value) {
    const labels = {
      "research-buy": "Research buy",
      "tiny-only": "Tiny only",
      "watch-proxy": "Watch proxy",
      "too-late": "Too late",
      "too-small": "Too small",
      avoid: "Avoid",
      pass: "Pass",
      "no-liquidity": "No liquidity",
    };
    return labels[value] || "Pass";
  }

  function callClass(value) {
    if (value === "research-buy" || value === "tiny-only") return "good";
    if (value === "avoid" || value === "too-late") return "bad";
    return "watch";
  }

  function pct(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return (number * 100).toFixed(1) + "%";
  }

  function formatCents(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(number < 10 ? 2 : 1) + "c" : "n/a";
  }

  function dollars(value) {
    const number = Number(value);
    return Number.isFinite(number) ? "$" + number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "n/a";
  }

  function signedDollars(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : number < 0 ? "-" : "";
    return sign + dollars(Math.abs(number));
  }

  function formatNumber(value, places) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places }) : "n/a";
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "n/a";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function setStatus(message, error) {
    statusEl.textContent = message;
    statusEl.className = error ? "neg" : "";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}());
