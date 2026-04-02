const PROD_REVIEWS_API_BASE = "https://backend-ujaa.onrender.com";

const reviewForm = document.getElementById("review-form");
const reviewerName = document.getElementById("reviewer-name");
const reviewerCar = document.getElementById("reviewer-car");
const reviewRating = document.getElementById("review-rating");
const reviewMessage = document.getElementById("review-message");
const reviewStatus = document.getElementById("review-status");
const reviewsList = document.getElementById("reviews-list");
const reviewsEmpty = document.getElementById("reviews-empty");
const reviewSubmitButton = reviewForm ? reviewForm.querySelector('button[type="submit"]') : null;

function reviewElementsReady() {
    return Boolean(
        reviewForm &&
        reviewerName &&
        reviewerCar &&
        reviewRating &&
        reviewMessage &&
        reviewStatus &&
        reviewsList &&
        reviewsEmpty &&
        reviewSubmitButton
    );
}

function reviewsApiBase() {
    const explicit = typeof window.REVIEWS_API_BASE === "string" ? window.REVIEWS_API_BASE.trim() : "";
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

    return PROD_REVIEWS_API_BASE;
}

function reviewsEndpoint() {
    return `${reviewsApiBase()}/api/reviews`;
}

function setStatus(message, isError = false) {
    reviewStatus.textContent = message;
    reviewStatus.style.color = isError ? "#ff9c8f" : "";
}

function setSubmitDisabled(disabled) {
    reviewSubmitButton.disabled = disabled;
    reviewSubmitButton.style.opacity = disabled ? "0.7" : "";
    reviewSubmitButton.style.cursor = disabled ? "wait" : "";
}

function formatDate(isoDate) {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return "Saved just now";
    }

    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function createReviewCard(review) {
    const card = document.createElement("article");
    card.className = "review-card";

    const header = document.createElement("div");
    header.className = "review-card-header";

    const name = document.createElement("strong");
    name.textContent = review.name;

    const rating = document.createElement("span");
    rating.className = "review-rating";
    rating.textContent = `${review.rating}/5`;

    header.append(name, rating);

    const meta = document.createElement("div");
    meta.className = "review-meta";

    const favorite = document.createElement("span");
    favorite.className = "review-car";
    favorite.textContent = review.car ? `Favorite pick: ${review.car}` : "Community review";

    const date = document.createElement("span");
    date.textContent = formatDate(review.createdAt);

    meta.append(favorite, date);

    const message = document.createElement("p");
    message.className = "review-message";
    message.textContent = review.message;

    card.append(header, meta, message);
    return card;
}

function renderReviews(reviews) {
    reviewsList.innerHTML = "";

    if (!Array.isArray(reviews) || !reviews.length) {
        reviewsEmpty.hidden = false;
        reviewsEmpty.textContent = "No reviews yet. Be the first to add one to the front page.";
        return;
    }

    reviewsEmpty.hidden = true;

    for (const review of reviews) {
        reviewsList.appendChild(createReviewCard(review));
    }
}

function buildReview() {
    return {
        name: reviewerName.value.trim(),
        car: reviewerCar.value.trim(),
        rating: Number(reviewRating.value),
        message: reviewMessage.value.trim(),
    };
}

function validateReview(review) {
    if (!review.name || !review.message) {
        return "Please enter your name and a review before posting.";
    }

    if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) {
        return "Please choose a rating between 1 and 5.";
    }

    return "";
}

async function requestReviews(url, options) {
    let response;

    try {
        response = await fetch(url, options);
    } catch {
        throw new Error("The live reviews service is unavailable right now.");
    }

    let payload = {};
    try {
        payload = await response.json();
    } catch {
        payload = {};
    }

    if (!response.ok) {
        throw new Error(payload.error || "The reviews request could not be completed.");
    }

    return payload;
}

async function loadReviewsFromBackend() {
    reviewsEmpty.hidden = false;
    reviewsEmpty.textContent = "Loading reviews...";

    const payload = await requestReviews(reviewsEndpoint(), {
        method: "GET",
        headers: {
            Accept: "application/json",
        },
    });

    renderReviews(payload.reviews);
}

async function submitReviewToBackend(review) {
    const payload = await requestReviews(reviewsEndpoint(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(review),
    });

    renderReviews(payload.reviews);
}

async function handleSubmit(event) {
    event.preventDefault();

    const review = buildReview();
    const validationMessage = validateReview(review);

    if (validationMessage) {
        setStatus(validationMessage, true);
        return;
    }

    setSubmitDisabled(true);
    setStatus("Posting review...");

    try {
        await submitReviewToBackend(review);
        reviewForm.reset();
        reviewRating.value = "5";
        setStatus("Your review is now live on the front page.");
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        setSubmitDisabled(false);
    }
}

async function initReviews() {
    if (!reviewElementsReady()) {
        return;
    }

    reviewForm.addEventListener("submit", handleSubmit);

    try {
        await loadReviewsFromBackend();
        setStatus("");
    } catch (error) {
        reviewsList.innerHTML = "";
        reviewsEmpty.hidden = false;
        reviewsEmpty.textContent = "Reviews are temporarily unavailable while the live backend reconnects.";
        setStatus(error.message, true);
    }
}

initReviews();
