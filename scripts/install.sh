#!/usr/bin/env bash
# Nitpicker setup wizard — prompts only for what it can't figure out.
# Invoked by: curl -fsSL https://nitpicker.dev/install | bash
#         or: pnpm setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env"
PEM_FILE="${PROJECT_ROOT}/.github-app.pem"
APP_JSON_FILE="${PROJECT_ROOT}/.github-app.json"

APP_NAME="nitpicker"
ORG=""
STACK_NAME="${STACK_NAME:-nitpicker}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AI_MODEL="${AI_MODEL:-claude-sonnet-4-20250514}"
AI_PROVIDER="${AI_PROVIDER:-anthropic}"
BOT_NAME=""
LLM_API_KEY="${LLM_API_KEY:-${ANTHROPIC_API_KEY:-${OPENAI_API_KEY:-${GOOGLE_GENERATIVE_AI_API_KEY:-}}}}"
SKIP_DEPLOY=false

GREEN=$'\033[0;32m'
CYAN=$'\033[0;36m'
YELLOW=$'\033[0;33m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

step=0
say()  { printf "%s\n" "$*"; }
info() { printf "%s→%s %s\n" "$CYAN" "$RESET" "$*"; }
ok()   { printf "%s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn() { printf "%s!%s %s\n" "$YELLOW" "$RESET" "$*"; }
die()  { printf "error: %s\n" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# curl|bash leaves stdin as the script pipe — prefer the real terminal
TTY=""
if [[ -r /dev/tty && -w /dev/tty ]]; then
  TTY="/dev/tty"
fi

can_prompt() {
  [[ -n "$TTY" || -t 0 ]]
}

read_reply() {
  # sets REPLY; optional -s for silent
  local silent=false
  [[ "${1:-}" == "-s" ]] && silent=true
  REPLY=""
  if [[ -n "$TTY" ]]; then
    if [[ "$silent" == true ]]; then read -r -s REPLY <"$TTY" || true
    else read -r REPLY <"$TTY" || true
    fi
  elif [[ -t 0 ]]; then
    if [[ "$silent" == true ]]; then read -r -s REPLY || true
    else read -r REPLY || true
    fi
  else
    return 1
  fi
}

banner() {
  step=$((step + 1))
  printf "\n%s%d.%s %s%s%s\n" "$BOLD" "$step" "$RESET" "$BOLD" "$*" "$RESET"
}

ask() {
  local q="$1" var="$2" def="${3:-}"
  if [[ -n "$def" ]]; then
    printf "  %s %s[%s]%s: " "$q" "$DIM" "$def" "$RESET"
  else
    printf "  %s: " "$q"
  fi
  if ! can_prompt; then
    [[ -n "$def" ]] || die "need a TTY to answer: $q"
    printf "%s\n" "$def"
    printf -v "$var" '%s' "$def"
    return
  fi
  read_reply || true
  if [[ -z "${REPLY:-}" ]]; then
    printf -v "$var" '%s' "$def"
  else
    printf -v "$var" '%s' "$REPLY"
  fi
}

ask_secret() {
  local q="$1" var="$2"
  can_prompt || die "need a TTY for secrets (or set LLM_API_KEY)"
  printf "  %s: " "$q"
  read_reply -s || true
  printf "\n"
  printf -v "$var" '%s' "${REPLY:-}"
}

yes() {
  local q="$1" def="${2:-y}" hint
  [[ "$def" == "y" ]] && hint="Y/n" || hint="y/N"
  if ! can_prompt; then
    [[ "$def" == "y" ]]
    return
  fi
  printf "  %s %s[%s]%s " "$q" "$DIM" "$hint" "$RESET"
  read_reply || true
  local reply="${REPLY:-$def}"
  [[ "$reply" =~ ^[Yy] ]]
}

open_url() {
  local url="$1"
  if [[ "$(uname -s)" == "Darwin" ]]; then open "$url" 2>/dev/null || true
  elif have xdg-open; then xdg-open "$url" 2>/dev/null || true
  fi
}

load_env() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  local value
  value="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- || true)"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

brew_install() {
  have brew || return 1
  info "installing $1…"
  brew install "$1"
}

# ── tools ───────────────────────────────────────────────────────────

ensure_tools() {
  banner "Checking tools"

  if have node; then
    local major; major="$(node -p "process.versions.node.split('.')[0]")"
    (( major >= 18 )) || { brew_install node || die "install Node.js ≥ 18"; }
    ok "node $(node -v | tr -d v)"
  else
    brew_install node || die "install Node.js ≥ 18 from https://nodejs.org"
    ok "node $(node -v | tr -d v)"
  fi

  if ! have pnpm; then
    if have corepack; then corepack enable >/dev/null 2>&1 || true; corepack prepare pnpm@latest --activate
    elif have npm; then npm install -g pnpm
    else brew_install pnpm || die "install pnpm: https://pnpm.io"
    fi
  fi
  ok "pnpm $(pnpm -v)"

  if [[ "$SKIP_DEPLOY" == true ]]; then return; fi

  if ! have aws; then brew_install awscli || die "install AWS CLI"; fi
  ok "aws cli"

  if ! have sam; then brew_install aws-sam-cli || die "install SAM CLI"; fi
  ok "sam cli"

  if ! aws sts get-caller-identity --region "$AWS_REGION" >/dev/null 2>&1; then
    warn "AWS credentials missing"
    say "  Run aws configure, then press enter…"
    can_prompt && read_reply || true
    if ! aws sts get-caller-identity --region "$AWS_REGION" >/dev/null 2>&1; then
      if yes "Open AWS configure now?" y; then
        if [[ -n "$TTY" ]]; then aws configure <"$TTY"
        else aws configure
        fi
      fi
    fi
    aws sts get-caller-identity --region "$AWS_REGION" >/dev/null 2>&1 \
      || die "AWS credentials required — run: aws configure"
  fi
  ok "aws $(aws sts get-caller-identity --query Account --output text)"
}

# ── github app ──────────────────────────────────────────────────────

materialize_pem() {
  printf '%s' "$PRIVATE_KEY_BASE64" | base64 --decode > "$PEM_FILE" 2>/dev/null \
    || printf '%s' "$PRIVATE_KEY_BASE64" | base64 -D > "$PEM_FILE"
  chmod 600 "$PEM_FILE"
}

create_github_app() {
  banner "GitHub App"
  say "  A browser window will open. Click through to create the app."
  say "  (Permissions & events are pre-filled.)"
  ask "GitHub org (empty = your user)" ORG "${ORG}"
  ask "App name" APP_NAME "${APP_NAME}"

  local args=(node "$SCRIPT_DIR/create-github-app.mjs" --name "$APP_NAME")
  [[ -n "$ORG" ]] && args+=(--org "$ORG")

  local json
  json="$("${args[@]}")" || die "GitHub App creation failed / timed out"

  printf '%s\n' "$json" > "$APP_JSON_FILE"
  chmod 600 "$APP_JSON_FILE"

  APP_ID="$(node -e "const a=require(process.argv[1]);process.stdout.write(String(a.id))" "$APP_JSON_FILE")"
  WEBHOOK_SECRET="$(node -e "const a=require(process.argv[1]);process.stdout.write(a.webhook_secret||'')" "$APP_JSON_FILE")"
  BOT_NAME="$(node -e "const a=require(process.argv[1]);process.stdout.write(a.slug||a.name||'')" "$APP_JSON_FILE")"
  APP_HTML_URL="$(node -e "const a=require(process.argv[1]);process.stdout.write(a.html_url||'')" "$APP_JSON_FILE")"
  APP_SLUG="$BOT_NAME"

  node -e "const a=require(process.argv[1]);require('fs').writeFileSync(process.argv[2],a.pem,{mode:0o600})" \
    "$APP_JSON_FILE" "$PEM_FILE"
  chmod 600 "$PEM_FILE"
  PRIVATE_KEY_BASE64="$(base64 < "$PEM_FILE" | tr -d '\n')"
  ok "app ${BOT_NAME} (id ${APP_ID})"
}

reuse_github_app() {
  APP_ID="$(load_env APP_ID)"
  WEBHOOK_SECRET="$(load_env WEBHOOK_SECRET)"
  PRIVATE_KEY_BASE64="$(load_env PRIVATE_KEY_BASE64)"
  BOT_NAME="$(load_env BOT_NAME)"
  [[ -z "$BOT_NAME" ]] && BOT_NAME="$APP_NAME"

  if [[ -z "$PRIVATE_KEY_BASE64" ]]; then
    local pk; pk="$(load_env PRIVATE_KEY)"
    [[ -n "$pk" ]] && PRIVATE_KEY_BASE64="$(printf '%s' "$pk" | base64 | tr -d '\n')"
  fi

  [[ -n "$APP_ID" && -n "$WEBHOOK_SECRET" && -n "$PRIVATE_KEY_BASE64" ]] \
    || die ".env is missing GitHub App credentials — re-run without reuse"
  materialize_pem
  APP_SLUG="$BOT_NAME"
  ok "reusing app ${BOT_NAME} (id ${APP_ID})"
}

# ── llm ─────────────────────────────────────────────────────────────

provider_key_url() {
  case "$1" in
    openai) echo "https://platform.openai.com/api-keys" ;;
    google) echo "https://aistudio.google.com/apikey" ;;
    *)      echo "https://console.anthropic.com/settings/keys" ;;
  esac
}

default_model_for() {
  case "$1" in
    openai) echo "gpt-4.1" ;;
    google) echo "gemini-2.5-flash" ;;
    *)      echo "claude-sonnet-4-20250514" ;;
  esac
}

collect_llm() {
  banner "AI provider"
  say "  1) anthropic   2) openai   3) google"
  local choice
  ask "Choice" choice "1"
  case "$choice" in
    2|openai|o) AI_PROVIDER=openai ;;
    3|google|g) AI_PROVIDER=google ;;
    *)          AI_PROVIDER=anthropic ;;
  esac

  local def_model
  def_model="$(default_model_for "$AI_PROVIDER")"
  if [[ -z "${AI_MODEL_SET:-}" ]]; then
    AI_MODEL="$def_model"
  fi
  ask "Model" AI_MODEL "$AI_MODEL"

  if [[ -z "$LLM_API_KEY" ]]; then
    local existing; existing="$(load_env LLM_API_KEY)"
    if [[ -n "$existing" ]] && yes "Use existing LLM_API_KEY from .env?" y; then
      LLM_API_KEY="$existing"
    fi
  fi

  if [[ -z "$LLM_API_KEY" ]]; then
    local url; url="$(provider_key_url "$AI_PROVIDER")"
    say "  Get a key: $url"
    if yes "Open that page?" y; then open_url "$url"; fi
    ask_secret "Paste API key" LLM_API_KEY
  fi
  [[ -n "$LLM_API_KEY" ]] || die "API key required"
  ok "${AI_PROVIDER} / ${AI_MODEL}"
}

# ── write + deploy ──────────────────────────────────────────────────

write_env() {
  umask 077
  cat > "$ENV_FILE" <<EOF
# Generated by nitpicker setup ($(date -u +%Y-%m-%dT%H:%M:%SZ))

APP_ID=${APP_ID}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
PRIVATE_KEY_BASE64=${PRIVATE_KEY_BASE64}

LLM_API_KEY=${LLM_API_KEY}
AI_PROVIDER=${AI_PROVIDER}
AI_MODEL=${AI_MODEL}
BOT_NAME=${BOT_NAME}

MAX_DIFF_SIZE=50000
REVIEW_ON_OPEN=true

STACK_NAME=${STACK_NAME}
AWS_REGION=${AWS_REGION}
EOF
  ok "wrote .env"
}

deploy_stack() {
  banner "Deploy to AWS"
  ask "AWS region" AWS_REGION "$AWS_REGION"
  ask "Stack name" STACK_NAME "$STACK_NAME"

  info "building + deploying (this can take a minute)…"
  export STACK_NAME AWS_REGION
  (cd "$PROJECT_ROOT" && bash "$SCRIPT_DIR/deploy.sh")

  WEBHOOK_URL="$(
    aws cloudformation describe-stacks \
      --stack-name "$STACK_NAME" \
      --region "$AWS_REGION" \
      --query 'Stacks[0].Outputs[?OutputKey==`WebhookUrl`].OutputValue' \
      --output text
  )"
  [[ -n "$WEBHOOK_URL" && "$WEBHOOK_URL" != "None" ]] || die "no WebhookUrl from stack"
  ok "$WEBHOOK_URL"

  info "wiring GitHub webhook…"
  if node "$SCRIPT_DIR/update-webhook.mjs" \
      --app-id "$APP_ID" --pem-file "$PEM_FILE" \
      --url "$WEBHOOK_URL" --secret "$WEBHOOK_SECRET" >/dev/null; then
    ok "webhook set"
  else
    warn "set webhook manually to: $WEBHOOK_URL"
  fi
}

install_on_repos() {
  banner "Install on your repos"
  local url
  if [[ -n "${APP_SLUG:-}" ]]; then
    url="https://github.com/apps/${APP_SLUG}/installations/new"
  else
    url="https://github.com/settings/apps"
  fi
  say "  Pick the org/repos Nit should review."
  open_url "$url"
  say "  ${DIM}${url}${RESET}"
  if can_prompt; then
    printf "  press enter when done… "
    read_reply || true
  fi
}

# ── main ────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG="$2"; shift 2 ;;
    --name) APP_NAME="$2"; shift 2 ;;
    --stack) STACK_NAME="$2"; shift 2 ;;
    --region) AWS_REGION="$2"; shift 2 ;;
    --model) AI_MODEL="$2"; AI_MODEL_SET=1; shift 2 ;;
    --provider) AI_PROVIDER="$2"; shift 2 ;;
    --llm-key) LLM_API_KEY="$2"; shift 2 ;;
    --skip-deploy) SKIP_DEPLOY=true; shift ;;
    -h|--help)
      cat <<EOF
nitpicker setup — interactive installer

  curl -fsSL https://nitpicker.dev/install | bash

Optional flags (after bash -s --):
  --org ORG       --llm-key KEY   --provider anthropic|openai|google
  --model MODEL   --region R      --stack NAME   --skip-deploy
EOF
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
done

printf "\n%s nitpicker setup %s\n" "$BOLD" "$RESET"
say "${DIM}I'll ask only for what I can't figure out.${RESET}"

ensure_tools

if [[ -f "$ENV_FILE" && -n "$(load_env APP_ID)" ]]; then
  banner "GitHub App"
  if yes "Reuse existing app id $(load_env APP_ID)?" y; then
    reuse_github_app
  else
    create_github_app
  fi
else
  create_github_app
fi
[[ -n "$BOT_NAME" ]] || BOT_NAME="${APP_SLUG:-$APP_NAME}"

collect_llm
write_env

banner "Dependencies"
(cd "$PROJECT_ROOT" && pnpm install --silent)
ok "pnpm install"

WEBHOOK_URL=""
if [[ "$SKIP_DEPLOY" == true ]]; then
  warn "skipped deploy — run pnpm deploy later"
else
  deploy_stack
fi

install_on_repos

printf "\n%s%s ready.%s\n" "$BOLD" "$GREEN" "$RESET"
say "  bot:     @${BOT_NAME}"
say "  model:   ${AI_PROVIDER} / ${AI_MODEL}"
[[ -n "$WEBHOOK_URL" ]] && say "  webhook: ${WEBHOOK_URL}"
say "  home:    ${PROJECT_ROOT}"
say ""
say "  Open a PR — or comment ${BOLD}/nitpicker${RESET} on one."
say ""
