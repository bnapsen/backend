const PROD_CLIPS_API_BASE = "https://nova-arcade-backend-1000121513328.us-central1.run.app";
const CLIP_OWNERSHIP_STORAGE_KEY = "nova-clips:owned-uploads";
const MAX_CLIP_UPLOAD_BYTES = 24 * 1024 * 1024;
const CLIP_REPORTER_STORAGE_KEY = "nova-clips:reporter-id";
const CLIP_VIEWER_STORAGE_KEY = "nova-clips:viewer-id";
const CLIP_COMMENTER_NAME_STORAGE_KEY = "nova-clips:commenter-name";
const CLIP_REACTION_STORAGE_KEY = "nova-clips:reactions";
const CLIP_VIEWED_STORAGE_KEY = "nova-clips:viewed";
const ALLOWED_CLIP_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".3gp", ".3gpp"]);
const EMOJI_REACTION_OPTIONS = ["❤️", "🔥", "😂", "👏"];

const uploadForm = document.getElementById("clip-upload-form");
const fileInput = document.getElementById("clip-file");
const dropZone = document.getElementById("clip-drop-zone");
const pickButton = document.getElementById("clip-pick-button");
const previewPanel = document.getElementById("clip-preview-panel");
const previewTitle = document.getElementById("clip-preview-title");
const previewStatus = document.getElementById("clip-preview-status");
const previewFileName = document.getElementById("clip-preview-file-name");
const previewMeta = document.getElementById("clip-preview-meta");
const previewVideo = document.getElementById("clip-preview-video");
const uploadStatus = document.getElementById("clip-upload-status");
const clipsStatus = document.getElementById("clips-status");
const clipsEmpty = document.getElementById("clips-empty");
const clipsFeed = document.getElementById("clips-feed");
const clipCountBadge = document.getElementById("clip-count-badge");
const clipAdminPanel = document.getElementById("clip-admin-panel");
const clipAdminStoredCount = document.getElementById("clip-admin-stored-count");
const clipAdminFeedCount = document.getElementById("clip-admin-feed-count");
const clipAdminStorageUsed = document.getElementById("clip-admin-storage-used");
const clipAdminFreeTierUsage = document.getElementById("clip-admin-free-tier-usage");
const clipAdminNote = document.getElementById("clip-admin-note");
const uploaderNameInput = document.getElementById("clip-uploader-name");
const titleInput = document.getElementById("clip-title");
const captionInput = document.getElementById("clip-caption");
const submitButton = document.getElementById("clip-submit-button");
const adminMode = new URLSearchParams(window.location.search).get("admin") === "1";

const state = {
    activePreviewUrl: "",
    uploadInFlight: false,
    observer: null,
    selectedFile: null,
    audioUnlocked: false,
    storageStats: null,
    renderedClips: [],
    viewTimers: new Map(),
    viewedClipIds: new Set(),
};

state.viewedClipIds = new Set(readViewedClipIds());

function updateMuteButtonState(video, muteButton) {
    if (!muteButton) {
        return;
    }
    muteButton.textContent = video.muted ? "Unmute" : "Mute";
}

async function playFeedVideo(video) {
    const muteButton = video.parentElement?.querySelector(".clip-mute-toggle");
    const userMuted = video.dataset.userMuted === "true";
    const shouldTrySound = !userMuted;

    if (shouldTrySound) {
        video.muted = false;
        video.defaultMuted = false;
        updateMuteButtonState(video, muteButton);
        try {
            await video.play();
            return;
        } catch {
            // Fall through to muted autoplay for browsers that block sound until user interaction.
        }
    }

    video.muted = true;
    video.defaultMuted = true;
    updateMuteButtonState(video, muteButton);
    try {
        await video.play();
    } catch {
        // Ignore autoplay failures.
    }
}

function unlockFeedAudio() {
    if (state.audioUnlocked) {
        return;
    }

    state.audioUnlocked = true;
    clipsFeed.querySelectorAll("video[data-feed-video='true']").forEach((video) => {
        if (video.dataset.userMuted === "true") {
            return;
        }
        video.muted = false;
        video.defaultMuted = false;
        const muteButton = video.parentElement?.querySelector(".clip-mute-toggle");
        updateMuteButtonState(video, muteButton);
    });

    clipsFeed
        .querySelectorAll("video[data-feed-video='true'][data-in-view='true']")
        .forEach((video) => {
            playFeedVideo(video);
        });
}

function clipsApiBase() {
    const explicit = typeof window.CLIPS_API_BASE === "string" ? window.CLIPS_API_BASE.trim() : "";
    if (explicit) {
        return explicit.replace(/\/$/, "");
    }

    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
        return "http://127.0.0.1:8081";
    }

    if (host === "nova-arcade-backend-1000121513328.us-central1.run.app") {
        return window.location.origin;
    }

    return PROD_CLIPS_API_BASE;
}

function clipsEndpoint() {
    return `${clipsApiBase()}/api/clips`;
}

function clipDeleteEndpoint() {
    return `${clipsApiBase()}/api/clips/delete`;
}

function clipReportEndpoint() {
    return `${clipsApiBase()}/api/clips/report`;
}

function clipViewEndpoint() {
    return `${clipsApiBase()}/api/clips/view`;
}

function clipReactionEndpoint() {
    return `${clipsApiBase()}/api/clips/react`;
}

function clipCommentEndpoint() {
    return `${clipsApiBase()}/api/clips/comment`;
}

function clipStorageAdminEndpoint() {
    return `${clipsApiBase()}/api/clips/admin/storage`;
}

function readOwnedUploads() {
    try {
        const raw = window.localStorage.getItem(CLIP_OWNERSHIP_STORAGE_KEY);
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
        window.localStorage.setItem(CLIP_OWNERSHIP_STORAGE_KEY, JSON.stringify(ownedUploads));
    } catch {
        // Ignore storage failures in restrictive browsers.
    }
}

function rememberOwnedUpload(clipId, deleteToken) {
    if (!clipId || !deleteToken) {
        return;
    }

    const ownedUploads = readOwnedUploads();
    ownedUploads[clipId] = deleteToken;
    writeOwnedUploads(ownedUploads);
}

function forgetOwnedUpload(clipId) {
    if (!clipId) {
        return;
    }

    const ownedUploads = readOwnedUploads();
    delete ownedUploads[clipId];
    writeOwnedUploads(ownedUploads);
}

function deleteTokenForClip(clipId) {
    const ownedUploads = readOwnedUploads();
    const token = ownedUploads[clipId];
    return typeof token === "string" ? token : "";
}

function reporterKey() {
    try {
        const existing = window.localStorage.getItem(CLIP_REPORTER_STORAGE_KEY);
        if (existing) {
            return existing;
        }
        const nextValue = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.localStorage.setItem(CLIP_REPORTER_STORAGE_KEY, nextValue);
        return nextValue;
    } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}

function viewerKey() {
    try {
        const existing = window.localStorage.getItem(CLIP_VIEWER_STORAGE_KEY);
        if (existing) {
            return existing;
        }
        const nextValue = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.localStorage.setItem(CLIP_VIEWER_STORAGE_KEY, nextValue);
        return nextValue;
    } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}

function readCommenterName() {
    try {
        return window.localStorage.getItem(CLIP_COMMENTER_NAME_STORAGE_KEY) || "";
    } catch {
        return "";
    }
}

function writeCommenterName(name) {
    try {
        if (!name) {
            window.localStorage.removeItem(CLIP_COMMENTER_NAME_STORAGE_KEY);
            return;
        }
        window.localStorage.setItem(CLIP_COMMENTER_NAME_STORAGE_KEY, name);
    } catch {
        // Ignore storage failures.
    }
}

function readReactionSelections() {
    try {
        const raw = window.localStorage.getItem(CLIP_REACTION_STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeReactionSelections(reactions) {
    try {
        window.localStorage.setItem(CLIP_REACTION_STORAGE_KEY, JSON.stringify(reactions));
    } catch {
        // Ignore storage failures.
    }
}

function reactionSelectionValue(reaction) {
    if (!reaction || typeof reaction !== "object" || !reaction.type) {
        return "";
    }
    if (reaction.type === "emoji" && reaction.emoji) {
        return `emoji:${reaction.emoji}`;
    }
    return reaction.type;
}

function reactionSelectionForClip(clipId) {
    const value = String(readReactionSelections()[clipId] || "");
    if (value === "like" || value === "dislike") {
        return { type: value, emoji: "" };
    }
    if (value.startsWith("emoji:")) {
        return { type: "emoji", emoji: value.slice(6) };
    }
    return null;
}

function rememberReactionSelection(clipId, reaction) {
    const reactions = readReactionSelections();
    const nextValue = reactionSelectionValue(reaction);
    if (!nextValue) {
        delete reactions[clipId];
    } else {
        reactions[clipId] = nextValue;
    }
    writeReactionSelections(reactions);
}

function readViewedClipIds() {
    try {
        const raw = window.localStorage.getItem(CLIP_VIEWED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map((value) => String(value || "")).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function rememberViewedClip(clipId) {
    if (!clipId) {
        return;
    }

    state.viewedClipIds.add(clipId);
    try {
        window.localStorage.setItem(CLIP_VIEWED_STORAGE_KEY, JSON.stringify([...state.viewedClipIds]));
    } catch {
        // Ignore storage failures.
    }
}

function resolveClipUrl(resourcePath) {
    const pathValue = String(resourcePath || "").trim();
    if (!pathValue) {
        return "";
    }

    if (/^https?:\/\//i.test(pathValue)) {
        return pathValue;
    }

    if (pathValue.startsWith("/media/")) {
        return `${clipsApiBase()}${pathValue}`;
    }

    return pathValue;
}

function setUploadStatus(message, isError = false) {
    uploadStatus.textContent = message;
    uploadStatus.style.color = isError ? "#ff9c8f" : "";
}

function setClipsStatus(message, isError = false) {
    clipsStatus.textContent = message;
    clipsStatus.style.color = isError ? "#ff9c8f" : "";
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
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value < 0) {
        return "Unknown size";
    }
    if (value === 0) {
        return "0 B";
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

function formatPercent(numerator, denominator) {
    const safeNumerator = Number(numerator || 0);
    const safeDenominator = Number(denominator || 0);
    if (!Number.isFinite(safeNumerator) || !Number.isFinite(safeDenominator) || safeDenominator <= 0) {
        return "N/A";
    }

    return `${((safeNumerator / safeDenominator) * 100).toFixed(1)}%`;
}

function formatDuration(seconds) {
    const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatCount(value, label) {
    const safeValue = Number(value || 0);
    return `${safeValue.toLocaleString()} ${label}`;
}

function currentCommenterName() {
    return readCommenterName() || uploaderNameInput?.value?.trim() || "";
}

function rememberClipInState(updatedClip) {
    if (!updatedClip || !updatedClip.id) {
        return;
    }

    const nextClips = Array.isArray(state.renderedClips) ? state.renderedClips.slice() : [];
    const clipIndex = nextClips.findIndex((clip) => clip.id === updatedClip.id);
    if (clipIndex >= 0) {
        nextClips[clipIndex] = updatedClip;
    } else {
        nextClips.unshift(updatedClip);
    }
    state.renderedClips = nextClips;
}

function renderClipMetrics(card, clip) {
    if (!card || !clip) {
        return;
    }

    const viewNode = card.querySelector("[data-clip-view-count]");
    const likeNode = card.querySelector("[data-clip-like-count]");
    const dislikeNode = card.querySelector("[data-clip-dislike-count]");
    const commentNode = card.querySelector("[data-clip-comment-count]");
    if (viewNode) {
        viewNode.textContent = formatCount(clip.viewCount, "views");
    }
    if (likeNode) {
        likeNode.textContent = formatCount(clip.likeCount, "likes");
    }
    if (dislikeNode) {
        dislikeNode.textContent = formatCount(clip.dislikeCount, "dislikes");
    }
    if (commentNode) {
        commentNode.textContent = formatCount(clip.commentCount, "comments");
    }
}

function replaceClipCard(updatedClip) {
    if (!updatedClip || !updatedClip.id) {
        return;
    }

    rememberClipInState(updatedClip);
    const existingCard = clipsFeed.querySelector(`[data-clip-id="${updatedClip.id}"]`);
    if (!existingCard) {
        renderClips(state.renderedClips, { preserveScroll: true });
        return;
    }

    const nextCard = createClipCard(updatedClip);
    existingCard.replaceWith(nextCard);
    attachFeedObserver();
}

function inferTitleFromFileName(fileName) {
    return String(fileName || "")
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "Untitled Clip";
}

function fileExtension(fileName) {
    const match = /\.([^.]+)$/.exec(String(fileName || ""));
    return match ? `.${match[1].toLowerCase()}` : "";
}

function isSupportedClipFile(file) {
    if (!file) {
        return false;
    }

    if (String(file.type || "").toLowerCase().startsWith("video/")) {
        return true;
    }

    return ALLOWED_CLIP_EXTENSIONS.has(fileExtension(file.name));
}

function releasePreviewUrl() {
    if (state.activePreviewUrl) {
        URL.revokeObjectURL(state.activePreviewUrl);
        state.activePreviewUrl = "";
    }
}

function setPreviewVideoSource(source) {
    previewVideo.pause();
    previewVideo.removeAttribute("src");
    previewVideo.load();
    if (!source) {
        return;
    }
    previewVideo.src = source;
}

function loadVideoMetadata(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const probeVideo = document.createElement("video");
        probeVideo.preload = "metadata";
        probeVideo.muted = true;
        probeVideo.playsInline = true;
        probeVideo.src = objectUrl;

        probeVideo.onloadedmetadata = () => {
            resolve({
                duration: probeVideo.duration,
                width: probeVideo.videoWidth,
                height: probeVideo.videoHeight,
                objectUrl,
            });
        };

        probeVideo.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("That video could not be read."));
        };
    });
}

function showFallbackPreview(file, statusMessage) {
    releasePreviewUrl();
    previewPanel.classList.remove("hidden");
    previewTitle.textContent = titleInput.value.trim() || inferTitleFromFileName(file.name);
    previewFileName.textContent = file.name;
    previewMeta.textContent = `${formatBytes(file.size)} - Local preview unavailable, server will validate and convert it.`;
    setPreviewStatus(statusMessage);
    previewVideo.pause();
    previewVideo.removeAttribute("src");
    previewVideo.removeAttribute("poster");
    previewVideo.load();
}

function showLocalPreview(file, metadata, statusMessage) {
    releasePreviewUrl();
    state.activePreviewUrl = metadata.objectUrl;
    previewPanel.classList.remove("hidden");
    previewTitle.textContent = titleInput.value.trim() || inferTitleFromFileName(file.name);
    previewFileName.textContent = file.name;
    previewMeta.textContent = `${formatDuration(metadata.duration)} - ${formatBytes(file.size)} - ${metadata.width}x${metadata.height}`;
    setPreviewStatus(statusMessage);
    setPreviewVideoSource(state.activePreviewUrl);
}

function showUploadedPreview(clip, fallbackFile) {
    previewPanel.classList.remove("hidden");
    previewTitle.textContent = clip.title || inferTitleFromFileName(fallbackFile?.name || "");
    previewFileName.textContent = fallbackFile?.name || clip.title || "Uploaded clip";
    previewMeta.textContent = `${formatDuration(clip.durationSeconds)} - ${formatBytes(clip.sizeBytes)} - Live on Nova Clips`;
    setPreviewStatus("Uploaded live");
    releasePreviewUrl();
    setPreviewVideoSource(resolveClipUrl(clip.videoPath));
    previewVideo.poster = resolveClipUrl(clip.posterPath);
}

function setDropZoneState({ dragging = false, busy = false } = {}) {
    dropZone.classList.toggle("is-dragging", dragging);
    dropZone.classList.toggle("is-busy", busy);
    dropZone.setAttribute("aria-disabled", String(busy));
    if (pickButton) {
        pickButton.disabled = busy;
    }
    if (submitButton) {
        submitButton.disabled = busy;
    }
}

async function removeClip(clipId, deleteButton) {
    const deleteToken = deleteTokenForClip(clipId);
    if (!deleteToken) {
        setClipsStatus("This browser does not have delete access for that clip.", true);
        return;
    }

    if (!window.confirm("Remove this clip from Nova Clips?")) {
        return;
    }

    deleteButton.disabled = true;
    deleteButton.textContent = "Removing...";

    try {
        const response = await fetch(clipDeleteEndpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clipId,
                deleteToken,
            }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Unable to remove that clip.");
        }

        forgetOwnedUpload(clipId);
        renderClips(payload.clips || []);
        await fetchClipAdminStats();
        setClipsStatus("Clip removed from the feed.");
    } catch (error) {
        setClipsStatus(error.message, true);
        deleteButton.disabled = false;
        deleteButton.textContent = "Delete Clip";
    }
}

async function reportClip(clipId, reportButton) {
    reportButton.disabled = true;
    reportButton.textContent = "Reporting...";

    try {
        const response = await fetch(clipReportEndpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clipId,
                reporterKey: reporterKey(),
            }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Unable to report that clip.");
        }

        setClipsStatus(payload.alreadyReported ? "You already reported that clip." : "Clip reported for review.");
        reportButton.textContent = payload.alreadyReported ? "Already Reported" : "Reported";
    } catch (error) {
        setClipsStatus(error.message, true);
        reportButton.disabled = false;
        reportButton.textContent = "Report Clip";
    }
}

async function registerClipView(clipId) {
    if (!clipId || state.viewedClipIds.has(clipId)) {
        return;
    }

    try {
        const response = await fetch(clipViewEndpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clipId,
                viewerKey: viewerKey(),
            }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.clip) {
            return;
        }

        rememberViewedClip(clipId);
        rememberClipInState(payload.clip);
        const card = clipsFeed.querySelector(`[data-clip-id="${clipId}"]`);
        if (card) {
            renderClipMetrics(card, payload.clip);
        }
    } catch {
        // Ignore view tracking failures so playback keeps feeling smooth.
    }
}

async function submitClipReaction(clipId, reactionType, emoji, button) {
    button.disabled = true;

    try {
        const response = await fetch(clipReactionEndpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clipId,
                viewerKey: viewerKey(),
                reactionType,
                emoji,
            }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.clip) {
            throw new Error(payload.error || "Unable to save that reaction.");
        }

        rememberReactionSelection(clipId, payload.activeReaction || null);
        replaceClipCard(payload.clip);
    } catch (error) {
        setClipsStatus(error.message, true);
        button.disabled = false;
    }
}

async function submitClipComment(clipId, nameInput, commentInput, submitButton, emoji = "") {
    const authorName = String(nameInput?.value || "").trim();
    const comment = String(commentInput?.value || "").trim();
    if (!comment && !emoji) {
        setClipsStatus("Write a comment or tap an emoji first.", true);
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Posting...";

    try {
        const response = await fetch(clipCommentEndpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                clipId,
                viewerKey: viewerKey(),
                authorName,
                comment,
                emoji,
            }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.clip) {
            throw new Error(payload.error || "Unable to post that comment.");
        }

        writeCommenterName(authorName);
        if (commentInput) {
            commentInput.value = "";
        }
        replaceClipCard(payload.clip);
        setClipsStatus("Comment posted.");
    } catch (error) {
        setClipsStatus(error.message, true);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Post";
    }
}

function attachFeedObserver() {
    if (state.observer) {
        state.observer.disconnect();
    }

    state.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            const video = entry.target;
            if (!(video instanceof HTMLVideoElement)) {
                return;
            }

            if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
                video.dataset.inView = "true";
                playFeedVideo(video);
                const clipId = video.closest(".clip-card")?.dataset.clipId || "";
                if (clipId && !state.viewedClipIds.has(clipId) && !state.viewTimers.has(clipId)) {
                    const timerId = window.setTimeout(() => {
                        state.viewTimers.delete(clipId);
                        if (video.dataset.inView === "true") {
                            registerClipView(clipId);
                        }
                    }, 1800);
                    state.viewTimers.set(clipId, timerId);
                }
            } else {
                video.dataset.inView = "false";
                const clipId = video.closest(".clip-card")?.dataset.clipId || "";
                const timerId = clipId ? state.viewTimers.get(clipId) : 0;
                if (timerId) {
                    window.clearTimeout(timerId);
                    state.viewTimers.delete(clipId);
                }
                video.pause();
            }
        });
    }, {
        threshold: [0.65],
        root: clipsFeed,
    });

    clipsFeed.querySelectorAll("video[data-feed-video='true']").forEach((video) => {
        state.observer.observe(video);
    });
}

function createClipCard(clip) {
    const article = document.createElement("article");
    article.className = "clip-card";
    article.dataset.clipId = clip.id;

    const mediaShell = document.createElement("div");
    mediaShell.className = "clip-card-video-shell";

    const video = document.createElement("video");
    video.setAttribute("playsinline", "");
    video.setAttribute("loop", "");
    video.setAttribute("preload", "metadata");
    video.setAttribute("data-feed-video", "true");
    video.controls = true;
    video.dataset.userMuted = "false";
    video.dataset.inView = "false";
    video.defaultMuted = false;
    video.muted = false;
    video.poster = resolveClipUrl(clip.posterPath);
    video.src = resolveClipUrl(clip.videoPath);
    mediaShell.appendChild(video);

    const muteButton = document.createElement("button");
    muteButton.type = "button";
    muteButton.className = "clip-mute-toggle";
    updateMuteButtonState(video, muteButton);
    muteButton.addEventListener("click", async () => {
        const nextMuted = !video.muted;
        video.dataset.userMuted = nextMuted ? "true" : "false";
        if (!nextMuted) {
            state.audioUnlocked = true;
            video.muted = false;
            video.defaultMuted = false;
            updateMuteButtonState(video, muteButton);
            await video.play().catch(() => {});
            return;
        }

        video.muted = true;
        video.defaultMuted = true;
        updateMuteButtonState(video, muteButton);
    });
    mediaShell.appendChild(muteButton);

    const meta = document.createElement("div");
    meta.className = "clip-card-meta";

    const pillRow = document.createElement("div");
    pillRow.className = "clip-pill-row";

    const durationPill = document.createElement("span");
    durationPill.className = "clip-pill";
    durationPill.textContent = `${formatDuration(clip.durationSeconds)} clip`;
    pillRow.appendChild(durationPill);

    const sizePill = document.createElement("span");
    sizePill.className = "clip-pill";
    sizePill.textContent = formatBytes(clip.sizeBytes);
    pillRow.appendChild(sizePill);

    const title = document.createElement("h3");
    title.className = "clip-card-title";
    title.textContent = clip.title || "Untitled Clip";

    const caption = document.createElement("p");
    caption.className = "clip-card-caption";
    caption.textContent = clip.caption || "No caption added.";

    const byline = document.createElement("p");
    byline.className = "clip-card-byline";
    byline.textContent = `Uploaded by ${clip.uploaderName || "Guest uploader"}`;

    const date = document.createElement("p");
    date.className = "clip-card-date";
    date.textContent = formatDate(clip.createdAt);

    const metrics = document.createElement("div");
    metrics.className = "clip-card-metrics";

    const viewMetric = document.createElement("span");
    viewMetric.className = "clip-metric";
    viewMetric.dataset.clipViewCount = "true";
    viewMetric.textContent = formatCount(clip.viewCount, "views");
    metrics.appendChild(viewMetric);

    const likeMetric = document.createElement("span");
    likeMetric.className = "clip-metric";
    likeMetric.dataset.clipLikeCount = "true";
    likeMetric.textContent = formatCount(clip.likeCount, "likes");
    metrics.appendChild(likeMetric);

    const dislikeMetric = document.createElement("span");
    dislikeMetric.className = "clip-metric";
    dislikeMetric.dataset.clipDislikeCount = "true";
    dislikeMetric.textContent = formatCount(clip.dislikeCount, "dislikes");
    metrics.appendChild(dislikeMetric);

    const commentMetric = document.createElement("span");
    commentMetric.className = "clip-metric";
    commentMetric.dataset.clipCommentCount = "true";
    commentMetric.textContent = formatCount(clip.commentCount, "comments");
    metrics.appendChild(commentMetric);

    const reactionRow = document.createElement("div");
    reactionRow.className = "clip-reaction-row";
    const selectedReaction = reactionSelectionForClip(clip.id);

    const makeReactionButton = (label, count, reactionType, emoji = "") => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "clip-reaction-button";
        if (
            selectedReaction &&
            selectedReaction.type === reactionType &&
            (reactionType !== "emoji" || selectedReaction.emoji === emoji)
        ) {
            button.classList.add("is-active");
        }
        button.textContent = `${label} ${Number(count || 0).toLocaleString()}`;
        button.addEventListener("click", () => {
            submitClipReaction(clip.id, reactionType, emoji, button);
        });
        return button;
    };

    reactionRow.appendChild(makeReactionButton("👍", clip.likeCount, "like"));
    reactionRow.appendChild(makeReactionButton("👎", clip.dislikeCount, "dislike"));
    EMOJI_REACTION_OPTIONS.forEach((emoji) => {
        reactionRow.appendChild(makeReactionButton(emoji, Number(clip.emojiCounts?.[emoji] || 0), "emoji", emoji));
    });

    const note = document.createElement("p");
    note.className = "clip-card-note";
    note.textContent = "Like, dislike, react with emoji, comment below, delete your own uploads, or report someone else's clip for review.";

    const commentsSection = document.createElement("section");
    commentsSection.className = "clip-comments";

    const commentsHeading = document.createElement("p");
    commentsHeading.className = "clip-comments-heading";
    commentsHeading.textContent = clip.commentCount ? `${clip.commentCount} comments` : "No comments yet";
    commentsSection.appendChild(commentsHeading);

    const commentsList = document.createElement("div");
    commentsList.className = "clip-comments-list";
    if (Array.isArray(clip.comments) && clip.comments.length) {
        clip.comments.forEach((comment) => {
            const commentRow = document.createElement("div");
            commentRow.className = "clip-comment";

            const commentAuthor = document.createElement("strong");
            commentAuthor.className = "clip-comment-author";
            commentAuthor.textContent = comment.authorName || "Guest viewer";

            const commentBody = document.createElement("span");
            commentBody.className = "clip-comment-body";
            commentBody.textContent = [comment.emoji, comment.body].filter(Boolean).join(" ");

            commentRow.appendChild(commentAuthor);
            commentRow.appendChild(commentBody);
            commentsList.appendChild(commentRow);
        });
    } else {
        const emptyComments = document.createElement("p");
        emptyComments.className = "clip-comment-empty";
        emptyComments.textContent = "Start the conversation.";
        commentsList.appendChild(emptyComments);
    }
    commentsSection.appendChild(commentsList);

    const commentForm = document.createElement("form");
    commentForm.className = "clip-comment-form";

    const commentNameInput = document.createElement("input");
    commentNameInput.type = "text";
    commentNameInput.className = "clip-comment-name";
    commentNameInput.maxLength = 48;
    commentNameInput.placeholder = "Name";
    commentNameInput.value = currentCommenterName();

    const commentInput = document.createElement("input");
    commentInput.type = "text";
    commentInput.className = "clip-comment-input";
    commentInput.maxLength = 180;
    commentInput.placeholder = "Leave a comment";

    const commentEmojiRow = document.createElement("div");
    commentEmojiRow.className = "clip-comment-emoji-row";
    EMOJI_REACTION_OPTIONS.forEach((emoji) => {
        const emojiButton = document.createElement("button");
        emojiButton.type = "button";
        emojiButton.className = "clip-comment-emoji";
        emojiButton.textContent = emoji;
        emojiButton.addEventListener("click", () => {
            commentInput.value = `${commentInput.value}${emoji}`.trim();
            commentInput.focus();
        });
        commentEmojiRow.appendChild(emojiButton);
    });

    const commentSubmit = document.createElement("button");
    commentSubmit.type = "submit";
    commentSubmit.className = "clip-action clip-action--comment";
    commentSubmit.textContent = "Post";

    commentForm.addEventListener("submit", (event) => {
        event.preventDefault();
        submitClipComment(clip.id, commentNameInput, commentInput, commentSubmit);
    });

    commentForm.appendChild(commentNameInput);
    commentForm.appendChild(commentInput);
    commentForm.appendChild(commentSubmit);
    commentsSection.appendChild(commentEmojiRow);
    commentsSection.appendChild(commentForm);

    const actions = document.createElement("div");
    actions.className = "clip-card-actions";

    const deleteToken = deleteTokenForClip(clip.id);
    if (deleteToken) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "clip-action clip-action--delete";
        deleteButton.textContent = "Delete Clip";
        deleteButton.addEventListener("click", () => {
            removeClip(clip.id, deleteButton);
        });
        actions.appendChild(deleteButton);
    } else {
        const reportButton = document.createElement("button");
        reportButton.type = "button";
        reportButton.className = "clip-action clip-action--report";
        reportButton.textContent = "Report Clip";
        reportButton.addEventListener("click", () => {
            reportClip(clip.id, reportButton);
        });
        actions.appendChild(reportButton);
    }

    meta.appendChild(pillRow);
    meta.appendChild(title);
    meta.appendChild(caption);
    meta.appendChild(byline);
    meta.appendChild(date);
    meta.appendChild(metrics);
    meta.appendChild(reactionRow);
    meta.appendChild(note);
    meta.appendChild(commentsSection);
    meta.appendChild(actions);

    article.appendChild(mediaShell);
    article.appendChild(meta);

    return article;
}

function updateClipCountBadge(visibleCount) {
    const safeVisibleCount = Number(visibleCount || 0);
    if (adminMode && state.storageStats) {
        const storedClipCount = Number(state.storageStats.storedClipCount || 0);
        if (storedClipCount > safeVisibleCount) {
            clipCountBadge.textContent = `${safeVisibleCount} newest shown of ${storedClipCount} stored`;
            return;
        }
        clipCountBadge.textContent = storedClipCount ? `${storedClipCount} clips stored` : "No clips yet";
        return;
    }

    clipCountBadge.textContent = safeVisibleCount ? `${safeVisibleCount} clips live` : "No clips yet";
}

function renderClips(clips, options = {}) {
    const previousScrollTop = options.preserveScroll ? clipsFeed.scrollTop : 0;
    state.viewTimers.forEach((timerId) => window.clearTimeout(timerId));
    state.viewTimers.clear();
    clipsFeed.innerHTML = "";

    const safeClips = Array.isArray(clips) ? clips : [];
    state.renderedClips = safeClips;
    updateClipCountBadge(safeClips.length);
    clipsEmpty.classList.toggle("hidden", safeClips.length !== 0);
    setClipsStatus(safeClips.length ? "Scroll the live feed." : "No clips are live yet.");

    safeClips.forEach((clip) => {
        clipsFeed.appendChild(createClipCard(clip));
    });

    attachFeedObserver();
    if (options.preserveScroll) {
        clipsFeed.scrollTop = previousScrollTop;
    }
}

function renderClipAdminStats(stats) {
    if (!adminMode || !clipAdminPanel) {
        return;
    }

    clipAdminPanel.classList.remove("hidden");
    state.storageStats = stats && typeof stats === "object" ? stats : null;

    if (!state.storageStats) {
        clipAdminStoredCount.textContent = "-";
        clipAdminFeedCount.textContent = "-";
        clipAdminStorageUsed.textContent = "-";
        clipAdminFreeTierUsage.textContent = "-";
        clipAdminNote.textContent = "Storage stats are not available right now.";
        clipAdminNote.style.color = "#ff9c8f";
        return;
    }

    const storedClipCount = Number(state.storageStats.storedClipCount || 0);
    const visibleClipCount = Number(state.storageStats.visibleClipCount || 0);
    const totalVideoBytes = Number(state.storageStats.totalVideoBytes || 0);
    const freeTierStorageBytes = Number(state.storageStats.freeTierStorageBytes || 0);
    const visibleFeedCap = Number(state.storageStats.visibleFeedCap || 0);

    clipAdminStoredCount.textContent = storedClipCount.toLocaleString();
    clipAdminFeedCount.textContent = visibleFeedCap
        ? `${visibleClipCount.toLocaleString()} / ${visibleFeedCap.toLocaleString()}`
        : visibleClipCount.toLocaleString();
    clipAdminStorageUsed.textContent = formatBytes(totalVideoBytes);
    clipAdminFreeTierUsage.textContent = formatPercent(totalVideoBytes, freeTierStorageBytes);
    clipAdminNote.style.color = "";
    clipAdminNote.textContent = [
        state.storageStats.storedClipCap
            ? `Stored clip cap is ${Number(state.storageStats.storedClipCap).toLocaleString()}.`
            : "Stored clip cap removed.",
        visibleFeedCap
            ? `The public feed still shows the newest ${visibleFeedCap.toLocaleString()} clips.`
            : "The public feed is not capped.",
        "This readout tracks transcoded video bytes; poster images and metadata are small and not counted here."
    ].join(" ");
}

async function fetchClipAdminStats() {
    if (!adminMode || !clipAdminPanel) {
        return;
    }

    clipAdminPanel.classList.remove("hidden");
    clipAdminNote.textContent = "Checking current library usage...";
    clipAdminNote.style.color = "";

    try {
        const response = await fetch(clipStorageAdminEndpoint());
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Unable to load clip storage stats.");
        }

        renderClipAdminStats(payload.stats || null);
        updateClipCountBadge(clipsFeed.childElementCount);
    } catch (error) {
        renderClipAdminStats(null);
        clipAdminNote.textContent = error.message;
        clipAdminNote.style.color = "#ff9c8f";
    }
}

async function fetchClips() {
    setClipsStatus("Loading the feed...");

    try {
        const response = await fetch(clipsEndpoint());
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Unable to load the feed.");
        }

        renderClips(payload.clips || []);
        await fetchClipAdminStats();
    } catch (error) {
        setClipsStatus(error.message, true);
        clipCountBadge.textContent = "Feed unavailable";
    }
}

async function handleClipSelection(file) {
    if (!file) {
        state.selectedFile = null;
        return;
    }

    if (!isSupportedClipFile(file)) {
        state.selectedFile = null;
        setUploadStatus("Choose a supported video file: mp4, webm, mov, m4v, or 3gp.", true);
        return;
    }

    if (file.size > MAX_CLIP_UPLOAD_BYTES) {
        state.selectedFile = null;
        setUploadStatus("Keep uploads at or under 24 MB before processing.", true);
        return;
    }

    setUploadStatus("");
    state.selectedFile = file;

    try {
        const metadata = await loadVideoMetadata(file);
        if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
            throw new Error("That video could not be measured.");
        }

        if (metadata.duration > 30.2) {
            throw new Error("Videos must be 30 seconds or shorter.");
        }

        showLocalPreview(file, metadata, "Looks good");
    } catch (error) {
        if (String(error && error.message || "").includes("30 seconds")) {
            state.selectedFile = null;
            releasePreviewUrl();
            previewPanel.classList.add("hidden");
            setUploadStatus(error.message, true);
            return;
        }

        showFallbackPreview(file, "Ready to upload");
        setUploadStatus("This device could not preview that clip locally, but the upload can still work and the server will validate it.");
    }
}

async function uploadClip(file) {
    if (!file || state.uploadInFlight) {
        if (!file) {
            setUploadStatus("Choose a clip first.");
        }
        return;
    }

    state.uploadInFlight = true;
    setDropZoneState({ busy: true });
    setUploadStatus("Uploading clip...");

    const formData = new FormData();
    formData.append("clipFile", file);
    if (uploaderNameInput.value.trim()) {
        formData.append("uploaderName", uploaderNameInput.value.trim());
    }
    if (titleInput.value.trim()) {
        formData.append("title", titleInput.value.trim());
    }
    if (captionInput.value.trim()) {
        formData.append("caption", captionInput.value.trim());
    }

    try {
        const response = await fetch(clipsEndpoint(), {
            method: "POST",
            body: formData,
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            throw new Error("The upload service returned an unreadable response.");
        }
        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Unable to save that clip right now.");
        }

        rememberOwnedUpload(payload.clip.id, payload.deleteToken);
        showUploadedPreview(payload.clip, file);
        renderClips(payload.clips || []);
        await fetchClipAdminStats();
        setUploadStatus("Clip uploaded and added to the live feed.");
        uploadForm.reset();
        state.selectedFile = null;
    } catch (error) {
        setUploadStatus(error.message, true);
    } finally {
        state.uploadInFlight = false;
        setDropZoneState({ busy: false });
    }
}

pickButton?.addEventListener("click", () => {
    if (!state.uploadInFlight) {
        fileInput?.click();
    }
});

dropZone?.addEventListener("click", () => {
    if (!state.uploadInFlight) {
        fileInput?.click();
    }
});

dropZone?.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !state.uploadInFlight) {
        event.preventDefault();
        fileInput?.click();
    }
});

fileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    await handleClipSelection(file);
});

["dragenter", "dragover"].forEach((eventName) => {
    dropZone?.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (!state.uploadInFlight) {
            setDropZoneState({ dragging: true });
        }
    });
});

["dragleave", "drop"].forEach((eventName) => {
    dropZone?.addEventListener(eventName, (event) => {
        event.preventDefault();
        setDropZoneState({ dragging: false });
    });
});

dropZone?.addEventListener("drop", async (event) => {
    if (state.uploadInFlight) {
        return;
    }
    const file = event.dataTransfer?.files?.[0];
    await handleClipSelection(file);
});

submitButton?.addEventListener("click", async () => {
    const file = state.selectedFile;
    await uploadClip(file);
});

uploadForm?.addEventListener("keydown", async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        const file = state.selectedFile;
        await uploadClip(file);
    }
});

window.addEventListener("pointerdown", unlockFeedAudio, { once: true, capture: true });
window.addEventListener("keydown", unlockFeedAudio, { once: true, capture: true });

if (adminMode && clipAdminPanel) {
    clipAdminPanel.classList.remove("hidden");
}

fetchClips();
