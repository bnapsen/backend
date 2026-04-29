(function () {
  "use strict";

  const API_BASE = "https://nova-arcade-backend-1000121513328.us-central1.run.app";
  const TOKEN_KEY = "kalshiLabToken";
  const SERIES_KEY = "kalshiEvScannerSeries";
  const DEFAULT_SERIES = [
    "KXBTC15M",
    "KXHIGHNY",
    "KXHIGHMIA",
    "KXHIGHDEN",
    "KXHIGHLAX",
    "KXHIGHTDAL",
    "KXHIGHTLV",
    "KXHIGHTSEA",
    "KXHIGHTNOLA",
    "KXHIGHTHOU",
    "KXHIGHTMIN",
    "INX",
    "NASDAQ100",
  ];
  const WEATHER_SERIES = [
    "KXHIGHNY",
    "KXHIGHMIA",
    "KXHIGHDEN",
    "KXHIGHLAX",
    "KXHIGHTDAL",
    "KXHIGHTLV",
    "KXHIGHTSEA",
    "KXHIGHTNOLA",
    "KXHIGHTHOU",
    "KXHIGHTMIN",
  ];

  const state = {
    scan: null,
    autoTimer: null,
    displayed: [],
  };

  const form = document.querySelector("#scan-form");
  const statusEl = document.querySelector("#status");
  const minNetInput = document.querySelector("#min-net");
  const maxMarketsInput = document.querySelector("#max-markets");
  const tokenInput = document.querySelector("#access-token");
  const includeNearInput = document.querySelector("#include-near");
  const autoRefreshInput = document.querySelector("#auto-refresh");
  const seriesInput = document.querySelector("#series-input");
  const summaryEl = document.querySelector("#summary");
  const alertsEl = document.querySelector("#alerts");
  const alertCountEl = document.querySelector("#alert-count");
  const nearCountEl = document.querySelector("#near-count");
  const nearMissesEl = document.querySelector("#near-misses");
  const notesEl = document.querySelector("#notes");
  const detailDialog = document.querySelector("#detail-dialog");
  const detailTitle = document.querySelector("#detail-title");
  const detailBody = document.querySelector("#detail-body");

  tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
  seriesInput.value = localStorage.getItem(SERIES_KEY) || DEFAULT_SERIES.join(", ");

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    saveSettings();
    runScan();
  });

  includeNearInput.addEventListener("change", render);
  autoRefreshInput.addEventListener("change", updateAutoRefresh);
  document.querySelector("#preset-weather").addEventListener("click", function () {
    seriesInput.value = WEATHER_SERIES.join(", ");
  });
  document.querySelector("#preset-btc").addEventListener("click", function () {
    seriesInput.value = "KXBTC15M";
  });
  document.querySelector("#preset-default").addEventListener("click", function () {
    seriesInput.value = DEFAULT_SERIES.join(", ");
  });
  document.querySelector("#detail-close").addEventListener("click", function () {
    detailDialog.close();
  });

  runScan();

  function apiUrl(path) {
    const host = window.location.hostname;
    const base = host === "localhost" || host === "127.0.0.1" || host.endsWith(".run.app")
      ? window.location.origin
      : API_BASE;
    return base + path;
  }

  function saveSettings() {
    localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
    localStorage.setItem(SERIES_KEY, seriesInput.value.trim());
  }

  async function runScan() {
    setStatus("Scanning Kalshi top of book...");
    const params = new URLSearchParams({
      minNet: String(Number(minNetInput.value || 0) / 100),
      maxMarketsPerSeries: String(Number(maxMarketsInput.value || 160)),
    });
    const series = seriesInput.value.trim();
    if (series) params.set("series", series);
    const token = tokenInput.value.trim();
    const headers = {};
    if (token) headers["X-Kalshi-Lab-Token"] = token;

    try {
      const response = await fetch(apiUrl("/api/kalshi/ev/scan?" + params.toString()), {
        headers,
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Scanner request failed.");
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
    if (!scan) {
      renderSummary(null);
      return;
    }
    renderSummary(scan);
    renderAlerts(scan);
    renderNearMisses(scan);
    renderNotes(scan);
  }

  function renderSummary(scan) {
    if (!scan) {
      summaryEl.innerHTML = "";
      return;
    }
    const cards = [
      ["Alerts", scan.opportunities.length, scan.opportunities.length ? "is-hot" : "is-cold"],
      ["Best net", money(scan.bestNetProfit || 0), (scan.bestNetProfit || 0) > 0 ? "is-hot" : "is-cold"],
      ["Markets", scan.scannedMarkets || 0, ""],
      ["Events", scan.scannedEvents || 0, ""],
      ["Candidates", scan.rawCandidateCount || 0, ""],
    ];
    summaryEl.innerHTML = cards.map(function (card) {
      return `<article class="summary-card ${card[2]}"><span>${escapeHtml(card[0])}</span><strong>${escapeHtml(card[1])}</strong></article>`;
    }).join("");
  }

  function renderAlerts(scan) {
    const rows = scan.opportunities || [];
    alertCountEl.textContent = String(rows.length);
    state.displayed = rows;

    if (!rows.length) {
      alertsEl.innerHTML = `<tr><td colspan="10"><div class="empty-state">No fee-adjusted consistency alerts above the current threshold.</div></td></tr>`;
      return;
    }

    alertsEl.innerHTML = rows.map(function (opportunity, index) {
      return `
        <tr>
          <td><span class="tag">${escapeHtml(ruleLabel(opportunity))}</span></td>
          <td>
            <div class="event-title">
              <strong>${escapeHtml(opportunity.title || opportunity.eventTicker || "Market")}</strong>
              <span class="leg-small">${escapeHtml(opportunity.eventTicker || "")}</span>
            </div>
          </td>
          <td class="${opportunity.netProfit >= 0 ? "money-positive" : "money-negative"}">${money(opportunity.netProfit)}</td>
          <td>${money(opportunity.totalCost)}</td>
          <td>${money(opportunity.fees)}</td>
          <td>${percent(opportunity.roiPct)}</td>
          <td>${escapeHtml(String(opportunity.maxContracts || 1))}</td>
          <td>${renderLegs(opportunity.legs)}</td>
          <td>${renderRisk(opportunity.riskFlags)}</td>
          <td>
            <div class="row-actions">
              <button class="detail-button" type="button" data-detail="${index}">Details</button>
              <a class="small-link" href="${escapeHtml(opportunity.kalshiUrl)}" target="_blank" rel="noopener">Kalshi</a>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    alertsEl.querySelectorAll("[data-detail]").forEach(function (button) {
      button.addEventListener("click", function () {
        openDetail(rows[Number(button.dataset.detail)]);
      });
    });
  }

  function renderNearMisses(scan) {
    const rows = includeNearInput.checked ? (scan.nearMisses || []).slice(0, 12) : [];
    nearCountEl.textContent = String(rows.length);

    if (!rows.length) {
      nearMissesEl.innerHTML = `<div class="empty-state">Near misses hidden or none available.</div>`;
      return;
    }

    nearMissesEl.innerHTML = rows.map(function (opportunity, index) {
      return `
        <article class="near-card">
          <div>
            <span class="tag is-near">${escapeHtml(ruleLabel(opportunity))}</span>
            <p><strong>${escapeHtml(opportunity.title || opportunity.eventTicker || "Market")}</strong></p>
            <p class="${opportunity.netProfit >= 0 ? "money-positive" : "money-negative"}">${money(opportunity.netProfit)} net per set</p>
          </div>
          <button class="detail-button" type="button" data-near="${index}">Details</button>
        </article>
      `;
    }).join("");

    nearMissesEl.querySelectorAll("[data-near]").forEach(function (button) {
      button.addEventListener("click", function () {
        openDetail(rows[Number(button.dataset.near)]);
      });
    });
  }

  function renderNotes(scan) {
    const notes = [
      ...(scan.notes || []),
      ...(scan.errors || []).map(function (item) {
        return `${item.series}: ${item.error}`;
      }),
    ];
    notesEl.innerHTML = notes.length
      ? notes.map(function (note) {
        return `<article class="note-card">${escapeHtml(note)}</article>`;
      }).join("")
      : `<article class="note-card">No scanner notes.</article>`;
  }

  function renderLegs(legs) {
    return `<ul class="leg-list">${(legs || []).map(function (leg) {
      return `
        <li class="leg-item">
          <span class="side ${leg.side === "no" ? "no" : ""}">${escapeHtml(leg.side)}</span>
          <strong>${escapeHtml(price(leg.price))}</strong>
          <span class="leg-small">${escapeHtml(leg.ticker)}</span>
        </li>
      `;
    }).join("")}</ul>`;
  }

  function renderRisk(flags) {
    return `<ul class="risk-list">${(flags || []).slice(0, 3).map(function (flag) {
      return `<li>${escapeHtml(flag)}</li>`;
    }).join("")}</ul>`;
  }

  function openDetail(opportunity) {
    if (!opportunity) return;
    detailTitle.textContent = ruleLabel(opportunity);
    detailBody.innerHTML = `
      <div class="detail-grid">
        <article class="detail-card"><span>Total cost</span><strong>${money(opportunity.totalCost)}</strong></article>
        <article class="detail-card"><span>Min payout</span><strong>${money(opportunity.minPayout)}</strong></article>
        <article class="detail-card"><span>Net</span><strong class="${opportunity.netProfit >= 0 ? "money-positive" : "money-negative"}">${money(opportunity.netProfit)}</strong></article>
        <article class="detail-card"><span>Max top size</span><strong>${escapeHtml(String(opportunity.maxContracts || 1))}</strong></article>
      </div>
      <h3>${escapeHtml(opportunity.title || opportunity.eventTicker || "Opportunity")}</h3>
      <p class="subtext">${escapeHtml(opportunity.summary || "")}</p>
      <h3>Legs</h3>
      ${renderLegs(opportunity.legs)}
      <h3>Proof</h3>
      <div class="note-list">${(opportunity.why || []).map(function (item) {
        return `<article class="note-card">${escapeHtml(item)}</article>`;
      }).join("")}</div>
      <h3>Execution Risks</h3>
      <div class="note-list">${(opportunity.riskFlags || []).map(function (item) {
        return `<article class="note-card">${escapeHtml(item)}</article>`;
      }).join("")}</div>
    `;
    detailDialog.showModal();
  }

  function updateAutoRefresh() {
    if (state.autoTimer) {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
    if (autoRefreshInput.checked) {
      state.autoTimer = setInterval(runScan, 10_000);
    }
  }

  function setStatus(text, error) {
    statusEl.textContent = text;
    statusEl.style.color = error ? "#ff5f7f" : "";
  }

  function ruleLabel(opportunity) {
    const labels = {
      "same-market": "YES/NO",
      "complete-set": "Complete set",
      threshold: "Threshold",
      exclusive: "Exclusive ranges",
    };
    return labels[opportunity.type] || opportunity.type || "Rule";
  }

  function money(value) {
    const number = Number(value || 0);
    const sign = number < 0 ? "-" : "";
    return sign + "$" + Math.abs(number).toFixed(2);
  }

  function price(value) {
    const number = Number(value || 0);
    return (number * 100).toFixed(number < 0.1 ? 1 : 0) + "c";
  }

  function percent(value) {
    const number = Number(value || 0);
    return (number * 100).toFixed(1) + "%";
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}());
