import "dotenv/config";

export const config = {
  botName: process.env.BOT_NAME ?? "nitpicker-bot",
  aiProvider: process.env.AI_PROVIDER ?? "anthropic",
  aiModel: process.env.AI_MODEL ?? "claude-sonnet-4-20250514",
  llmApiKey: process.env.LLM_API_KEY,
  maxDiffSize: Number(process.env.MAX_DIFF_SIZE ?? 50_000),
  maxReviewerGuideSize: Number(process.env.MAX_REVIEWER_GUIDE_SIZE ?? 20_000),
  maxCopilotInstructionsSize: Number(
    process.env.MAX_COPILOT_INSTRUCTIONS_SIZE ?? 20_000,
  ),
  reviewOnOpen: process.env.REVIEW_ON_OPEN !== "false",
} as const;
