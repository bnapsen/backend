# Kalshi WebSocket Setup

The Bitcoin lab can match Kalshi bid/ask ticks more closely when Cloud Run has Kalshi API credentials. Kalshi WebSocket market-data channels still require an authenticated WebSocket handshake, even for public ticker updates.

## What You Need

- Kalshi API key ID
- The matching RSA private key PEM file downloaded/generated from Kalshi
- Google Cloud access to the `bnapsen` project

Do not commit the private key. Do not paste it into normal shell history.

## One-Time Setup

From the repo root:

```powershell
.\scripts\setup-kalshi-cloud-run-secrets.ps1 `
  -ApiKeyId "YOUR_KALSHI_API_KEY_ID" `
  -PrivateKeyPath "C:\path\to\kalshi_private_key.pem"
```

The script:

- Creates Google Secret Manager secrets if needed.
- Adds the API key ID and private key as secret versions.
- Grants the Cloud Run runtime service account access to those secrets.
- Attaches them as `KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY_PEM`.

## Verify

Open:

```text
https://bnapsen.com/kalshi-bitcoin-lab.html
```

The status line should move from:

```text
Kalshi WS not-configured / Quotes: Kalshi REST market detail
```

to something like:

```text
Kalshi WS connected / Quotes: Kalshi WebSocket ticker
```

If it shows a WebSocket error, the key ID/private key pair is probably mismatched, malformed, or not enabled for the Kalshi API account.
