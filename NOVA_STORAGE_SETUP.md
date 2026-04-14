# Nova Arcade Google Cloud storage

This project now uses Google Cloud for durable backend storage:

- Cloud Run for the live Node backend
- Google Cloud Storage for uploaded songs, clips, and review metadata
- Firestore for Arcade Lounge room persistence

The public site can stay on GitHub Pages at `bnapsen.com` while the API and
WebSocket backend run on Cloud Run.

## Live backend

- Service: `nova-arcade-backend`
- Region: `us-central1`
- Base URL: `https://nova-arcade-backend-1000121513328.us-central1.run.app`

## Storage layout

- `songs/audio/*`
- `songs/metadata/songs.json`
- `clips/videos/*`
- `clips/posters/*`
- `clips/metadata/clips.json`
- `clips/metadata/reports.json`
- `reviews/metadata/reviews.json`

Arcade Lounge room state is stored in Firestore collection:

- `arcadeChatRooms`

## Required environment variables

The backend currently uses Google Cloud Storage through the existing
S3-compatible path:

- `GOOGLE_CLOUD_PROJECT`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `ARCADE_CHAT_FIRESTORE_COLLECTION`

For the current `bnapsen` project the important values are:

- `GOOGLE_CLOUD_PROJECT=bnapsen`
- `S3_BUCKET=bnapsen-media-1000121513328`
- `S3_REGION=auto`
- `S3_ENDPOINT=https://storage.googleapis.com`
- `S3_FORCE_PATH_STYLE=true`
- `ARCADE_CHAT_FIRESTORE_COLLECTION=arcadeChatRooms`

## Deploy

From the repo root:

```powershell
gcloud run deploy nova-arcade-backend `
  --source . `
  --project bnapsen `
  --region us-central1 `
  --allow-unauthenticated
```

The repo root `Dockerfile` builds the backend and includes the City Raid
download assets served by the backend routes.

## Automatic deploys from GitHub

Pushes to `main` now trigger two GitHub Actions flows:

- `.github/workflows/main.yml` publishes the static frontend to GitHub Pages
- `.github/workflows/deploy-google-backend.yml` rebuilds and redeploys the
  Cloud Run backend

The backend deploy authenticates with Google Cloud through GitHub OIDC instead
of a long-lived JSON key, so normal GitHub pushes keep the frontend and backend
moving together without storing a deploy key in the repo.

## Verification

After deploy, verify:

- `GET /api/songs` returns uploaded community songs plus the seeded track
- `GET /api/clips` returns uploaded clips
- uploaded media paths use `/media/songs/s3/...` and `/media/clips/s3/...`
- Arcade Lounge messages survive a backend restart

## Important Cloud Run note

Cloud Run has a hard request-body limit, so the site now treats song and clip
uploads as `24 MB` max to avoid raw `413 Request Entity Too Large` failures.
