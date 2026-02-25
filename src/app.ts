import type { Probot } from "probot";
import { handlePullRequest } from "./handlers/pull-request.js";
import { handleIssueComment } from "./handlers/comment.js";
import { handleReviewComment } from "./handlers/review-comment.js";

export function app(probot: Probot): void {
  probot.log.info("PR Reviewer bot loaded");

  probot.on(
    ["pull_request.opened", "pull_request.reopened", "pull_request.ready_for_review"],
    handlePullRequest,
  );

  probot.on("issue_comment.created", handleIssueComment);

  probot.on("pull_request_review_comment.created", handleReviewComment);
}
