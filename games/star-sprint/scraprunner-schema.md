# ScrapRunner Online Persistence

ScrapRunner uses the existing AP Advantage Player Firebase account flow and SIM
wallet store. Local development falls back to in-memory stores when no Google
Cloud project is configured. Production stores the data below in Firestore.

## Collections

### `simWallets/{uid}`

Shared website wallet used by ScrapRunner and the other SIM-enabled pages.

```json
{
  "uid": "firebase-user-id",
  "email": "player@example.com",
  "displayName": "Player",
  "currency": "SIM",
  "balanceCents": 125000,
  "startingBalanceCents": 100000,
  "recentTransactions": [
    {
      "id": "uuid",
      "createdAt": "2026-05-24T12:00:00.000Z",
      "source": "scraprunner-online",
      "action": "run-extract",
      "amountCents": 850,
      "balanceAfterCents": 125000,
      "metadata": {
        "game": "scraprunner",
        "zoneId": "rust-yard",
        "runId": "uuid"
      }
    }
  ],
  "createdAt": "2026-05-24T12:00:00.000Z",
  "updatedAt": "2026-05-24T12:00:00.000Z"
}
```

### `scraprunnerProfiles/{uid}`

One profile per signed-in AP account.

```json
{
  "uid": "firebase-user-id",
  "email": "player@example.com",
  "displayName": "Player",
  "upgrades": {
    "engine": 2,
    "cargo": 1,
    "health": 0,
    "weapon": 3,
    "magnet": 1,
    "boost": 0,
    "coin": 1,
    "scrap": 2
  },
  "unlockedZones": ["rust-yard", "neon-wrecks"],
  "stats": {
    "runs": 10,
    "extractions": 7,
    "scrap": 420,
    "kills": 38,
    "score": 5800,
    "earnedCents": 23000,
    "bestRewardCents": 5100
  },
  "daily": {
    "lastClaimDayKey": "2026-05-24",
    "streak": 3,
    "bestStreak": 6
  },
  "missions": {
    "dayKey": "2026-05-24",
    "items": [
      {
        "id": "scrap-2026-05-24",
        "kind": "scrap",
        "target": 90,
        "progress": 40,
        "rewardCents": 450,
        "claimed": false
      }
    ]
  },
  "achievements": ["first-extract"],
  "recentRuns": [],
  "createdAt": "2026-05-24T12:00:00.000Z",
  "updatedAt": "2026-05-24T12:00:00.000Z"
}
```

### `scraprunnerRuns/{runId}`

Extracted runs used by the global leaderboard. The client never writes these
documents directly; the multiplayer server creates them after validating a run.

```json
{
  "id": "run-id",
  "runId": "run-id",
  "uid": "firebase-user-id",
  "displayName": "Player",
  "zoneId": "rust-yard",
  "zoneName": "Rust Yard",
  "scrap": 64,
  "kills": 5,
  "score": 1050,
  "durationSeconds": 92.5,
  "timeLeftSeconds": 57,
  "rewardCents": 1740,
  "extracted": true,
  "createdAt": "2026-05-24T12:00:00.000Z"
}
```

## SQL Upgrade Path

If ScrapRunner moves from Firestore to Postgres later, use these table shapes:

```sql
create table scraprunner_profiles (
  uid text primary key,
  email text,
  display_name text not null,
  upgrades jsonb not null,
  unlocked_zones jsonb not null,
  stats jsonb not null,
  daily jsonb not null,
  missions jsonb not null,
  achievements jsonb not null,
  recent_runs jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table scraprunner_runs (
  id text primary key,
  uid text not null references scraprunner_profiles(uid),
  display_name text not null,
  zone_id text not null,
  zone_name text not null,
  scrap integer not null,
  kills integer not null,
  score integer not null,
  duration_seconds numeric not null,
  time_left_seconds integer not null,
  reward_cents integer not null,
  extracted boolean not null,
  created_at timestamptz not null
);

create index scraprunner_runs_leaderboard_idx
  on scraprunner_runs (reward_cents desc, score desc);
```
