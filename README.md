# PR Reviewer Bot

AI-powered GitHub pull request reviewer built with [Probot](https://probot.github.io/) and [Vercel AI SDK](https://ai-sdk.dev). Uses Claude Sonnet as the default model, but supports any LLM provider through the AI SDK.

## Features

- **Auto-review** -- Automatically reviews when a pull request is opened or reopened
- **On-demand review** -- Comment `/ai-review` on any PR to trigger a review
- **Question answering** -- Tag the bot (e.g. `@pr-reviewer-bot what does this change do?`) in a PR comment to ask questions
- **Thread replies** -- Tag the bot in a review comment thread and it will reply with context-aware answers

## Prerequisites

- Node.js 18+
- A [GitHub App](#creating-a-github-app) registered on GitHub
- An [Anthropic API key](https://console.anthropic.com/) (or any AI SDK-compatible provider)

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url> pr-reviewer
cd pr-reviewer
pnpm install
```

### 2. Creating a GitHub App

1. Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**
2. Fill in the basics:

- **Name**: `pr-reviewer-bot` (or your preferred name)
- **Homepage URL**: any valid URL
- **Webhook URL**: your server URL + `/api/github/webhooks` (use [smee.io](https://smee.io) for local dev)
- **Webhook secret**: generate a random string and save it

3. Set **Permissions**:

- **Pull requests**: Read & Write
- **Issues**: Read & Write
- **Contents**: Read-only

4. Subscribe to **events**:

- `Pull request`
- `Issue comment`
- `Pull request review comment`

5. Click **Create GitHub App**
6. After creation, generate a **Private Key** (downloads a `.pem` file)
7. Note the **App ID** from the app settings page
8. **Install** the app on the repositories you want to use it with

### 3. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

```env
# From your GitHub App settings
APP_ID=123456
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
WEBHOOK_SECRET=your-webhook-secret

# From Anthropic (or your chosen provider)
ANTHROPIC_API_KEY=sk-ant-...

# Optional overrides
AI_MODEL=claude-sonnet-4-20250514
BOT_NAME=pr-reviewer-bot
MAX_DIFF_SIZE=50000
```

For the `PRIVATE_KEY`, you can either:

- Paste the key contents with `\n` for newlines (as shown above)
- Set `PRIVATE_KEY_PATH` to the path of the `.pem` file

### 4. Local development

For local development, use [smee.io](https://smee.io) to forward GitHub webhooks to your machine:

1. Go to [https://smee.io/new](https://smee.io/new) and copy the webhook proxy URL
2. Set this URL as the **Webhook URL** in your GitHub App settings
3. Install the smee client:

```bash
npm install -g smee-client
```

1. Start the proxy and the dev server:

```bash
# Terminal 1: forward webhooks
smee -u https://smee.io/YOUR_CHANNEL --target http://localhost:3000/api/github/webhooks

# Terminal 2: start the bot
pnpm dev
```

### 5. Production

```bash
pnpm build
pnpm start
```

## Quick Start

1. [Create a GitHub App](#2-creating-a-github-app) with the required permissions and events
2. [Get an Anthropic API key](https://console.anthropic.com/) (or another AI provider key)
3. Copy `.env.example` to `.env` and fill in `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`, and `ANTHROPIC_API_KEY`
4. Install the app on your target repository via the GitHub App settings page
5. Start the bot:

```bash
pnpm install
pnpm dev
```

1. For local development, run [smee.io](https://smee.io) in a separate terminal to forward webhooks:

```bash
smee -u https://smee.io/YOUR_CHANNEL --target http://localhost:3000/api/github/webhooks
```

1. Open a PR on the repo where you installed the app — the bot will automatically post a review on initial open.

## Usage

**When is the bot triggered?**
The bot activates in two ways:

- **Automatically** — when a pull request is first opened or reopened
- **On-demand** — whenever someone mentions `@<bot-name>` (e.g. `@botname`) in a PR comment or review thread, or posts `/ai-review`

The bot name defaults to `pr-reviewer-bot`. Set `BOT_NAME` in your `.env` to match your GitHub App slug (e.g. PRettyHarsh).

Once the bot is running and installed on a repository, it responds to three types of triggers:

| Trigger              | How to activate                                    | What happens                                                          |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| **Auto-review**      | Open or reopen a PR                                | Bot automatically posts an inline code review with severity labels    |
| **On-demand review** | Comment `/ai-review` on any PR                     | Bot reviews the current PR state and posts findings as a comment      |
| **Ask a question**   | Comment `@pr-reviewer-bot <your question>` on a PR | Bot answers using the PR diff and description as context              |
| **Thread reply**     | Tag `@pr-reviewer-bot` in a review comment thread  | Bot replies with context from the thread history and surrounding code |

### Automatic reviews

Once installed on a repository, the bot will automatically review a pull request when it is first opened or reopened. It will not trigger on subsequent commits pushed to the PR. Reviews appear as PR review comments with inline suggestions categorized by severity (critical / warning / suggestion).

Set `REVIEW_ON_OPEN=false` in your `.env` to disable auto-reviews and only use on-demand mode.

### On-demand review

Comment on any PR:

```
/ai-review
```

### Ask a question

Tag the bot in a PR comment:

```
@pr-reviewer-bot Why was this function refactored?
```

### Reply in a thread

Tag the bot in a review comment thread:

```
@pr-reviewer-bot Can you suggest a better approach here?
```

> **Important:** The `@pr-reviewer-bot` mention must match the **slug** of your GitHub App (lowercase, hyphenated). For example, if your GitHub App is named "My PR Reviewer", the slug is `my-pr-reviewer` and users would tag `@my-pr-reviewer`. Set `BOT_NAME` in your `.env` to match.

## Switching AI Providers

The service uses Vercel AI SDK, so you can swap the AI provider by changing the model configuration. For example, to use OpenAI:

1. Install the provider: `pnpm add @ai-sdk/openai`
2. Update `src/services/ai.ts`:

```typescript
import { openai } from "@ai-sdk/openai";
// change getModel() to return openai("gpt-4o")
```

1. Set `OPENAI_API_KEY` in your `.env`

See [AI SDK Providers](https://ai-sdk.dev/providers) for all supported providers.

## Configuration

| Variable            | Default                    | Description                                 |
| ------------------- | -------------------------- | ------------------------------------------- |
| `APP_ID`            | --                         | GitHub App ID                               |
| `PRIVATE_KEY`       | --                         | GitHub App private key                      |
| `WEBHOOK_SECRET`    | --                         | GitHub webhook secret                       |
| `ANTHROPIC_API_KEY` | --                         | Anthropic API key                           |
| `AI_MODEL`          | `claude-sonnet-4-20250514` | Model ID to use                             |
| `BOT_NAME`          | `pr-reviewer-bot`          | Bot name for @mentions                      |
| `MAX_DIFF_SIZE`     | `50000`                    | Max diff characters sent to the AI          |
| `REVIEW_ON_OPEN`    | `true`                     | Auto-review when a PR is opened or reopened |

## Project Structure

```
src/
  index.ts              # App entry point, registers webhook handlers
  config.ts             # Environment-based configuration
  handlers/
    pull-request.ts     # PR opened/reopened handler
    comment.ts          # Issue comment handler (@mention + /ai-review)
    review-comment.ts   # Review thread comment handler
  services/
    ai.ts               # AI service (Vercel AI SDK + Anthropic)
    github.ts           # GitHub API helpers
  prompts/
    review.ts           # System/user prompts for code review
    question.ts         # Prompts for Q&A and thread replies
```

## License

MIT
