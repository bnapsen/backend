param(
  [string]$Project = "bnapsen",
  [string]$Region = "us-central1",
  [string]$Service = "nova-arcade-backend",
  [string]$ServiceAccount = "nova-arcade-runtime@bnapsen.iam.gserviceaccount.com",
  [string]$ApiKeyId = "",
  [string]$PrivateKeyPath = "",
  [switch]$AttachOnly
)

$ErrorActionPreference = "Stop"

function Ensure-Secret {
  param(
    [Parameter(Mandatory = $true)][string]$Name
  )

  $exists = $false
  try {
    gcloud secrets describe $Name --project $Project --format="value(name)" *> $null
    $exists = $true
  } catch {
    $exists = $false
  }

  if (-not $exists) {
    gcloud secrets create $Name --project $Project --replication-policy="automatic"
  }
}

function Grant-SecretAccess {
  param(
    [Parameter(Mandatory = $true)][string]$Name
  )

  gcloud secrets add-iam-policy-binding $Name `
    --project $Project `
    --member "serviceAccount:$ServiceAccount" `
    --role "roles/secretmanager.secretAccessor" *> $null
}

$apiKeySecret = "kalshi-api-key-id"
$privateKeySecret = "kalshi-private-key-pem"

Ensure-Secret -Name $apiKeySecret
Ensure-Secret -Name $privateKeySecret

if (-not $AttachOnly) {
  if (-not $ApiKeyId) {
    $ApiKeyId = Read-Host "Kalshi API key ID"
  }
  if (-not $ApiKeyId.Trim()) {
    throw "Kalshi API key ID is required."
  }

  if (-not $PrivateKeyPath) {
    $PrivateKeyPath = Read-Host "Path to Kalshi RSA private key PEM file"
  }
  $resolvedPrivateKeyPath = Resolve-Path -LiteralPath $PrivateKeyPath
  if (-not $resolvedPrivateKeyPath) {
    throw "Private key PEM file not found."
  }

  $tempApiKeyFile = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -LiteralPath $tempApiKeyFile -Value $ApiKeyId.Trim() -NoNewline -Encoding ASCII
    gcloud secrets versions add $apiKeySecret --project $Project --data-file $tempApiKeyFile
  } finally {
    Remove-Item -LiteralPath $tempApiKeyFile -Force -ErrorAction SilentlyContinue
  }

  gcloud secrets versions add $privateKeySecret --project $Project --data-file $resolvedPrivateKeyPath
}

Grant-SecretAccess -Name $apiKeySecret
Grant-SecretAccess -Name $privateKeySecret

gcloud run services update $Service `
  --project $Project `
  --region $Region `
  --update-secrets "KALSHI_API_KEY_ID=$apiKeySecret:latest,KALSHI_PRIVATE_KEY_PEM=$privateKeySecret:latest"

Write-Host "Kalshi WebSocket credentials are attached to $Service."
Write-Host "Reload the Bitcoin lab and check for: Kalshi WS connected / Quotes: Kalshi WebSocket ticker."
