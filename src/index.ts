import { run } from "probot";
import type { Probot } from "probot";
import { handlePullRequest } from "./handlers/pull-request.js";
import { handleIssueComment } from "./handlers/comment.js";
import { handleReviewComment } from "./handlers/review-comment.js";

function app(probot: Probot): void {
  probot.log.info("PR Reviewer bot loaded");

  probot.on(
    ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
    handlePullRequest,
  );

  probot.on("issue_comment.created", handleIssueComment);

  probot.on("pull_request_review_comment.created", handleReviewComment);
}

run(app);
