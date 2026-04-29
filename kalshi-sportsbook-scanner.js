(function () {
  "use strict";

  const API_BASE = "https://nova-arcade-backend-1000121513328.us-central1.run.app";
  const TOKEN_KEY = "kalshiLabToken";
  const SETTINGS_KEY = "kalshiSportsbookCrossCheckSettings";

  const state = {
    scan: null,
    selectedKalshi: null,
  };

  const form = document.querySelector("#scan-form");
  const statusEl = document.querySelector("#status");
  const stateSelect = document.querySelector("#state-select");
  const sportsInput = document.querySelector("#sports-input");
  const booksInput = document.querySelector("#books-input");
  const kalshiLimitInput = document.querySelector("#kalshi-limit");
  const minEdgeInput = document.querySelector("#min-edge");
  const tokenInput = document.querySelector("#access-token");
  const summaryEl = document.querySelector("#summary");
  const evCandidatesEl = document.querySelector("#ev-candidates");
  const arbsEl = document.querySelector("#arbs");
  const matchesEl = document.querySelector("#matches");
  const notesEl = document.querySelector("#notes");
  const evCountEl = document.querySelector("#ev-count");
  const arbCountEl = document.querySelector("#arb-count");
  const matchCountEl = document.querySelector("#match-count");
  const kalshiCountEl = document.querySelector("#kalshi-count");
  const bookCountEl = document.querySelector("#book-count");
  const kalshiRowsEl = document.querySelector("#kalshi-rows");
  const bookRowsEl = document.querySelector("#book-rows");
  const detailDialog = document.querySelector("#detail-dialog");
  const detailTitle = document.querySelector("#detail-title");
  const detailBody = document.querySelector("#detail-body");

  const calcLabel = document.querySelector("#calc-label");
  const calcYesPrice = document.querySelector("#calc-yes-price");
  const calcNoPrice = document.querySelector("#calc-no-price");
  const calcBookYes = document.querySelector("#calc-book-yes");
  const calcBookNo = document.querySelector("#calc-book-no");
  const calcResult = document.querySelector("#calc-result");

  loadSettings();
  tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    saveSettings();
    runScan();
  });

  [calcLabel, calcYesPrice, calcNoPrice, calcBookYes, calcBookNo].forEach(function (input) {
    input.addEventListener("input", renderCalculator);
  });

  document.querySelector("#clear-calculator").addEventListener("click", function () {
    calcLabel.value = "";
    calcYesPrice.value = "";
    calcNoPrice.value = "";
    calcBookYes.value = "";
    calcBookNo.value = "";
    state.selectedKalshi = null;
    renderCalculator();
  });

  document.querySelector("#detail-close").addEventListener("click", function () {
    detailDialog.close();
  });

  renderCalculator();
  runScan();

  function apiUrl(path) {
    const host = window.location.hostname;
    const base = host === "localhost" || host === "127.0.0.1" || host.endsWith(".run.app")
      ? window.location.origin
      : API_BASE;
    return base + path;
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      if (saved.state) stateSelect.value = saved.state;
      if (saved.sports) sportsInput.value = saved.sports;
      if (saved.books) booksInput.value = saved.books;
      if (saved.kalshiLimit) kalshiLimitInput.value = saved.kalshiLimit;
      if (saved.minEdge) minEdgeInput.value = saved.minEdge;
    } catch (error) {
      // Ignore corrupted local settings.
    }
  }

  function saveSettings() {
    localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      state: stateSelect.value,
      sports: sportsInput.value.trim(),
      books: booksInput.value.trim(),
      kalshiLimit: kalshiLimitInput.value,
      minEdge: minEdgeInput.value,
    }));
  }

  async function runScan() {
    setStatus("Scanning Kalshi sports legs and sportsbook board...");
    const params = new URLSearchParams({
      sports: sportsInput.value.trim(),
      bookmakers: booksInput.value.trim(),
      kalshiLimit: String(Number(kalshiLimitInput.value || 500)),
      minEdge: String(Number(minEdgeInput.value || 1.5) / 100),
    });
    const token = tokenInput.value.trim();
    const headers = {};
    if (token) headers["X-Kalshi-Lab-Token"] = token;

    try {
      const response = await fetch(apiUrl("/api/kalshi/sportsbook/scan?" + params.toString()), {
        headers,
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Scan failed.");
      }
      state.scan = data;
      setStatus("Scan complete at " + formatTime(data.asOf));
      render();
    } catch (error) {
      setStatus(error.message || "Unable to scan.", true);
    }
  }

  function render() {
    const scan = state.scan;
    if (!scan) return;
    renderSummary(scan);
    renderEvCandidates(scan.evCandidates || []);
    renderArbs(scan.arbitrage || (scan.sportsbook && scan.sportsbook.arbitrage) || []);
    renderMatches(scan.matches || []);
    renderNotes(scan);
    renderKalshiRows((scan.kalshi && scan.kalshi.markets) || []);
    renderBookRows((scan.sportsbook && scan.sportsbook.rows) || []);
  }

  function renderSummary(scan) {
    const configured = scan.sportsbook && scan.sportsbook.configured;
    const cards = [
      ["Positive EV", (scan.evCandidates || []).length, (scan.evCandidates || []).length ? "is-warn" : "is-cold"],
      ["Book arbs", (scan.arbitrage || []).length, (scan.arbitrage || []).length ? "is-warn" : "is-cold"],
      ["Kalshi legs", ((scan.kalshi && scan.kalshi.markets) || []).length, ""],
      ["Sportsbook rows", ((scan.sportsbook && scan.sportsbook.rows) || []).length, configured ? "" : "is-cold"],
      ["Mode", configured ? "Live odds" : "Manual odds", configured ? "" : "is-warn"],
    ];
    summaryEl.innerHTML = cards.map(function (card) {
      return `<article class="summary-card ${card[2]}"><span>${escapeHtml(card[0])}</span><strong>${escapeHtml(card[1])}</strong></article>`;
    }).join("");
  }

  function renderEvCandidates(candidates) {
    evCountEl.textContent = String(candidates.length);
    if (!candidates.length) {
      evCandidatesEl.innerHTML = `<div class="empty-state">No positive EV candidates above the current threshold. Live sportsbook odds require an odds API key.</div>`;
      return;
    }
    evCandidatesEl.innerHTML = candidates.slice(0, 16).map(function (candidate, index) {
      const market = candidate.kalshi || {};
      const consensus = candidate.consensus || {};
      const outcome = candidate.outcome || {};
      return `
        <article class="match-card">
          <div class="match-meta">
            <span class="tag hot">${percent(candidate.edge)} edge</span>
            <span class="tag">${escapeHtml(candidate.side || "").toUpperCase()}</span>
            <span class="tag ${candidate.validation === "strong-match" ? "clean" : "warn"}">${Math.round((candidate.matchScore || 0) * 100)}% match</span>
          </div>
          <h3>${escapeHtml(market.title || "Kalshi market")}</h3>
          <p>${escapeHtml(consensus.game || "")} ${escapeHtml(consensus.marketTitle || "")}: fair ${percent(candidate.fairProbability)} vs all-in ${price(candidate.allInPrice)}.</p>
          <p class="small">Consensus outcome: ${escapeHtml(outcome.label || outcome.key || "")}. Books sampled: ${escapeHtml((consensus.sampleBooks || []).join(", ") || "none")}.</p>
          ${renderRiskFlags(candidate.riskFlags)}
          <div class="row-actions">
            <button type="button" data-use-ev="${index}">Use in calculator</button>
            <button type="button" class="ghost" data-detail-ev="${index}">Details</button>
            <a class="small-link" href="${escapeHtml(market.url || "#")}" target="_blank" rel="noopener">Kalshi</a>
          </div>
        </article>
      `;
    }).join("");
    evCandidatesEl.querySelectorAll("[data-use-ev]").forEach(function (button) {
      button.addEventListener("click", function () {
        const candidate = candidates[Number(button.dataset.useEv)];
        fillKalshi(candidate.kalshi);
      });
    });
    evCandidatesEl.querySelectorAll("[data-detail-ev]").forEach(function (button) {
      button.addEventListener("click", function () {
        openEvDetail(candidates[Number(button.dataset.detailEv)]);
      });
    });
  }

  function renderArbs(arbs) {
    arbCountEl.textContent = String(arbs.length);
    if (!arbs.length) {
      arbsEl.innerHTML = `<div class="empty-state">No cross-book arbitrage found across selected books.</div>`;
      return;
    }
    arbsEl.innerHTML = arbs.slice(0, 14).map(function (arb, index) {
      return `
        <article class="match-card">
          <div class="match-meta">
            <span class="tag hot">${percent(arb.roi)} lock ROI</span>
            <span class="tag">${escapeHtml(arb.sportTitle || "")}</span>
            <span class="tag">${escapeHtml(arb.marketTitle || "")}</span>
          </div>
          <h3>${escapeHtml(arb.game || "Sportsbook arb")}</h3>
          <p class="small">${formatDateTime(arb.commenceTime)} ${arb.point === null || arb.point === undefined ? "" : "line " + escapeHtml(arb.point)}</p>
          ${renderArbLegs(arb.legs)}
          <div class="row-actions">
            <button type="button" class="ghost" data-detail-arb="${index}">Details</button>
          </div>
        </article>
      `;
    }).join("");
    arbsEl.querySelectorAll("[data-detail-arb]").forEach(function (button) {
      button.addEventListener("click", function () {
        openArbDetail(arbs[Number(button.dataset.detailArb)]);
      });
    });
  }

  function renderMatches(matches) {
    matchCountEl.textContent = String(matches.length);
    if (!matches.length) {
      matchesEl.innerHTML = `<div class="empty-state">No clean automatic matches yet. Use the Kalshi leg list plus manual calculator.</div>`;
      return;
    }
    matchesEl.innerHTML = matches.slice(0, 12).map(function (match, index) {
      return `
        <article class="match-card">
          <div class="match-meta">
            <span class="tag ${match.yesEdge > 0 ? "hot" : "warn"}">${percent(match.yesEdge)} ref edge</span>
            <span class="tag">match ${Math.round(match.score * 100)}%</span>
          </div>
          <h3>${escapeHtml(match.kalshi.title)}</h3>
          <p>${escapeHtml(match.sportsbook.bookmakerTitle)} ${escapeHtml(match.sportsbook.marketTitle)}: ${escapeHtml(bookOutcomeLabel(match.sportsbook))}</p>
          <div class="row-actions">
            <button type="button" data-fill-match="${index}">Use in calculator</button>
            <a class="small-link" href="${escapeHtml(match.kalshi.url)}" target="_blank" rel="noopener">Kalshi</a>
          </div>
        </article>
      `;
    }).join("");
    matchesEl.querySelectorAll("[data-fill-match]").forEach(function (button) {
      button.addEventListener("click", function () {
        const match = matches[Number(button.dataset.fillMatch)];
        fillKalshi(match.kalshi);
        calcBookYes.value = String(match.sportsbook.americanOdds || "");
        renderCalculator();
      });
    });
  }

  function renderNotes(scan) {
    const notes = [
      ...((scan.notes || [])),
      scan.sportsbook && scan.sportsbook.note ? scan.sportsbook.note : "",
      stateSelect.value ? `Location note: sportsbook legality and college-prop rules still depend on being physically in ${stateSelect.value}.` : "Choose your state before treating any sportsbook leg as available.",
      ...(((scan.sportsbook && scan.sportsbook.errors) || []).map(function (item) {
        return `${item.sport}: ${item.error}`;
      })),
    ].filter(Boolean);
    notesEl.innerHTML = notes.map(function (note) {
      return `<article class="note-card">${escapeHtml(note)}</article>`;
    }).join("");
  }

  function renderKalshiRows(markets) {
    kalshiCountEl.textContent = String(markets.length);
    if (!markets.length) {
      kalshiRowsEl.innerHTML = `<tr><td colspan="8"><div class="empty-state">No Kalshi sports legs found in the scan window.</div></td></tr>`;
      return;
    }
    kalshiRowsEl.innerHTML = markets.map(function (market, index) {
      return `
        <tr>
          <td>
            <div class="market-title">
              <strong>${escapeHtml(market.title)}</strong>
              <span class="small">${escapeHtml(market.ticker)}</span>
            </div>
          </td>
          <td><span class="tag ${market.matchability}">${escapeHtml(market.matchability)}</span></td>
          <td>${price(market.yesAsk)} <span class="small">size ${compactNumber(market.yesAskSize)}</span></td>
          <td>${price(market.noAsk)} <span class="small">size ${compactNumber(market.noAskSize)}</span></td>
          <td>
            <div>YES ${price(market.yesAllIn)}</div>
            <div>NO ${price(market.noAllIn)}</div>
          </td>
          <td>${renderLegs(market.legs)}</td>
          <td>${formatDateTime(market.expectedExpirationTime || market.closeTime)}</td>
          <td>
            <div class="row-actions">
              <button type="button" data-use-kalshi="${index}">Use</button>
              <button type="button" class="ghost" data-detail="${index}">Details</button>
              <a class="small-link" href="${escapeHtml(market.url)}" target="_blank" rel="noopener">Open</a>
            </div>
          </td>
        </tr>
      `;
    }).join("");
    kalshiRowsEl.querySelectorAll("[data-use-kalshi]").forEach(function (button) {
      button.addEventListener("click", function () {
        fillKalshi(markets[Number(button.dataset.useKalshi)]);
      });
    });
    kalshiRowsEl.querySelectorAll("[data-detail]").forEach(function (button) {
      button.addEventListener("click", function () {
        openKalshiDetail(markets[Number(button.dataset.detail)]);
      });
    });
  }

  function renderBookRows(rows) {
    bookCountEl.textContent = String(rows.length);
    if (!rows.length) {
      bookRowsEl.innerHTML = `<tr><td colspan="9"><div class="empty-state">Live sportsbook board is not configured. Add an odds API key on the backend or paste odds into the calculator.</div></td></tr>`;
      return;
    }
    bookRowsEl.innerHTML = rows.slice(0, 250).map(function (row, index) {
      return `
        <tr>
          <td>
            <div class="market-title">
              <strong>${escapeHtml(row.game)}</strong>
              <span class="small">${escapeHtml(row.sportTitle)}</span>
            </div>
          </td>
          <td>${escapeHtml(row.bookmakerTitle)}</td>
          <td>${escapeHtml(row.marketTitle)}</td>
          <td>${escapeHtml(bookOutcomeLabel(row))}</td>
          <td>${american(row.americanOdds)}</td>
          <td>${row.noVigProbability === null ? "--" : percent(row.noVigProbability)}</td>
          <td>${row.holdPct === null ? "--" : escapeHtml(String(row.holdPct)) + "%"}</td>
          <td>${formatDateTime(row.commenceTime)}</td>
          <td><button type="button" data-use-book="${index}">Use</button></td>
        </tr>
      `;
    }).join("");
    bookRowsEl.querySelectorAll("[data-use-book]").forEach(function (button) {
      button.addEventListener("click", function () {
        const row = rows[Number(button.dataset.useBook)];
        calcBookYes.value = String(row.americanOdds || "");
        if (!calcLabel.value) calcLabel.value = `${row.game} ${row.marketTitle} ${bookOutcomeLabel(row)}`;
        renderCalculator();
      });
    });
  }

  function fillKalshi(market) {
    state.selectedKalshi = market;
    calcLabel.value = market.title || market.subtitle || "";
    calcYesPrice.value = market.yesAsk ? String(Math.round(market.yesAsk * 1000) / 10) : "";
    calcNoPrice.value = market.noAsk ? String(Math.round(market.noAsk * 1000) / 10) : "";
    renderCalculator();
    document.querySelector(".manual-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderCalculator() {
    const label = calcLabel.value.trim() || "Selected outcome";
    const yesPrice = centsToProb(calcYesPrice.value);
    const noPrice = centsToProb(calcNoPrice.value);
    const bookYes = Number(calcBookYes.value);
    const bookNo = Number(calcBookNo.value);
    const yesDecimal = americanToDecimal(bookYes);
    const noDecimal = americanToDecimal(bookNo);
    const impliedYes = yesDecimal ? 1 / yesDecimal : null;
    const impliedNo = noDecimal ? 1 / noDecimal : null;
    const vigSum = impliedYes !== null && impliedNo !== null ? impliedYes + impliedNo : null;
    const noVigYes = vigSum ? impliedYes / vigSum : impliedYes;
    const noVigNo = vigSum ? impliedNo / vigSum : null;
    const yesAllIn = yesPrice === null ? null : yesPrice + kalshiFee(yesPrice);
    const noAllIn = noPrice === null ? null : noPrice + kalshiFee(noPrice);
    const yesEv = yesAllIn !== null && noVigYes !== null ? noVigYes - yesAllIn : null;
    const noEv = noAllIn !== null && noVigNo !== null ? noVigNo - noAllIn : null;
    const yesArb = yesAllIn !== null && noDecimal ? 1 - (yesAllIn + 1 / noDecimal) : null;
    const noArb = noAllIn !== null && yesDecimal ? 1 - (noAllIn + 1 / yesDecimal) : null;
    const bestArb = Math.max(yesArb === null ? -99 : yesArb, noArb === null ? -99 : noArb);
    const bestLabel = bestArb > 0
      ? (yesArb >= noArb ? "Buy Kalshi YES + sportsbook NO" : "Buy Kalshi NO + sportsbook YES")
      : "No locked arb from entered prices";

    calcResult.innerHTML = [
      metric("Outcome", label, ""),
      metric("Book fair YES", noVigYes === null ? "--" : percent(noVigYes), noVigYes === null ? "" : ""),
      metric("Kalshi YES EV", yesEv === null ? "--" : percent(yesEv), yesEv > 0 ? "money-positive" : "money-negative"),
      metric("Kalshi NO EV", noEv === null ? "--" : percent(noEv), noEv > 0 ? "money-positive" : "money-negative"),
      metric("YES all-in", yesAllIn === null ? "--" : price(yesAllIn), ""),
      metric("NO all-in", noAllIn === null ? "--" : price(noAllIn), ""),
      metric("Arb lock", bestArb > 0 ? percent(bestArb) : "--", bestArb > 0 ? "money-positive" : "money-negative"),
      metric("Best structure", bestLabel, bestArb > 0 ? "money-positive" : ""),
    ].join("");
  }

  function metric(label, value, valueClass) {
    return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong class="${valueClass || ""}">${escapeHtml(value)}</strong></article>`;
  }

  function openKalshiDetail(market) {
    detailTitle.textContent = market.title || "Kalshi market";
    detailBody.innerHTML = `
      <div class="detail-grid">
        <article class="note-card"><strong>Ticker</strong><p>${escapeHtml(market.ticker)}</p></article>
        <article class="note-card"><strong>Prices</strong><p>YES ${price(market.yesAsk)} ask, all-in ${price(market.yesAllIn)}. NO ${price(market.noAsk)} ask, all-in ${price(market.noAllIn)}.</p></article>
        <article class="note-card"><strong>Legs</strong>${renderLegs(market.legs)}</article>
        <article class="note-card"><strong>Rules</strong><p>${escapeHtml(market.rules || "No rules text returned in this scan.")}</p></article>
        <article class="note-card"><a class="small-link" href="${escapeHtml(market.url)}" target="_blank" rel="noopener">Open on Kalshi</a></article>
      </div>
    `;
    detailDialog.showModal();
  }

  function openEvDetail(candidate) {
    const market = candidate.kalshi || {};
    const consensus = candidate.consensus || {};
    detailTitle.textContent = `${String(candidate.side || "").toUpperCase()} EV candidate`;
    detailBody.innerHTML = `
      <div class="detail-grid">
        <article class="note-card"><strong>EV math</strong><p>Fair probability ${percent(candidate.fairProbability)} minus Kalshi all-in ${price(candidate.allInPrice)} equals ${percent(candidate.edge)} edge. ROI on cost is ${percent(candidate.roi)}.</p></article>
        <article class="note-card"><strong>Sportsbook consensus</strong><p>${escapeHtml(consensus.game || "")} ${escapeHtml(consensus.marketTitle || "")}. Books: ${escapeHtml((consensus.sampleBooks || []).join(", ") || "none")}.</p></article>
        <article class="note-card"><strong>Match quality</strong><p>${escapeHtml(candidate.validation || "")}; score ${Math.round((candidate.matchScore || 0) * 100)}%. ${escapeHtml((candidate.riskFlags || []).join(" "))}</p></article>
        <article class="note-card"><strong>Kalshi</strong><p>${escapeHtml(market.title || "")}</p><a class="small-link" href="${escapeHtml(market.url || "#")}" target="_blank" rel="noopener">Open on Kalshi</a></article>
      </div>
    `;
    detailDialog.showModal();
  }

  function openArbDetail(arb) {
    detailTitle.textContent = "Cross-book arbitrage";
    detailBody.innerHTML = `
      <div class="detail-grid">
        <article class="note-card"><strong>Arb math</strong><p>Best-price implied probabilities sum to ${percent(arb.impliedSum)}. Lock ROI is ${percent(arb.roi)} before limits, movement, voids, and rule differences.</p></article>
        <article class="note-card"><strong>Market</strong><p>${escapeHtml(arb.game || "")} ${escapeHtml(arb.marketTitle || "")} ${arb.point === null || arb.point === undefined ? "" : "line " + escapeHtml(arb.point)}</p></article>
        <article class="note-card"><strong>Stake split</strong>${renderArbLegs(arb.legs)}</article>
      </div>
    `;
    detailDialog.showModal();
  }

  function renderLegs(legs) {
    if (!legs || !legs.length) return `<span class="small">No parsed legs</span>`;
    return `<ul class="leg-list">${legs.slice(0, 7).map(function (leg) {
      const point = leg.point === null || leg.point === undefined ? "" : ` ${leg.point}`;
      return `<li><span class="tag ${leg.legSide === "no" ? "no" : ""}">${escapeHtml(leg.legSide)}</span> ${escapeHtml(leg.type)}: ${escapeHtml(leg.outcome || leg.description)}${escapeHtml(point)}</li>`;
    }).join("")}${legs.length > 7 ? `<li class="small">+${legs.length - 7} more legs</li>` : ""}</ul>`;
  }

  function renderRiskFlags(flags) {
    if (!flags || !flags.length) return "";
    return `<ul class="leg-list">${flags.map(function (flag) {
      return `<li><span class="tag warn">check</span> ${escapeHtml(flag)}</li>`;
    }).join("")}</ul>`;
  }

  function renderArbLegs(legs) {
    if (!legs || !legs.length) return `<span class="small">No legs</span>`;
    return `<ul class="leg-list">${legs.map(function (leg) {
      const point = leg.point === null || leg.point === undefined ? "" : ` ${leg.point}`;
      return `<li><span class="tag clean">${escapeHtml(leg.bookmakerTitle || "")}</span> ${escapeHtml(leg.outcome || "")}${escapeHtml(point)} at ${american(leg.americanOdds)} <span class="small">stake ${percent(leg.stakeShare)}</span></li>`;
    }).join("")}</ul>`;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle("money-negative", Boolean(isError));
  }

  function centsToProb(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return number > 1 ? Math.max(0, Math.min(1, number / 100)) : Math.max(0, Math.min(1, number));
  }

  function kalshiFee(priceDollars) {
    if (!Number.isFinite(priceDollars) || priceDollars <= 0 || priceDollars >= 1) return 0;
    return Math.ceil(0.07 * priceDollars * (1 - priceDollars) * 100) / 100;
  }

  function americanToDecimal(odds) {
    const number = Number(odds);
    if (!Number.isFinite(number) || number === 0) return null;
    return number > 0 ? 1 + number / 100 : 1 + 100 / Math.abs(number);
  }

  function bookOutcomeLabel(row) {
    const point = row.point === null || row.point === undefined ? "" : ` ${row.point}`;
    const description = row.description ? ` ${row.description}` : "";
    return `${row.outcome}${point}${description}`;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "--";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "--";
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function price(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return Math.round(number * 1000) / 10 + "c";
  }

  function percent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return (number * 100).toFixed(1) + "%";
  }

  function american(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return number > 0 ? `+${number}` : String(number);
  }

  function compactNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    if (number >= 1000) return (number / 1000).toFixed(1) + "k";
    return String(Math.round(number * 10) / 10);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
