(function () {
  const PROD_KALSHI_WEATHER_API_BASE = "https://nova-arcade-backend-1000121513328.us-central1.run.app";
  const AUTO_AUDIT_ENABLED_KEY = "kalshiWeatherAutoAuditEnabled";
  const AUTO_AUDIT_LIMIT_KEY = "kalshiWeatherAutoAuditLimit";
  const AUTO_AUDIT_MINUTES_KEY = "kalshiWeatherAutoAuditMinutes";
  const PORTFOLIO_BUDGET_KEY = "kalshiWeatherPortfolioBudget";
  const PORTFOLIO_CITY_CAP_KEY = "kalshiWeatherPortfolioCityCap";
  const PORTFOLIO_BANKROLL_KEY = "kalshiWeatherPortfolioBankroll";
  const PORTFOLIO_KELLY_PERCENT_KEY = "kalshiWeatherPortfolioKellyPercent";
  const state = {
    scan: null,
    candidates: [],
    ledger: loadAuditLedger(),
    autoAuditTimer: null,
    dailyPortfolio: null,
    chartPayloads: {},
    nextChartId: 0,
    chartLiveTimers: {},
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
  const candidateTitleEl = document.querySelector("#candidate-title");
  const candidatesEl = document.querySelector("#candidates");
  const contextsEl = document.querySelector("#contexts");
  const auditSummaryEl = document.querySelector("#audit-summary");
  const ledgerEl = document.querySelector("#ledger");
  const portfolioSummaryEl = document.querySelector("#portfolio-summary");
  const portfolioItemsEl = document.querySelector("#portfolio-items");
  const portfolioBankrollInput = document.querySelector("#portfolio-bankroll");
  const portfolioKellyPercentInput = document.querySelector("#portfolio-kelly-percent");
  const portfolioBudgetInput = document.querySelector("#portfolio-budget");
  const portfolioCityCapInput = document.querySelector("#portfolio-city-cap");
  const autoAuditEnabledInput = document.querySelector("#auto-audit-enabled");
  const autoAuditLimitInput = document.querySelector("#auto-audit-limit");
  const autoAuditMinutesInput = document.querySelector("#auto-audit-minutes");
  const detailDialog = document.querySelector("#detail-dialog");
  const detailTitle = document.querySelector("#detail-title");
  const detailBody = document.querySelector("#detail-body");

  function openKalshiWindow(url) {
    if (!url) return false;
    const opened = window.open(
      url,
      "kalshiMarket-" + Date.now(),
      "popup=yes,width=1280,height=900,left=80,top=40,resizable=yes,scrollbars=yes"
    );
    if (!opened) return false;
    opened.opener = null;
    opened.focus();
    return true;
  }

  dateInput.value = tomorrowIsoDate();
  tokenInput.value = localStorage.getItem("kalshiLabToken") || "";
  portfolioBankrollInput.value = localStorage.getItem(PORTFOLIO_BANKROLL_KEY) || "1000";
  portfolioKellyPercentInput.value = localStorage.getItem(PORTFOLIO_KELLY_PERCENT_KEY) || "25";
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
    localStorage.setItem(PORTFOLIO_BANKROLL_KEY, String(portfolioBankroll()));
    localStorage.setItem(PORTFOLIO_KELLY_PERCENT_KEY, String(portfolioKellyPercent()));
    localStorage.setItem(PORTFOLIO_BUDGET_KEY, String(portfolioBudget()));
    localStorage.setItem(PORTFOLIO_CITY_CAP_KEY, String(portfolioCityCap()));
    renderDailyPortfolio();
    setStatus("Built a strict model-positive basket for " + formatDateWithRelative(portfolioMarketDate()) + ".");
  });

  document.querySelector("#portfolio-audit").addEventListener("click", function () {
    addDailyPortfolioToAudit();
  });

  portfolioBankrollInput.addEventListener("change", function () {
    localStorage.setItem(PORTFOLIO_BANKROLL_KEY, String(portfolioBankroll()));
    renderDailyPortfolio();
    renderCandidates();
  });

  portfolioKellyPercentInput.addEventListener("change", function () {
    localStorage.setItem(PORTFOLIO_KELLY_PERCENT_KEY, String(portfolioKellyPercent()));
    renderDailyPortfolio();
    renderCandidates();
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

  detailDialog.addEventListener("close", function () {
    stopLiveObservationStreams();
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
      setStatus("Updated " + formatTime(scan.asOf) + ". " + state.candidates.length + " " + (isAllScoredMode() ? "markets" : "picks") + " shown for " + formatDateWithRelative(scan.date) + "." + autoMessage);
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
      metric("Calibration", "Market-shrunk", "Avg edge " + pct(avgEdge) + ", after fees"),
      metric("Scan health", errors ? errors + " issue" + (errors === 1 ? "" : "s") : "OK", "NWS + Kalshi prior"),
    ].join("");
  }

  function renderDailyPortfolio() {
    state.dailyPortfolio = buildDailyPortfolio();
    const portfolio = state.dailyPortfolio;
    portfolioSummaryEl.innerHTML = [
      portfolioMetric("Basket cost", dollars(portfolio.costDollars), portfolio.items.length + " picks / $" + portfolio.budgetDollars.toFixed(0) + " cap"),
      portfolioMetric("Model EV", signedDollars(portfolio.expectedProfitDollars), "model-only, not guaranteed"),
      portfolioMetric("Avg edge", pct(portfolio.avgEdge), portfolio.excludedCount + " excluded"),
      portfolioMetric("Kelly risk", pct(portfolio.bankrollRisk), portfolio.kellyPercent + "% Kelly on " + dollars(portfolio.bankrollDollars)),
      portfolioMetric("Max loss", dollars(portfolio.maxLossDollars), "max " + dollars(portfolio.cityCapDollars) + " per city"),
      portfolioMetric("Rules", portfolio.rulesLabel, portfolio.dateLabel),
    ].join("");

    if (!portfolio.items.length) {
      portfolioItemsEl.innerHTML = '<tr><td colspan="10" class="subtext">No strict daily portfolio right now. The basket excludes Audit, Pass, Avoid, low-confidence, thin-edge picks, and bets above fractional Kelly size.</td></tr>';
      return;
    }

    portfolioItemsEl.innerHTML = portfolio.items.map(function (pick, index) {
      const item = pick.item;
      return [
        "<tr>",
        '<td><div class="market-name"><strong>' + escapeHtml(item.location) + " " + escapeHtml(item.subtitle) + "</strong>" + renderDateBadge(portfolio.marketDate) + "<span>" + escapeHtml(item.ticker) + "</span>" + renderRiskFlags(item) + "</div></td>",
        '<td><span class="side ' + (item.side === "yes" ? "yes" : "no") + '">' + item.side.toUpperCase() + "</span></td>",
        "<td>" + item.price.askCents + 'c<br><span class="subtext">bid ' + item.price.bidCents + "c</span></td>",
        "<td>" + renderOddsComparisonCell(item, pick) + "</td>",
        '<td class="' + (Number(pick.modelEdge || item.adjustedEdge || 0) >= 0 ? "pos" : "neg") + '">' + pct(Number(pick.modelEdge || item.adjustedEdge || 0)) + "</td>",
        "<td>" + pct(pick.fullKelly) + '<br><span class="subtext">' + pct(pick.fractionalKelly) + " / " + dollars(pick.kellyTargetDollars) + "</span></td>",
        "<td>" + pick.contracts + "</td>",
        "<td>" + dollars(pick.costDollars) + "</td>",
        '<td class="' + (pick.expectedProfitDollars >= 0 ? "pos" : "neg") + '">' + signedDollars(pick.expectedProfitDollars) + "</td>",
        '<td><div class="actions"><button type="button" data-portfolio-detail="' + index + '">View</button><button type="button" data-portfolio-chart="' + index + '">Chart</button><button type="button" data-portfolio-open="' + index + '">Kalshi</button><button type="button" data-portfolio-audit="' + index + '">Audit</button></div></td>',
        "</tr>",
      ].join("");
    }).join("");

    portfolioItemsEl.querySelectorAll("[data-portfolio-detail]").forEach(function (button) {
      button.addEventListener("click", function () {
        const pick = state.dailyPortfolio.items[Number(button.dataset.portfolioDetail)];
        showDetail(pick.item, pick);
      });
    });
    portfolioItemsEl.querySelectorAll("[data-portfolio-chart]").forEach(function (button) {
      button.addEventListener("click", function () { showTemperatureDetail(state.dailyPortfolio.items[Number(button.dataset.portfolioChart)].item); });
    });
    portfolioItemsEl.querySelectorAll("[data-portfolio-open]").forEach(function (button) {
      button.addEventListener("click", function () {
        const pick = state.dailyPortfolio.items[Number(button.dataset.portfolioOpen)];
        const url = pick && pick.item && pick.item.url;
        if (!openKalshiWindow(url) && url) window.open(url, "_blank", "noopener");
      });
    });
    portfolioItemsEl.querySelectorAll("[data-portfolio-audit]").forEach(function (button) {
      button.addEventListener("click", function () { addPortfolioPickToAudit(state.dailyPortfolio.items[Number(button.dataset.portfolioAudit)]); });
    });
  }

  function buildDailyPortfolio() {
    const budget = portfolioBudget();
    const cityCap = Math.min(portfolioCityCap(), budget);
    const kellySettings = currentKellySettings();
    const marketDate = portfolioMarketDate();
    const selected = [];
    const spentByLocation = {};
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
      const remainingBudget = budget - spent;
      if (remainingBudget < 0.25) return;
      const locationSpent = Number(spentByLocation[item.location] || 0);
      const remainingCityBudget = cityCap - locationSpent;
      if (remainingCityBudget < 0.25) return;
      const maxCost = Math.min(remainingBudget, remainingCityBudget);
      const pick = sizePortfolioPick(item, maxCost, kellySettings);
      if (!pick || pick.expectedProfitDollars <= 0) return;
      selected.push(pick);
      spent += pick.costDollars;
      spentByLocation[item.location] = locationSpent + pick.costDollars;
    });

    const expectedProfit = selected.reduce(function (sum, pick) { return sum + pick.expectedProfitDollars; }, 0);
    const avgEdge = selected.length ? selected.reduce(function (sum, pick) { return sum + Number(pick.item.adjustedEdge || 0); }, 0) / selected.length : 0;
    return {
      marketDate: marketDate,
      dateLabel: formatDateWithRelative(marketDate),
      budgetDollars: budget,
      cityCapDollars: cityCap,
      bankrollDollars: kellySettings.bankroll,
      kellyPercent: kellySettings.kellyPercent,
      kellyFraction: kellySettings.kellyFraction,
      bankrollRisk: kellySettings.bankroll > 0 ? spent / kellySettings.bankroll : 0,
      costDollars: roundMoney(spent),
      maxLossDollars: roundMoney(spent),
      expectedProfitDollars: roundMoney(expectedProfit),
      avgEdge: avgEdge,
      excludedCount: excludedCount,
      rulesLabel: "strict, Kelly, city cap",
      items: selected,
    };
  }

  function isStrictPortfolioCandidate(item) {
    if (!item || item.recommendation === "audit-only") return false;
    if (item.recommendation !== "research-buy" && item.recommendation !== "small-buy" && item.recommendation !== "tiny-only") return false;
    if (item.confidence === "low") return false;
    if (Number(item.adjustedEdge || 0) < 0.02) return false;
    if (Number(item.probability || 0) < 0.04) return false;
    const flags = (item.riskFlags || []).join(" ").toLowerCase();
    if (flags.indexOf("station observation unavailable") >= 0) return false;
    if (flags.indexOf("heavy market-prior shrink") >= 0 && Number(item.adjustedEdge || 0) < 0.04) return false;
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

  function sizePortfolioPick(item, maxCost, kellySettings) {
    const ask = Number(item.price && item.price.ask || 0);
    const probability = Number(item.probability || 0);
    if (!Number.isFinite(ask) || ask <= 0 || ask >= 1) return null;
    if (!Number.isFinite(probability) || probability <= 0 || probability > 1) return null;
    const maxSize = Math.max(1, Math.floor(Number(item.price.askSize || 25)));
    const upperContracts = Math.min(25, maxSize, Math.floor(maxCost / ask) + 1);
    for (let contracts = upperContracts; contracts >= 1; contracts -= 1) {
      const fee = kalshiFeeDollars(contracts, ask);
      const cost = contracts * ask + fee;
      if (cost > maxCost + 0.00001) continue;
      const breakEven = cost / contracts;
      const fullKelly = kellyFractionFor(probability, breakEven);
      const fractionalKelly = fullKelly * kellySettings.kellyFraction;
      const kellyTarget = kellySettings.bankroll * fractionalKelly;
      if (kellyTarget <= 0 || cost > kellyTarget + 0.00001) continue;
      const expectedProfit = contracts * probability - cost;
      const modelEdge = probability - breakEven;
      return {
        item: item,
        contracts: contracts,
        priceCents: item.price.askCents,
        costDollars: roundMoney(cost),
        feeDollars: roundMoney(fee),
        breakEven: round(breakEven, 4),
        modelEdge: round(modelEdge, 4),
        fullKelly: fullKelly,
        fractionalKelly: fractionalKelly,
        kellyTargetDollars: roundMoney(kellyTarget),
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
    const allScored = isAllScoredMode();
    candidateTitleEl.textContent = allScored ? "All Scored Markets" : "Positive-EV Picks";
    countEl.textContent = state.candidates.length + " " + (allScored ? "scored" : "picks");
    if (!state.candidates.length) {
      candidatesEl.innerHTML = '<tr><td colspan="13" class="subtext">' + (allScored ? "No scored markets loaded." : "No actionable positive-EV picks cleared the current filters.") + "</td></tr>";
      return;
    }

    const scanDate = state.scan && state.scan.date ? state.scan.date : dateInput.value;
    const kellySettings = currentKellySettings();
    candidatesEl.innerHTML = state.candidates.map(function (item, index) {
      return [
        "<tr>",
        '<td><span class="pill ' + actionClass(item.recommendation) + '">' + escapeHtml(actionLabel(item.recommendation)) + "</span></td>",
        '<td><div class="market-name"><strong>' + escapeHtml(item.location) + " " + escapeHtml(item.subtitle) + "</strong>" + renderDateBadge(scanDate) + "<span>" + escapeHtml(item.ticker) + "</span>" + renderRiskFlags(item) + "</div></td>",
        '<td><span class="side ' + (item.side === "yes" ? "yes" : "no") + '">' + item.side.toUpperCase() + "</span></td>",
        "<td>" + item.price.askCents + 'c<br><span class="subtext">bid ' + item.price.bidCents + "c</span></td>",
        "<td>" + renderOddsComparisonCell(item) + "</td>",
        "<td>" + pct(item.rawProbability) + '<br><span class="subtext">tight ' + pct(item.tightProbability) + "</span></td>",
        "<td>" + pct(item.breakEven) + "</td>",
        '<td class="' + (item.adjustedEdge >= 0 ? "pos" : "neg") + '">' + pct(item.adjustedEdge) + "</td>",
        '<td class="' + (modelEvDollars(item) >= 0 ? "pos" : "neg") + '">' + signedDollars(modelEvDollars(item)) + "</td>",
        "<td>" + renderKellyCell(item, kellySettings) + "</td>",
        '<td><span class="confidence">' + escapeHtml(item.confidence) + "</span></td>",
        "<td>" + item.suggested.contracts + " @ " + item.suggested.maxPriceCents + 'c<br><span class="subtext">$' + Number(item.suggested.maxCost).toFixed(2) + "</span></td>",
        '<td><div class="actions"><button type="button" data-detail="' + index + '">View</button><button type="button" data-chart="' + index + '">Chart</button><button type="button" data-open="' + index + '">Kalshi</button><button type="button" data-log="' + index + '">Audit</button></div></td>',
        "</tr>",
      ].join("");
    }).join("");

    candidatesEl.querySelectorAll("[data-detail]").forEach(function (button) {
      button.addEventListener("click", function () { showDetail(state.candidates[Number(button.dataset.detail)]); });
    });
    candidatesEl.querySelectorAll("[data-chart]").forEach(function (button) {
      button.addEventListener("click", function () { showTemperatureDetail(state.candidates[Number(button.dataset.chart)]); });
    });
    candidatesEl.querySelectorAll("[data-open]").forEach(function (button) {
      button.addEventListener("click", function () {
        const item = state.candidates[Number(button.dataset.open)];
        const url = item && item.url;
        if (!openKalshiWindow(url) && url) window.open(url, "_blank", "noopener");
      });
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

    contextsEl.innerHTML = contexts.map(function (context, index) {
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
        '<div class="actions context-actions"><button type="button" data-context-chart="' + index + '">Open temperature chart</button></div>',
        "</div>",
      ].join("");
    }).join("");

    contextsEl.querySelectorAll("[data-context-chart]").forEach(function (button) {
      button.addEventListener("click", function () { showContextTemperatureDetail(contexts[Number(button.dataset.contextChart)]); });
    });
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
        "<span>model " + pct(entry.modelProbability) + "</span>",
        "<span>pay " + pct(entry.breakEven) + "</span>",
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

  function showDetail(item, pick) {
    const scanDate = state.scan && state.scan.date ? state.scan.date : dateInput.value;
    const observations = item.context && item.context.observations ? item.context.observations : {};
    const settlement = item.context && item.context.settlement ? item.context.settlement : {};
    const kelly = kellyForCandidate(item, currentKellySettings());
    const oddsMath = oddsMathForItem(item, pick);
    detailTitle.textContent = item.location + " " + item.subtitle + " " + item.side.toUpperCase() + " - " + formatDateWithRelative(scanDate);
    detailBody.innerHTML = [
      '<div class="detail-block"><h3>Decision</h3><p>Weather date: <strong>' + escapeHtml(formatDateWithRelative(scanDate)) + "</strong>. " + escapeHtml(item.recommendation) + " at " + item.price.askCents + "c ask. Model event odds " + pct(oddsMath.probability) + " versus fee-adjusted pay odds " + pct(oddsMath.breakEven) + ". Edge " + pct(oddsMath.edge) + ". Confidence " + escapeHtml(item.confidence) + '.</p><div class="actions"><button type="button" id="detail-open">Open Kalshi</button><button type="button" id="detail-log">Audit</button></div></div>',
      renderOddsExplanationBlock(item, pick),
      renderTemperatureChartBlock(item.context, item.range, scanDate, item.location + " " + item.subtitle),
      renderProbabilityStackBlock(item),
      renderWhyOddsBlock(item),
      '<div class="detail-block"><h3>Calibration</h3><p>' + renderCalibrationDetail(item) + "</p></div>",
      '<div class="detail-block"><h3>Kelly Size</h3><p>Full Kelly ' + pct(kelly.fullKelly) + ". Fractional stake " + pct(kelly.fractionalKelly) + " of bankroll, target " + dollars(kelly.targetDollars) + ". This assumes the model probability is calibrated; bad odds make Kelly overbet.</p></div>",
      '<div class="detail-block"><h3>Model EV</h3><p>Suggested size ' + oddsMath.contracts + " contracts at " + oddsMath.priceCents + "c. Model expected profit " + signedDollars(oddsMath.expectedProfit) + " before any later price movement.</p></div>",
      '<div class="detail-block"><h3>Forecast And Observations</h3><p>Mean ' + formatNumber(item.context.meanHigh, 1) + "F, hourly max " + valueOrNa(item.context.hourlyMax) + "F, remaining hourly max " + valueOrNa(item.context.remainingHourlyMax) + "F, daily high " + valueOrNa(item.context.dailyHigh) + "F. " + escapeHtml(observations.stationId || "Station") + " high so far " + valueOrNa(observations.observedHighF) + "F, latest " + valueOrNa(observations.latestTempF) + "F. " + escapeHtml(item.context.detailedForecast || item.context.shortForecast || "") + "</p></div>",
      '<div class="detail-block"><h3>Settlement Proxy</h3><p>' + escapeHtml((settlement.stationId || observations.stationId || "Mapped station") + ": " + (settlement.stationHint || "") + ". " + (settlement.sourceNote || observations.note || "")) + "</p></div>",
      '<div class="detail-block"><h3>Risk Flags</h3><p>' + escapeHtml(item.riskFlags && item.riskFlags.length ? item.riskFlags.join(", ") : "None raised by this pass.") + "</p></div>",
    ].join("");
    detailBody.querySelector("#detail-open").addEventListener("click", function () {
      if (!openKalshiWindow(item.url)) window.open(item.url, "_blank", "noopener");
    });
    detailBody.querySelector("#detail-log").addEventListener("click", function () { logCandidate(item); });
    detailDialog.showModal();
    bindInteractiveTemperatureCharts();
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

  function showTemperatureDetail(item) {
    const scanDate = state.scan && state.scan.date ? state.scan.date : dateInput.value;
    if (!item) return;
    const oddsMath = oddsMathForItem(item);
    detailTitle.textContent = item.location + " temperature chart - " + formatDateWithRelative(scanDate);
    detailBody.innerHTML = [
      renderTemperatureChartBlock(item.context, item.range, scanDate, item.location + " " + item.subtitle),
      '<div class="detail-block"><h3>Market Overlay</h3><p>' + escapeHtml(item.side.toUpperCase() + " " + item.subtitle + ". Model event odds " + pct(oddsMath.probability) + ", you pay " + pct(oddsMath.breakEven) + " after estimated fee, market prior " + pct(item.marketProbability) + ", edge " + pct(oddsMath.edge) + ".") + '</p><div class="actions"><button type="button" id="chart-open">Open Kalshi</button><button type="button" id="chart-log">Audit</button></div></div>',
      '<div class="detail-block"><h3>Forecast Notes</h3><p>' + escapeHtml((item.context && (item.context.detailedForecast || item.context.shortForecast)) || "No detailed forecast text returned.") + "</p></div>",
    ].join("");
    detailBody.querySelector("#chart-open").addEventListener("click", function () {
      if (!openKalshiWindow(item.url)) window.open(item.url, "_blank", "noopener");
    });
    detailBody.querySelector("#chart-log").addEventListener("click", function () { logCandidate(item); });
    detailDialog.showModal();
    bindInteractiveTemperatureCharts();
  }

  function showContextTemperatureDetail(context) {
    const scanDate = state.scan && state.scan.date ? state.scan.date : dateInput.value;
    if (!context) return;
    const locationName = context.location && context.location.label ? context.location.label : "City";
    const forecast = context.forecast || {};
    const observations = context.observations || {};
    const settlement = context.settlement || {};
    detailTitle.textContent = locationName + " temperature chart - " + formatDateWithRelative(scanDate);
    detailBody.innerHTML = [
      renderTemperatureChartBlock(context, null, scanDate, locationName),
      '<div class="detail-block"><h3>Forecast Details</h3><p>Mean ' + formatNumber(forecast.meanHigh, 1) + "F, hourly max " + valueOrNa(forecast.hourlyMax) + "F, remaining hourly max " + valueOrNa(forecast.remainingHourlyMax) + "F, daily forecast " + valueOrNa(forecast.dailyHigh) + "F. " + escapeHtml(forecast.detailedForecast || forecast.shortForecast || "") + "</p></div>",
      '<div class="detail-block"><h3>Station Proxy</h3><p>' + escapeHtml((settlement.stationId || observations.stationId || "Mapped station") + ": " + (settlement.stationHint || observations.stationHint || "") + ". " + (settlement.sourceNote || observations.note || "")) + "</p></div>",
    ].join("");
    detailDialog.showModal();
    bindInteractiveTemperatureCharts();
  }

  function renderTemperatureChartBlock(context, range, scanDate, title) {
    const chart = context && context.chart ? context.chart : {};
    const forecast = Array.isArray(chart.hourlyForecast) ? chart.hourlyForecast : [];
    const observed = Array.isArray(chart.observations) ? chart.observations : [];
    const forecastPoints = chartPoints(forecast, "forecast");
    const observedPoints = chartPoints(observed, "observed");
    const points = forecastPoints.concat(observedPoints);
    const marketDate = chart.date || scanDate;
    const timeZone = chart.timeZone || (context && context.timeZone) || "local";
    const stationId = chartStationId(context);
    if (!points.length) {
      return '<div class="detail-block"><h3>Temperature Chart</h3><p class="subtext">No hourly chart data returned for ' + escapeHtml(formatDateWithRelative(marketDate)) + ".</p></div>";
    }

    const rangeBounds = chartRangeBounds(range);
    const values = points.map(function (point) { return point.tempF; });
    [chart.hourlyMax, chart.remainingHourlyMax, chart.dailyHigh, chart.meanHigh, chart.observedHighF, rangeBounds.lower, rangeBounds.upper].forEach(function (value) {
      if (Number.isFinite(Number(value))) values.push(Number(value));
    });
    const minValue = Math.min.apply(null, values);
    const maxValue = Math.max.apply(null, values);
    const yBounds = temperatureAxisBounds(minValue, maxValue);
    const yMin = yBounds.min;
    const yMax = yBounds.max;
    const width = 980;
    const height = 430;
    const pad = { left: 62, right: 132, top: 34, bottom: 42 };
    const innerWidth = width - pad.left - pad.right;
    const tempBottom = 286;
    const precipTop = 318;
    const precipHeight = 58;
    const innerHeight = tempBottom - pad.top;
    const xForHour = function (hour) {
      return pad.left + clampNumber(Number(hour), 0, 24) / 24 * innerWidth;
    };
    const yForTemp = function (temp) {
      const scale = (Number(temp) - yMin) / Math.max(1, yMax - yMin);
      return pad.top + (1 - scale) * innerHeight;
    };

    const yTicks = temperatureTicks(yMin, yMax);
    const xTicks = [];
    for (let hour = 0; hour <= 24; hour += 2) {
      xTicks.push(hour);
    }

    const forecastPath = linePath(forecastPoints, xForHour, yForTemp);
    const rangeOverlay = renderRangeOverlay(range, rangeBounds, xForHour, yForTemp, pad, innerWidth, yMin, yMax);
    const referenceLines = renderReferenceLines(chart, yForTemp, pad, innerWidth, tempBottom);
    const chartId = "temp-chart-" + (++state.nextChartId);
    state.chartPayloads[chartId] = {
      title: title,
      marketDate: marketDate,
      timeZone: timeZone,
      points: points,
      forecastPoints: forecastPoints,
      observedPoints: observedPoints,
      live: {
        stationId: stationId,
        date: marketDate,
        enabled: Boolean(stationId && chart.dayPhase === "today"),
      },
      dimensions: {
        width: width,
        height: height,
        pad: pad,
        tempBottom: tempBottom,
        innerWidth: innerWidth,
        innerHeight: innerHeight,
        yMin: yMin,
        yMax: yMax,
      },
    };
    const svg = [
      '<svg class="chart-svg" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + escapeHtml(title + " temperature chart") + '">',
      '<rect class="chart-bg" x="0" y="0" width="' + width + '" height="' + height + '"></rect>',
      '<rect class="chart-daylight-band" x="' + xForHour(11) + '" y="' + pad.top + '" width="' + (xForHour(17) - xForHour(11)) + '" height="' + innerHeight + '"></rect>',
      '<text class="chart-range-label" x="' + (xForHour(11) + 8) + '" y="' + (pad.top + 16) + '">peak heating window</text>',
      renderTemperatureAxis(yTicks, yForTemp, pad, innerWidth),
      xTicks.map(function (hour) {
        const x = xForHour(hour);
        return '<line class="chart-grid faint" x1="' + x + '" x2="' + x + '" y1="' + pad.top + '" y2="' + tempBottom + '"></line><text class="chart-axis-label" x="' + x + '" y="' + (height - 12) + '">' + chartHourLabel(hour) + '</text>';
      }).join(""),
      rangeOverlay,
      referenceLines,
      renderPrecipBars(forecastPoints, xForHour, precipTop, precipHeight),
      '<line class="chart-precip-base" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + (precipTop + precipHeight) + '" y2="' + (precipTop + precipHeight) + '"></line>',
      '<text class="chart-axis-label" x="10" y="' + (precipTop + 18) + '">PoP</text>',
      renderNowLine(chart, xForHour, pad, tempBottom, height),
      forecastPath ? '<path class="chart-line forecast-line" d="' + forecastPath + '"></path>' : "",
      renderLiveObservationLayer(observedPoints, xForHour, yForTemp),
      renderChartDots(forecastPoints, xForHour, yForTemp, "forecast-dot"),
      renderWindRibbon(forecastPoints, xForHour, height),
      '<line class="chart-crosshair chart-crosshair-x" x1="0" x2="0" y1="' + pad.top + '" y2="' + (height - pad.bottom) + '"></line>',
      '<line class="chart-crosshair chart-crosshair-y" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="0" y2="0"></line>',
      '<circle class="chart-hover-dot" cx="0" cy="0" r="5"></circle>',
      "</svg>",
    ].join("");

    return [
      '<div class="detail-block chart-block">',
      renderChartDateBanner(title, marketDate, timeZone, chart, stationId),
      '<div class="chart-head"><div><h3>Interactive Temperature Path</h3><p class="subtext">Hover or tap the chart for exact hour-by-hour values. The shaded bucket is the Kalshi contract range for this row.</p></div>' + renderChartLegend(forecastPoints.length, observedPoints.length, range) + "</div>",
      renderChartControls(chartId, observedPoints.length, range, Boolean(stationId)),
      '<div class="chart-stage interactive-chart" data-chart-id="' + chartId + '">' + svg + '<div class="chart-tooltip" hidden></div></div>',
      renderChartStats(context, chart, range),
      renderChartAccuracyNotes(context, chart, range),
      renderHourlyBreakdown(forecast),
      "</div>",
    ].join("");
  }

  function renderChartDateBanner(title, marketDate, timeZone, chart, stationId) {
    const generated = chart.generatedAt || chart.updatedAt;
    const dayPhase = chart.dayPhase ? chart.dayPhase : relativeDateLabel(marketDate).toLowerCase();
    return [
      '<div class="chart-date-banner">',
      '<div><span>Market day</span><strong>' + escapeHtml(formatDateWithRelative(marketDate)) + '</strong><small>' + escapeHtml(title) + "</small></div>",
      '<div><span>Local clock</span><strong>' + escapeHtml(timeZone || "local") + '</strong><small>' + escapeHtml(dayPhase) + "</small></div>",
      '<div><span>NWS grid</span><strong>' + escapeHtml(chart.gridId ? chart.gridId + " " + chart.gridX + "," + chart.gridY : "n/a") + '</strong><small>' + escapeHtml(chart.forecastOffice || "forecast office n/a") + "</small></div>",
      '<div><span>Forecast run</span><strong>' + escapeHtml(generated ? formatTime(generated) : "n/a") + '</strong><small>NWS hourly + daily blend</small></div>',
      '<div class="live-status-card"><span>Live station</span><strong data-live-temp>' + escapeHtml(valueWithF(chart.latestTempF)) + '</strong><small data-live-status>' + escapeHtml(liveStatusText(chart, stationId)) + "</small></div>",
      "</div>",
    ].join("");
  }

  function renderChartControls(chartId, observedCount, range, hasStation) {
    const observedActive = observedCount || hasStation;
    return [
      '<div class="chart-controls" data-chart-controls="' + chartId + '">',
      '<button type="button" class="active" data-chart-toggle="forecast">Forecast</button>',
      '<button type="button" class="' + (observedActive ? "active" : "") + '" data-chart-toggle="observed"' + (observedActive ? "" : " disabled") + '>Station obs</button>',
      '<button type="button" class="active" data-chart-toggle="precip">Precip</button>',
      '<button type="button" class="' + (range ? "active" : "") + '" data-chart-toggle="range"' + (range ? "" : " disabled") + '>Bucket</button>',
      '<button type="button" class="active" data-chart-toggle="refs">Refs</button>',
      "</div>",
    ].join("");
  }

  function chartStationId(context) {
    const observations = context && context.observations ? context.observations : {};
    const settlement = context && context.settlement ? context.settlement : {};
    return observations.stationId || settlement.stationId || "";
  }

  function liveStatusText(chart, stationId) {
    if (!stationId) return "No mapped station";
    if (chart.dayPhase === "future") return stationId + " stream starts on market day";
    if (chart.dayPhase === "past") return stationId + " final observation feed";
    if (chart.latestTime) return stationId + " updated " + formatTime(chart.latestTime);
    return stationId + " waiting for observations";
  }

  function temperatureAxisBounds(minValue, maxValue) {
    const min = Number(minValue);
    const max = Number(maxValue);
    const rawSpan = Math.max(0.5, max - min);
    const padding = rawSpan <= 5 ? 0.6 : rawSpan <= 12 ? 1 : rawSpan <= 24 ? 1.5 : 3;
    const boundStep = rawSpan <= 12 ? 0.5 : rawSpan <= 24 ? 1 : 2;
    const lower = Math.floor((min - padding) / boundStep) * boundStep;
    const upper = Math.ceil((max + padding) / boundStep) * boundStep;
    return {
      min: roundTemperatureValue(lower),
      max: roundTemperatureValue(Math.max(upper, lower + boundStep)),
    };
  }

  function temperatureTicks(yMin, yMax) {
    const span = Math.max(1, Number(yMax) - Number(yMin));
    const step = temperatureGridStep(span);
    const labelStep = temperatureLabelStep(span);
    const ticks = [];
    const start = Math.ceil(Number(yMin) / step) * step;
    for (let value = start; value <= Number(yMax) + 0.0001; value += step) {
      const rounded = roundTemperatureValue(value);
      const showLabel = isStepMultiple(rounded, labelStep) || Math.abs(rounded - start) < 0.0001 || rounded + step > Number(yMax);
      ticks.push({
        value: rounded,
        showLabel: showLabel,
        major: showLabel || isStepMultiple(rounded, 5),
      });
    }
    return ticks;
  }

  function temperatureGridStep(span) {
    if (span <= 5) return 0.25;
    if (span <= 14) return 0.5;
    if (span <= 28) return 1;
    if (span <= 44) return 2;
    return 5;
  }

  function temperatureLabelStep(span) {
    if (span <= 9) return 0.5;
    if (span <= 18) return 1;
    if (span <= 32) return 2;
    if (span <= 54) return 5;
    return 10;
  }

  function isStepMultiple(value, step) {
    const ratio = Number(value) / Number(step);
    return Math.abs(ratio - Math.round(ratio)) < 0.0001;
  }

  function roundTemperatureValue(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function formatTemperatureTick(value) {
    const text = formatNumber(value, 1);
    return text === "-0.0" ? "0.0F" : text + "F";
  }

  function renderTemperatureAxis(ticks, yForTemp, pad, innerWidth) {
    const plotRight = pad.left + innerWidth;
    return ticks.map(function (tick) {
      const y = yForTemp(tick.value);
      const className = tick.major ? "chart-grid major" : "chart-grid minor";
      const label = formatTemperatureTick(tick.value);
      return [
        '<line class="' + className + '" x1="' + pad.left + '" x2="' + plotRight + '" y1="' + y + '" y2="' + y + '"></line>',
        '<line class="chart-tick" x1="' + (pad.left - 5) + '" x2="' + pad.left + '" y1="' + y + '" y2="' + y + '"></line>',
        '<line class="chart-tick" x1="' + plotRight + '" x2="' + (plotRight + 5) + '" y1="' + y + '" y2="' + y + '"></line>',
        tick.showLabel ? '<text class="chart-axis-label chart-axis-left" x="' + (pad.left - 10) + '" y="' + (y + 4) + '">' + label + "</text>" : "",
        tick.showLabel && tick.major ? '<text class="chart-axis-label chart-axis-right" x="' + (plotRight + 10) + '" y="' + (y + 4) + '">' + label + "</text>" : "",
      ].join("");
    }).join("");
  }

  function renderPrecipBars(points, xForHour, precipTop, precipHeight) {
    return points.map(function (point) {
      const precip = Number(point.precipProbability);
      if (!Number.isFinite(precip) || precip <= 0) return "";
      const x = xForHour(point.hour) - 9;
      const barHeight = Math.max(2, clampNumber(precip, 0, 100) / 100 * precipHeight);
      const y = precipTop + precipHeight - barHeight;
      return '<rect class="chart-precip-bar" x="' + x + '" y="' + y + '" width="18" height="' + barHeight + '"><title>' + chartHourLabel(point.hour) + " precipitation " + formatNumber(precip, 0) + "%</title></rect>";
    }).join("");
  }

  function renderWindRibbon(points, xForHour, height) {
    return points
      .filter(function (point) { return point.windDirection || Number.isFinite(Number(point.windSpeedMph)); })
      .map(function (point) {
        const wind = [point.windDirection, Number.isFinite(Number(point.windSpeedMph)) ? formatNumber(point.windSpeedMph, 0) + "mph" : ""].filter(Boolean).join(" ");
        return '<text class="chart-wind-label" x="' + xForHour(point.hour) + '" y="' + (height - 26) + '">' + escapeHtml(wind) + "</text>";
      })
      .join("");
  }

  function renderNowLine(chart, xForHour, pad, tempBottom, height) {
    if (chart.dayPhase !== "today" || !Number.isFinite(Number(chart.localHour))) return "";
    const x = xForHour(chart.localHour);
    return '<line class="chart-now-line" x1="' + x + '" x2="' + x + '" y1="' + pad.top + '" y2="' + (height - pad.bottom) + '"></line><text class="chart-now-label" x="' + (x + 6) + '" y="' + (tempBottom - 8) + '">now</text>';
  }

  function renderLiveObservationLayer(points, xForHour, yForTemp) {
    const path = linePath(points, xForHour, yForTemp);
    const latest = points.length ? points[points.length - 1] : null;
    return [
      '<g class="live-observation-layer">',
      path ? '<path class="chart-line observed-line" d="' + path + '"></path>' : "",
      renderChartDots(points, xForHour, yForTemp, "observed-dot"),
      latest ? renderLiveMarker(latest, xForHour, yForTemp) : "",
      "</g>",
    ].join("");
  }

  function renderLiveMarker(point, xForHour, yForTemp) {
    const x = xForHour(point.hour);
    const y = yForTemp(point.tempF);
    const label = valueWithF(point.tempF);
    const textWidth = Math.max(48, label.length * 7.2 + 18);
    const labelX = Math.min(x + 10, 980 - textWidth - 10);
    const labelY = Math.max(28, y - 24);
    return [
      '<circle class="live-pulse-ring" cx="' + x + '" cy="' + y + '" r="8"></circle>',
      '<circle class="live-now-dot" cx="' + x + '" cy="' + y + '" r="5"></circle>',
      '<rect class="live-now-label-bg" x="' + labelX + '" y="' + (labelY - 15) + '" width="' + textWidth + '" height="20" rx="6"></rect>',
      '<text class="live-now-label" x="' + (labelX + 8) + '" y="' + labelY + '">LIVE ' + escapeHtml(label) + "</text>",
    ].join("");
  }

  function renderChartAccuracyNotes(context, chart, range) {
    const observations = context && context.observations ? context.observations : {};
    const settlement = context && context.settlement ? context.settlement : {};
    const notes = [
      "Chart date is the local market day shown above, not your browser day if the city is in another timezone.",
      "Blue line is the NWS grid hourly forecast for the mapped point; yellow bars are hourly precipitation probability.",
      "Green station observations are a proxy for the settlement station when available; final Kalshi settlement can use later NWS climate reports or corrections.",
      range ? "Bucket shading uses the half-degree settlement boundaries used by the model for this contract." : "Open a specific candidate to overlay its exact Kalshi bucket.",
    ];
    if (observations.error) notes.push("Station observation warning: " + observations.error);
    if (settlement.stationHint) notes.push("Station hint: " + settlement.stationHint);
    if (chart.updatedAt && chart.generatedAt && chart.updatedAt !== chart.generatedAt) notes.push("NWS update time: " + formatTime(chart.updatedAt) + ".");
    return '<div class="chart-notes">' + notes.map(function (note) { return "<p>" + escapeHtml(note) + "</p>"; }).join("") + "</div>";
  }

  function chartPoints(items, kind) {
    return items
      .map(function (item) {
        const tempF = Number(item.tempF);
        const localHour = Number(item.localHour);
        if (!Number.isFinite(tempF) || !Number.isFinite(localHour)) return null;
        return {
          kind: kind,
          hour: localHour,
          tempF: tempF,
          time: item.time || "",
          label: item.shortForecast || item.description || "",
          precipProbability: item.precipProbability,
          windSpeedMph: item.windSpeedMph,
          windDirection: item.windDirection || "",
          dewpointF: item.dewpointF,
          humidity: item.humidity,
        };
      })
      .filter(Boolean)
      .sort(function (left, right) { return left.hour - right.hour; });
  }

  function chartRangeBounds(range) {
    if (!range) return { lower: null, upper: null, label: "" };
    const lower = Number.isFinite(Number(range.lowerBound)) ? Number(range.lowerBound) : null;
    const upper = Number.isFinite(Number(range.upperBound)) ? Number(range.upperBound) : null;
    return {
      lower: lower,
      upper: upper,
      label: range.label || "",
    };
  }

  function renderRangeOverlay(range, bounds, xForHour, yForTemp, pad, innerWidth, yMin, yMax) {
    if (!range || (!Number.isFinite(Number(bounds.lower)) && !Number.isFinite(Number(bounds.upper)))) return "";
    const left = pad.left;
    const width = innerWidth;
    const label = escapeHtml(bounds.label || "Contract range");
    if (Number.isFinite(Number(bounds.lower)) && Number.isFinite(Number(bounds.upper))) {
      const yTop = yForTemp(bounds.upper);
      const yBottom = yForTemp(bounds.lower);
      return '<rect class="chart-range-band" x="' + left + '" y="' + yTop + '" width="' + width + '" height="' + Math.max(2, yBottom - yTop) + '"></rect><text class="chart-range-label" x="' + (left + 8) + '" y="' + (yTop + 16) + '">' + label + "</text>";
    }
    if (Number.isFinite(Number(bounds.upper))) {
      const yTop = yForTemp(Math.min(yMax, bounds.upper));
      const yBottom = yForTemp(yMin);
      return '<rect class="chart-range-band" x="' + left + '" y="' + yTop + '" width="' + width + '" height="' + Math.max(2, yBottom - yTop) + '"></rect><line class="chart-threshold" x1="' + left + '" x2="' + (left + width) + '" y1="' + yTop + '" y2="' + yTop + '"></line><text class="chart-range-label" x="' + (left + 8) + '" y="' + (yTop + 16) + '">' + label + "</text>";
    }
    const yBottom = yForTemp(bounds.lower);
    return '<rect class="chart-range-band" x="' + left + '" y="' + yForTemp(yMax) + '" width="' + width + '" height="' + Math.max(2, yBottom - yForTemp(yMax)) + '"></rect><line class="chart-threshold" x1="' + left + '" x2="' + (left + width) + '" y1="' + yBottom + '" y2="' + yBottom + '"></line><text class="chart-range-label" x="' + (left + 8) + '" y="' + (yBottom - 8) + '">' + label + "</text>";
  }

  function renderReferenceLines(chart, yForTemp, pad, innerWidth, tempBottom) {
    const refs = [
      { label: "mean", value: chart.meanHigh, className: "mean-line" },
      { label: "daily", value: chart.dailyHigh, className: "daily-line" },
      { label: "obs high", value: chart.observedHighF, className: "observed-high-line" },
    ]
      .filter(function (ref) { return Number.isFinite(Number(ref.value)); })
      .map(function (ref) {
        return Object.assign({}, ref, {
          y: yForTemp(Number(ref.value)),
          text: ref.label + " " + formatNumber(ref.value, 1) + "F",
        });
      })
      .sort(function (left, right) { return left.y - right.y; });

    const minGap = 20;
    const labelMin = pad.top + 14;
    const labelMax = tempBottom - 8;
    refs.forEach(function (ref, index) {
      ref.labelY = clampNumber(ref.y, labelMin, labelMax);
      if (index > 0 && ref.labelY - refs[index - 1].labelY < minGap) {
        ref.labelY = refs[index - 1].labelY + minGap;
      }
    });
    if (refs.length && refs[refs.length - 1].labelY > labelMax) {
      const overflow = refs[refs.length - 1].labelY - labelMax;
      refs.forEach(function (ref) {
        ref.labelY = clampNumber(ref.labelY - overflow, labelMin, labelMax);
      });
    }

    const plotRight = pad.left + innerWidth;
    const labelX = plotRight + 38;
    return refs.map(function (ref) {
      const textWidth = Math.max(72, ref.text.length * 6.6);
      const labelY = ref.labelY;
      return [
        '<line class="chart-ref ' + ref.className + '" x1="' + pad.left + '" x2="' + plotRight + '" y1="' + ref.y + '" y2="' + ref.y + '"></line>',
        '<line class="chart-ref-connector" x1="' + plotRight + '" x2="' + (labelX - 6) + '" y1="' + ref.y + '" y2="' + labelY + '"></line>',
        '<rect class="chart-ref-label-bg" x="' + (labelX - 4) + '" y="' + (labelY - 14) + '" width="' + (textWidth + 8) + '" height="18" rx="5"></rect>',
        '<text class="chart-ref-label" x="' + labelX + '" y="' + labelY + '">' + escapeHtml(ref.text) + "</text>",
      ].join("");
    }).join("");
  }

  function renderChartDots(points, xForHour, yForTemp, className) {
    return points.map(function (point) {
      const title = chartHourLabel(point.hour) + " " + formatNumber(point.tempF, 1) + "F" + (point.label ? " - " + point.label : "");
      return '<circle class="' + className + '" cx="' + xForHour(point.hour) + '" cy="' + yForTemp(point.tempF) + '" r="3.4"><title>' + escapeHtml(title) + "</title></circle>";
    }).join("");
  }

  function linePath(points, xForHour, yForTemp) {
    if (!points.length) return "";
    return points.map(function (point, index) {
      const prefix = index === 0 ? "M" : "L";
      return prefix + " " + round(xForHour(point.hour), 2) + " " + round(yForTemp(point.tempF), 2);
    }).join(" ");
  }

  function renderChartLegend(forecastCount, observedCount, range) {
    return [
      '<div class="chart-legend">',
      forecastCount ? '<span><i class="legend-swatch forecast"></i>NWS hourly</span>' : "",
      observedCount ? '<span><i class="legend-swatch observed"></i>Station obs</span>' : "",
      range ? '<span><i class="legend-swatch range"></i>Contract bucket</span>' : "",
      "</div>",
    ].join("");
  }

  function renderChartStats(context, chart, range) {
    const observations = context && context.observations ? context.observations : {};
    const stats = [
      ["Market date", chart.date ? formatCalendarDate(chart.date) : "n/a"],
      ["Timezone", chart.timeZone || "n/a"],
      ["Mean model", valueWithF(chart.meanHigh)],
      ["Hourly max", valueWithF(chart.hourlyMax)],
      ["Remaining max", valueWithF(chart.remainingHourlyMax)],
      ["NWS daily", valueWithF(chart.dailyHigh)],
      ["Observed high", valueWithF(chart.observedHighF)],
      ["Latest obs", valueWithF(chart.latestTempF)],
      ["Bucket", range && range.label ? range.label : "all buckets"],
      ["Station", observations.stationId || "n/a"],
      ["Obs count", observations.observationCount == null ? "n/a" : String(observations.observationCount)],
      ["Generated", chart.generatedAt ? formatTime(chart.generatedAt) : "n/a"],
    ];
    return '<div class="chart-stats">' + stats.map(function (stat) {
      return '<div><span>' + escapeHtml(stat[0]) + '</span><strong>' + escapeHtml(stat[1]) + "</strong></div>";
    }).join("") + "</div>";
  }

  function renderHourlyBreakdown(forecast) {
    if (!forecast.length) return "";
    return [
      '<div class="hourly-breakdown">',
      "<h3>Hourly Forecast Feed</h3>",
      '<div class="hourly-table">',
      '<div class="hourly-row hourly-head"><span>Time</span><span>Temp</span><span>Dew</span><span>Humidity</span><span>PoP</span><span>Wind</span><span>Forecast</span></div>',
      forecast.map(function (period) {
        const wind = [period.windDirection, Number.isFinite(Number(period.windSpeedMph)) ? formatNumber(period.windSpeedMph, 0) + " mph" : ""].filter(Boolean).join(" ");
        return '<div class="hourly-row" data-hour="' + escapeHtml(period.localHour) + '"><span>' + escapeHtml(chartHourLabel(period.localHour)) + '</span><span>' + valueWithF(period.tempF) + '</span><span>' + valueWithF(period.dewpointF) + '</span><span>' + escapeHtml(period.humidity == null ? "n/a" : formatNumber(period.humidity, 0) + "%") + '</span><span>' + escapeHtml(period.precipProbability == null ? "n/a" : formatNumber(period.precipProbability, 0) + "%") + '</span><span>' + escapeHtml(wind || "n/a") + '</span><span>' + escapeHtml(period.shortForecast || "n/a") + "</span></div>";
      }).join(""),
      "</div>",
      "</div>",
    ].join("");
  }

  function valueWithF(value) {
    return Number.isFinite(Number(value)) ? formatNumber(value, 1) + "F" : "n/a";
  }

  function chartHourLabel(hourValue) {
    const number = Number(hourValue);
    if (!Number.isFinite(number)) return "n/a";
    if (number >= 24) return "12a";
    const hour = Math.floor(number);
    const suffix = hour >= 12 ? "p" : "a";
    const twelve = hour % 12 || 12;
    return String(twelve) + suffix;
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function bindInteractiveTemperatureCharts() {
    detailBody.querySelectorAll(".chart-controls").forEach(function (controls) {
      if (controls.dataset.bound === "1") return;
      controls.dataset.bound = "1";
      controls.addEventListener("click", function (event) {
        const button = event.target.closest("[data-chart-toggle]");
        if (!button || button.disabled) return;
        const chartId = controls.dataset.chartControls;
        const stage = detailBody.querySelector('.interactive-chart[data-chart-id="' + chartId + '"]');
        if (!stage) return;
        button.classList.toggle("active");
        stage.classList.toggle("hide-" + button.dataset.chartToggle, !button.classList.contains("active"));
      });
    });

    detailBody.querySelectorAll(".interactive-chart").forEach(function (stage) {
      if (stage.dataset.bound === "1") return;
      stage.dataset.bound = "1";
      const chartId = stage.dataset.chartId;
      const payload = state.chartPayloads[chartId];
      const svg = stage.querySelector("svg");
      const tooltip = stage.querySelector(".chart-tooltip");
      if (!payload || !svg || !tooltip) return;

      stage.addEventListener("pointermove", function (event) {
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const viewX = (event.clientX - rect.left) / rect.width * payload.dimensions.width;
        const point = nearestChartPoint(payload, viewX);
        if (!point) return;
        const x = chartXFromPayload(payload, point.hour);
        const y = chartYFromPayload(payload, point.tempF);
        stage.querySelector(".chart-crosshair-x").setAttribute("x1", x);
        stage.querySelector(".chart-crosshair-x").setAttribute("x2", x);
        stage.querySelector(".chart-crosshair-y").setAttribute("y1", y);
        stage.querySelector(".chart-crosshair-y").setAttribute("y2", y);
        const hoverDot = stage.querySelector(".chart-hover-dot");
        hoverDot.setAttribute("cx", x);
        hoverDot.setAttribute("cy", y);
        stage.classList.add("is-hovering");
        tooltip.hidden = false;
        tooltip.innerHTML = renderChartTooltip(point, payload);
        const left = clampNumber(event.clientX - rect.left + 14, 8, Math.max(8, rect.width - 250));
        const top = clampNumber(event.clientY - rect.top + 14, 8, Math.max(8, rect.height - 178));
        tooltip.style.left = left + "px";
        tooltip.style.top = top + "px";
        highlightHourlyRow(stage, point.hour);
      });

      stage.addEventListener("pointerleave", function () {
        stage.classList.remove("is-hovering");
        tooltip.hidden = true;
        highlightHourlyRow(stage, null);
      });

      startLiveObservationStream(stage, payload);
    });
  }

  function startLiveObservationStream(stage, payload) {
    const chartId = stage.dataset.chartId;
    const live = payload && payload.live ? payload.live : null;
    if (!chartId || !live || !live.stationId) return;
    if (!live.enabled) {
      updateLiveStatus(stage, null, live.stationId + " stream starts when this city reaches the market day.");
      return;
    }
    if (state.chartLiveTimers[chartId]) return;
    refreshLiveObservation(stage, payload);
    state.chartLiveTimers[chartId] = setInterval(function () {
      refreshLiveObservation(stage, payload);
    }, 60000);
  }

  async function refreshLiveObservation(stage, payload) {
    const live = payload && payload.live ? payload.live : null;
    if (!live || !live.stationId) return;
    try {
      updateLiveStatus(stage, null, "Refreshing " + live.stationId + "...");
      const params = new URLSearchParams({
        stationId: live.stationId,
        date: live.date,
      });
      const data = await fetchJson(kalshiWeatherEndpoint("/api/kalshi/weather/live?" + params.toString()));
      applyLiveObservation(stage, payload, data);
    } catch (error) {
      updateLiveStatus(stage, null, "Live station refresh failed: " + error.message);
    }
  }

  function applyLiveObservation(stage, payload, data) {
    const chart = data && data.chart ? data.chart : {};
    const observations = data && data.observations ? data.observations : {};
    const points = chartPoints(Array.isArray(chart.observations) ? chart.observations : [], "observed");
    payload.observedPoints = points;
    payload.points = (payload.forecastPoints || []).concat(points);
    const xForHour = function (hour) { return chartXFromPayload(payload, hour); };
    const yForTemp = function (temp) { return chartYFromPayload(payload, temp); };
    const layer = stage.querySelector(".live-observation-layer");
    if (layer) {
      layer.outerHTML = renderLiveObservationLayer(points, xForHour, yForTemp);
    }
    const latest = Number.isFinite(Number(chart.latestTempF)) ? chart.latestTempF : observations.latestTempF;
    updateLiveStatus(stage, latest, liveStatusText(chart, observations.stationId || (payload.live && payload.live.stationId)));
  }

  function updateLiveStatus(stage, latestTempF, text) {
    const block = stage.closest(".chart-block");
    if (!block) return;
    const tempEl = block.querySelector("[data-live-temp]");
    const statusEl = block.querySelector("[data-live-status]");
    if (tempEl && latestTempF !== null && latestTempF !== undefined) tempEl.textContent = valueWithF(latestTempF);
    if (statusEl && text) statusEl.textContent = text;
  }

  function stopLiveObservationStreams() {
    Object.keys(state.chartLiveTimers).forEach(function (chartId) {
      clearInterval(state.chartLiveTimers[chartId]);
    });
    state.chartLiveTimers = {};
  }

  function nearestChartPoint(payload, viewX) {
    const points = payload.points || [];
    let best = null;
    let bestDistance = Infinity;
    points.forEach(function (point) {
      const x = chartXFromPayload(payload, point.hour);
      const distance = Math.abs(x - viewX);
      if (distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    });
    return best;
  }

  function chartXFromPayload(payload, hour) {
    const dimensions = payload.dimensions;
    return dimensions.pad.left + clampNumber(Number(hour), 0, 24) / 24 * dimensions.innerWidth;
  }

  function chartYFromPayload(payload, tempF) {
    const dimensions = payload.dimensions;
    const scale = (Number(tempF) - dimensions.yMin) / Math.max(1, dimensions.yMax - dimensions.yMin);
    return dimensions.pad.top + (1 - scale) * dimensions.innerHeight;
  }

  function renderChartTooltip(point, payload) {
    const wind = [point.windDirection, Number.isFinite(Number(point.windSpeedMph)) ? formatNumber(point.windSpeedMph, 0) + " mph" : ""].filter(Boolean).join(" ");
    const details = [
      point.time ? formatTime(point.time) : chartHourLabel(point.hour),
      payload.timeZone,
      point.kind === "observed" ? "station observation" : "NWS hourly forecast",
    ].filter(Boolean).join(" - ");
    return [
      "<strong>" + escapeHtml(chartHourLabel(point.hour) + " / " + valueWithF(point.tempF)) + "</strong>",
      "<span>" + escapeHtml(details) + "</span>",
      "<span>Dewpoint " + escapeHtml(valueWithF(point.dewpointF)) + " / humidity " + escapeHtml(point.humidity == null ? "n/a" : formatNumber(point.humidity, 0) + "%") + "</span>",
      "<span>Precip " + escapeHtml(point.precipProbability == null ? "n/a" : formatNumber(point.precipProbability, 0) + "%") + " / wind " + escapeHtml(wind || "n/a") + "</span>",
      point.label ? "<small>" + escapeHtml(point.label) + "</small>" : "",
    ].join("");
  }

  function highlightHourlyRow(stage, hour) {
    const block = stage.closest(".chart-block");
    if (!block) return;
    block.querySelectorAll(".hourly-row.is-active").forEach(function (row) {
      row.classList.remove("is-active");
    });
    if (hour === null || hour === undefined) return;
    let best = null;
    let bestDistance = Infinity;
    block.querySelectorAll(".hourly-row[data-hour]").forEach(function (row) {
      const distance = Math.abs(Number(row.dataset.hour) - Number(hour));
      if (distance < bestDistance) {
        best = row;
        bestDistance = distance;
      }
    });
    if (best && bestDistance <= 0.75) best.classList.add("is-active");
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

  function currentKellySettings() {
    const bankroll = portfolioBankroll();
    const kellyPercent = portfolioKellyPercent();
    return {
      bankroll: bankroll,
      kellyPercent: kellyPercent,
      kellyFraction: kellyPercent / 100,
    };
  }

  function portfolioBankroll() {
    const bankroll = clampInteger(portfolioBankrollInput.value, 25, 100000, 1000);
    portfolioBankrollInput.value = String(bankroll);
    localStorage.setItem(PORTFOLIO_BANKROLL_KEY, String(bankroll));
    return bankroll;
  }

  function portfolioKellyPercent() {
    const kellyPercent = clampInteger(portfolioKellyPercentInput.value, 1, 100, 25);
    portfolioKellyPercentInput.value = String(kellyPercent);
    localStorage.setItem(PORTFOLIO_KELLY_PERCENT_KEY, String(kellyPercent));
    return kellyPercent;
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

  function isAllScoredMode() {
    return Boolean(state.scan && state.scan.filters && (state.scan.filters.mode === "all-scored-markets" || state.scan.filters.includeNegative));
  }

  function modelEvDollars(item) {
    if (item.expectedValue && item.expectedValue.total != null) {
      return Number(item.expectedValue.total);
    }
    return Number(item.suggested && item.suggested.modelEv != null ? item.suggested.modelEv : Number(item.suggested.contracts || 0) * Number(item.adjustedEdge || 0));
  }

  function oddsMathForItem(item, pick) {
    const probability = Number(item && item.probability || 0);
    const contracts = Number(pick && pick.contracts || item && item.suggested && item.suggested.contracts || 1);
    const priceCents = Number(pick && pick.priceCents || item && item.price && item.price.askCents || item && item.suggested && item.suggested.maxPriceCents || 0);
    const price = priceCents / 100;
    const fee = Number(pick && pick.feeDollars != null ? pick.feeDollars : kalshiFeeDollars(contracts, price));
    const cost = Number(pick && pick.costDollars != null ? pick.costDollars : contracts * price + fee);
    const breakEven = Number(pick && pick.breakEven != null ? pick.breakEven : cost / Math.max(1, contracts));
    const edge = probability - breakEven;
    const expectedProfit = contracts * probability - cost;
    return {
      probability: probability,
      contracts: contracts,
      priceCents: priceCents,
      price: price,
      fee: fee,
      cost: cost,
      breakEven: breakEven,
      edge: edge,
      expectedProfit: expectedProfit,
      marketProbability: Number(item && item.marketProbability || 0),
      weatherProbability: Number(item && item.weatherProbability || 0),
    };
  }

  function renderOddsComparisonCell(item, pick) {
    const math = oddsMathForItem(item, pick);
    const edgeClass = math.edge >= 0 ? "pos" : "neg";
    return [
      '<div class="odds-cell">',
      '<strong class="' + edgeClass + '">model ' + pct(math.probability) + "</strong>",
      '<span>pay ' + pct(math.breakEven) + ' <small>incl fee</small></span>',
      '<span class="' + edgeClass + '">edge ' + pct(math.edge) + "</span>",
      '<span class="subtext">market prior ' + pct(math.marketProbability) + "</span>",
      "</div>",
    ].join("");
  }

  function renderOddsExplanationBlock(item, pick) {
    const math = oddsMathForItem(item, pick);
    const edgeClass = math.edge >= 0 ? "pos" : "neg";
    return [
      '<div class="detail-block odds-explainer">',
      '<h3>Odds Vs Price</h3>',
      '<div class="odds-summary-grid">',
      oddsMetric("Model event odds", pct(math.probability), item.side.toUpperCase() + " " + item.subtitle),
      oddsMetric("You pay", pct(math.breakEven), math.priceCents + "c ask + " + dollars(math.fee) + " estimated fee"),
      oddsMetric("Edge", pct(math.edge), "model odds minus break-even", edgeClass),
      oddsMetric("Model EV", signedDollars(math.expectedProfit), math.contracts + " contract" + (math.contracts === 1 ? "" : "s") + " in this calculation", math.expectedProfit >= 0 ? "pos" : "neg"),
      "</div>",
      '<p class="odds-formula">Formula: edge = calibrated model probability - fee-adjusted break-even = ' + pct(math.probability) + " - " + pct(math.breakEven) + " = " + pct(math.edge) + ".</p>",
      '<p class="subtext">The displayed ask is the market price. The pay odds here are the effective break-even after the estimated Kalshi fee, so tiny bets can need a higher true probability than the ask alone suggests.</p>',
      "</div>",
    ].join("");
  }

  function renderProbabilityStackBlock(item) {
    return [
      '<div class="detail-block odds-stack">',
      '<h3>Probability Stack</h3>',
      '<div class="odds-stack-grid">',
      oddsMetric("Raw weather", pct(item.rawProbability), "normal forecast error"),
      oddsMetric("Tight weather", pct(item.tightProbability), "low-error scenario"),
      oddsMetric("Wide weather", pct(item.wideProbability), "high-error scenario"),
      oddsMetric("Weather-only", pct(item.weatherProbability), "forecast + station guardrails"),
      oddsMetric("Market prior", pct(item.marketProbability), "Kalshi bid/ask midpoint signal"),
      oddsMetric("Final model", pct(item.probability), "market-shrunk calibrated odds", Number(item.adjustedEdge || 0) >= 0 ? "pos" : "neg"),
      "</div>",
      "</div>",
    ].join("");
  }

  function renderWhyOddsBlock(item) {
    const lines = (item.rationale || []).slice(0, 8);
    if (!lines.length) {
      lines.push("No rationale was returned for this market.");
    }
    return '<div class="detail-block"><h3>Why The Model Got There</h3><ul class="odds-reasons">' + lines.map(function (line) {
      return "<li>" + escapeHtml(line) + "</li>";
    }).join("") + "</ul></div>";
  }

  function oddsMetric(label, value, subtext, className) {
    return '<div class="odds-metric"><span>' + escapeHtml(label) + '</span><strong class="' + escapeHtml(className || "") + '">' + escapeHtml(value) + '</strong><small>' + escapeHtml(subtext) + "</small></div>";
  }

  function renderKellyCell(item, settings) {
    const kelly = kellyForCandidate(item, settings);
    if (kelly.fullKelly <= 0) {
      return '0.0%<br><span class="subtext">$0 target</span>';
    }
    return pct(kelly.fullKelly) + '<br><span class="subtext">' + pct(kelly.fractionalKelly) + " / " + dollars(kelly.targetDollars) + "</span>";
  }

  function renderCalibrationDetail(item) {
    const calibration = item.calibration || {};
    const notes = Array.isArray(calibration.notes) ? calibration.notes : [];
    const weight = calibration.marketWeight == null ? "n/a" : pct(calibration.marketWeight);
    const cap = calibration.distanceCap == null ? "station override" : pct(calibration.distanceCap);
    const noteText = notes.length ? " " + notes.join(" ") : "";
    return escapeHtml("Market weight " + weight + ". Separation cap " + cap + "." + noteText);
  }

  function kellyForCandidate(item, settings) {
    const probability = Number(item.probability || 0);
    const price = Number(item.breakEven || (item.price && item.price.ask) || 0);
    const sizing = settings || currentKellySettings();
    const fullKelly = kellyFractionFor(probability, price);
    const fractionalKelly = fullKelly * sizing.kellyFraction;
    return {
      fullKelly: fullKelly,
      fractionalKelly: fractionalKelly,
      targetDollars: roundMoney(sizing.bankroll * fractionalKelly),
    };
  }

  function kellyFractionFor(probability, breakEvenCost) {
    const p = Number(probability);
    const c = Number(breakEvenCost);
    if (!Number.isFinite(p) || !Number.isFinite(c)) return 0;
    if (p <= 0 || p > 1 || c <= 0 || c >= 1 || p <= c) return 0;
    return Math.max(0, Math.min(1, (p - c) / (1 - c)));
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
