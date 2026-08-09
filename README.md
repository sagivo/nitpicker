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
curl -fsSL https://nitpicker.dev/install | bash -s -- --org my-org --provider openai
```

Already cloned? `pnpm setup` runs the same wizard.

## Local dev

```bash
cd ~/nitpicker && pnpm dev
# smee -u <url> --target http://localhost:3000/api/github/webhooks
```

## Config

Written to `.env` by setup. Tweak anytime, then `pnpm deploy`:

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `LLM_API_KEY` | — | provider API key |
| `AI_PROVIDER` | `anthropic` | `anthropic` \| `openai` \| `google` |
| `AI_MODEL` | `claude-sonnet-4-20250514` | model id |
| `BOT_NAME` | app slug | must match `@mentions` |
| `REVIEW_ON_OPEN` | `true` | auto-review on PR open |
| `MAX_DIFF_SIZE` | `50000` | max diff chars to the model |

## License

MIT
