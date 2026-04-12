const PROD_SONGS_API_BASE = "https://backend-ujaa.onrender.com";
const SONG_OWNERSHIP_STORAGE_KEY = "nova-jukebox:owned-uploads";
const ALLOWED_SONG_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);
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
const fileInput = document.getElementById("song-file");
const dropZone = document.getElementById("song-drop-zone");
const pickButton = document.getElementById("song-pick-button");
const previewPanel = document.getElementById("song-file-preview");
const previewTitle = document.getElementById("song-preview-title");
const previewStatus = document.getElementById("song-preview-status");
const previewFileName = document.getElementById("song-preview-file-name");
const previewMeta = document.getElementById("song-preview-meta");
const previewAudio = document.getElementById("song-preview-audio");
const uploadStatus = document.getElementById("song-upload-status");
const songsStatus = document.getElementById("songs-status");
const songsEmpty = document.getElementById("songs-empty");
const songsList = document.getElementById("songs-list");
const songCountBadge = document.getElementById("song-count-badge");

const state = {
    activePreviewUrl: "",
    uploadInFlight: false,
};

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

function songDeleteEndpoint() {
    return `${songsApiBase()}/api/songs/delete`;
}

function readOwnedUploads() {
    try {
        const raw = window.localStorage.getItem(SONG_OWNERSHIP_STORAGE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeOwnedUploads(ownedUploads) {
    try {
        window.localStorage.setItem(SONG_OWNERSHIP_STORAGE_KEY, JSON.stringify(ownedUploads));
    } catch {
        // Ignore storage failures in restrictive browsers.
    }
}

function rememberOwnedUpload(songId, deleteToken) {
    if (!songId || !deleteToken) {
        return;
    }

    const ownedUploads = readOwnedUploads();
    ownedUploads[songId] = deleteToken;
    writeOwnedUploads(ownedUploads);
}

function forgetOwnedUpload(songId) {
    if (!songId) {
        return;
    }

    const ownedUploads = readOwnedUploads();
    delete ownedUploads[songId];
    writeOwnedUploads(ownedUploads);
}

function deleteTokenForSong(songId) {
    const ownedUploads = readOwnedUploads();
    const token = ownedUploads[songId];
    return typeof token === "string" ? token : "";
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

function setPreviewStatus(message, isError = false) {
    previewStatus.textContent = message;
    previewStatus.style.color = isError ? "#ff9c8f" : "";
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

function inferTitleFromFileName(fileName) {
    return String(fileName || "")
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "Untitled Upload";
}

function fileExtension(fileName) {
    const match = /\.([^.]+)$/.exec(String(fileName || ""));
    return match ? `.${match[1].toLowerCase()}` : "";
}

function isSupportedSongFile(file) {
    if (!file) {
        return false;
    }

    if (String(file.type || "").toLowerCase().startsWith("audio/")) {
        return true;
    }

    return ALLOWED_SONG_EXTENSIONS.has(fileExtension(file.name));
}

function releasePreviewUrl() {
    if (state.activePreviewUrl) {
        URL.revokeObjectURL(state.activePreviewUrl);
        state.activePreviewUrl = "";
    }
}

function setPreviewAudioSource(source) {
    previewAudio.pause();
    previewAudio.removeAttribute("src");
    previewAudio.load();
    if (!source) {
        return;
    }
    previewAudio.src = source;
}

function showLocalPreview(file, statusMessage) {
    releasePreviewUrl();
    state.activePreviewUrl = URL.createObjectURL(file);
    previewPanel.classList.remove("hidden");
    previewTitle.textContent = inferTitleFromFileName(file.name);
    previewFileName.textContent = file.name;
    previewMeta.textContent = `${formatBytes(file.size)} · ${fileExtension(file.name).slice(1).toUpperCase() || "Audio file"}`;
    setPreviewStatus(statusMessage);
    setPreviewAudioSource(state.activePreviewUrl);
}

function showUploadedPreview(song, fallbackFile) {
    previewPanel.classList.remove("hidden");
    previewTitle.textContent = song.title || inferTitleFromFileName(fallbackFile?.name || "");
    previewFileName.textContent = song.originalFileName || fallbackFile?.name || "";
    previewMeta.textContent = `${formatBytes(song.sizeBytes || fallbackFile?.size || 0)} · Live on Nova Jukebox`;
    setPreviewStatus("Uploaded live");
    releasePreviewUrl();
    setPreviewAudioSource(resolveAudioUrl(song));
}

function setDropZoneState({ dragging = false, busy = false } = {}) {
    dropZone.classList.toggle("is-dragging", dragging);
    dropZone.classList.toggle("is-busy", busy);
    dropZone.setAttribute("aria-disabled", String(busy));
    if (pickButton) {
        pickButton.disabled = busy;
    }
}

function trackCredit(song) {
    const artist = String(song.artist || "").trim();
    const uploader = String(song.uploaderName || "").trim();

    if (artist && uploader && artist.toLowerCase() !== uploader.toLowerCase()) {
        return `${artist} - uploaded by ${uploader}`;
    }

    return artist || uploader || "Community upload";
}

async function removeSong(songId, deleteButton) {
    const deleteToken = deleteTokenForSong(songId);
    if (!deleteToken) {
        setSongsStatus("This browser does not have delete access for that upload.", true);
        return;
    }

    if (!window.confirm("Remove this uploaded song from Nova Jukebox?")) {
        return;
    }

    deleteButton.disabled = true;
    deleteButton.textContent = "Removing...";

    try {
        const response = await fetch(songDeleteEndpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                songId,
                deleteToken,
            }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Unable to remove that upload.");
        }

        forgetOwnedUpload(songId);
        renderSongs(payload.songs || FALLBACK_SONGS);
        setSongsStatus("Upload removed from the jukebox.");
    } catch (error) {
        setSongsStatus(error.message, true);
        deleteButton.disabled = false;
        deleteButton.textContent = "Remove Upload";
    }
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

    const deleteToken = deleteTokenForSong(song.id);
    if (deleteToken && String(song.source || "") === "community") {
        const actions = document.createElement("div");
        actions.className = "song-actions";

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "song-remove-button";
        deleteButton.textContent = "Remove Upload";
        deleteButton.addEventListener("click", () => {
            removeSong(song.id, deleteButton);
        });

        actions.appendChild(deleteButton);
        article.appendChild(actions);
    }

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

async function uploadSelectedFile(file) {
    if (state.uploadInFlight) {
        return;
    }

    if (!file) {
        return;
    }

    if (!isSupportedSongFile(file)) {
        setUploadStatus("Choose an audio file in WAV, MP3, OGG, M4A, AAC, or FLAC format.", true);
        return;
    }

    state.uploadInFlight = true;
    setDropZoneState({ busy: true });
    setUploadStatus(`Uploading ${file.name}...`);
    showLocalPreview(file, "Uploading now");

    const formData = new FormData();
    formData.append("songFile", file, file.name);

    try {
        const response = await fetch(songsEndpoint(), {
            method: "POST",
            body: formData,
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Upload failed.");
        }

        if (payload.song && payload.song.id && payload.deleteToken) {
            rememberOwnedUpload(payload.song.id, payload.deleteToken);
            showUploadedPreview(payload.song, file);
        }

        renderSongs(payload.songs || FALLBACK_SONGS);
        setSongsStatus("");
        setUploadStatus(`${inferTitleFromFileName(file.name)} is live on the jukebox now.`);
        fileInput.value = "";
    } catch (error) {
        setPreviewStatus("Upload failed", true);
        setUploadStatus(error.message, true);
    } finally {
        state.uploadInFlight = false;
        setDropZoneState({ busy: false });
    }
}

function handleFileSelection(fileList) {
    const file = fileList && fileList[0];
    if (!file) {
        return;
    }

    uploadSelectedFile(file);
}

function openFilePicker() {
    if (state.uploadInFlight) {
        return;
    }

    fileInput.click();
}

function hasDraggedFiles(event) {
    const types = event.dataTransfer ? Array.from(event.dataTransfer.types || []) : [];
    return types.includes("Files");
}

function bindUploadInteractions() {
    if (!uploadForm || !fileInput || !dropZone || !pickButton) {
        return;
    }

    pickButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFilePicker();
    });

    dropZone.addEventListener("click", () => {
        openFilePicker();
    });

    dropZone.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        event.preventDefault();
        openFilePicker();
    });

    fileInput.addEventListener("change", () => {
        handleFileSelection(fileInput.files);
    });

    for (const eventName of ["dragenter", "dragover"]) {
        dropZone.addEventListener(eventName, (event) => {
            if (!hasDraggedFiles(event)) {
                return;
            }
            event.preventDefault();
            if (!state.uploadInFlight) {
                setDropZoneState({ dragging: true, busy: false });
            }
        });
    }

    dropZone.addEventListener("dragleave", (event) => {
        event.preventDefault();
        if (!dropZone.contains(event.relatedTarget)) {
            setDropZoneState({ dragging: false, busy: state.uploadInFlight });
        }
    });

    dropZone.addEventListener("drop", (event) => {
        if (!hasDraggedFiles(event)) {
            return;
        }
        event.preventDefault();
        setDropZoneState({ dragging: false, busy: state.uploadInFlight });
        if (state.uploadInFlight) {
            return;
        }
        handleFileSelection(event.dataTransfer.files);
    });
}

if (
    uploadForm &&
    fileInput &&
    dropZone &&
    pickButton &&
    previewPanel &&
    previewTitle &&
    previewStatus &&
    previewFileName &&
    previewMeta &&
    previewAudio &&
    uploadStatus &&
    songsStatus &&
    songsEmpty &&
    songsList &&
    songCountBadge
) {
    bindUploadInteractions();
    loadSongs();
    window.addEventListener("beforeunload", releasePreviewUrl);
}
