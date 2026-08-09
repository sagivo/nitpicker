import type { Context } from "probot";
import { config } from "../config.js";

export interface PathInstruction {
  applyTo: string;
  content: string;
}

export interface PRDetails {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  diff: string;
  changedFiles: ChangedFile[];
  reviewerGuide?: string;
  copilotInstructions?: string;
  pathInstructions?: PathInstruction[];
}

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ThreadComment {
  id: number;
  user: string;
  body: string;
  createdAt: string;
}

/**
 * Fetch full PR details including diff and changed file list.
 * Truncates the diff if it exceeds the configured max size.
 */
export async function fetchPRDetails(
  context: Context<
    "pull_request" | "pull_request.opened" | "pull_request.synchronize"
  >,
): Promise<PRDetails> {
  const { owner, repo } = context.repo();
  const number = context.payload.pull_request.number;

  // Split into critical (must succeed) and optional (gracefully degrade) fetches.
  // Critical fetches throw on failure; optional ones already swallow errors internally,
  // but allSettled provides an extra safety net so a regression never takes down the review.
  const [diffResponse, filesResponse] = await Promise.all([
    context.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: number,
      mediaType: { format: "diff" },
    }),
    context.octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    }),
  ]);

  const optionalResults = await Promise.allSettled([
    fetchReviewerGuide(context.octokit, owner, repo),
    fetchCopilotInstructions(context.octokit, owner, repo),
    fetchPathInstructions(context.octokit, owner, repo),
  ]);

  const reviewerGuide =
    optionalResults[0].status === "fulfilled" ? optionalResults[0].value : undefined;
  const copilotInstructions =
    optionalResults[1].status === "fulfilled" ? optionalResults[1].value : undefined;
  const pathInstructions =
    optionalResults[2].status === "fulfilled" ? optionalResults[2].value : [];

  let diff = String(diffResponse.data);
  if (diff.length > config.maxDiffSize) {
    diff = diff.slice(0, config.maxDiffSize) + "\n\n[diff truncated]";
  }

  const changedFiles: ChangedFile[] = filesResponse.data.map((f: any) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));

  return {
    owner,
    repo,
    number,
    title: context.payload.pull_request.title,
    body: context.payload.pull_request.body ?? "",
    diff,
    changedFiles,
    reviewerGuide,
    copilotInstructions,
    pathInstructions: pathInstructions.length > 0 ? pathInstructions : undefined,
  };
}

/**
 * Fetch PR details using just owner/repo/number (for comment-triggered flows
 * where the context event is not a pull_request event).
 */
export async function fetchPRDetailsFromIssue(
  context: Context<"issue_comment" | "issue_comment.created">,
  pullNumber: number,
): Promise<PRDetails> {
  const { owner, repo } = context.repo();

  const [prResponse, diffResponse, filesResponse] = await Promise.all([
    context.octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
    context.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: "diff" },
    }),
    context.octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    }),
  ]);

  const optionalResults = await Promise.allSettled([
    fetchReviewerGuide(context.octokit, owner, repo),
    fetchCopilotInstructions(context.octokit, owner, repo),
    fetchPathInstructions(context.octokit, owner, repo),
  ]);

  const reviewerGuide =
    optionalResults[0].status === "fulfilled" ? optionalResults[0].value : undefined;
  const copilotInstructions =
    optionalResults[1].status === "fulfilled" ? optionalResults[1].value : undefined;
  const pathInstructions =
    optionalResults[2].status === "fulfilled" ? optionalResults[2].value : [];

  let diff = String(diffResponse.data);
  if (diff.length > config.maxDiffSize) {
    diff = diff.slice(0, config.maxDiffSize) + "\n\n[diff truncated]";
  }

  const changedFiles: ChangedFile[] = filesResponse.data.map((f: any) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));

  const pr = prResponse.data;
  return {
    owner,
    repo,
    number: pullNumber,
    title: pr.title,
    body: pr.body ?? "",
    diff,
    changedFiles,
    reviewerGuide,
    copilotInstructions,
    pathInstructions: pathInstructions.length > 0 ? pathInstructions : undefined,
  };
}

/**
 * Fetch all comments in a review comment thread by walking the
 * `in_reply_to_id` chain back to the root, then fetching siblings.
 */
export async function fetchReviewThread(
  context: Context<
    "pull_request_review_comment" | "pull_request_review_comment.created"
  >,
): Promise<{
  rootComment: ThreadComment;
  thread: ThreadComment[];
  filePath: string;
  diffHunk: string;
}> {
  const { owner, repo } = context.repo();
  const pullNumber = context.payload.pull_request.number;
  const comment = context.payload.comment;

  const rootId = comment.in_reply_to_id ?? comment.id;

  const allComments: any[] = await context.octokit.paginate(
    context.octokit.rest.pulls.listReviewComments,
    { owner, repo, pull_number: pullNumber, per_page: 100 },
  );

  const threadComments = allComments.filter(
    (c: any) => c.id === rootId || c.in_reply_to_id === rootId,
  );

  threadComments.sort(
    (a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const root = threadComments[0];
  const thread: ThreadComment[] = threadComments.map((c: any) => ({
    id: c.id,
    user: c.user?.login ?? "unknown",
    body: c.body,
    createdAt: c.created_at,
  }));

  return {
    rootComment: thread[0],
    thread,
    filePath: root?.path ?? comment.path,
    diffHunk: root?.diff_hunk ?? comment.diff_hunk,
  };
}

export type ReactionTarget =
  | { type: "pr"; pullNumber: number }
  | { type: "issueComment"; commentId: number }
  | { type: "reviewComment"; commentId: number };

/**
 * Add a 👀 reaction to signal that the bot is processing.
 * Returns the reaction ID so it can be removed later.
 */
export async function addEyesReaction(
  context: Context<any>,
  target: ReactionTarget,
): Promise<number> {
  const repo = context.repo();
  switch (target.type) {
    case "pr": {
      const { data } = await context.octokit.rest.reactions.createForIssue({
        ...repo,
        issue_number: target.pullNumber,
        content: "eyes",
      });
      return data.id;
    }
    case "issueComment": {
      const { data } =
        await context.octokit.rest.reactions.createForIssueComment({
          ...repo,
          comment_id: target.commentId,
          content: "eyes",
        });
      return data.id;
    }
    case "reviewComment": {
      const { data } =
        await context.octokit.rest.reactions.createForPullRequestReviewComment({
          ...repo,
          comment_id: target.commentId,
          content: "eyes",
        });
      return data.id;
    }
  }
}

export async function removeEyesReaction(
  context: Context<any>,
  target: ReactionTarget,
  reactionId: number,
): Promise<void> {
  const repo = context.repo();
  try {
    switch (target.type) {
      case "pr":
        await context.octokit.rest.reactions.deleteForIssue({
          ...repo,
          issue_number: target.pullNumber,
          reaction_id: reactionId,
        });
        break;
      case "issueComment":
        await context.octokit.rest.reactions.deleteForIssueComment({
          ...repo,
          comment_id: target.commentId,
          reaction_id: reactionId,
        });
        break;
      case "reviewComment":
        await context.octokit.rest.reactions.deleteForPullRequestComment({
          ...repo,
          comment_id: target.commentId,
          reaction_id: reactionId,
        });
        break;
    }
  } catch {
    // Best-effort removal — don't fail the handler if cleanup fails
  }
}

/**
 * Check whether a comment body mentions the bot.
 */
export function isBotMentioned(body: string): boolean {
  const mention = `@${config.botName}`;
  return body.toLowerCase().includes(mention.toLowerCase());
}

/**
 * Strip the @bot mention from a comment to extract the user's actual question.
 */
export function stripBotMention(body: string): string {
  const mention = new RegExp(`@${config.botName}\\s*`, "gi");
  return body.replace(mention, "").trim();
}

export async function fetchReviewerGuide(
  octokit: Context<any>["octokit"],
  owner: string,
  repo: string,
): Promise<string | undefined> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      // Always read from the default branch; the guide is a repo-level config, not per-PR.
      path: "REVIEWER.md",
    });

    if ("content" in data && data.encoding === "base64") {
      let content = Buffer.from(data.content, "base64").toString("utf-8");
      if (content.length > config.maxReviewerGuideSize) {
        content =
          content.slice(0, config.maxReviewerGuideSize) +
          "\n\n[reviewer guide truncated]";
      }
      return content;
    }
  } catch (err: any) {
    if (err?.status !== 404) {
      console.warn(
        "fetchReviewerGuide: unexpected error",
        err?.status,
        err?.message,
      );
    }
  }
  return undefined;
}

/**
 * Fetch the repo-wide Copilot instructions file (.github/copilot-instructions.md).
 * Returns the file content or undefined if the file does not exist.
 */
export async function fetchCopilotInstructions(
  octokit: Context<any>["octokit"],
  owner: string,
  repo: string,
): Promise<string | undefined> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ".github/copilot-instructions.md",
    });

    if ("content" in data && data.encoding === "base64") {
      let content = Buffer.from(data.content, "base64").toString("utf-8");
      if (content.length > config.maxCopilotInstructionsSize) {
        content =
          content.slice(0, config.maxCopilotInstructionsSize) +
          "\n\n[copilot instructions truncated]";
      }
      return content;
    }
  } catch (err: any) {
    if (err?.status !== 404) {
      console.warn(
        "fetchCopilotInstructions: unexpected error",
        err?.status,
        err?.message,
      );
    }
  }
  return undefined;
}

function parseFrontmatter(raw: string): {
  applyTo?: string;
  body: string;
} {
  // Strip UTF-8 BOM if present
  const cleaned = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;

  // Tolerate trailing spaces on --- delimiters
  const match = cleaned.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) {
    return { body: cleaned };
  }

  const frontmatter = match[1];
  const body = match[2];

  // Match applyTo with properly paired quotes: "val", 'val', or unquoted val
  const applyToMatch = frontmatter.match(
    /^applyTo:\s*(?:"([^"]*)"|'([^']*)'|(\S.*?))\s*$/m,
  );

  return {
    applyTo: applyToMatch?.[1] ?? applyToMatch?.[2] ?? applyToMatch?.[3],
    body,
  };
}

/**
 * Fetch path-specific Copilot instruction files from .github/instructions/.
 * Each file must end with `.instructions.md` and contain an `applyTo` frontmatter field.
 * Returns an array of { applyTo, content } objects.
 */
export async function fetchPathInstructions(
  octokit: Context<any>["octokit"],
  owner: string,
  repo: string,
): Promise<PathInstruction[]> {
  const instructions: PathInstruction[] = [];

  try {
    const { data: dirEntries } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ".github/instructions",
    });

    if (!Array.isArray(dirEntries)) {
      return instructions;
    }

    // Collect all .instructions.md files (flat + nested dirs)
    const filePaths: string[] = [];
    const subDirs: string[] = [];

    for (const entry of dirEntries) {
      if (
        entry.type === "file" &&
        entry.name.endsWith(".instructions.md")
      ) {
        filePaths.push(entry.path);
      } else if (entry.type === "dir") {
        subDirs.push(entry.path);
      }
    }

    const MAX_SUBDIRS = 5;
    const MAX_INSTRUCTION_FILES = 15;

    const subDirResults = await Promise.all(
      subDirs.slice(0, MAX_SUBDIRS).map(async (dirPath) => {
        try {
          const { data: subEntries } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: dirPath,
          });
          if (Array.isArray(subEntries)) {
            return subEntries
              .filter(
                (e: any) =>
                  e.type === "file" &&
                  e.name.endsWith(".instructions.md"),
              )
              .map((e: any) => e.path as string);
          }
        } catch {
          // Subdirectory listing failed — skip it
        }
        return [];
      }),
    );

    for (const paths of subDirResults) {
      filePaths.push(...paths);
    }

    const fileResults = await Promise.all(
      filePaths.slice(0, MAX_INSTRUCTION_FILES).map(async (filePath) => {
        try {
          const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePath,
          });

          if ("content" in data && data.encoding === "base64") {
            const raw = Buffer.from(data.content, "base64").toString("utf-8");
            const { applyTo, body } = parseFrontmatter(raw);
            if (applyTo && body.trim()) {
              return { applyTo, content: body.trim() };
            }
          }
        } catch {
          // Individual file fetch failed — skip it
        }
        return null;
      }),
    );

    let totalSize = 0;
    for (const result of fileResults) {
      if (!result) continue;
      totalSize += result.content.length;
      if (totalSize > config.maxCopilotInstructionsSize) {
        const overshoot = totalSize - config.maxCopilotInstructionsSize;
        result.content =
          result.content.slice(0, result.content.length - overshoot) +
          "\n\n[path instructions truncated — aggregate limit reached]";
        instructions.push(result);
        break;
      }
      instructions.push(result);
    }
  } catch (err: any) {
    if (err?.status !== 404) {
      console.warn(
        "fetchPathInstructions: unexpected error",
        err?.status,
        err?.message,
      );
    }
  }

  return instructions;
}
