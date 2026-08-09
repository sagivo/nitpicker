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
EXAMPLES_ACTIONS="${PROJECT_ROOT}/examples/github-actions/nitpicker.yml"

APP_NAME="nitpicker"
ORG=""
STACK_NAME="${STACK_NAME:-nitpicker}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CF_WORKER_NAME="${CF_WORKER_NAME:-nitpicker}"
AI_MODEL="${AI_MODEL:-claude-sonnet-5}"
AI_PROVIDER="${AI_PROVIDER:-anthropic}"
BOT_NAME=""
LLM_API_KEY="${LLM_API_KEY:-${ANTHROPIC_API_KEY:-${OPENAI_API_KEY:-${GOOGLE_GENERATIVE_AI_API_KEY:-}}}}"
SKIP_DEPLOY=false
# lambda | worker | actions  (empty = ask)
DEPLOY_METHOD="${DEPLOY_METHOD:-}"

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

# curl|bash leaves stdin as the script pipe — prefer the real terminal.
TTY=""
if [[ -e /dev/tty ]] && { : </dev/tty; } 2>/dev/null; then
  TTY="/dev/tty"
fi

can_prompt() {
  [[ -n "$TTY" || -t 0 ]]
}

read_reply() {
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
  local q="$1" var="$2" def="${3-}"
  local has_def=false
  (( $# >= 3 )) && has_def=true
  if [[ "$has_def" == true && -n "$def" ]]; then
    printf "  %s %s[%s]%s: " "$q" "$DIM" "$def" "$RESET"
  else
    printf "  %s: " "$q"
  fi
  if ! can_prompt; then
    [[ "$has_def" == true ]] || die "need a TTY to answer: $q"
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

normalize_method() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|lambda|aws|app|app+lambda|github-app|github_app) DEPLOY_METHOD=lambda ;;
    2|worker|workers|cloudflare|cf|cfw) DEPLOY_METHOD=worker ;;
    3|actions|action|gha|github-actions|github_actions) DEPLOY_METHOD=actions ;;
    *) return 1 ;;
  esac
}

# ── method ──────────────────────────────────────────────────────────

choose_method() {
  banner "Deploy method"
  if [[ -n "$DEPLOY_METHOD" ]]; then
    normalize_method "$DEPLOY_METHOD" || die "unknown --method: $DEPLOY_METHOD (use lambda|worker|actions)"
    ok "method: ${DEPLOY_METHOD}"
    return
  fi

  say "  ${BOLD}1) AWS Lambda${RESET}          GitHub App + webhook  · multi-repo · AWS account"
  say "  ${BOLD}2) Cloudflare Workers${RESET} GitHub App + webhook  · multi-repo · CF account"
  say "  ${BOLD}3) GitHub Actions${RESET}     per-repo workflow     · no server  · GITHUB_TOKEN"
  say ""
  say "  ${DIM}App modes get a real bot identity + instant /nitpicker & @mentions.${RESET}"
  say "  ${DIM}Actions posts as github-actions[bot]; no AWS/CF required.${RESET}"

  local choice
  ask "Choice" choice "1"
  normalize_method "$choice" || normalize_method "1" || true
  ok "method: ${DEPLOY_METHOD}"
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

  case "$DEPLOY_METHOD" in
    lambda)
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
      ;;
    worker)
      if ! have wrangler && ! have npx; then
        die "need wrangler or npx to deploy Workers"
      fi
      ok "wrangler $({ wrangler --version 2>/dev/null || npx wrangler --version 2>/dev/null || echo ready; } | head -1)"
      if ! { wrangler whoami >/dev/null 2>&1 || npx wrangler whoami >/dev/null 2>&1; }; then
        warn "Not logged into Cloudflare"
        say "  Run: npx wrangler login"
        if yes "Login now?" y; then
          if have wrangler; then wrangler login
          else npx wrangler login
          fi
        fi
        { wrangler whoami >/dev/null 2>&1 || npx wrangler whoami >/dev/null 2>&1; } \
          || die "Cloudflare login required — run: npx wrangler login"
      fi
      ok "cloudflare auth"
      ;;
    actions)
      ok "no cloud deploy tools needed"
      ;;
  esac
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

setup_github_app() {
  if [[ -f "$ENV_FILE" && -n "$(load_env APP_ID)" ]]; then
    banner "GitHub App"
    if yes "Reuse existing app id $(load_env APP_ID)?" y; then
      reuse_github_app
      return
    fi
  fi
  create_github_app
  [[ -n "$BOT_NAME" ]] || BOT_NAME="${APP_SLUG:-$APP_NAME}"
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
    *)      echo "claude-sonnet-5" ;;
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
  {
    echo "# Generated by nitpicker setup ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
    echo "DEPLOY_METHOD=${DEPLOY_METHOD}"
    echo ""
    if [[ "$DEPLOY_METHOD" != "actions" ]]; then
      echo "APP_ID=${APP_ID}"
      echo "WEBHOOK_SECRET=${WEBHOOK_SECRET}"
      echo "PRIVATE_KEY_BASE64=${PRIVATE_KEY_BASE64}"
      echo ""
    fi
    echo "LLM_API_KEY=${LLM_API_KEY}"
    echo "AI_PROVIDER=${AI_PROVIDER}"
    echo "AI_MODEL=${AI_MODEL}"
    echo "BOT_NAME=${BOT_NAME}"
    echo ""
    echo "MAX_DIFF_SIZE=50000"
    echo "REVIEW_ON_OPEN=true"
    echo ""
    case "$DEPLOY_METHOD" in
      lambda)
        echo "STACK_NAME=${STACK_NAME}"
        echo "AWS_REGION=${AWS_REGION}"
        ;;
      worker)
        echo "CF_WORKER_NAME=${CF_WORKER_NAME}"
        ;;
      actions)
        echo "# Add LLM_API_KEY as a GitHub Actions secret in each repo"
        ;;
    esac
  } > "$ENV_FILE"
  ok "wrote .env"
}

deploy_lambda() {
  banner "Deploy to AWS Lambda"
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

deploy_worker() {
  banner "Deploy to Cloudflare Workers"
  ask "Worker name" CF_WORKER_NAME "$CF_WORKER_NAME"

  info "deploying worker + secrets…"
  export CF_WORKER_NAME
  # ensure .env has latest worker name before deploy script reads it
  if grep -q '^CF_WORKER_NAME=' "$ENV_FILE" 2>/dev/null; then
    tmp="$(mktemp)"
    sed "s/^CF_WORKER_NAME=.*/CF_WORKER_NAME=${CF_WORKER_NAME}/" "$ENV_FILE" >"$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '\nCF_WORKER_NAME=%s\n' "$CF_WORKER_NAME" >>"$ENV_FILE"
  fi

  DEPLOY_OUT="$(cd "$PROJECT_ROOT" && bash "$SCRIPT_DIR/deploy-worker.sh")" || {
    printf '%s\n' "$DEPLOY_OUT"
    die "worker deploy failed"
  }
  printf '%s\n' "$DEPLOY_OUT"

  WEBHOOK_URL="$(
    printf '%s\n' "$DEPLOY_OUT" | grep -Eo 'https://[a-zA-Z0-9._/-]+\.workers\.dev' | head -1 || true
  )"
  if [[ -n "$WEBHOOK_URL" ]]; then
    ok "$WEBHOOK_URL"
    info "wiring GitHub webhook…"
    if node "$SCRIPT_DIR/update-webhook.mjs" \
        --app-id "$APP_ID" --pem-file "$PEM_FILE" \
        --url "$WEBHOOK_URL" --secret "$WEBHOOK_SECRET" >/dev/null; then
      ok "webhook set"
    else
      warn "set webhook manually to: $WEBHOOK_URL"
    fi
  else
    warn "could not parse workers.dev URL — set the GitHub App webhook manually"
  fi
}

setup_actions() {
  banner "GitHub Actions setup"
  BOT_NAME="${BOT_NAME:-github-actions}"

  say "  Add this workflow to each repo (or org reusable workflow):"
  say "  ${DIM}.github/workflows/nitpicker.yml${RESET}"
  say ""
  if [[ -f "$EXAMPLES_ACTIONS" ]]; then
    say "  Template:"
    say "  ${DIM}${EXAMPLES_ACTIONS}${RESET}"
  fi
  say ""
  say "  Repo secrets / variables:"
  say "    ${BOLD}LLM_API_KEY${RESET}     (secret, required)"
  say "    AI_PROVIDER    (variable, default anthropic)"
  say "    AI_MODEL       (variable, default ${AI_MODEL})"
  say "    BOT_NAME       (variable, default github-actions)"
  say ""
  say "  Minimal workflow:"
  cat <<'YAML'
  name: Nitpicker
  on:
    pull_request:
      types: [opened, reopened, ready_for_review]
    issue_comment:
      types: [created]
    pull_request_review_comment:
      types: [created]
  permissions:
    contents: read
    pull-requests: write
    issues: write
  jobs:
    review:
      runs-on: ubuntu-latest
      steps:
        - uses: sagivo/nitpicker@main
          with:
            llm-api-key: ${{ secrets.LLM_API_KEY }}
YAML
  say ""
  say "  Then open a PR — or comment ${BOLD}/nitpicker${RESET}."
  say "  Q&A: ${BOLD}@github-actions why…${RESET} (or set BOT_NAME + a PAT for a custom identity)."

  if can_prompt && yes "Copy workflow template path to clipboard?" n; then
    if have pbcopy; then printf '%s' "$EXAMPLES_ACTIONS" | pbcopy && ok "copied path"
    elif have xclip; then printf '%s' "$EXAMPLES_ACTIONS" | xclip -selection clipboard && ok "copied path"
    else warn "no clipboard tool found"
    fi
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
    --worker-name) CF_WORKER_NAME="$2"; shift 2 ;;
    --model) AI_MODEL="$2"; AI_MODEL_SET=1; shift 2 ;;
    --provider) AI_PROVIDER="$2"; shift 2 ;;
    --llm-key) LLM_API_KEY="$2"; shift 2 ;;
    --method) DEPLOY_METHOD="$2"; shift 2 ;;
    --skip-deploy) SKIP_DEPLOY=true; shift ;;
    -h|--help)
      cat <<EOF
nitpicker setup — interactive installer

  curl -fsSL https://nitpicker.dev/install | bash
  pnpm setup

Optional flags (after bash -s --):
  --method NAME      lambda | worker | actions
  --org ORG          GitHub org for the app (default: your user)
  --name NAME        GitHub App name (default: nitpicker)
  --provider NAME    anthropic | openai | google (default: anthropic)
  --model MODEL      model id (default depends on provider)
  --llm-key KEY      skip the API key prompt
  --region R         AWS region for lambda (default: us-east-1)
  --stack NAME       CloudFormation stack (default: nitpicker)
  --worker-name N    Cloudflare Worker name (default: nitpicker)
  --skip-deploy      write .env only; deploy later

Methods:
  lambda    GitHub App + AWS Lambda webhook (multi-repo bot)
  worker    GitHub App + Cloudflare Workers webhook (multi-repo bot)
  actions   GitHub Actions workflow per repo (no always-on server)
EOF
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
done

printf "\n%s nitpicker setup %s\n" "$BOLD" "$RESET"
say "${DIM}I'll ask only for what I can't figure out.${RESET}"

choose_method
ensure_tools

case "$DEPLOY_METHOD" in
  lambda|worker)
    setup_github_app
    [[ -n "$BOT_NAME" ]] || BOT_NAME="${APP_SLUG:-$APP_NAME}"
    ;;
  actions)
    BOT_NAME="${BOT_NAME:-github-actions}"
    APP_ID=""; WEBHOOK_SECRET=""; PRIVATE_KEY_BASE64=""; APP_SLUG=""
    ;;
esac

collect_llm
write_env

banner "Dependencies"
(cd "$PROJECT_ROOT" && pnpm install --silent)
ok "pnpm install"

WEBHOOK_URL=""
if [[ "$SKIP_DEPLOY" == true ]]; then
  warn "skipped deploy — finish setup manually (see README)"
else
  case "$DEPLOY_METHOD" in
    lambda)  deploy_lambda ;;
    worker)  deploy_worker ;;
    actions) setup_actions ;;
  esac
fi

if [[ "$DEPLOY_METHOD" == "lambda" || "$DEPLOY_METHOD" == "worker" ]]; then
  install_on_repos
fi

printf "\n%s%s ready.%s\n" "$BOLD" "$GREEN" "$RESET"
say "  method:  ${DEPLOY_METHOD}"
say "  bot:     @${BOT_NAME}"
say "  model:   ${AI_PROVIDER} / ${AI_MODEL}"
[[ -n "$WEBHOOK_URL" ]] && say "  webhook: ${WEBHOOK_URL}"
say "  home:    ${PROJECT_ROOT}"
say ""
case "$DEPLOY_METHOD" in
  actions)
    say "  Add the workflow + LLM_API_KEY secret, then open a PR."
    ;;
  *)
    say "  Open a PR — or comment ${BOLD}/nitpicker${RESET} on one."
    ;;
esac
say ""
