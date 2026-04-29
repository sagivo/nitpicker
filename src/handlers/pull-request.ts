import type { Context } from "probot";
import {
  fetchPRDetails,
  fetchReviewerGuide,
  addEyesReaction,
  removeEyesReaction,
  type ChangedFile,
  type ReactionTarget,
} from "../services/github.js";
import {
  reviewPR,
  type ReviewComment,
  type ReviewResponse,
} from "../services/ai.js";
import { config } from "../config.js";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  suggestion: "🔵",
};

export async function handlePullRequest(
  context: Context<
    | "pull_request.opened"
    | "pull_request.synchronize"
    | "pull_request.reopened"
    | "pull_request.ready_for_review"
  >,
): Promise<void> {
  if (!config.reviewOnOpen) {
    context.log.info("Auto-review disabled, skipping");
    return;
  }

  if (context.payload.pull_request.draft) {
    context.log.info("Draft PR, skipping review");
    return;
  }

  const pr = await fetchPRDetails(context);
  context.log.info(`Reviewing PR #${pr.number}: ${pr.title}`);

  if (!pr.diff.trim()) {
    context.log.info("Empty diff, skipping review");
    return;
  }

  const target: ReactionTarget = { type: "pr", pullNumber: pr.number };
  const reactionId = await addEyesReaction(context, target);

  const review = await reviewPR(pr);

  if (review.comments.length === 0) {
    const body =
      review.summary ||
      "Reviewed the changes — everything looks good. No issues found.";
    const { data: postedReview } =
      await context.octokit.rest.pulls.createReview({
        ...context.repo(),
        pull_number: pr.number,
        event: "COMMENT",
        body,
      });
    context.log.info(`Posted review: ${postedReview.html_url}`);
    await removeEyesReaction(context, target, reactionId);
    return;
  }

  const { inline, nonInline } = splitReviewComments(
    review.comments,
    pr.changedFiles,
  );

  if (inline.length === 0) {
    const summary = formatSummaryComment(review.comments);
    const body = review.summary
      ? `${review.summary}\n\n---\n\n${summary}`
      : summary;
    const { data: fallbackReview } =
      await context.octokit.rest.pulls.createReview({
        ...context.repo(),
        pull_number: pr.number,
        event: "COMMENT",
        body,
      });
    context.log.info(
      `Posted review (summary only): ${fallbackReview.html_url}`,
    );
    await removeEyesReaction(context, target, reactionId);
    return;
  }

  const summaryParts = [buildSummary(review.comments, review.summary)];
  if (nonInline.length > 0) {
    summaryParts.push(formatSummaryComment(nonInline));
  }

  const { data: inlineReview } = await context.octokit.rest.pulls.createReview({
    ...context.repo(),
    pull_number: pr.number,
    event: "COMMENT",
    body: summaryParts.join("\n\n---\n\n"),
    comments: inline,
  });

  context.log.info(
    `Posted review with ${inline.length} inline comment(s): ${inlineReview.html_url}`,
  );
  await removeEyesReaction(context, target, reactionId);
}

/**
 * Handle the /ai-review command in PR comments to trigger an on-demand review.
 */
export async function handleOnDemandReview(
  context: Context<"issue_comment.created">,
  pullNumber: number,
): Promise<void> {
  const commentTarget: ReactionTarget = {
    type: "issueComment",
    commentId: context.payload.comment.id,
  };
  const reactionId = await addEyesReaction(context, commentTarget);

  const { owner, repo } = context.repo();

  const prResponse = await context.octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  const [diffResponse, filesResponse, reviewerGuide] = await Promise.all([
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

  const pr = {
    owner,
    repo,
    number: pullNumber,
    title: prResponse.data.title,
    body: prResponse.data.body ?? "",
    diff,
    changedFiles: filesResponse.data.map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
    reviewerGuide,
  };

  context.log.info(`On-demand review for PR #${pullNumber}`);

  const review = await reviewPR(pr);

  if (review.comments.length === 0) {
    const body =
      review.summary ||
      "Reviewed the changes — everything looks good. No issues found.";
    const { data: postedReview } =
      await context.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        event: "COMMENT",
        body,
      });
    context.log.info(
      `Posted on-demand review (no issues): ${postedReview.html_url}`,
    );
    await removeEyesReaction(context, commentTarget, reactionId);
    return;
  }

  const { inline, nonInline } = splitReviewComments(
    review.comments,
    pr.changedFiles,
  );

  if (inline.length === 0) {
    const summary = formatSummaryComment(review.comments);
    const body = review.summary
      ? `${review.summary}\n\n---\n\n${summary}`
      : summary;
    const { data: fallbackReview } =
      await context.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        event: "COMMENT",
        body,
      });
    context.log.info(
      `Posted on-demand review (summary only): ${fallbackReview.html_url}`,
    );
    await removeEyesReaction(context, commentTarget, reactionId);
    return;
  }

  const summaryParts = [buildSummary(review.comments, review.summary)];
  if (nonInline.length > 0) {
    summaryParts.push(formatSummaryComment(nonInline));
  }

  const { data: inlineReview } = await context.octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    event: "COMMENT",
    body: summaryParts.join("\n\n---\n\n"),
    comments: inline,
  });

  context.log.info(
    `Posted on-demand review with ${inline.length} inline comment(s): ${inlineReview.html_url}`,
  );
  await removeEyesReaction(context, commentTarget, reactionId);
}

/**
 * Parse a GitHub patch string to extract the set of new-side line numbers
 * that are valid targets for inline review comments.
 */
function parseDiffLines(patch: string): Set<number> {
  const valid = new Set<number>();
  let newLine = 0;

  for (const line of patch.split("\n")) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (newLine === 0) continue;

    if (line.startsWith("+") || line.startsWith(" ")) {
      valid.add(newLine);
      newLine++;
    } else if (line.startsWith("-")) {
      // Deleted lines don't advance the new-file line counter
    }
  }

  return valid;
}

type FormattedComment = {
  path: string;
  line: number;
  start_line?: number;
  body: string;
};

/**
 * Split AI review comments into those that can be placed as inline review
 * comments (line exists in the diff) and those that cannot.
 */
function splitReviewComments(
  comments: ReviewComment[],
  changedFiles: ChangedFile[],
): { inline: FormattedComment[]; nonInline: ReviewComment[] } {
  const diffLinesByFile = new Map<string, Set<number>>();
  for (const f of changedFiles) {
    if (f.patch) {
      diffLinesByFile.set(f.filename, parseDiffLines(f.patch));
    }
  }

  const inline: FormattedComment[] = [];
  const nonInline: ReviewComment[] = [];

  for (const c of comments) {
    const validLines = diffLinesByFile.get(c.file);
    if (!validLines || c.line <= 0 || !validLines.has(c.line)) {
      nonInline.push(c);
      continue;
    }

    const startLine =
      c.start_line && c.start_line > 0 ? c.start_line : undefined;
    if (startLine !== undefined) {
      let rangeValid = true;
      for (let l = startLine; l <= c.line; l++) {
        if (!validLines.has(l)) {
          rangeValid = false;
          break;
        }
      }
      if (!rangeValid) {
        nonInline.push(c);
        continue;
      }
    }

    const comment: FormattedComment = {
      path: c.file,
      line: c.line,
      body: `${SEVERITY_EMOJI[c.severity] ?? ""} **${c.severity}**\n\n${c.body}`,
    };
    if (startLine !== undefined) {
      comment.start_line = startLine;
    }
    inline.push(comment);
  }

  return { inline, nonInline };
}

function buildSummary(comments: ReviewComment[], aiSummary?: string): string {
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const c of comments) {
    counts[c.severity]++;
  }

  const parts: string[] = ["## AI Review Summary\n"];

  if (aiSummary) {
    parts.push(aiSummary);
    parts.push("");
  }

  if (counts.critical > 0)
    parts.push(`- 🔴 **${counts.critical}** critical issue(s)`);
  if (counts.warning > 0) parts.push(`- 🟡 **${counts.warning}** warning(s)`);
  if (counts.suggestion > 0)
    parts.push(`- 🔵 **${counts.suggestion}** suggestion(s)`);

  return parts.join("\n");
}

function formatSummaryComment(comments: ReviewComment[]): string {
  const lines = ["## AI Review\n"];
  for (const c of comments) {
    const emoji = SEVERITY_EMOJI[c.severity] ?? "";
    lines.push(`### ${emoji} ${c.severity} — \`${c.file}\` (line ${c.line})\n`);
    lines.push(c.body);
    lines.push("");
  }
  return lines.join("\n");
}
