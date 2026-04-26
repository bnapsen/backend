(function () {
  const PROD_KALSHI_WEATHER_API_BASE = "https://nova-arcade-backend-1000121513328.us-central1.run.app";
  const state = {
    scan: null,
    candidates: [],
    ledger: JSON.parse(localStorage.getItem("kalshiWeatherLedger") || "[]"),
  };

  const form = document.querySelector("#scan-form");
  const dateInput = document.querySelector("#date");
  const minEdgeInput = document.querySelector("#min-edge");
  const maxCostInput = document.querySelector("#max-cost");
  const includeNegativeInput = document.querySelector("#include-negative");
  const tokenInput = document.querySelector("#access-token");
  const statusEl = document.querySelector("#status");
  const summaryEl = document.querySelector("#summary");
  const countEl = document.querySelector("#count");
  const candidatesEl = document.querySelector("#candidates");
  const contextsEl = document.querySelector("#contexts");
  const ledgerEl = document.querySelector("#ledger");
  const detailDialog = document.querySelector("#detail-dialog");
  const detailTitle = document.querySelector("#detail-title");
  const detailBody = document.querySelector("#detail-body");

  dateInput.value = tomorrowIsoDate();
  tokenInput.value = localStorage.getItem("kalshiLabToken") || "";

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    localStorage.setItem("kalshiLabToken", tokenInput.value.trim());
    runScan();
  });

  document.querySelector("#clear-ledger").addEventListener("click", function () {
    if (!confirm("Clear the local ledger on this browser?")) return;
    state.ledger = [];
    saveLedger();
    renderLedger();
  });

  document.querySelector("#detail-close").addEventListener("click", function () {
    detailDialog.close();
  });

  renderLedger();
  runScan();

  async function runScan() {
    setLoading(true, "Scanning Kalshi and NWS...");
    try {
      const params = new URLSearchParams({
        date: dateInput.value,
        minEdge: String(Number(minEdgeInput.value || 0) / 100),
        maxCost: String(Number(maxCostInput.value || 3)),
      });
      if (includeNegativeInput.checked) params.set("includeNegative", "1");
      const scan = await fetchJson(kalshiWeatherEndpoint("/api/kalshi/weather/scan?" + params.toString()));
      state.scan = scan;
      state.candidates = scan.candidates || [];
      renderScan();
      setStatus("Updated " + formatTime(scan.asOf) + ". " + state.candidates.length + " markets shown.");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setLoading(false);
    }
  }

  function renderScan() {
    renderSummary();
    renderCandidates();
    renderContexts();
  }

  function renderSummary() {
    const top = state.candidates[0];
    const buyCount = state.candidates.filter(function (item) {
      return item.recommendation === "research-buy" || item.recommendation === "small-buy";
    }).length;
    const avgEdge = state.candidates.length
      ? state.candidates.reduce(function (sum, item) { return sum + item.adjustedEdge; }, 0) / state.candidates.length
      : 0;
    const errors = state.scan && state.scan.errors ? state.scan.errors.length : 0;
    summaryEl.innerHTML = [
      metric("Top edge", top ? pct(top.adjustedEdge) : "n/a", top ? top.location + " " + top.subtitle + " " + top.side.toUpperCase() : "No candidate"),
      metric("Buy flags", String(buyCount), "Research-buy or small-buy"),
      metric("Shown avg edge", pct(avgEdge), "Adjusted, after fees"),
      metric("Scan health", errors ? errors + " issue" + (errors === 1 ? "" : "s") : "OK", state.scan ? state.scan.date : ""),
    ].join("");
  }

  function renderCandidates() {
    countEl.textContent = state.candidates.length + " candidates";
    if (!state.candidates.length) {
      candidatesEl.innerHTML = '<tr><td colspan="11" class="subtext">No markets cleared the current filters.</td></tr>';
      return;
    }

    candidatesEl.innerHTML = state.candidates.map(function (item, index) {
      return [
        "<tr>",
        '<td><span class="pill ' + actionClass(item.recommendation) + '">' + escapeHtml(actionLabel(item.recommendation)) + "</span></td>",
        '<td><div class="market-name"><strong>' + escapeHtml(item.location) + " " + escapeHtml(item.subtitle) + "</strong><span>" + escapeHtml(item.ticker) + "</span>" + renderRiskFlags(item) + "</div></td>",
        '<td><span class="side ' + (item.side === "yes" ? "yes" : "no") + '">' + item.side.toUpperCase() + "</span></td>",
        "<td>" + item.price.askCents + 'c<br><span class="subtext">bid ' + item.price.bidCents + "c</span></td>",
        "<td>" + pct(item.probability) + "</td>",
        "<td>" + pct(item.rawProbability) + '<br><span class="subtext">tight ' + pct(item.tightProbability) + "</span></td>",
        "<td>" + pct(item.breakEven) + "</td>",
        '<td class="' + (item.adjustedEdge >= 0 ? "pos" : "neg") + '">' + pct(item.adjustedEdge) + "</td>",
        '<td><span class="confidence">' + escapeHtml(item.confidence) + "</span></td>",
        "<td>" + item.suggested.contracts + " @ " + item.suggested.maxPriceCents + 'c<br><span class="subtext">$' + Number(item.suggested.maxCost).toFixed(2) + "</span></td>",
        '<td><div class="actions"><button type="button" data-detail="' + index + '">View</button><button type="button" data-open="' + index + '">Kalshi</button><button type="button" data-log="' + index + '">Log</button></div></td>',
        "</tr>",
      ].join("");
    }).join("");

    candidatesEl.querySelectorAll("[data-detail]").forEach(function (button) {
      button.addEventListener("click", function () { showDetail(state.candidates[Number(button.dataset.detail)]); });
    });
    candidatesEl.querySelectorAll("[data-open]").forEach(function (button) {
      button.addEventListener("click", function () { window.open(state.candidates[Number(button.dataset.open)].url, "_blank", "noopener"); });
    });
    candidatesEl.querySelectorAll("[data-log]").forEach(function (button) {
      button.addEventListener("click", function () { logCandidate(state.candidates[Number(button.dataset.log)]); });
    });
  }

  function renderContexts() {
    const contexts = state.scan && state.scan.contexts ? state.scan.contexts : [];
    if (!contexts.length) {
      contextsEl.innerHTML = '<div class="context-item"><span class="subtext">No forecast context loaded.</span></div>';
      return;
    }

    contextsEl.innerHTML = contexts.map(function (context) {
      return [
        '<div class="context-item">',
        "<h3>" + escapeHtml(context.location.label) + "</h3>",
        '<div class="context-row">',
        "<span>mean " + formatNumber(context.forecast.meanHigh, 1) + "F</span>",
        "<span>hourly " + valueOrNa(context.forecast.hourlyMax) + "F</span>",
        "<span>daily " + valueOrNa(context.forecast.dailyHigh) + "F</span>",
        "<span>PoP " + valueOrNa(context.regime.maxPrecipProbability) + "%</span>",
        "<span>wind " + escapeHtml((context.regime.peakWindDirections || []).join("/") || "n/a") + "</span>",
        "</div>",
        '<p class="subtext">' + escapeHtml(context.forecast.detailedForecast || context.forecast.shortForecast || "") + "</p>",
        "</div>",
      ].join("");
    }).join("");
  }

  function renderLedger() {
    if (!state.ledger.length) {
      ledgerEl.innerHTML = '<div class="ledger-item"><span class="subtext">No local ledger entries yet.</span></div>';
      return;
    }

    ledgerEl.innerHTML = state.ledger.slice(0, 50).map(function (entry) {
      return [
        '<div class="ledger-item">',
        "<h3>" + escapeHtml(entry.ticker) + ' <span class="' + (entry.side === "yes" ? "yes" : "no") + '">' + entry.side.toUpperCase() + "</span></h3>",
        '<div class="context-row">',
        "<span>" + entry.contracts + " contracts</span>",
        "<span>" + entry.priceCents + "c</span>",
        "<span>p " + pct(entry.modelProbability) + "</span>",
        "<span>edge " + pct(entry.adjustedEdge) + "</span>",
        "<span>" + formatTime(entry.createdAt) + "</span>",
        "</div>",
        entry.notes ? '<p class="subtext">' + escapeHtml(entry.notes) + "</p>" : "",
        "</div>",
      ].join("");
    }).join("");
  }

  function showDetail(item) {
    detailTitle.textContent = item.location + " " + item.subtitle + " " + item.side.toUpperCase();
    detailBody.innerHTML = [
      '<div class="detail-block"><h3>Decision</h3><p>' + escapeHtml(item.recommendation) + " at " + item.price.askCents + "c ask. Adjusted edge " + pct(item.adjustedEdge) + ". Confidence " + escapeHtml(item.confidence) + '.</p><div class="actions"><button type="button" id="detail-open">Open Kalshi</button><button type="button" id="detail-log">Log</button></div></div>',
      '<div class="detail-block"><h3>Probability Stack</h3><p>Adjusted ' + pct(item.probability) + ". Raw sigma=3 " + pct(item.rawProbability) + ". Tight sigma=2 " + pct(item.tightProbability) + ". Wide sigma=4 " + pct(item.wideProbability) + ". Break-even " + pct(item.breakEven) + ".</p></div>",
      '<div class="detail-block"><h3>Forecast</h3><p>Mean ' + formatNumber(item.context.meanHigh, 1) + "F, hourly max " + valueOrNa(item.context.hourlyMax) + "F, daily high " + valueOrNa(item.context.dailyHigh) + "F. " + escapeHtml(item.context.detailedForecast || item.context.shortForecast || "") + "</p></div>",
      '<div class="detail-block"><h3>Rationale</h3><ul>' + (item.rationale || []).map(function (line) { return "<li>" + escapeHtml(line) + "</li>"; }).join("") + "</ul></div>",
      '<div class="detail-block"><h3>Risk Flags</h3><p>' + escapeHtml(item.riskFlags && item.riskFlags.length ? item.riskFlags.join(", ") : "None raised by this pass.") + "</p></div>",
    ].join("");
    detailBody.querySelector("#detail-open").addEventListener("click", function () { window.open(item.url, "_blank", "noopener"); });
    detailBody.querySelector("#detail-log").addEventListener("click", function () { logCandidate(item); });
    detailDialog.showModal();
  }

  function logCandidate(item) {
    const contracts = Number(prompt("Contracts", String(item.suggested.contracts)));
    if (!Number.isFinite(contracts) || contracts <= 0) return;
    const priceCents = Number(prompt("Price in cents", String(item.suggested.maxPriceCents)));
    if (!Number.isFinite(priceCents) || priceCents <= 0) return;
    const notes = prompt("Notes", item.recommendation + "; " + item.location + " " + item.subtitle) || "";
    state.ledger.unshift({
      createdAt: new Date().toISOString(),
      ticker: item.ticker,
      side: item.side,
      contracts: contracts,
      priceCents: priceCents,
      modelProbability: item.probability,
      adjustedEdge: item.adjustedEdge,
      notes: notes,
    });
    saveLedger();
    renderLedger();
  }

  function saveLedger() {
    localStorage.setItem("kalshiWeatherLedger", JSON.stringify(state.ledger));
  }

  function fetchJson(url) {
    const headers = {};
    const token = tokenInput.value.trim() || localStorage.getItem("kalshiLabToken") || "";
    if (token) headers["X-Kalshi-Lab-Token"] = token;
    return fetch(url, { headers: headers }).then(function (response) {
      return response.text().then(function (text) {
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
        return data;
      });
    });
  }

  function kalshiWeatherEndpoint(path) {
    const explicit = typeof window.KALSHI_WEATHER_API_BASE === "string" ? window.KALSHI_WEATHER_API_BASE.trim() : "";
    const base = explicit || defaultApiBase();
    return base.replace(/\/$/, "") + path;
  }

  function defaultApiBase() {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "nova-arcade-backend-1000121513328.us-central1.run.app") {
      return window.location.origin;
    }
    return PROD_KALSHI_WEATHER_API_BASE;
  }

  function metric(label, value, subtext) {
    return '<div class="metric"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong><small>" + escapeHtml(subtext) + "</small></div>";
  }

  function renderRiskFlags(item) {
    if (!item.riskFlags || !item.riskFlags.length) return "";
    return '<div class="risk-list">' + item.riskFlags.slice(0, 3).map(function (flag) {
      return "<span>" + escapeHtml(flag) + "</span>";
    }).join("") + "</div>";
  }

  function actionClass(action) {
    if (action === "research-buy" || action === "small-buy") return "buy";
    if (action === "tiny-only") return "tiny";
    if (action === "avoid-or-sell") return "avoid";
    return "pass";
  }

  function actionLabel(action) {
    return {
      "research-buy": "Research",
      "small-buy": "Small",
      "tiny-only": "Tiny",
      "avoid-or-sell": "Avoid",
      "pass": "Pass",
    }[action] || action;
  }

  function setLoading(loading, message) {
    form.querySelectorAll("button,input").forEach(function (node) {
      node.disabled = loading;
    });
    if (message) setStatus(message);
  }

  function setStatus(message, error) {
    statusEl.textContent = message;
    statusEl.className = error ? "neg" : "";
  }

  function pct(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return (number * 100).toFixed(1) + "%";
  }

  function formatNumber(value, places) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(places) : "n/a";
  }

  function valueOrNa(value) {
    return value === null || value === undefined || value === "" ? "n/a" : value;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function tomorrowIsoDate() {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}());
