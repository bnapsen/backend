# Nova Arcade cheap durable storage

This project now supports the lowest-cost durable setup:

- free Render web service for the backend
- Cloudflare R2 for uploaded media
- Cloudflare R2 JSON files for song and clip metadata

No Render Postgres is required for this setup.

## What changed

- `games/star-sprint/song-media.js`
- `games/star-sprint/clip-media.js`
- `games/star-sprint/songs-store.js`
- `games/star-sprint/clips-store.js`
- `games/star-sprint/s3-json-store.js`
- `games/star-sprint/migrate-live-uploads-to-object-storage.js`

When the standard `S3_*` variables are present:

- songs and clips store media in the bucket
- songs and clips store metadata in JSON files in the same bucket
- the backend no longer needs a Render disk or Postgres to keep uploads

## Required environment variables

Set these on the Render `backend` service:

- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

For Cloudflare R2, the common values are:

- `S3_REGION=auto`
- `S3_FORCE_PATH_STYLE=true`
- `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`

## Bucket layout

- `songs/audio/*`
- `songs/metadata/songs.json`
- `clips/videos/*`
- `clips/posters/*`
- `clips/metadata/clips.json`
- `clips/metadata/reports.json`

## Before redeploying the backend

If the live Render service still has uploads stored locally, migrate them first:

```powershell
$env:S3_BUCKET='your-bucket'
$env:S3_REGION='auto'
$env:S3_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'
$env:S3_FORCE_PATH_STYLE='true'
$env:S3_ACCESS_KEY_ID='...'
$env:S3_SECRET_ACCESS_KEY='...'
node .\games\star-sprint\migrate-live-uploads-to-object-storage.js
```

That script reads current live uploads from `https://backend-ujaa.onrender.com`, writes them into object storage, and writes the metadata JSON files there too.

## After redeploy

Verify that:

- songs return `/media/songs/s3/...`
- clips return `/media/clips/s3/videos/...`
- uploads still exist after restarting the Render backend

## Cost notes

- Render can stay on the free web tier for this path
- Cloudflare R2 includes a free tier, so small hobby usage can stay near zero cost
