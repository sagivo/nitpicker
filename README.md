# Nitpicker

**Open-source AI PR reviewer.** Reviews the diff only — cheaper, faster, fewer tokens. Any model.

| | |
| --- | --- |
| **Auto-review** | On open, reopen, ready for review |
| **On demand** | Comment `/nitpicker` |
| **Q&A** | `@bot why did we change this?` |

## Install

```bash
curl -fsSL https://nitpicker.dev/install | bash
```

The installer clones into `~/nitpicker`, then runs a short wizard:

1. **Choose deploy method** (Lambda, Cloudflare Workers, or GitHub Actions)
2. Installs missing tools when it can
3. Creates the GitHub App when needed (browser)
4. Asks for your LLM API key
5. Deploys / prints workflow setup
6. Opens the app install page (App modes)

```bash
# optional flags
curl -fsSL https://nitpicker.dev/install | bash -s -- \
  --method lambda \
  --org my-org \
  --provider openai \
  --model gpt-4.1
```

### Deploy methods

| Method | Flag | Needs | Best for |
| ------ | ---- | ----- | -------- |
| **AWS Lambda** | `--method lambda` | AWS account + GitHub App | Multi-repo bot, instant webhooks |
| **Cloudflare Workers** | `--method worker` | CF account + GitHub App | Multi-repo bot, no AWS |
| **GitHub Actions** | `--method actions` | Repo workflow + `LLM_API_KEY` secret | No always-on server; per-repo |

**App modes** (Lambda / Workers): real bot user, multi-repo install, `/nitpicker` + `@bot` Q&A.

**Actions mode:** posts as `github-actions[bot]` (unless you pass a PAT). Add the workflow from `examples/github-actions/nitpicker.yml` and set secret `LLM_API_KEY`. Q&A via `@github-actions …`.

### Installer flags

Pass after `bash -s --` (or to `pnpm setup`):

| Flag | Default | Notes |
| ---- | ------- | ----- |
| `--method NAME` | prompt | `lambda` \| `worker` \| `actions` |
| `--org ORG` | your user | GitHub org that will own the app |
| `--name NAME` | `nitpicker` | GitHub App name |
| `--provider NAME` | `anthropic` | `anthropic` \| `openai` \| `google` |
| `--model MODEL` | per provider | model id (see defaults below) |
| `--llm-key KEY` | — | skip the API key prompt |
| `--region R` | `us-east-1` | AWS region (lambda) |
| `--stack NAME` | `nitpicker` | CloudFormation stack name (lambda) |
| `--worker-name N` | `nitpicker` | Cloudflare Worker name (worker) |
| `--skip-deploy` | off | write `.env` only; deploy later |
| `-h`, `--help` | — | print flag help |

Default models when `--model` is omitted:

| Provider | Default model |
| -------- | ------------- |
| `anthropic` | `claude-sonnet-5` |
| `openai` | `gpt-4.1` |
| `google` | `gemini-2.5-flash` |

### Installer environment variables

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `NITPICKER_HOME` | `~/nitpicker` | clone / install directory |
| `NITPICKER_REPO` | `https://github.com/sagivo/nitpicker.git` | git remote to clone |
| `NITPICKER_BRANCH` | `main` | branch to check out |
| `DEPLOY_METHOD` | — | same as `--method` |
| `LLM_API_KEY` | — | same as `--llm-key`; also accepts provider-specific `*_API_KEY` vars |
| `AI_PROVIDER` | `anthropic` | same as `--provider` |
| `AI_MODEL` | per provider | same as `--model` |
| `AWS_REGION` | `us-east-1` | same as `--region` |
| `STACK_NAME` | `nitpicker` | same as `--stack` |
| `CF_WORKER_NAME` | `nitpicker` | same as `--worker-name` |

```bash
NITPICKER_HOME=~/tools/nitpicker \
  curl -fsSL https://nitpicker.dev/install | bash -s -- --method worker --provider openai
```

Already cloned? `pnpm setup` runs the same wizard (same flags).

## GitHub Actions (manual)

```yaml
# .github/workflows/nitpicker.yml
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
          ai-provider: anthropic   # optional
          ai-model: claude-sonnet-5
```

Full template: [`examples/github-actions/nitpicker.yml`](examples/github-actions/nitpicker.yml).

## Local dev

```bash
cd ~/nitpicker && pnpm dev
# smee -u <url> --target http://localhost:3000/api/github/webhooks
```

## Config

Written to `.env` by setup. Tweak anytime, then redeploy.

### AI & behavior

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `LLM_API_KEY` | — | provider API key (required) |
| `AI_PROVIDER` | `anthropic` | `anthropic` \| `openai` \| `google` |
| `AI_MODEL` | `claude-sonnet-5` | model id |
| `BOT_NAME` | `nitpicker-bot` | must match `@mentions` (app slug, or `github-actions` for Actions) |
| `REVIEW_ON_OPEN` | `true` | auto-review on PR open / reopen / ready for review |
| `MAX_DIFF_SIZE` | `50000` | max diff chars sent to the model |
| `MAX_REVIEWER_GUIDE_SIZE` | `20000` | max chars from reviewer guide files |
| `MAX_COPILOT_INSTRUCTIONS_SIZE` | `20000` | max chars from copilot instruction files |

### GitHub App (Lambda / Workers)

| Variable | Notes |
| -------- | ----- |
| `APP_ID` | GitHub App ID |
| `WEBHOOK_SECRET` | webhook HMAC secret |
| `PRIVATE_KEY_BASE64` | app private key, base64-encoded PEM (preferred) |
| `PRIVATE_KEY` | raw PEM; used if `PRIVATE_KEY_BASE64` is unset |

### Deploy

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `DEPLOY_METHOD` | — | `lambda` \| `worker` \| `actions` |
| `STACK_NAME` | `nitpicker` | CloudFormation stack (lambda) |
| `AWS_REGION` | `us-east-1` | deploy region (lambda) |
| `CF_WORKER_NAME` | `nitpicker` | Worker name (worker) |

```bash
pnpm deploy          # Lambda (from .env)
pnpm deploy:worker   # Cloudflare Workers (from .env)
# Actions: add workflow + secrets — no deploy command
```

## License

MIT
