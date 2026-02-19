import "dotenv/config";

export const config = {
  botName: process.env.BOT_NAME ?? "pr-reviewer-bot",
  aiModel: process.env.AI_MODEL ?? "claude-sonnet-4-20250514",
  maxDiffSize: Number(process.env.MAX_DIFF_SIZE ?? 50_000),
  reviewOnOpen: process.env.REVIEW_ON_OPEN !== "false",
} as const;
