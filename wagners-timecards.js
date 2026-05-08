'use strict';

(function () {
  const PROD_API_BASE = 'https://nova-arcade-backend-2rpkpv7fpq-uc.a.run.app';
  const DRAFT_KEY = 'wagners-timecards:draft:v1';
  const LAST_WORKER_KEY = 'wagners-timecards:last-worker:v1';
  const els = {};
  let deferredInstallPrompt = null;
  const state = {
    entries: [],
    myTimecards: [],
    bossTimecards: [],
    filteredBossTimecards: [],
    profile: null,
    employeeProfile: null,
    quickBooks: null,
    isAdmin: false,
    lastSubmitted: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiBase() {
    return String(window.WAGNERS_TIME_API_BASE || PROD_API_BASE).replace(/\/+$/, '');
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function startOfWeekIso(date = new Date()) {
    const copy = new Date(date);
    const day = copy.getDay();
    const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
    copy.setDate(diff);
    return copy.toISOString().slice(0, 10);
  }

  function addDaysIso(isoDate, days) {
    const date = new Date(`${isoDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function cleanText(value, max = 120) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function timeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return NaN;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
    return hours * 60 + minutes;
  }

  function entryMinutes(entry) {
    const start = timeToMinutes(entry.start);
    const end = timeToMinutes(entry.end);
    const breakMinutes = Math.max(0, Math.min(240, Math.round(Number(entry.breakMinutes || 0))));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.max(0, end - start - breakMinutes);
  }

  function formatHours(minutes) {
    return (Math.round((Number(minutes || 0) / 60) * 100) / 100).toFixed(2);
  }

  function formatDate(value) {
    if (!value) return 'No date';
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return value;
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setStatus(message, tone = '') {
    els.statusMessage.textContent = message || '';
    els.statusMessage.className = `status-message ${tone}`.trim();
  }

  function setEmployeeAccountStatus(message, tone = '') {
    if (!els.employeeAccountStatus) return;
    els.employeeAccountStatus.textContent = message || '';
    els.employeeAccountStatus.className = `account-status ${tone}`.trim();
  }

  function setQuickBooksStatus(message, tone = '') {
    if (!els.quickBooksStatus) return;
    els.quickBooksStatus.textContent = message || '';
    els.quickBooksStatus.className = `account-status ${tone}`.trim();
  }

  function isInstalledApp() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: window-controls-overlay)').matches
      || window.navigator.standalone === true;
  }

  function renderInstallButton() {
    if (!els.installAppButton) return;
    els.installAppButton.hidden = isInstalledApp();
  }

  async function installApp() {
    if (isInstalledApp()) {
      setStatus('App is already installed.', 'ok');
      renderInstallButton();
      return;
    }

    if (!deferredInstallPrompt) {
      setStatus('Use your browser menu to install this app on your phone or Windows.', 'ok');
      return;
    }

    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => ({}));
    renderInstallButton();
    if (choice && choice.outcome === 'accepted') {
      setStatus('App install started.', 'ok');
    } else {
      setStatus('App install was not completed.', '');
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/wagners-timecards-sw.js', { scope: '/' });
    } catch {
      // The timecard app still works normally when install support is unavailable.
    }
  }

  function employeeProfilePayload() {
    return {
      fullName: cleanText(els.workerName.value, 100),
      phone: cleanText(els.employeePhone.value, 40),
      employeeCode: cleanText(els.employeeCode.value, 40),
      role: cleanText(els.crewRole.value, 60),
    };
  }

  function draftPayload() {
    return {
      workerName: cleanText(els.workerName.value, 100),
      crewRole: cleanText(els.crewRole.value, 60),
      employeePhone: cleanText(els.employeePhone.value, 40),
      employeeCode: cleanText(els.employeeCode.value, 40),
      weekStart: els.weekStart.value,
      weekEnd: els.weekEnd.value,
      signatureName: cleanText(els.signatureName.value, 100),
      entries: state.entries.map((entry) => ({ ...entry })),
    };
  }

  function saveLastWorker() {
    const payload = {
      workerName: cleanText(els.workerName.value, 100),
      crewRole: cleanText(els.crewRole.value, 60),
      employeePhone: cleanText(els.employeePhone.value, 40),
      employeeCode: cleanText(els.employeeCode.value, 40),
    };
    try {
      localStorage.setItem(LAST_WORKER_KEY, JSON.stringify(payload));
    } catch {
      // Local drafts are a convenience only.
    }
  }

  function saveDraft(showMessage = false) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draftPayload()));
      saveLastWorker();
      if (showMessage) setStatus('Draft saved on this device.', 'ok');
    } catch {
      if (showMessage) setStatus('This browser could not save the draft locally.', 'error');
    }
  }

  function loadDraft() {
    const weekStart = startOfWeekIso();
    els.weekStart.value = weekStart;
    els.weekEnd.value = addDaysIso(weekStart, 6);
    els.entryDate.value = todayIso();

    try {
      const worker = JSON.parse(localStorage.getItem(LAST_WORKER_KEY) || '{}');
      els.workerName.value = cleanText(worker.workerName, 100);
      els.crewRole.value = cleanText(worker.crewRole, 60);
      els.employeePhone.value = cleanText(worker.employeePhone, 40);
      els.employeeCode.value = cleanText(worker.employeeCode, 40);
    } catch {
      // Ignore malformed saved worker data.
    }

    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      if (!draft || typeof draft !== 'object') return;
      els.workerName.value = cleanText(draft.workerName || els.workerName.value, 100);
      els.crewRole.value = cleanText(draft.crewRole || els.crewRole.value, 60);
      els.employeePhone.value = cleanText(draft.employeePhone || els.employeePhone.value, 40);
      els.employeeCode.value = cleanText(draft.employeeCode || els.employeeCode.value, 40);
      els.weekStart.value = draft.weekStart || els.weekStart.value;
      els.weekEnd.value = draft.weekEnd || els.weekEnd.value;
      els.signatureName.value = cleanText(draft.signatureName, 100);
      state.entries = Array.isArray(draft.entries)
        ? draft.entries.map(normalizeEntry).filter((entry) => entry.minutes > 0)
        : [];
    } catch {
      state.entries = [];
    }
  }

  function normalizeEntry(entry) {
    const next = {
      id: cleanText(entry.id, 80) || `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date: cleanText(entry.date, 20),
      customer: cleanText(entry.customer, 120),
      jobName: cleanText(entry.jobName, 120),
      service: cleanText(entry.service, 80) || 'Painting',
      payType: cleanText(entry.payType, 40) || 'Regular',
      start: cleanText(entry.start, 10),
      end: cleanText(entry.end, 10),
      breakMinutes: Math.max(0, Math.min(240, Math.round(Number(entry.breakMinutes || 0)))),
      billable: entry.billable !== false,
      notes: cleanText(entry.notes, 400),
    };
    next.minutes = entryMinutes(next);
    next.hours = Number(formatHours(next.minutes));
    return next;
  }

  function totals(entries = state.entries) {
    const minutes = entries.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
    const jobs = entries.length;
    return { minutes, hours: Number(formatHours(minutes)), jobs };
  }

  function renderSummary() {
    const summary = totals();
    els.summaryHours.textContent = formatHours(summary.minutes);
    els.summaryJobs.textContent = String(summary.jobs);
    els.summaryStatus.textContent = state.lastSubmitted ? 'Submitted' : 'Draft';
    els.summarySync.textContent = state.lastSubmitted
      ? `Sent ${new Date(state.lastSubmitted).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Not submitted';
  }

  function renderEntries() {
    if (!state.entries.length) {
      els.entriesList.innerHTML = '<p class="empty-state">Add each job or stop as its own entry. Multiple jobs in one day are expected.</p>';
      renderSummary();
      return;
    }

    els.entriesList.innerHTML = state.entries.map((entry) => `
      <article class="entry-card" data-entry-id="${escapeHtml(entry.id)}">
        <div class="entry-top">
          <div>
            <h3 class="entry-title">${escapeHtml(entry.customer || entry.jobName || 'Job')}</h3>
            <div class="entry-meta">
              <span>${escapeHtml(formatDate(entry.date))}</span>
              <span>${escapeHtml(entry.start)}-${escapeHtml(entry.end)}</span>
              <span>${formatHours(entry.minutes)} hr</span>
              <span>${escapeHtml(entry.service)}</span>
            </div>
          </div>
          <button class="remove-entry" type="button" data-remove-entry="${escapeHtml(entry.id)}" aria-label="Remove entry">x</button>
        </div>
        <div class="entry-meta">
          <span class="pill">${escapeHtml(entry.payType)}</span>
          <span class="pill ${entry.billable ? '' : 'warn'}">${entry.billable ? 'Billable' : 'Nonbillable'}</span>
          ${entry.breakMinutes ? `<span>${entry.breakMinutes} min break</span>` : ''}
        </div>
        ${entry.jobName ? `<p class="entry-title">${escapeHtml(entry.jobName)}</p>` : ''}
        ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : ''}
      </article>
    `).join('');

    renderSummary();
  }

  function addEntryFromForm(event) {
    event.preventDefault();
    const entry = normalizeEntry({
      date: els.entryDate.value,
      customer: els.entryCustomer.value,
      jobName: els.entryJob.value,
      service: els.entryService.value,
      payType: els.entryPayType.value,
      start: els.entryStart.value,
      end: els.entryEnd.value,
      breakMinutes: els.entryBreak.value,
      billable: els.entryBillable.checked,
      notes: els.entryNotes.value,
    });

    if (!entry.date || (!entry.customer && !entry.jobName)) {
      setStatus('Add a date and a customer or job name.', 'error');
      return;
    }
    if (entry.minutes <= 0) {
      setStatus('Check the start and end time for that entry.', 'error');
      return;
    }

    state.entries.push(entry);
    els.entryCustomer.value = '';
    els.entryJob.value = '';
    els.entryNotes.value = '';
    els.entryStart.value = '';
    els.entryEnd.value = '';
    els.entryBreak.value = '0';
    renderEntries();
    saveDraft();
    setStatus('Job added to the draft.', 'ok');
  }

  function removeEntry(id) {
    state.entries = state.entries.filter((entry) => entry.id !== id);
    renderEntries();
    saveDraft();
  }

  function currentPayload() {
    return {
      ...draftPayload(),
      employeeProfile: employeeProfilePayload(),
      signedAt: new Date().toISOString(),
      deviceNote: navigator.userAgent.slice(0, 140),
    };
  }

  function validateForSubmit() {
    if (!state.profile || !state.profile.signedIn) {
      return 'Sign in with Google before submitting.';
    }
    if (!state.entries.length) {
      return 'Add at least one job entry.';
    }
    if (!cleanText(els.workerName.value, 100)) {
      return 'Add your name.';
    }
    if (!cleanText(els.signatureName.value, 100)) {
      return 'Type your signature name.';
    }
    if (!els.certify.checked) {
      return 'Check the certification box.';
    }
    return '';
  }

  async function authHeaders(extra = {}) {
    if (!window.NovaAuth || typeof window.NovaAuth.appendAuthHeaders !== 'function') {
      return extra;
    }
    return window.NovaAuth.appendAuthHeaders(extra);
  }

  function applyEmployeeProfile(profile) {
    state.employeeProfile = profile || null;
    if (!profile) {
      setEmployeeAccountStatus(state.profile && state.profile.signedIn
        ? 'Save your employee account before submitting.'
        : 'Sign in to create an employee account.');
      return;
    }
    els.workerName.value = cleanText(profile.fullName || els.workerName.value, 100);
    els.employeePhone.value = cleanText(profile.phone || els.employeePhone.value, 40);
    els.employeeCode.value = cleanText(profile.employeeCode || els.employeeCode.value, 40);
    els.crewRole.value = cleanText(profile.role || els.crewRole.value, 60);
    if (!els.signatureName.value) {
      els.signatureName.value = cleanText(profile.fullName, 100);
    }
    saveLastWorker();
    setEmployeeAccountStatus('Employee account saved to this sign-in.', 'ok');
  }

  async function loadEmployeeProfile() {
    if (!state.profile || !state.profile.signedIn) {
      state.employeeProfile = null;
      setEmployeeAccountStatus('Sign in to create an employee account.');
      return null;
    }

    try {
      const response = await fetch(`${apiBase()}/api/wagners/employee-profile`, {
        headers: await authHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Unable to load employee account.');
      }
      applyEmployeeProfile(body.profile || null);
      return body.profile || null;
    } catch (error) {
      state.employeeProfile = null;
      setEmployeeAccountStatus(error.message || 'Unable to load employee account.', 'error');
      return null;
    }
  }

  async function saveEmployeeProfile({ quiet = false } = {}) {
    if (!state.profile || !state.profile.signedIn) {
      throw new Error('Sign in before saving an employee account.');
    }
    const payload = employeeProfilePayload();
    if (!payload.fullName) {
      throw new Error('Add your name before saving the employee account.');
    }
    if (!quiet) setEmployeeAccountStatus('Saving employee account...');

    const response = await fetch(`${apiBase()}/api/wagners/employee-profile`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      throw new Error(body.error || 'Unable to save employee account.');
    }
    applyEmployeeProfile(body.profile);
    return body.profile;
  }

  async function ensureEmployeeProfile() {
    const current = employeeProfilePayload();
    const saved = state.employeeProfile || {};
    const changed = current.fullName !== cleanText(saved.fullName, 100)
      || current.phone !== cleanText(saved.phone, 40)
      || current.employeeCode !== cleanText(saved.employeeCode, 40)
      || current.role !== cleanText(saved.role, 60);
    if (!state.employeeProfile || changed) {
      return saveEmployeeProfile({ quiet: true });
    }
    return state.employeeProfile;
  }

  async function submitTimecard() {
    const validation = validateForSubmit();
    if (validation) {
      setStatus(validation, 'error');
      return;
    }

    setStatus('Submitting timecard...');
    saveDraft();

    try {
      await ensureEmployeeProfile();
      const response = await fetch(`${apiBase()}/api/wagners/timecards`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(currentPayload()),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Timecard could not be submitted.');
      }
      state.lastSubmitted = body.timecard.submittedAt || new Date().toISOString();
      const emailStatus = body.emailDelivery && body.emailDelivery.status;
      setStatus(emailStatus === 'sent'
        ? 'Timecard submitted and emailed to payroll.'
        : 'Timecard submitted for payroll.', 'ok');
      clearDraft(false);
      await loadMyTimecards();
      if (body.isAdmin) await loadBossTimecards({ quiet: true });
    } catch (error) {
      setStatus(error.message || 'Timecard could not be submitted.', 'error');
    }
    renderSummary();
  }

  function clearDraft(showMessage = true) {
    state.entries = [];
    els.certify.checked = false;
    els.signatureName.value = cleanText(els.workerName.value, 100);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore storage failures.
    }
    renderEntries();
    if (showMessage) setStatus('Started a new timecard.', 'ok');
  }

  async function loadMyTimecards() {
    if (!state.profile || !state.profile.signedIn) {
      els.myTimecards.innerHTML = '<p class="empty-state">Sign in to see submitted cards.</p>';
      return;
    }

    try {
      const response = await fetch(`${apiBase()}/api/wagners/timecards/me`, {
        headers: await authHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Unable to load submitted cards.');
      }
      state.myTimecards = Array.isArray(body.timecards) ? body.timecards : [];
      state.isAdmin = Boolean(body.isAdmin);
      renderTimecardList(els.myTimecards, state.myTimecards, { ownerView: true });
      if (state.isAdmin) {
        els.bossPanel.hidden = false;
        await loadBossTimecards({ quiet: true });
      }
    } catch (error) {
      els.myTimecards.innerHTML = `<p class="empty-state">${escapeHtml(error.message || 'Unable to load submitted cards.')}</p>`;
    }
  }

  async function loadBossTimecards({ quiet = false } = {}) {
    if (!state.profile || !state.profile.signedIn) return;
    try {
      const response = await fetch(`${apiBase()}/api/wagners/timecards`, {
        headers: await authHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) {
        els.bossPanel.hidden = true;
        return;
      }
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Unable to load boss review.');
      }
      state.bossTimecards = Array.isArray(body.timecards) ? body.timecards : [];
      state.isAdmin = true;
      els.bossPanel.hidden = false;
      renderBossTimecards();
      await loadQuickBooksStatus({ quiet: true });
      if (!quiet) setStatus('Boss review refreshed.', 'ok');
    } catch (error) {
      if (!quiet) setStatus(error.message || 'Unable to load boss review.', 'error');
    }
  }

  function bossSearchText(card) {
    const entries = Array.isArray(card.entries) ? card.entries : [];
    return [
      card.id,
      card.status,
      card.employeeName,
      card.workerName,
      card.ownerName,
      card.employeeEmail,
      card.workerEmail,
      card.employeeCode,
      card.employeePhone,
      card.crewRole,
      card.weekStart,
      card.weekEnd,
      card.submittedAt,
      ...entries.flatMap((entry) => [
        entry.date,
        entry.customer,
        entry.jobName,
        entry.service,
        entry.payType,
        entry.notes,
      ]),
    ].map((value) => String(value || '').toLowerCase()).join(' ');
  }

  function bossFilteredTimecards() {
    const query = cleanText(els.bossSearch && els.bossSearch.value, 140).toLowerCase();
    const status = cleanText(els.bossStatusFilter && els.bossStatusFilter.value, 40).toLowerCase();
    return state.bossTimecards.filter((card) => {
      const statusMatches = !status || String(card.status || 'submitted').toLowerCase() === status;
      const queryMatches = !query || bossSearchText(card).includes(query);
      return statusMatches && queryMatches;
    });
  }

  function renderBossTimecards() {
    state.filteredBossTimecards = bossFilteredTimecards();
    renderTimecardList(els.bossTimecards, state.filteredBossTimecards, {
      bossView: true,
      emptyMessage: state.bossTimecards.length
        ? 'No payroll records match that search.'
        : 'No submitted cards yet.',
    });
    if (els.bossFilterStatus) {
      els.bossFilterStatus.textContent = `Showing ${state.filteredBossTimecards.length} of ${state.bossTimecards.length} loaded payroll records.`;
    }
  }

  function renderTimecardList(root, timecards, options = {}) {
    if (!timecards.length) {
      root.innerHTML = `<p class="empty-state">${escapeHtml(options.emptyMessage || 'No submitted cards yet.')}</p>`;
      return;
    }

    root.innerHTML = timecards.map((card) => {
      const total = card.totals || totals(card.entries || []);
      const entryCount = Number(total.entryCount || (card.entries || []).length || 0);
      const quickBooksExport = card.quickBooksExport || {};
      const quickBooksSynced = quickBooksExport.status === 'synced';
      const actions = options.bossView
        ? `<div class="button-row">
            <button class="ghost-button" type="button" data-status-id="${escapeHtml(card.id)}" data-status-value="approved">Approve</button>
            <button class="ghost-button" type="button" data-status-id="${escapeHtml(card.id)}" data-status-value="needs-review">Needs Review</button>
            <button class="ghost-button" type="button" data-status-id="${escapeHtml(card.id)}" data-status-value="exported">Mark Exported</button>
            <button class="primary-button" type="button" data-qb-sync-id="${escapeHtml(card.id)}" ${quickBooksSynced ? 'disabled' : ''}>${quickBooksSynced ? 'Synced to QB' : 'Sync QuickBooks'}</button>
          </div>`
        : '';
      return `
        <article class="timecard-card">
          <div class="timecard-top">
            <div>
              <h3 class="timecard-title">${escapeHtml(card.workerName || card.ownerName || 'Crew member')}</h3>
              <div class="timecard-meta">
                <span>${escapeHtml(card.weekStart || '')}${card.weekEnd ? ` to ${escapeHtml(card.weekEnd)}` : ''}</span>
                <span>${formatHours(total.minutes || 0)} hr</span>
                <span>${entryCount} entries</span>
                <span class="pill">${escapeHtml(card.status || 'submitted')}</span>
              </div>
            </div>
            <button class="ghost-button" type="button" data-export-card="${escapeHtml(card.id)}">CSV</button>
          </div>
          <div class="timecard-meta">
            <span>${escapeHtml(card.employeeEmail || card.workerEmail || '')}</span>
            ${card.employeeCode ? `<span>Employee ID ${escapeHtml(card.employeeCode)}</span>` : ''}
            ${card.emailDelivery && card.emailDelivery.status ? `<span>Email ${escapeHtml(card.emailDelivery.status)}</span>` : ''}
            ${quickBooksExport.status ? `<span>QuickBooks ${escapeHtml(quickBooksExport.status)}</span>` : ''}
            <span>Submitted ${escapeHtml(card.submittedAt ? new Date(card.submittedAt).toLocaleString() : '')}</span>
          </div>
          ${actions}
        </article>
      `;
    }).join('');
  }

  async function updateTimecardStatus(id, status) {
    setStatus('Updating timecard...');
    try {
      const response = await fetch(`${apiBase()}/api/wagners/timecards/status`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Unable to update timecard.');
      }
      setStatus('Timecard updated.', 'ok');
      await loadBossTimecards({ quiet: true });
    } catch (error) {
      setStatus(error.message || 'Unable to update timecard.', 'error');
    }
  }

  async function loadQuickBooksStatus({ quiet = false } = {}) {
    if (!state.profile || !state.profile.signedIn || !state.isAdmin) return;
    try {
      const response = await fetch(`${apiBase()}/api/wagners/quickbooks/status`, {
        headers: await authHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Unable to load QuickBooks status.');
      }
      state.quickBooks = body;
      if (!body.configured) {
        setQuickBooksStatus('QuickBooks sync needs Intuit app credentials before it can connect.', 'error');
      } else if (body.connection && body.connection.connected) {
        setQuickBooksStatus(`QuickBooks connected${body.connection.connectedByEmail ? ` by ${body.connection.connectedByEmail}` : ''}.`, 'ok');
      } else {
        setQuickBooksStatus('QuickBooks is ready to connect. An authorized QuickBooks user must approve it.', '');
      }
      if (!quiet) setStatus('QuickBooks status refreshed.', 'ok');
    } catch (error) {
      setQuickBooksStatus(error.message || 'Unable to load QuickBooks status.', 'error');
    }
  }

  async function connectQuickBooks() {
    setQuickBooksStatus('Preparing QuickBooks connection...');
    try {
      const response = await fetch(`${apiBase()}/api/wagners/quickbooks/connect-url`, {
        headers: await authHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Unable to start QuickBooks connection.');
      }
      window.location.href = body.url;
    } catch (error) {
      setQuickBooksStatus(error.message || 'Unable to start QuickBooks connection.', 'error');
    }
  }

  async function syncTimecardToQuickBooks(id) {
    setStatus('Syncing timecard to QuickBooks...');
    try {
      const response = await fetch(`${apiBase()}/api/wagners/quickbooks/export-timecard`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        const details = Array.isArray(body.details) && body.details.length
          ? ` ${body.details.join(' ')}`
          : '';
        throw new Error(`${body.error || 'Unable to sync with QuickBooks.'}${details}`);
      }
      setStatus('Timecard synced to QuickBooks.', 'ok');
      await loadBossTimecards({ quiet: true });
    } catch (error) {
      setStatus(error.message || 'Unable to sync with QuickBooks.', 'error');
    }
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function timecardsToRows(timecards) {
    return timecards.flatMap((card) => {
      const entries = Array.isArray(card.entries) ? card.entries : [];
      return entries.map((entry) => ({
        employee: card.employeeName || card.workerName || card.ownerName || '',
        email: card.employeeEmail || card.workerEmail || card.ownerEmail || '',
        employeeCode: card.employeeCode || '',
        date: entry.date || '',
        customer: entry.customer || '',
        job: entry.jobName || '',
        service: entry.service || '',
        payType: entry.payType || '',
        start: entry.start || '',
        end: entry.end || '',
        breakMinutes: entry.breakMinutes || 0,
        hours: formatHours(entry.minutes || 0),
        billable: entry.billable === false ? 'No' : 'Yes',
        notes: entry.notes || '',
        timecardId: card.id || '',
        status: card.status || 'draft',
        submittedAt: card.submittedAt || '',
      }));
    });
  }

  function makeCsv(timecards) {
    const headers = [
      'Employee',
      'Employee Email',
      'Employee ID',
      'Date',
      'Customer or Project',
      'Job Name',
      'Service',
      'Pay Type',
      'Start Time',
      'End Time',
      'Break Minutes',
      'Hours',
      'Billable',
      'Notes',
      'Source Timecard ID',
      'Status',
      'Submitted At',
    ];
    const rows = timecardsToRows(timecards).map((row) => [
      row.employee,
      row.email,
      row.employeeCode,
      row.date,
      row.customer,
      row.job,
      row.service,
      row.payType,
      row.start,
      row.end,
      row.breakMinutes,
      row.hours,
      row.billable,
      row.notes,
      row.timecardId,
      row.status,
      row.submittedAt,
    ]);
    return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  }

  async function downloadCsv(timecards, name) {
    if (!timecards.length || !timecardsToRows(timecards).length) {
      setStatus('There are no timecard rows to export.', 'error');
      return;
    }
    const blob = new Blob([makeCsv(timecards)], { type: 'text/csv;charset=utf-8' });
    const fileName = `${name}-${todayIso()}.csv`;
    if (navigator.canShare && window.File) {
      const file = new File([blob], fileName, { type: 'text/csv' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName });
          return;
        } catch {
          // Fall back to a download link when sharing is cancelled or unsupported.
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function currentDraftAsTimecard() {
    const payload = currentPayload();
    return {
      ...payload,
      id: 'draft',
      status: 'draft',
      submittedAt: '',
      totals: totals(payload.entries),
    };
  }

  function findCard(id) {
    return [...state.myTimecards, ...state.bossTimecards].find((card) => String(card.id) === String(id));
  }

  function syncProfile(profile) {
    state.profile = profile || null;
    if (profile && profile.displayName && !els.workerName.value) {
      els.workerName.value = profile.displayName;
    }
    if (profile && profile.displayName && !els.signatureName.value) {
      els.signatureName.value = profile.displayName;
    }
    if (!profile || !profile.signedIn) {
      state.employeeProfile = null;
      setEmployeeAccountStatus('Sign in to create an employee account.');
    } else {
      loadEmployeeProfile();
    }
    loadMyTimecards();
  }

  function bindEvents() {
    els.entryForm.addEventListener('submit', addEntryFromForm);
    els.entriesList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-entry]');
      if (button) removeEntry(button.getAttribute('data-remove-entry'));
    });
    document.addEventListener('click', (event) => {
      const exportButton = event.target.closest('[data-export-card]');
      if (exportButton) {
        const card = findCard(exportButton.getAttribute('data-export-card'));
        if (card) downloadCsv([card], `wagners-timecard-${card.workerName || 'employee'}`);
      }
      const statusButton = event.target.closest('[data-status-id]');
      if (statusButton) {
        updateTimecardStatus(statusButton.getAttribute('data-status-id'), statusButton.getAttribute('data-status-value'));
      }
      const quickBooksButton = event.target.closest('[data-qb-sync-id]');
      if (quickBooksButton && !quickBooksButton.disabled) {
        syncTimecardToQuickBooks(quickBooksButton.getAttribute('data-qb-sync-id'));
      }
    });
    els.useTodayButton.addEventListener('click', () => {
      els.entryDate.value = todayIso();
    });
    els.saveDraftButton.addEventListener('click', () => saveDraft(true));
    els.installAppButton.addEventListener('click', installApp);
    els.saveEmployeeButton.addEventListener('click', () => {
      saveEmployeeProfile().catch((error) => {
        setEmployeeAccountStatus(error.message || 'Unable to save employee account.', 'error');
      });
    });
    els.submitCardButton.addEventListener('click', submitTimecard);
    els.newCardButton.addEventListener('click', () => clearDraft(true));
    els.exportDraftButton.addEventListener('click', () => downloadCsv([currentDraftAsTimecard()], 'wagners-timecard-draft'));
    els.refreshMineButton.addEventListener('click', loadMyTimecards);
    els.refreshBossButton.addEventListener('click', () => loadBossTimecards());
    els.exportBossButton.addEventListener('click', () => downloadCsv(state.bossTimecards, 'wagners-payroll-export'));
    els.bossSearch.addEventListener('input', renderBossTimecards);
    els.bossStatusFilter.addEventListener('change', renderBossTimecards);
    els.connectQuickBooksButton.addEventListener('click', connectQuickBooks);
    els.refreshQuickBooksButton.addEventListener('click', () => loadQuickBooksStatus());
    ['workerName', 'employeePhone', 'employeeCode', 'crewRole', 'weekStart', 'weekEnd', 'signatureName'].forEach((key) => {
      els[key].addEventListener('change', () => saveDraft());
      els[key].addEventListener('input', () => saveDraft());
    });
  }

  function cacheEls() {
    Object.assign(els, {
      summaryHours: $('summary-hours'),
      summaryJobs: $('summary-jobs'),
      summaryStatus: $('summary-status'),
      summarySync: $('summary-sync'),
      installAppButton: $('install-app-button'),
      workerName: $('worker-name'),
      employeePhone: $('employee-phone'),
      employeeCode: $('employee-code'),
      employeeAccountStatus: $('employee-account-status'),
      crewRole: $('crew-role'),
      weekStart: $('week-start'),
      weekEnd: $('week-end'),
      entryForm: $('entry-form'),
      entryDate: $('entry-date'),
      entryCustomer: $('entry-customer'),
      entryJob: $('entry-job'),
      entryService: $('entry-service'),
      entryPayType: $('entry-pay-type'),
      entryStart: $('entry-start'),
      entryEnd: $('entry-end'),
      entryBreak: $('entry-break'),
      entryBillable: $('entry-billable'),
      entryNotes: $('entry-notes'),
      entriesList: $('entries-list'),
      signatureName: $('signature-name'),
      certify: $('certify'),
      statusMessage: $('status-message'),
      myTimecards: $('my-timecards'),
      bossPanel: $('boss-panel'),
      bossTimecards: $('boss-timecards'),
      useTodayButton: $('use-today-button'),
      saveDraftButton: $('save-draft-button'),
      saveEmployeeButton: $('save-employee-button'),
      submitCardButton: $('submit-card-button'),
      newCardButton: $('new-card-button'),
      exportDraftButton: $('export-draft-button'),
      refreshMineButton: $('refresh-mine-button'),
      refreshBossButton: $('refresh-boss-button'),
      exportBossButton: $('export-boss-button'),
      bossSearch: $('boss-search'),
      bossStatusFilter: $('boss-status-filter'),
      bossFilterStatus: $('boss-filter-status'),
      connectQuickBooksButton: $('connect-quickbooks-button'),
      refreshQuickBooksButton: $('refresh-quickbooks-button'),
      quickBooksStatus: $('quickbooks-status'),
    });
  }

  function initAuth() {
    if (!window.NovaAuth || typeof window.NovaAuth.init !== 'function') {
      setStatus('Account sign-in is not available yet.', 'error');
      els.myTimecards.innerHTML = '<p class="empty-state">Sign in will appear when the account system loads.</p>';
      return;
    }
    window.NovaAuth.init({
      apiBaseUrl: apiBase(),
      onChange: syncProfile,
    }).then(syncProfile).catch((error) => {
      setStatus(error.message || 'Account sign-in could not start.', 'error');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheEls();
    loadDraft();
    renderEntries();
    bindEvents();
    renderInstallButton();
    registerServiceWorker();
    initAuth();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    renderInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setStatus('App installed.', 'ok');
    renderInstallButton();
  });
})();
