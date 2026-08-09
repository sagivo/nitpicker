import type { Context } from "probot";
import { config } from "../config.js";
import {
  fetchPRDetailsFromIssue,
  isBotMentioned,
  stripBotMention,
  addEyesReaction,
  removeEyesReaction,
  type ReactionTarget,
} from "../services/github.js";
import { answerQuestion } from "../services/ai.js";
import { handleOnDemandReview } from "./pull-request.js";

/**
 * Handle issue_comment.created events on pull requests.
 * Responds to:
 *   - @bot-name <question>  → answers the question using PR context
 *   - /nitpicker            → triggers a full on-demand review
 */
export async function handleIssueComment(
  context: Context<"issue_comment.created">,
): Promise<void> {
  const { payload } = context;

  if (!payload.issue.pull_request) {
    return;
  }

  if (payload.comment.user?.login === `${config.botName}[bot]`) {
    return;
  }

  const body = payload.comment.body.trim();
  const pullNumber = payload.issue.number;

  if (body.toLowerCase() === "/nitpicker") {
    await handleOnDemandReview(context, pullNumber);
    return;
  }

  if (!isBotMentioned(body)) {
    return;
  }

  const question = stripBotMention(body);
  if (!question) {
    return;
  }

  const target: ReactionTarget = { type: "issueComment", commentId: payload.comment.id };
  const reactionId = await addEyesReaction(context, target);

  context.log.info(`Answering question on PR #${pullNumber}: ${question.slice(0, 80)}...`);

  const pr = await fetchPRDetailsFromIssue(context, pullNumber);
  const answer = await answerQuestion(pr, question);

  const { data: answerComment } = await context.octokit.rest.issues.createComment({
    ...context.repo(),
    issue_number: pullNumber,
    body: answer,
  });

  context.log.info(`Posted answer on PR #${pullNumber}: ${answerComment.html_url}`);
  await removeEyesReaction(context, target, reactionId);
}
