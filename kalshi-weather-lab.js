(function () {
  const PROD_KALSHI_WEATHER_API_BASE = "https://nova-arcade-backend-1000121513328.us-central1.run.app";
  const AUTO_AUDIT_ENABLED_KEY = "kalshiWeatherAutoAuditEnabled";
  const AUTO_AUDIT_LIMIT_KEY = "kalshiWeatherAutoAuditLimit";
  const AUTO_AUDIT_MINUTES_KEY = "kalshiWeatherAutoAuditMinutes";
  const PORTFOLIO_BUDGET_KEY = "kalshiWeatherPortfolioBudget";
  const PORTFOLIO_CITY_CAP_KEY = "kalshiWeatherPortfolioCityCap";
  const state = {
    scan: null,
    candidates: [],
    ledger: loadAuditLedger(),
    autoAuditTimer: null,
    dailyPortfolio: null,
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
  const auditSummaryEl = document.querySelector("#audit-summary");
  const ledgerEl = document.querySelector("#ledger");
  const portfolioSummaryEl = document.querySelector("#portfolio-summary");
  const portfolioItemsEl = document.querySelector("#portfolio-items");
  const portfolioBudgetInput = document.querySelector("#portfolio-budget");
  const portfolioCityCapInput = document.querySelector("#portfolio-city-cap");
  const autoAuditEnabledInput = document.querySelector("#auto-audit-enabled");
  const autoAuditLimitInput = document.querySelector("#auto-audit-limit");
  const autoAuditMinutesInput = document.querySelector("#auto-audit-minutes");
  const detailDialog = document.querySelector("#detail-dialog");
  const detailTitle = document.querySelector("#detail-title");
  const detailBody = document.querySelector("#detail-body");

  dateInput.value = tomorrowIsoDate();
  tokenInput.value = localStorage.getItem("kalshiLabToken") || "";
  portfolioBudgetInput.value = localStorage.getItem(PORTFOLIO_BUDGET_KEY) || "25";
  portfolioCityCapInput.value = localStorage.getItem(PORTFOLIO_CITY_CAP_KEY) || "5";
  autoAuditEnabledInput.checked = localStorage.getItem(AUTO_AUDIT_ENABLED_KEY) === "1";
  autoAuditLimitInput.value = localStorage.getItem(AUTO_AUDIT_LIMIT_KEY) || "10";
  autoAuditMinutesInput.value = localStorage.getItem(AUTO_AUDIT_MINUTES_KEY) || "15";

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    localStorage.setItem("kalshiLabToken", tokenInput.value.trim());
    runScan();
  });

  document.querySelector("#clear-ledger").addEventListener("click", function () {
    if (!confirm("Clear the local edge audit on this browser?")) return;
    state.ledger = [];
    saveLedger();
    renderLedger();
  });

  document.querySelector("#audit-add-visible").addEventListener("click", function () {
    addVisibleBuysToAudit();
  });

  document.querySelector("#resolve-audit").addEventListener("click", function () {
    resolveAudit();
  });

  document.querySelector("#portfolio-build").addEventListener("click", function () {
    localStorage.setItem(PORTFOLIO_BUDGET_KEY, String(portfolioBudget()));
    localStorage.setItem(PORTFOLIO_CITY_CAP_KEY, String(portfolioCityCap()));
    renderDailyPortfolio();
    setStatus("Built a strict model-positive basket for " + formatDateWithRelative(portfolioMarketDate()) + ".");
  });

  document.querySelector("#portfolio-audit").addEventListener("click", function () {
    addDailyPortfolioToAudit();
  });

  portfolioBudgetInput.addEventListener("change", function () {
    localStorage.setItem(PORTFOLIO_BUDGET_KEY, String(portfolioBudget()));
    renderDailyPortfolio();
  });

  portfolioCityCapInput.addEventListener("change", function () {
    localStorage.setItem(PORTFOLIO_CITY_CAP_KEY, String(portfolioCityCap()));
    renderDailyPortfolio();
  });

  autoAuditEnabledInput.addEventListener("change", function () {
    localStorage.setItem(AUTO_AUDIT_ENABLED_KEY, autoAuditEnabledInput.checked ? "1" : "0");
    scheduleAutoAudit();
    if (!autoAuditEnabledInput.checked) {
      renderLedger();
      setStatus("Auto audit off.");
      return;
    }
    const added = autoAuditTopCandidates();
    renderLedger();
    resolveAudit({ silent: true });
    setStatus("Auto audit on. Tracking top " + autoAuditLimit() + " buy flags every " + autoAuditMinutes() + " minutes." + (added ? " Added " + added + "." : ""));
  });

  autoAuditLimitInput.addEventListener("change", function () {
    localStorage.setItem(AUTO_AUDIT_LIMIT_KEY, String(autoAuditLimit()));
    renderLedger();
  });

  autoAuditMinutesInput.addEventListener("change", function () {
    localStorage.setItem(AUTO_AUDIT_MINUTES_KEY, String(autoAuditMinutes()));
    scheduleAutoAudit();
    renderLedger();
  });

  document.querySelector("#detail-close").addEventListener("click", function () {
    detailDialog.close();
  });

  renderLedger();
  runScan();
  scheduleAutoAudit();

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
      let autoMessage = "";
      if (autoAuditEnabledInput.checked) {
        const added = autoAuditTopCandidates();
        const resolution = await resolveAudit({ silent: true });
        renderLedger();
        autoMessage = " Auto audit top " + autoAuditLimit() + " on.";
        if (added) autoMessage += " Added " + added + ".";
        if (resolution && resolution.resolvedCount) autoMessage += " Resolved " + resolution.resolvedCount + ".";
      }
      setStatus("Updated " + formatTime(scan.asOf) + ". " + state.candidates.length + " markets shown for " + formatDateWithRelative(scan.date) + "." + autoMessage);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setLoading(false);
    }
  }

  function renderScan() {
    renderSummary();
    renderDailyPortfolio();
    renderCandidates();
    renderContexts();
  }

  function renderSummary() {
    const top = state.candidates[0];
    const buyCount = buyCandidates().length;
    const avgEdge = state.candidates.length
      ? state.candidates.reduce(function (sum, item) { return sum + item.adjustedEdge; }, 0) / state.candidates.length
      : 0;
    const errors = state.scan && state.scan.errors ? state.scan.errors.length : 0;
    const scanDate = state.scan && state.scan.date ? state.scan.date : dateInput.value;
    const buys = buyCandidates();
    const modelEv = buys.reduce(function (sum, item) { return sum + modelEvDollars(item); }, 0);
    const modelCost = buys.reduce(function (sum, item) { return sum + Number(item.suggested.maxCost || 0); }, 0);
    summaryEl.innerHTML = [
      metric("Weather date", relativeDateLabel(scanDate), formatCalendarDate(scanDate)),
      metric("Top edge", top ? pct(top.adjustedEdge) : "n/a", top ? top.location + " " + top.subtitle + " " + top.side.toUpperCase() : "No candidate"),
      metric("Model EV", signedDollars(modelEv), buys.length + " flags, $" + modelCost.toFixed(2) + " model stake"),
      metric("Buy flags", String(buyCount), "Research, small, or tiny"),
      metric("Scan health", errors ? errors + " issue" + (errors === 1 ? "" : "s") : "OK", "Avg edge " + pct(avgEdge) + ", after fees"),
    ].join("");
  }

  function renderDailyPortfolio() {
    state.dailyPortfolio = buildDailyPortfolio();
    const portfolio = state.dailyPortfolio;
    portfolioSummaryEl.innerHTML = [
      portfolioMetric("Basket cost", dollars(portfolio.costDollars), portfolio.items.length + " picks / $" + portfolio.budgetDollars.toFixed(0) + " cap"),
      portfolioMetric("Model EV", signedDollars(portfolio.expectedProfitDollars), "model-only, not guaranteed"),
      portfolioMetric("Avg edge", pct(portfolio.avgEdge), portfolio.excludedCount + " excluded"),
      portfolioMetric("Max loss", dollars(portfolio.maxLossDollars), "if every pick loses"),
      portfolioMetric("Rules", portfolio.rulesLabel, portfolio.dateLabel),
    ].join("");

    if (!portfolio.items.length) {
      portfolioItemsEl.innerHTML = '<tr><td colspan="9" class="subtext">No strict daily portfolio right now. The basket excludes Audit, Pass, Avoid, low-confidence, and thin-edge picks.</td></tr>';
      return;
    }

    portfolioItemsEl.innerHTML = portfolio.items.map(function (pick, index) {
      const item = pick.item;
      return [
        "<tr>",
        '<td><div class="market-name"><strong>' + escapeHtml(item.location) + " " + escapeHtml(item.subtitle) + "</strong>" + renderDateBadge(portfolio.marketDate) + "<span>" + escapeHtml(item.ticker) + "</span>" + renderRiskFlags(item) + "</div></td>",
        '<td><span class="side ' + (item.side === "yes" ? "yes" : "no") + '">' + item.side.toUpperCase() + "</span></td>",
        "<td>" + item.price.askCents + 'c<br><span class="subtext">bid ' + item.price.bidCents + "c</span></td>",
        "<td>" + pct(item.probability) + "</td>",
        '<td class="' + (item.adjustedEdge >= 0 ? "pos" : "neg") + '">' + pct(item.adjustedEdge) + "</td>",
        "<td>" + pick.contracts + "</td>",
        "<td>" + dollars(pick.costDollars) + "</td>",
        '<td class="' + (pick.expectedProfitDollars >= 0 ? "pos" : "neg") + '">' + signedDollars(pick.expectedProfitDollars) + "</td>",
        '<td><div class="actions"><button type="button" data-portfolio-detail="' + index + '">View</button><button type="button" data-portfolio-open="' + index + '">Kalshi</button><button type="button" data-portfolio-audit="' + index + '">Audit</button></div></td>',
        "</tr>",
      ].join("");
    }).join("");

    portfolioItemsEl.querySelectorAll("[data-portfolio-detail]").forEach(function (button) {
      button.addEventListener("click", function () { showDetail(state.dailyPortfolio.items[Number(button.dataset.portfolioDetail)].item); });
    });
    portfolioItemsEl.querySelectorAll("[data-portfolio-open]").forEach(function (button) {
      button.addEventListener("click", function () { window.open(state.dailyPortfolio.items[Number(button.dataset.portfolioOpen)].item.url, "_blank", "noopener"); });
    });
    portfolioItemsEl.querySelectorAll("[data-portfolio-audit]").forEach(function (button) {
      button.addEventListener("click", function () { addPortfolioPickToAudit(state.dailyPortfolio.items[Number(button.dataset.portfolioAudit)]); });
    });
  }

  function buildDailyPortfolio() {
    const budget = portfolioBudget();
    const cityCap = Math.min(portfolioCityCap(), budget);
    const marketDate = portfolioMarketDate();
    const selected = [];
    const usedLocations = {};
    let spent = 0;
    let excludedCount = 0;

    const strictCandidates = state.candidates
      .filter(function (item) {
        if (!isStrictPortfolioCandidate(item)) {
          excludedCount += 1;
          return false;
        }
        return true;
      })
      .sort(portfolioCandidateSort);

    strictCandidates.forEach(function (item) {
      if (selected.length >= 10) return;
      if (usedLocations[item.location]) return;
      const remainingBudget = budget - spent;
      if (remainingBudget < 0.25) return;
      const maxCost = Math.min(remainingBudget, cityCap);
      const pick = sizePortfolioPick(item, maxCost);
      if (!pick || pick.expectedProfitDollars <= 0) return;
      selected.push(pick);
      usedLocations[item.location] = true;
      spent += pick.costDollars;
    });

    const expectedProfit = selected.reduce(function (sum, pick) { return sum + pick.expectedProfitDollars; }, 0);
    const avgEdge = selected.length ? selected.reduce(function (sum, pick) { return sum + Number(pick.item.adjustedEdge || 0); }, 0) / selected.length : 0;
    return {
      marketDate: marketDate,
      dateLabel: formatDateWithRelative(marketDate),
      budgetDollars: budget,
      cityCapDollars: cityCap,
      costDollars: roundMoney(spent),
      maxLossDollars: roundMoney(spent),
      expectedProfitDollars: roundMoney(expectedProfit),
      avgEdge: avgEdge,
      excludedCount: excludedCount,
      rulesLabel: "strict, 1/city",
      items: selected,
    };
  }

  function isStrictPortfolioCandidate(item) {
    if (!item || item.recommendation === "audit-only") return false;
    if (item.recommendation !== "research-buy" && item.recommendation !== "small-buy") return false;
    if (item.confidence === "low") return false;
    if (Number(item.adjustedEdge || 0) < 0.08) return false;
    if (Number(item.probability || 0) < 0.08) return false;
    const flags = (item.riskFlags || []).join(" ").toLowerCase();
    if (flags.indexOf("station observation unavailable") >= 0) return false;
    return true;
  }

  function portfolioCandidateSort(left, right) {
    const rank = { "research-buy": 2, "small-buy": 1 };
    const rankDiff = (rank[right.recommendation] || 0) - (rank[left.recommendation] || 0);
    if (rankDiff) return rankDiff;
    const evDiff = modelEvDollars(right) - modelEvDollars(left);
    if (Math.abs(evDiff) > 0.001) return evDiff;
    return Number(right.adjustedEdge || 0) - Number(left.adjustedEdge || 0);
  }

  function sizePortfolioPick(item, maxCost) {
    const ask = Number(item.price && item.price.ask || 0);
    if (!Number.isFinite(ask) || ask <= 0 || ask >= 1) return null;
    const maxSize = Math.max(1, Math.floor(Number(item.price.askSize || 25)));
    const upperContracts = Math.min(25, maxSize, Math.floor(maxCost / ask) + 1);
    for (let contracts = upperContracts; contracts >= 1; contracts -= 1) {
      const fee = kalshiFeeDollars(contracts, ask);
      const cost = contracts * ask + fee;
      if (cost > maxCost + 0.00001) continue;
      const expectedProfit = contracts * Number(item.probability || 0) - cost;
      return {
        item: item,
        contracts: contracts,
        priceCents: item.price.askCents,
        costDollars: roundMoney(cost),
        feeDollars: roundMoney(fee),
        expectedProfitDollars: roundMoney(expectedProfit),
        payoutIfRightDollars: contracts,
      };
    }
    return null;
  }

  function addDailyPortfolioToAudit() {
    const portfolio = state.dailyPortfolio || buildDailyPortfolio();
    if (!portfolio.items.length) {
      setStatus("No daily portfolio picks to audit.", true);
      return;
    }
    let added = 0;
    portfolio.items.forEach(function (pick) {
      if (addPortfolioPickToAudit(pick, true)) added += 1;
    });
    renderLedger();
    setStatus(added ? "Added " + added + " daily portfolio picks to the edge audit." : "Daily portfolio picks are already in the edge audit.");
  }

  function addPortfolioPickToAudit(pick, silent) {
    const item = pick && pick.item;
    if (!item) return false;
    const exists = state.ledger.some(function (entry) {
      return entry.ticker === item.ticker && entry.side === item.side && entry.marketDate === portfolioMarketDate();
    });
    if (exists) {
      if (!silent) setStatus("That portfolio pick is already in the edge audit.");
      return false;
    }
    state.ledger.unshift(buildAuditEntry(
      item,
      Number(pick.contracts || 1),
      Number(pick.priceCents || item.price.askCents || 1),
      "Daily portfolio; " + item.recommendation + "; " + item.location + " " + item.subtitle
    ));
    saveLedger();
    if (!silent) {
      renderLedger();
      setStatus("Added portfolio pick to the edge audit.");
    }
    return true;
  }

  function renderCandidates() {
    countEl.textContent = state.candidates.length + " candidates";
    if (!state.candidates.length) {
      candidatesEl.innerHTML = '<tr><td colspan="12" class="subtext">No markets cleared the current filters.</td></tr>';
      return;
    }

    const scanDate = state.scan && state.scan.date ? state.scan.date : dateInput.value;
    candidatesEl.innerHTML = state.candidates.map(function (item, index) {
      return [
        "<tr>",
        '<td><span class="pill ' + actionClass(item.recommendation) + '">' + escapeHtml(actionLabel(item.recommendation)) + "</span></td>",
        '<td><div class="market-name"><strong>' + escapeHtml(item.location) + " " + escapeHtml(item.subtitle) + "</strong>" + renderDateBadge(scanDate) + "<span>" + escapeHtml(item.ticker) + "</span>" + renderRiskFlags(item) + "</div></td>",
        '<td><span class="side ' + (item.side === "yes" ? "yes" : "no") + '">' + item.side.toUpperCase() + "</span></td>",
        "<td>" + item.price.askCents + 'c<br><span class="subtext">bid ' + item.price.bidCents + "c</span></td>",
        "<td>" + pct(item.probability) + "</td>",
        "<td>" + pct(item.rawProbability) + '<br><span class="subtext">tight ' + pct(item.tightProbability) + "</span></td>",
        "<td>" + pct(item.breakEven) + "</td>",
        '<td class="' + (item.adjustedEdge >= 0 ? "pos" : "neg") + '">' + pct(item.adjustedEdge) + "</td>",
        '<td class="' + (modelEvDollars(item) >= 0 ? "pos" : "neg") + '">' + signedDollars(modelEvDollars(item)) + "</td>",
        '<td><span class="confidence">' + escapeHtml(item.confidence) + "</span></td>",
        "<td>" + item.suggested.contracts + " @ " + item.suggested.maxPriceCents + 'c<br><span class="subtext">$' + Number(item.suggested.maxCost).toFixed(2) + "</span></td>",
        '<td><div class="actions"><button type="button" data-detail="' + index + '">View</button><button type="button" data-open="' + index + '">Kalshi</button><button type="button" data-log="' + index + '">Audit</button></div></td>',
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
    const scanDate = state.scan && state.scan.date ? state.scan.date : dateInput.value;
    if (!contexts.length) {
      contextsEl.innerHTML = '<div class="context-item"><span class="subtext">No forecast context loaded.</span></div>';
      return;
    }

    contextsEl.innerHTML = contexts.map(function (context) {
      const observations = context.observations || {};
      return [
        '<div class="context-item">',
        "<h3>" + escapeHtml(context.location.label) + " " + renderDateBadge(scanDate) + "</h3>",
        '<div class="context-row">',
        "<span>mean " + formatNumber(context.forecast.meanHigh, 1) + "F</span>",
        "<span>hourly " + valueOrNa(context.forecast.hourlyMax) + "F</span>",
        "<span>remaining " + valueOrNa(context.forecast.remainingHourlyMax) + "F</span>",
        "<span>daily " + valueOrNa(context.forecast.dailyHigh) + "F</span>",
        "<span>" + escapeHtml(observations.stationId || "station") + " high " + valueOrNa(observations.observedHighF) + "F</span>",
        "<span>latest " + valueOrNa(observations.latestTempF) + "F</span>",
        "<span>" + escapeHtml(observations.dayPhase || "future") + "</span>",
        "<span>PoP " + valueOrNa(context.regime.maxPrecipProbability) + "%</span>",
        "<span>wind " + escapeHtml((context.regime.peakWindDirections || []).join("/") || "n/a") + "</span>",
        "</div>",
        observations.note ? '<p class="subtext">' + escapeHtml(observations.note) + "</p>" : "",
        '<p class="subtext">' + escapeHtml(context.forecast.detailedForecast || context.forecast.shortForecast || "") + "</p>",
        "</div>",
      ].join("");
    }).join("");
  }

  function renderLedger() {
    renderAuditSummary();
    if (!state.ledger.length) {
      ledgerEl.innerHTML = '<div class="ledger-item"><span class="subtext">No edge audit entries yet.</span></div>';
      return;
    }

    ledgerEl.innerHTML = state.ledger.slice(0, 50).map(function (entry) {
      const resolved = entry.status === "resolved";
      const profitClass = Number(entry.profitDollars || 0) >= 0 ? "pos" : "neg";
      return [
        '<div class="ledger-item">',
        "<h3>" + escapeHtml(entry.ticker) + ' <span class="' + (entry.side === "yes" ? "yes" : "no") + '">' + entry.side.toUpperCase() + "</span></h3>",
        renderDateBadge(entry.marketDate),
        '<div class="context-row">',
        "<span>" + entry.contracts + " contracts</span>",
        "<span>" + entry.priceCents + "c</span>",
        "<span>p " + pct(entry.modelProbability) + "</span>",
        "<span>edge " + pct(entry.adjustedEdge) + "</span>",
        "<span>EV " + signedDollars(entry.expectedProfitDollars || 0) + "</span>",
        entry.latestPrice != null ? "<span>mark " + escapeHtml(entry.latestPrice) + "c</span>" : "",
        resolved ? '<span class="' + profitClass + '">result ' + escapeHtml(entry.outcome || "") + " / " + signedDollars(entry.profitDollars || 0) + "</span>" : "<span>open</span>",
        entry.latestCheckedAt ? "<span>checked " + formatTime(entry.latestCheckedAt) + "</span>" : "<span>logged " + formatTime(entry.createdAt) + "</span>",
        "</div>",
        entry.notes ? '<p class="subtext">' + escapeHtml(entry.notes) + "</p>" : "",
        "</div>",
      ].join("");
    }).join("");
  }

  function showDetail(item) {
    const scanDate = state.scan && state.scan.date ? state.scan.date : dateInput.value;
    const observations = item.context && item.context.observations ? item.context.observations : {};
    const settlement = item.context && item.context.settlement ? item.context.settlement : {};
    detailTitle.textContent = item.location + " " + item.subtitle + " " + item.side.toUpperCase() + " - " + formatDateWithRelative(scanDate);
    detailBody.innerHTML = [
      '<div class="detail-block"><h3>Decision</h3><p>Weather date: <strong>' + escapeHtml(formatDateWithRelative(scanDate)) + "</strong>. " + escapeHtml(item.recommendation) + " at " + item.price.askCents + "c ask. Adjusted edge " + pct(item.adjustedEdge) + ". Confidence " + escapeHtml(item.confidence) + '.</p><div class="actions"><button type="button" id="detail-open">Open Kalshi</button><button type="button" id="detail-log">Audit</button></div></div>',
      '<div class="detail-block"><h3>Probability Stack</h3><p>Adjusted ' + pct(item.probability) + ". Raw sigma=3 " + pct(item.rawProbability) + ". Tight sigma=2 " + pct(item.tightProbability) + ". Wide sigma=4 " + pct(item.wideProbability) + ". Break-even " + pct(item.breakEven) + ".</p></div>",
      '<div class="detail-block"><h3>Model EV</h3><p>Suggested size ' + item.suggested.contracts + " contracts at " + item.suggested.maxPriceCents + "c. Model expected profit " + signedDollars(modelEvDollars(item)) + " before any later price movement.</p></div>",
      '<div class="detail-block"><h3>Forecast And Observations</h3><p>Mean ' + formatNumber(item.context.meanHigh, 1) + "F, hourly max " + valueOrNa(item.context.hourlyMax) + "F, remaining hourly max " + valueOrNa(item.context.remainingHourlyMax) + "F, daily high " + valueOrNa(item.context.dailyHigh) + "F. " + escapeHtml(observations.stationId || "Station") + " high so far " + valueOrNa(observations.observedHighF) + "F, latest " + valueOrNa(observations.latestTempF) + "F. " + escapeHtml(item.context.detailedForecast || item.context.shortForecast || "") + "</p></div>",
      '<div class="detail-block"><h3>Settlement Proxy</h3><p>' + escapeHtml((settlement.stationId || observations.stationId || "Mapped station") + ": " + (settlement.stationHint || "") + ". " + (settlement.sourceNote || observations.note || "")) + "</p></div>",
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
    state.ledger.unshift(buildAuditEntry(item, contracts, priceCents, notes));
    saveLedger();
    renderLedger();
  }

  function buildAuditEntry(item, contracts, priceCents, notes) {
    const price = priceCents / 100;
    const fee = kalshiFeeDollars(contracts, price);
    const cost = contracts * price + fee;
    const probability = Number(item.probability || 0);
    return {
      id: item.ticker + "-" + item.side + "-" + Date.now(),
      createdAt: new Date().toISOString(),
      autoAudit: String(notes || "").indexOf("Auto-audit") === 0,
      ticker: item.ticker,
      eventTicker: item.eventTicker,
      marketDate: auditMarketDate(),
      location: item.location,
      subtitle: item.subtitle,
      side: item.side,
      contracts: contracts,
      priceCents: priceCents,
      feeDollars: roundMoney(fee),
      costDollars: roundMoney(cost),
      modelProbability: item.probability,
      breakEven: round(cost / contracts, 4),
      adjustedEdge: item.adjustedEdge,
      expectedProfitDollars: roundMoney(contracts * probability - cost),
      recommendation: item.recommendation,
      confidence: item.confidence,
      url: item.url,
      status: "open",
      notes: notes,
    };
  }

  function addVisibleBuysToAudit() {
    const candidates = buyCandidates();
    if (!candidates.length) {
      setStatus("No buy-flag candidates to add.", true);
      return;
    }

    const added = addCandidatesToAudit(candidates, "Manual audit");
    setStatus(added ? "Added " + added + " candidates to the edge audit." : "Those buy flags are already in the edge audit.");
  }

  function autoAuditTopCandidates() {
    if (!state.candidates.length) return 0;
    return addCandidatesToAudit(buyCandidates().slice(0, autoAuditLimit()), "Auto-audit");
  }

  function addCandidatesToAudit(candidates, notePrefix) {
    let added = 0;
    candidates.forEach(function (item) {
      const exists = state.ledger.some(function (entry) {
        return entry.ticker === item.ticker && entry.side === item.side && entry.marketDate === auditMarketDate();
      });
      if (exists) return;
      state.ledger.unshift(buildAuditEntry(
        item,
        Number(item.suggested.contracts || 1),
        Number(item.suggested.maxPriceCents || item.price.askCents || 1),
        notePrefix + " " + item.recommendation + "; " + item.location + " " + item.subtitle
      ));
      added += 1;
    });
    if (added) {
      saveLedger();
      renderLedger();
    }
    return added;
  }

  async function resolveAudit(options) {
    const silent = Boolean(options && options.silent);
    const openEntries = state.ledger.filter(function (entry) {
      return entry.status !== "resolved";
    });
    if (!openEntries.length) {
      if (!silent) setStatus("No open audit entries to resolve.");
      return { resolvedCount: 0, checkedCount: 0 };
    }

    if (!silent) setStatus("Checking Kalshi settlements...");
    try {
      const tickers = openEntries.map(function (entry) { return entry.ticker; }).join(",");
      const data = await fetchJson(kalshiWeatherEndpoint("/api/kalshi/weather/resolve?tickers=" + encodeURIComponent(tickers)));
      const byTicker = {};
      (data.markets || []).forEach(function (market) {
        byTicker[market.ticker] = market;
      });
      let resolvedCount = 0;
      state.ledger = state.ledger.map(function (entry) {
        if (entry.status === "resolved") return entry;
        const market = byTicker[entry.ticker];
        if (!market) return entry;
        const result = normalizeMarketResult(market.result);
        const next = Object.assign({}, entry, {
          latestStatus: market.status || "",
          latestCheckedAt: data.asOf || new Date().toISOString(),
          latestPrice: sideMarkPrice(market, entry.side),
        });
        if (!result) return next;

        const won = result === entry.side;
        resolvedCount += 1;
        return Object.assign(next, {
          status: "resolved",
          outcome: result,
          won: won,
          payoutDollars: won ? Number(entry.contracts || 0) : 0,
          profitDollars: roundMoney((won ? Number(entry.contracts || 0) : 0) - Number(entry.costDollars || 0)),
          resolvedAt: data.asOf || new Date().toISOString(),
        });
      });
      saveLedger();
      renderLedger();
      if (!silent || resolvedCount) setStatus("Resolved " + resolvedCount + " audit entries.");
      return { resolvedCount: resolvedCount, checkedCount: openEntries.length };
    } catch (error) {
      if (!silent) setStatus(error.message, true);
      return { resolvedCount: 0, checkedCount: openEntries.length, error: error.message };
    }
  }

  function renderAuditSummary() {
    if (!state.ledger.length) {
      auditSummaryEl.innerHTML = "";
      return;
    }

    const resolved = state.ledger.filter(function (entry) { return entry.status === "resolved"; });
    const open = state.ledger.length - resolved.length;
    const expectedProfit = state.ledger.reduce(function (sum, entry) { return sum + Number(entry.expectedProfitDollars || 0); }, 0);
    const totalCost = state.ledger.reduce(function (sum, entry) { return sum + Number(entry.costDollars || 0); }, 0);
    const realizedProfit = resolved.reduce(function (sum, entry) { return sum + Number(entry.profitDollars || 0); }, 0);
    const avgModelP = resolved.length ? resolved.reduce(function (sum, entry) { return sum + Number(entry.modelProbability || 0); }, 0) / resolved.length : null;
    const hitRate = resolved.length ? resolved.filter(function (entry) { return entry.won; }).length / resolved.length : null;
    const autoCount = state.ledger.filter(function (entry) { return entry.autoAudit; }).length;
    const latestCheck = latestAuditCheckTime();
    auditSummaryEl.innerHTML = [
      auditMetric("Entries", state.ledger.length, open + " open, " + autoCount + " auto"),
      auditMetric("Expected", signedDollars(expectedProfit), "$" + totalCost.toFixed(2) + " tracked"),
      auditMetric("Realized", signedDollars(realizedProfit), resolved.length + " resolved"),
      auditMetric("Calibration", resolved.length ? pct(hitRate) : "n/a", resolved.length ? "avg p " + pct(avgModelP) : "need settlements"),
      auditMetric("Checked", latestCheck ? formatTime(latestCheck) : "not yet", autoAuditEnabledInput.checked ? "auto on: top " + autoAuditLimit() + " / " + autoAuditMinutes() + "m" : "auto off"),
    ].join("");
  }

  function latestAuditCheckTime() {
    let latest = 0;
    state.ledger.forEach(function (entry) {
      const value = entry.latestCheckedAt || entry.resolvedAt || entry.createdAt;
      const time = new Date(value).getTime();
      if (Number.isFinite(time) && time > latest) latest = time;
    });
    return latest ? new Date(latest).toISOString() : "";
  }

  function scheduleAutoAudit() {
    if (state.autoAuditTimer) {
      clearInterval(state.autoAuditTimer);
      state.autoAuditTimer = null;
    }
    if (!autoAuditEnabledInput.checked) return;
    state.autoAuditTimer = setInterval(function () {
      runScan();
    }, autoAuditMinutes() * 60 * 1000);
  }

  function autoAuditLimit() {
    const limit = clampInteger(autoAuditLimitInput.value, 1, 50, 10);
    autoAuditLimitInput.value = String(limit);
    localStorage.setItem(AUTO_AUDIT_LIMIT_KEY, String(limit));
    return limit;
  }

  function autoAuditMinutes() {
    const minutes = clampInteger(autoAuditMinutesInput.value, 3, 120, 15);
    autoAuditMinutesInput.value = String(minutes);
    localStorage.setItem(AUTO_AUDIT_MINUTES_KEY, String(minutes));
    return minutes;
  }

  function auditMarketDate() {
    return state.scan && state.scan.date ? state.scan.date : dateInput.value;
  }

  function portfolioMarketDate() {
    return state.scan && state.scan.date ? state.scan.date : dateInput.value;
  }

  function portfolioBudget() {
    const budget = clampInteger(portfolioBudgetInput.value, 1, 250, 25);
    portfolioBudgetInput.value = String(budget);
    localStorage.setItem(PORTFOLIO_BUDGET_KEY, String(budget));
    return budget;
  }

  function portfolioCityCap() {
    const cityCap = clampInteger(portfolioCityCapInput.value, 1, 50, 5);
    portfolioCityCapInput.value = String(cityCap);
    localStorage.setItem(PORTFOLIO_CITY_CAP_KEY, String(cityCap));
    return cityCap;
  }

  function saveLedger() {
    localStorage.setItem("kalshiWeatherEdgeAudit", JSON.stringify(state.ledger));
  }

  function loadAuditLedger() {
    try {
      return JSON.parse(localStorage.getItem("kalshiWeatherEdgeAudit") || "[]");
    } catch (error) {
      return [];
    }
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

  function auditMetric(label, value, subtext) {
    return '<div class="audit-metric"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong><small>" + escapeHtml(subtext) + "</small></div>";
  }

  function portfolioMetric(label, value, subtext) {
    return '<div class="portfolio-metric"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong><small>" + escapeHtml(subtext) + "</small></div>";
  }

  function buyCandidates() {
    return state.candidates.filter(function (item) {
      return item.recommendation === "research-buy" || item.recommendation === "small-buy" || item.recommendation === "tiny-only";
    });
  }

  function modelEvDollars(item) {
    return Number(item.suggested && item.suggested.modelEv != null ? item.suggested.modelEv : Number(item.suggested.contracts || 0) * Number(item.adjustedEdge || 0));
  }

  function kalshiFeeDollars(contracts, priceDollars) {
    return Math.ceil(0.07 * contracts * priceDollars * (1 - priceDollars) * 100) / 100;
  }

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(Number(value || 0) * factor) / factor;
  }

  function roundMoney(value) {
    return round(value, 2);
  }

  function clampInteger(value, min, max, fallback) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function signedDollars(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : number < 0 ? "-" : "";
    return sign + "$" + Math.abs(number).toFixed(2);
  }

  function dollars(value) {
    return "$" + Math.abs(Number(value || 0)).toFixed(2);
  }

  function normalizeMarketResult(result) {
    const text = String(result || "").toLowerCase();
    if (text === "yes" || text === "y" || text === "true" || text === "1") return "yes";
    if (text === "no" || text === "n" || text === "false" || text === "0") return "no";
    return "";
  }

  function sideMarkPrice(market, side) {
    if (side === "yes") return Number(market.yesBid || market.lastPrice || 0);
    return Number(market.noBid || 0);
  }

  function renderDateBadge(dateText) {
    return '<span class="date-badge ' + dateClass(dateText) + '"><strong>' + escapeHtml(relativeDateLabel(dateText)) + '</strong><small>' + escapeHtml(formatCalendarDate(dateText)) + "</small></span>";
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
    if (action === "audit-only") return "audit";
    if (action === "avoid-or-sell") return "avoid";
    return "pass";
  }

  function actionLabel(action) {
    return {
      "research-buy": "Research",
      "small-buy": "Small",
      "tiny-only": "Tiny",
      "audit-only": "Audit",
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

  function parseLocalDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function dayOffset(dateText) {
    const target = parseLocalDate(dateText);
    if (!target) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }

  function relativeDateLabel(dateText) {
    const offset = dayOffset(dateText);
    if (offset === null) return "Date unknown";
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    if (offset === -1) return "Yesterday";
    if (offset > 1 && offset <= 7) return "In " + offset + " days";
    if (offset < -1) return Math.abs(offset) + " days ago";
    return "Future date";
  }

  function dateClass(dateText) {
    const offset = dayOffset(dateText);
    if (offset === 1) return "tomorrow";
    if (offset === 0) return "today";
    if (offset !== null && offset < 0) return "past";
    return "future";
  }

  function formatCalendarDate(dateText) {
    const date = parseLocalDate(dateText);
    if (!date) return String(dateText || "n/a");
    return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  }

  function formatDateWithRelative(dateText) {
    return formatCalendarDate(dateText) + " (" + relativeDateLabel(dateText) + ")";
  }

  function tomorrowIsoDate() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return localIsoDate(date);
  }

  function localIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
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
