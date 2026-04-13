# Nova Arcade durable storage

This repo now supports two durable storage layers:

- object storage for song files and clip media
- Postgres for song and clip metadata

## What is already in the code

- `games/star-sprint/song-media.js`
- `games/star-sprint/songs-store.js`
- `games/star-sprint/clip-media.js`
- `games/star-sprint/clips-store.js`
- `render.yaml`

Songs and clips now:

- store metadata in Postgres when `DATABASE_URL` is set
- store media in S3-compatible object storage when the `S3_*` variables are set
- fall back to local disk only when those durable services are not configured
- keep serving older local files during migration by using provider-specific media URLs

## Render setup

The `render.yaml` file defines:

- `nova-arcade-db` as the Postgres database
- `nova-arcade-object-storage` as a MinIO private service
- `backend` wired to both

Important: Render only applies `render.yaml` automatically if the repo is connected as a Blueprint. A normal git-backed service will keep ignoring new resources in `render.yaml`.

## To make the live site durable

1. In Render, create or update the repo as a Blueprint.
2. Let Render provision:
   - `nova-arcade-db`
   - `nova-arcade-object-storage`
   - `backend`
3. Confirm the backend has these environment variables:
   - `DATABASE_URL`
   - `S3_BUCKET`
   - `S3_REGION`
   - `S3_ENDPOINT`
   - `S3_FORCE_PATH_STYLE`
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`
4. Deploy the backend again.
5. Upload a song and a clip, then restart the backend and confirm both still exist.

## Notes

- Existing local songs and clips are imported into Postgres on startup when `DATABASE_URL` is enabled.
- Existing local media URLs keep working during the transition.
- New uploads use object storage once the `S3_*` variables are active.
