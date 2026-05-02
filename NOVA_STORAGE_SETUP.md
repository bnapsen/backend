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
- `NOVA_AUTH_REQUIRED`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_WEB_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_APP_ID` (optional when using Identity Platform Auth without a Firebase Web App)
- `FIREBASE_MESSAGING_SENDER_ID` (optional)
- `FIREBASE_STORAGE_BUCKET` (optional)
- `FIREBASE_GOOGLE_AUTH_ENABLED` (`true` only after the Google OAuth provider is configured)

For the current `bnapsen` project the important values are:

- `GOOGLE_CLOUD_PROJECT=bnapsen`
- `S3_BUCKET=bnapsen-media-1000121513328`
- `S3_REGION=auto`
- `S3_ENDPOINT=https://storage.googleapis.com`
- `S3_FORCE_PATH_STYLE=true`
- `ARCADE_CHAT_FIRESTORE_COLLECTION=arcadeChatRooms`
- `NOVA_AUTH_REQUIRED=true`
- `FIREBASE_PROJECT_ID=bnapsen`
- `FIREBASE_AUTH_DOMAIN=bnapsen.firebaseapp.com`
- `FIREBASE_WEB_API_KEY=<your Firebase or Identity Platform web api key>`
- `FIREBASE_APP_ID=<your Firebase web app id, if you create one>`
- `FIREBASE_MESSAGING_SENDER_ID=<your Firebase sender id, if available>`
- `FIREBASE_STORAGE_BUCKET=<your Firebase storage bucket, if enabled>`
- `FIREBASE_GOOGLE_AUTH_ENABLED=true`

## Account sign-in

Nova Live and Nova Clips now use Firebase Authentication. The frontend loads
the Firebase web config from `GET /api/auth/config`, then sends the Firebase ID
token to the Cloud Run backend. The backend verifies that token with
`firebase-admin` before allowing:

- Nova Live hosting, joining, and chat
- Nova Live replay posting
- Nova Clips uploads
- clip deletion by the owning signed-in account, with existing delete tokens
  still accepted as a fallback for older uploads

Firebase Console setup:

1. Enable Authentication for the `bnapsen` Firebase project.
2. Enable the Email/Password provider.
3. To enable the Google provider, create or reuse a Google OAuth web client in
   Google Auth Platform, then add that client ID and client secret to the
   `google.com` provider config in Firebase Authentication.
4. Add authorized domains for `bnapsen.com`, `www.bnapsen.com`, and any preview
   domain you use while testing.
5. Copy the Firebase web app config values into the Cloud Run environment
   variables above.
6. Set `FIREBASE_GOOGLE_AUTH_ENABLED=true` only after a test call to
   `accounts:createAuthUri` for `google.com` succeeds.

If the Firebase web config is missing and `NOVA_AUTH_REQUIRED=true`, the UI
will show that accounts still need setup and protected actions will fail closed.
The homepage account box supports both Google sign-in and plain email/password
account creation when those providers are enabled in Firebase Authentication.

## SIM wallet

Signed-in accounts get a shared SIM wallet the first time the backend sees the
account. The default grant is `1,000 SIM`; the wallet is stored in Firestore and
is used by the 15-minute Bitcoin paper trader now, with the same API available
for future games.

- `GET /api/sim/wallet` verifies the Firebase ID token, creates the wallet if
  needed, and returns the current SIM balance.
- `POST /api/sim/wallet/adjust` records debits and credits in cents, rejects
  overdrafts, and keeps a capped recent transaction list on the wallet document.
- `SIM_STARTING_BALANCE` can override the starter grant.
- `SIM_WALLET_FIRESTORE_COLLECTION` can override the default `simWallets`
  collection.

Unsigned visitors keep using local browser-only SIM in tools that support paper
play, but signed-in users see the account SIM balance in the auth widget.

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

Cloud Run should be kept at at least `1 GiB` of memory for Nova Clips, since
clip finalize/transcode work can exceed the default `512 MiB` on larger phone
uploads.

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

Cloud Run has a hard request-body limit, so the legacy multipart path stays
small. Larger Nova Clips and Nova Live replay uploads use signed direct cloud
uploads instead; the current raw clip ceiling is `1.5 GB` before processing.
