import type { Context } from "probot";
import { config } from "../config.js";

export interface PRDetails {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  diff: string;
  changedFiles: ChangedFile[];
  reviewerGuide?: string;
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

  const [diffResponse, filesResponse, reviewerGuide] = await Promise.all([
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
    fetchReviewerGuide(context.octokit, owner, repo),
  ]);

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

  const [prResponse, diffResponse, filesResponse, reviewerGuide] =
    await Promise.all([
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
      fetchReviewerGuide(context.octokit, owner, repo),
    ]);

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
        await context.octokit.rest.reactions.deleteForPullRequestReviewComment({
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
      path: "REVIEWER.md",
    });

    if ("content" in data && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
  } catch {
    // REVIEWER.md doesn't exist in this repo — that's fine
  }
  return undefined;
}
