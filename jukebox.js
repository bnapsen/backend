const PROD_SONGS_API_BASE = "https://backend-ujaa.onrender.com";
const FALLBACK_SONGS = [
    {
        id: "seed-sude",
        title: "Sude",
        artist: "Ben Wagner",
        uploaderName: "Ben Wagner",
        description: "The first track inside Nova Jukebox.",
        createdAt: "2026-04-12T12:26:58.000Z",
        sizeBytes: 35835052,
        mimeType: "audio/wav",
        source: "featured",
        audioPath: "/assets/music/sude.wav",
        originalFileName: "sude.wav",
    },
];

const uploadForm = document.getElementById("song-upload-form");
const uploadStatus = document.getElementById("song-upload-status");
const songsStatus = document.getElementById("songs-status");
const songsEmpty = document.getElementById("songs-empty");
const songsList = document.getElementById("songs-list");
const songCountBadge = document.getElementById("song-count-badge");
const submitButton = uploadForm ? uploadForm.querySelector('button[type="submit"]') : null;

function songsApiBase() {
    const explicit = typeof window.SONGS_API_BASE === "string" ? window.SONGS_API_BASE.trim() : "";
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

    return PROD_SONGS_API_BASE;
}

function songsEndpoint() {
    return `${songsApiBase()}/api/songs`;
}

function resolveAudioUrl(song) {
    const audioPath = String(song.audioPath || "").trim();
    if (!audioPath) {
        return "";
    }

    if (/^https?:\/\//i.test(audioPath)) {
        return audioPath;
    }

    if (audioPath.startsWith("/media/")) {
        return `${songsApiBase()}${audioPath}`;
    }

    return audioPath;
}

function setUploadStatus(message, isError = false) {
    uploadStatus.textContent = message;
    uploadStatus.style.color = isError ? "#ff9c8f" : "";
}

function setSongsStatus(message, isError = false) {
    songsStatus.textContent = message;
    songsStatus.style.color = isError ? "#ff9c8f" : "";
}

function setSubmitDisabled(disabled) {
    if (!submitButton) {
        return;
    }

    submitButton.disabled = disabled;
    submitButton.style.opacity = disabled ? "0.7" : "";
    submitButton.style.cursor = disabled ? "wait" : "";
}

function formatDate(isoDate) {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return "Just added";
    }

    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) {
        return "Unknown size";
    }

    const units = ["B", "KB", "MB", "GB"];
    let amount = value;
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
    }

    const digits = amount >= 100 || unitIndex === 0 ? 0 : 1;
    return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

function trackCredit(song) {
    const artist = String(song.artist || "").trim();
    const uploader = String(song.uploaderName || "").trim();

    if (artist && uploader && artist.toLowerCase() !== uploader.toLowerCase()) {
        return `${artist} · uploaded by ${uploader}`;
    }

    return artist || uploader || "Community upload";
}

function createSongCard(song) {
    const article = document.createElement("article");
    article.className = "song-card";

    const source = String(song.source || "community") === "featured" ? "Featured track" : "Community upload";
    const sourceClass = source === "Community upload" ? "song-source song-source--community" : "song-source";

    const top = document.createElement("div");
    top.className = "song-card-top";

    const headingBlock = document.createElement("div");

    const badge = document.createElement("span");
    badge.className = sourceClass;
    badge.textContent = source;

    const title = document.createElement("h3");
    title.textContent = song.title || "Untitled Track";

    const credit = document.createElement("p");
    credit.className = "song-credit";
    credit.textContent = trackCredit(song);

    headingBlock.append(badge, title, credit);
    top.appendChild(headingBlock);

    const description = document.createElement("p");
    description.className = "song-description";
    description.textContent = song.description || "Dropped into the shelf with no extra note.";

    const playerWrap = document.createElement("div");
    playerWrap.className = "song-player";
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = resolveAudioUrl(song);
    playerWrap.appendChild(audio);

    const meta = document.createElement("div");
    meta.className = "song-meta";
    for (const value of [
        formatDate(song.createdAt),
        formatBytes(song.sizeBytes),
        song.originalFileName || "Audio file",
    ]) {
        const item = document.createElement("span");
        item.textContent = value;
        meta.appendChild(item);
    }

    article.append(top, description, playerWrap, meta);

    return article;
}

function renderSongs(songs) {
    const safeSongs = Array.isArray(songs) ? songs : [];
    songsList.innerHTML = "";
    songsEmpty.classList.toggle("hidden", safeSongs.length > 0);
    songCountBadge.textContent = `${safeSongs.length} track${safeSongs.length === 1 ? "" : "s"} live`;

    for (const song of safeSongs) {
        songsList.appendChild(createSongCard(song));
    }
}

async function loadSongs() {
    try {
        const response = await fetch(songsEndpoint());
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Unable to load the jukebox.");
        }

        renderSongs(payload.songs);
        setSongsStatus("");
    } catch (error) {
        renderSongs(FALLBACK_SONGS);
        setSongsStatus("Live uploads are unavailable right now. Showing the featured track instead.", true);
    }
}

async function handleUpload(event) {
    event.preventDefault();
    if (!uploadForm) {
        return;
    }

    const formData = new FormData(uploadForm);
    setSubmitDisabled(true);
    setUploadStatus("Uploading track...");

    try {
        const response = await fetch(songsEndpoint(), {
            method: "POST",
            body: formData,
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Upload failed.");
        }

        uploadForm.reset();
        setUploadStatus("Track uploaded. It is live on the jukebox now.");
        renderSongs(payload.songs || FALLBACK_SONGS);
        setSongsStatus("");
    } catch (error) {
        setUploadStatus(error.message, true);
    } finally {
        setSubmitDisabled(false);
    }
}

if (uploadForm && uploadStatus && songsStatus && songsEmpty && songsList && songCountBadge) {
    uploadForm.addEventListener("submit", handleUpload);
    loadSongs();
}
