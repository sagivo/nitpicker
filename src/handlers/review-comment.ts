import type { Context } from "probot";
import { config } from "../config.js";
import {
  fetchReviewThread,
  isBotMentioned,
  stripBotMention,
  addEyesReaction,
  removeEyesReaction,
  type ReactionTarget,
} from "../services/github.js";
import { replyToThread } from "../services/ai.js";

/**
 * Handle pull_request_review_comment.created events.
 * Responds when the bot is mentioned in a review comment thread.
 */
export async function handleReviewComment(
  context: Context<"pull_request_review_comment.created">,
): Promise<void> {
  const { payload } = context;

  if (payload.comment.user?.login === `${config.botName}[bot]`) {
    return;
  }

  const body = payload.comment.body.trim();
  if (!isBotMentioned(body)) {
    return;
  }

  const question = stripBotMention(body);
  if (!question) {
    return;
  }

  const pullNumber = payload.pull_request.number;
  const target: ReactionTarget = { type: "reviewComment", commentId: payload.comment.id };
  const reactionId = await addEyesReaction(context, target);

  context.log.info(
    `Replying to review thread on PR #${pullNumber}, comment ${payload.comment.id}`,
  );

  const { thread, filePath, diffHunk } = await fetchReviewThread(context);
  const reply = await replyToThread(thread, filePath, diffHunk, question);

  const { data: replyComment } = await context.octokit.rest.pulls.createReplyForReviewComment({
    ...context.repo(),
    pull_number: pullNumber,
    comment_id: payload.comment.id,
    body: reply,
  });

  context.log.info(`Posted thread reply on PR #${pullNumber}: ${replyComment.html_url}`);
  await removeEyesReaction(context, target, reactionId);
}
