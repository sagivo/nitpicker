import { readFileSync } from "node:fs";
import { Octokit } from "@octokit/rest";
import { handlePullRequest } from "./handlers/pull-request.js";
import { handleIssueComment } from "./handlers/comment.js";
import { handleReviewComment } from "./handlers/review-comment.js";

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

const log: Logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  debug: (...args) => console.debug(...args),
};

/**
 * Minimal Probot-compatible context for GitHub Actions.
 * Handlers only need octokit, payload, log, and repo().
 */
function createActionsContext(octokit: Octokit, payload: any): any {
  const owner =
    payload.repository?.owner?.login ?? payload.organization?.login;
  const repo = payload.repository?.name;

  if (!owner || !repo) {
    throw new Error("Event payload missing repository owner/name");
  }

  return {
    octokit,
    payload,
    log,
    repo: (extras: Record<string, unknown> = {}) => ({
      owner,
      repo,
      ...extras,
    }),
  };
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN (or GH_TOKEN) is required");
  }
  if (!process.env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY is required");
  }

  // Default bot identity when posting as github-actions[bot]
  if (!process.env.BOT_NAME) {
    process.env.BOT_NAME = "github-actions";
  }

  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventName || !eventPath) {
    throw new Error("GITHUB_EVENT_NAME and GITHUB_EVENT_PATH are required");
  }

  const payload = JSON.parse(readFileSync(eventPath, "utf8"));
  const octokit = new Octokit({ auth: token });
  const context = createActionsContext(octokit, payload);
  const action = payload.action as string | undefined;

  log.info(`nitpicker actions: ${eventName}.${action ?? "?"}`);

  switch (eventName) {
    case "pull_request": {
      if (
        action === "opened" ||
        action === "reopened" ||
        action === "ready_for_review"
      ) {
        await handlePullRequest(context);
      } else {
        log.info(`Ignoring pull_request.${action}`);
      }
      break;
    }
    case "issue_comment": {
      if (action === "created") {
        await handleIssueComment(context);
      } else {
        log.info(`Ignoring issue_comment.${action}`);
      }
      break;
    }
    case "pull_request_review_comment": {
      if (action === "created") {
        await handleReviewComment(context);
      } else {
        log.info(`Ignoring pull_request_review_comment.${action}`);
      }
      break;
    }
    default:
      log.info(`Ignoring unsupported event: ${eventName}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
