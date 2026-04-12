const PROD_CITY_RAID_API_BASE = "https://backend-ujaa.onrender.com";

const joinForm = document.getElementById("city-raid-join-form");
const roomCodeInput = document.getElementById("city-raid-room-code");
const resolveButton = document.getElementById("city-raid-resolve-button");
const joinStatus = document.getElementById("city-raid-join-status");
const joinResult = document.getElementById("city-raid-join-result");
const resolvedRoomCode = document.getElementById("city-raid-resolved-room-code");
const resolvedHostName = document.getElementById("city-raid-resolved-host-name");
const resolvedNote = document.getElementById("city-raid-resolved-note");
const resolvedVersion = document.getElementById("city-raid-resolved-version");
const resolvedUpdated = document.getElementById("city-raid-resolved-updated");
const resolvedAddress = document.getElementById("city-raid-resolved-address");
const shareLink = document.getElementById("city-raid-share-link");
const launchCommand = document.getElementById("city-raid-launch-command");
const copyAddressButton = document.getElementById("city-raid-copy-address");
const copyCommandButton = document.getElementById("city-raid-copy-command");
const refreshButton = document.getElementById("city-raid-refresh-lobbies");
const lobbiesStatus = document.getElementById("city-raid-lobbies-status");
const lobbiesEmpty = document.getElementById("city-raid-lobbies-empty");
const lobbiesList = document.getElementById("city-raid-lobbies-list");

function cityRaidApiBase() {
    const explicit = typeof window.CITY_RAID_API_BASE === "string" ? window.CITY_RAID_API_BASE.trim() : "";
    if (explicit) {
        return explicit.replace(/\/$/, "");
    }

    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
        return "http://127.0.0.1:8081";
    }

    if (host === "backend-ujaa.onrender.com") {
        return window.location.origin;
    }

    return PROD_CITY_RAID_API_BASE;
}

function lobbiesEndpoint() {
    return `${cityRaidApiBase()}/api/cityraid/lobbies`;
}

function resolveEndpoint(roomCode) {
    return `${cityRaidApiBase()}/api/cityraid/lobbies/resolve?roomCode=${encodeURIComponent(roomCode)}`;
}

function normalizeRoomCode(raw) {
    return String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 5);
}

function setJoinBusy(busy) {
    if (!resolveButton) {
        return;
    }
    resolveButton.disabled = busy;
    resolveButton.textContent = busy ? "Looking..." : "Find Room";
}

function setJoinStatus(message, isError = false) {
    if (!joinStatus) {
        return;
    }
    joinStatus.textContent = message;
    joinStatus.style.color = isError ? "#ff9c8f" : "";
}

function setLobbiesStatus(message, isError = false) {
    if (!lobbiesStatus) {
        return;
    }
    lobbiesStatus.textContent = message;
    lobbiesStatus.style.color = isError ? "#ff9c8f" : "";
}

function buildLaunchCommand(address) {
    return `FIRSTPERSON.exe ${address}`;
}

function formatUpdatedAt(isoDate) {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return "Fresh heartbeat";
    }

    return `Updated ${date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    })}`;
}

function safeText(value, fallback) {
    const text = String(value || "").trim();
    return text || fallback;
}

async function readJson(url, options) {
    let response;

    try {
        response = await fetch(url, options);
    } catch {
        throw new Error("The live City Raid lobby service is unavailable right now.");
    }

    let payload = {};
    try {
        payload = await response.json();
    } catch {
        payload = {};
    }

    if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "The City Raid lobby request could not be completed.");
    }

    return payload;
}

function showJoinResult(payload) {
    const lobby = payload && payload.lobby ? payload.lobby : {};
    const roomCode = safeText(payload.roomCode || lobby.roomCode, "-----");
    const joinAddress = safeText(payload.joinAddress || lobby.joinAddress, "");
    const nextShareLink = safeText(lobby.shareUrl, window.location.href);

    resolvedRoomCode.textContent = roomCode;
    resolvedHostName.textContent = safeText(lobby.hostName, "City Raid Host");
    resolvedNote.textContent = safeText(lobby.note, "Room ready to join right now.");
    resolvedVersion.textContent = safeText(lobby.version, "Current build");
    resolvedUpdated.textContent = formatUpdatedAt(lobby.updatedAt);
    resolvedAddress.textContent = joinAddress || "Join address unavailable";
    launchCommand.textContent = joinAddress ? buildLaunchCommand(joinAddress) : "Run JOIN-CITY-RAID-MULTIPLAYER.bat and paste the room code";
    shareLink.href = nextShareLink;
    shareLink.textContent = nextShareLink;
    joinResult.classList.remove("hidden");
}

async function copyText(text, button, idleLabel) {
    if (!button || !text) {
        return;
    }

    const original = idleLabel || button.textContent;
    try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
        window.setTimeout(() => {
            button.textContent = original;
        }, 1400);
    } catch {
        button.textContent = "Copy failed";
        window.setTimeout(() => {
            button.textContent = original;
        }, 1400);
    }
}

function createLobbyCard(lobby) {
    const article = document.createElement("article");
    article.className = "room-card";

    const top = document.createElement("div");
    top.className = "room-card-top";

    const titleWrap = document.createElement("div");
    const roomCode = document.createElement("strong");
    roomCode.textContent = safeText(lobby.roomCode, "-----");
    const host = document.createElement("p");
    host.textContent = safeText(lobby.hostName, "City Raid Host");
    titleWrap.append(roomCode, host);

    const chip = document.createElement("span");
    chip.className = "lobby-chip";
    chip.textContent = safeText(lobby.version, "Current build");

    top.append(titleWrap, chip);

    const note = document.createElement("p");
    note.textContent = safeText(lobby.note, "Room live on the board now.");

    const meta = document.createElement("div");
    meta.className = "result-meta";
    for (const text of [
        safeText(lobby.publicAddressHint || lobby.joinAddress, "Address pending"),
        formatUpdatedAt(lobby.updatedAt),
    ]) {
        const item = document.createElement("span");
        item.textContent = text;
        meta.appendChild(item);
    }

    const actions = document.createElement("div");
    actions.className = "room-card-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "btn btn-primary room-code-button";
    openButton.textContent = "Use This Room";
    openButton.addEventListener("click", async () => {
        roomCodeInput.value = safeText(lobby.roomCode, "");
        await resolveRoomCode(safeText(lobby.roomCode, ""));
        document.getElementById("co-op")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "btn btn-secondary";
    copyButton.textContent = "Copy Link";
    copyButton.addEventListener("click", async () => {
        await copyText(safeText(lobby.shareUrl, ""), copyButton, "Copy Link");
    });

    actions.append(openButton, copyButton);
    article.append(top, note, meta, actions);
    return article;
}

function renderLobbies(lobbies) {
    const safeLobbies = Array.isArray(lobbies) ? lobbies : [];
    lobbiesList.innerHTML = "";
    lobbiesEmpty.classList.toggle("hidden", safeLobbies.length > 0);

    for (const lobby of safeLobbies) {
        lobbiesList.appendChild(createLobbyCard(lobby));
    }
}

async function loadLobbies() {
    setLobbiesStatus("Refreshing live rooms...");

    try {
        const payload = await readJson(lobbiesEndpoint(), {
            method: "GET",
            headers: {
                Accept: "application/json",
            },
        });
        renderLobbies(payload.lobbies);
        setLobbiesStatus(payload.lobbies && payload.lobbies.length ? "" : "No public rooms are active right now.");
    } catch (error) {
        renderLobbies([]);
        setLobbiesStatus(error.message, true);
    }
}

async function resolveRoomCode(rawRoomCode) {
    const roomCode = normalizeRoomCode(rawRoomCode);
    if (!roomCode) {
        setJoinStatus("Enter a five-character room code first.", true);
        joinResult.classList.add("hidden");
        return;
    }

    setJoinBusy(true);
    setJoinStatus(`Resolving room ${roomCode}...`);

    try {
        const payload = await readJson(resolveEndpoint(roomCode), {
            method: "GET",
            headers: {
                Accept: "application/json",
            },
        });
        showJoinResult(payload);
        setJoinStatus(`Room ${roomCode} is ready.`);
    } catch (error) {
        joinResult.classList.add("hidden");
        setJoinStatus(error.message, true);
    } finally {
        setJoinBusy(false);
    }
}

function bindEvents() {
    if (!joinForm || !roomCodeInput || !refreshButton) {
        return;
    }

    joinForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await resolveRoomCode(roomCodeInput.value);
    });

    roomCodeInput.addEventListener("input", () => {
        roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
    });

    refreshButton.addEventListener("click", async () => {
        await loadLobbies();
    });

    copyAddressButton?.addEventListener("click", async () => {
        await copyText(resolvedAddress.textContent, copyAddressButton, "Copy Address");
    });

    copyCommandButton?.addEventListener("click", async () => {
        await copyText(launchCommand.textContent, copyCommandButton, "Copy Launch Line");
    });
}

async function initCityRaidPage() {
    if (!joinForm || !roomCodeInput || !joinResult || !lobbiesList || !lobbiesEmpty) {
        return;
    }

    bindEvents();
    await loadLobbies();

    const initialRoomCode = normalizeRoomCode(new URL(window.location.href).searchParams.get("room"));
    if (initialRoomCode) {
        roomCodeInput.value = initialRoomCode;
        await resolveRoomCode(initialRoomCode);
    }

    window.setInterval(() => {
        loadLobbies();
    }, 20000);
}

initCityRaidPage();
