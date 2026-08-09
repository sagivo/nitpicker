#!/usr/bin/env bash
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
  value=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d'=' -f2-)
  # Strip surrounding quotes
  value="${value%\"}"
  value="${value#\"}"
  echo "$value"
}

APP_ID=$(load_env APP_ID)
WEBHOOK_SECRET=$(load_env WEBHOOK_SECRET)
LLM_API_KEY=$(load_env LLM_API_KEY)
AI_PROVIDER=$(load_env AI_PROVIDER)
AI_MODEL=$(load_env AI_MODEL)
BOT_NAME=$(load_env BOT_NAME)
MAX_DIFF_SIZE=$(load_env MAX_DIFF_SIZE)

PRIVATE_KEY_BASE64=$(load_env PRIVATE_KEY_BASE64)
if [[ -z "$PRIVATE_KEY_BASE64" ]]; then
  PRIVATE_KEY=$(grep -A 100 "^PRIVATE_KEY=" "$ENV_FILE" | sed 's/^PRIVATE_KEY=//' | sed 's/^"//;s/"$//')
  if [[ -n "$PRIVATE_KEY" ]]; then
    PRIVATE_KEY_BASE64=$(echo "$PRIVATE_KEY" | base64)
  fi
fi

STACK_NAME="${STACK_NAME:-liblab-pr}"
REGION="${AWS_REGION:-us-east-1}"

for var in APP_ID WEBHOOK_SECRET LLM_API_KEY PRIVATE_KEY_BASE64; do
  if [[ -z "${!var}" ]]; then
    echo "Error: $var is not set in .env"
    exit 1
  fi
done

echo "Building Lambda bundle..."
cd "$PROJECT_ROOT"
pnpm build:lambda

echo "Deploying stack '$STACK_NAME' to $REGION..."
sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "AppId=${APP_ID}" \
    "PrivateKeyBase64=${PRIVATE_KEY_BASE64}" \
    "WebhookSecret=${WEBHOOK_SECRET}" \
    "LlmApiKey=${LLM_API_KEY}" \
    "AiProvider=${AI_PROVIDER:-anthropic}" \
    "AiModel=${AI_MODEL:-claude-sonnet-4-20250514}" \
    "BotName=${BOT_NAME:-nitpicker-bot}" \
    "MaxDiffSize=${MAX_DIFF_SIZE:-50000}"

echo ""
echo "Done! Webhook URL:"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`WebhookUrl`].OutputValue' \
  --output text
