#!/usr/bin/env bash
# Deploy Nitpicker to Cloudflare Workers and print the webhook URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

load_env() {
  local key="$1"
  local value
  value=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d'=' -f2- || true)
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

have() { command -v "$1" >/dev/null 2>&1; }

APP_ID=$(load_env APP_ID)
WEBHOOK_SECRET=$(load_env WEBHOOK_SECRET)
LLM_API_KEY=$(load_env LLM_API_KEY)
AI_PROVIDER=$(load_env AI_PROVIDER)
AI_MODEL=$(load_env AI_MODEL)
BOT_NAME=$(load_env BOT_NAME)
MAX_DIFF_SIZE=$(load_env MAX_DIFF_SIZE)
REVIEW_ON_OPEN=$(load_env REVIEW_ON_OPEN)
CF_WORKER_NAME=$(load_env CF_WORKER_NAME)
CF_WORKER_NAME="${CF_WORKER_NAME:-nitpicker}"

PRIVATE_KEY_BASE64=$(load_env PRIVATE_KEY_BASE64)
if [[ -z "$PRIVATE_KEY_BASE64" ]]; then
  PRIVATE_KEY=$(load_env PRIVATE_KEY)
  if [[ -n "$PRIVATE_KEY" ]]; then
    PRIVATE_KEY_BASE64=$(printf '%s' "$PRIVATE_KEY" | base64 | tr -d '\n')
  fi
fi

for var in APP_ID WEBHOOK_SECRET LLM_API_KEY PRIVATE_KEY_BASE64; do
  if [[ -z "${!var}" ]]; then
    echo "Error: $var is not set in .env"
    exit 1
  fi
done

cd "$PROJECT_ROOT"

if ! have wrangler; then
  if have pnpm; then
    echo "Installing wrangler locally…"
    pnpm add -D wrangler >/dev/null
  elif have npm; then
    npm install -D wrangler >/dev/null
  else
    echo "Error: install wrangler (pnpm add -D wrangler) or Cloudflare Wrangler CLI"
    exit 1
  fi
fi

WRANGLER=(npx wrangler)
if have wrangler; then
  WRANGLER=(wrangler)
fi

# Keep wrangler.toml name in sync when overridden
if [[ -f wrangler.toml ]]; then
  if grep -q '^name = ' wrangler.toml; then
    # portable in-place edit
    tmp="$(mktemp)"
    sed "s/^name = .*/name = \"${CF_WORKER_NAME}\"/" wrangler.toml >"$tmp"
    mv "$tmp" wrangler.toml
  fi
fi

echo "Setting Worker secrets…"
printf '%s' "$APP_ID" | "${WRANGLER[@]}" secret put APP_ID --name "$CF_WORKER_NAME" >/dev/null
printf '%s' "$PRIVATE_KEY_BASE64" | "${WRANGLER[@]}" secret put PRIVATE_KEY_BASE64 --name "$CF_WORKER_NAME" >/dev/null
printf '%s' "$WEBHOOK_SECRET" | "${WRANGLER[@]}" secret put WEBHOOK_SECRET --name "$CF_WORKER_NAME" >/dev/null
printf '%s' "$LLM_API_KEY" | "${WRANGLER[@]}" secret put LLM_API_KEY --name "$CF_WORKER_NAME" >/dev/null

echo "Deploying Worker '${CF_WORKER_NAME}'…"
# Pass non-secret vars on deploy
DEPLOY_ARGS=(deploy --name "$CF_WORKER_NAME")
[[ -n "$AI_PROVIDER" ]] && DEPLOY_ARGS+=(--var "AI_PROVIDER:${AI_PROVIDER}")
[[ -n "$AI_MODEL" ]] && DEPLOY_ARGS+=(--var "AI_MODEL:${AI_MODEL}")
[[ -n "$BOT_NAME" ]] && DEPLOY_ARGS+=(--var "BOT_NAME:${BOT_NAME}")
[[ -n "$MAX_DIFF_SIZE" ]] && DEPLOY_ARGS+=(--var "MAX_DIFF_SIZE:${MAX_DIFF_SIZE}")
[[ -n "$REVIEW_ON_OPEN" ]] && DEPLOY_ARGS+=(--var "REVIEW_ON_OPEN:${REVIEW_ON_OPEN}")

DEPLOY_OUT="$("${WRANGLER[@]}" "${DEPLOY_ARGS[@]}" 2>&1)" || {
  printf '%s\n' "$DEPLOY_OUT"
  exit 1
}
printf '%s\n' "$DEPLOY_OUT"

WEBHOOK_URL="$(
  printf '%s\n' "$DEPLOY_OUT" | grep -Eo 'https://[a-zA-Z0-9._/-]+\.workers\.dev' | head -1 || true
)"

if [[ -z "$WEBHOOK_URL" ]]; then
  WEBHOOK_URL="$("${WRANGLER[@]}" deployments list --name "$CF_WORKER_NAME" 2>/dev/null | grep -Eo 'https://[a-zA-Z0-9._/-]+\.workers\.dev' | head -1 || true)"
fi

echo ""
if [[ -n "$WEBHOOK_URL" ]]; then
  echo "Done! Webhook URL:"
  echo "$WEBHOOK_URL"
else
  echo "Deployed. Find your workers.dev URL in the Cloudflare dashboard / wrangler output above."
fi
