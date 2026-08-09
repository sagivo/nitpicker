# Nitpicker

**Open-source AI PR reviewer.** Reviews the diff only — cheaper, faster, fewer tokens. Runs on one AWS Lambda. Any model.

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

1. Installs missing tools when it can  
2. Creates the GitHub App (browser)  
3. Asks for your LLM API key  
4. Deploys to Lambda and wires the webhook  
5. Opens the page to install the app on your repos  

You need an AWS account and an API key (Anthropic, OpenAI, or Google).

```bash
# optional flags
curl -fsSL https://nitpicker.dev/install | bash -s -- \
  --org my-org \
  --provider openai \
  --model gpt-4.1 \
  --region us-east-1 \
  --stack nitpicker
```

### Installer flags

Pass after `bash -s --` (or to `pnpm setup`):

| Flag | Default | Notes |
| ---- | ------- | ----- |
| `--org ORG` | your user | GitHub org that will own the app |
| `--name NAME` | `nitpicker` | GitHub App name |
| `--provider NAME` | `anthropic` | `anthropic` \| `openai` \| `google` |
| `--model MODEL` | per provider | model id (see defaults below) |
| `--llm-key KEY` | — | skip the API key prompt |
| `--region R` | `us-east-1` | AWS region |
| `--stack NAME` | `nitpicker` | CloudFormation stack name |
| `--skip-deploy` | off | write `.env` only; run `pnpm deploy` later |
| `-h`, `--help` | — | print flag help |

Default models when `--model` is omitted:

| Provider | Default model |
| -------- | ------------- |
| `anthropic` | `claude-sonnet-5` |
| `openai` | `gpt-4.1` |
| `google` | `gemini-2.5-flash` |

### Installer environment variables

Set these before the curl one-liner (or export them):

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `NITPICKER_HOME` | `~/nitpicker` | clone / install directory |
| `NITPICKER_REPO` | `https://github.com/sagivo/nitpicker.git` | git remote to clone |
| `NITPICKER_BRANCH` | `main` | branch to check out |
| `LLM_API_KEY` | — | same as `--llm-key`; also accepts `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY` |
| `AI_PROVIDER` | `anthropic` | same as `--provider` |
| `AI_MODEL` | per provider | same as `--model` |
| `AWS_REGION` | `us-east-1` | same as `--region` |
| `STACK_NAME` | `nitpicker` | same as `--stack` |

```bash
NITPICKER_HOME=~/tools/nitpicker \
  curl -fsSL https://nitpicker.dev/install | bash -s -- --provider openai
```

Already cloned? `pnpm setup` runs the same wizard (same flags).

## Local dev

```bash
cd ~/nitpicker && pnpm dev
# smee -u <url> --target http://localhost:3000/api/github/webhooks
```

## Config

Written to `.env` by setup. Tweak anytime, then `pnpm deploy`:

### AI & behavior

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `LLM_API_KEY` | — | provider API key (required) |
| `AI_PROVIDER` | `anthropic` | `anthropic` \| `openai` \| `google` |
| `AI_MODEL` | `claude-sonnet-5` | model id |
| `BOT_NAME` | `nitpicker-bot` | must match `@mentions` (set to app slug by setup) |
| `REVIEW_ON_OPEN` | `true` | auto-review on PR open / reopen / ready for review |
| `MAX_DIFF_SIZE` | `50000` | max diff chars sent to the model |
| `MAX_REVIEWER_GUIDE_SIZE` | `20000` | max chars from reviewer guide files |
| `MAX_COPILOT_INSTRUCTIONS_SIZE` | `20000` | max chars from copilot instruction files |

### GitHub App (set by setup)

| Variable | Notes |
| -------- | ----- |
| `APP_ID` | GitHub App ID |
| `WEBHOOK_SECRET` | webhook HMAC secret |
| `PRIVATE_KEY_BASE64` | app private key, base64-encoded PEM (preferred on Lambda) |
| `PRIVATE_KEY` | raw PEM; used if `PRIVATE_KEY_BASE64` is unset |

### Deploy

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `STACK_NAME` | `nitpicker` | CloudFormation stack name |
| `AWS_REGION` | `us-east-1` | deploy region |

```bash
pnpm deploy   # builds Lambda bundle + sam deploy from .env
```

## License

MIT
