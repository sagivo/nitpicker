import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { config } from "../config.js";
import type { PRDetails, ThreadComment } from "./github.js";
import { REVIEW_SYSTEM_PROMPT, buildReviewPrompt } from "../prompts/review.js";
import {
  QUESTION_SYSTEM_PROMPT,
  buildQuestionPrompt,
  THREAD_SYSTEM_PROMPT,
  buildThreadPrompt,
} from "../prompts/question.js";

function getModel() {
  return anthropic(config.aiModel);
}

const reviewCommentSchema = z.object({
  file: z.string(),
  line: z.number(),
  start_line: z.number().optional(),
  severity: z.enum(["critical", "warning", "suggestion"]),
  body: z.string(),
});

export type ReviewComment = z.infer<typeof reviewCommentSchema>;

const reviewResponseSchema = z.object({
  summary: z.string(),
  comments: z.array(reviewCommentSchema),
});

export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

/**
 * Use AI to review a pull request diff and return a summary plus structured inline comments.
 */
export async function reviewPR(pr: PRDetails): Promise<ReviewResponse> {
  const { text } = await generateText({
    model: getModel(),
    system: REVIEW_SYSTEM_PROMPT,
    prompt: buildReviewPrompt(pr),
  });

  return parseReviewResponse(text);
}

/**
 * Use AI to answer a question about a PR.
 */
export async function answerQuestion(
  pr: PRDetails,
  question: string,
): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    system: QUESTION_SYSTEM_PROMPT,
    prompt: buildQuestionPrompt(pr, question),
  });

  return text;
}

/**
 * Use AI to reply to a review comment thread.
 */
export async function replyToThread(
  thread: ThreadComment[],
  filePath: string,
  diffHunk: string,
  question: string,
): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    system: THREAD_SYSTEM_PROMPT,
    prompt: buildThreadPrompt(thread, filePath, diffHunk, question),
  });

  return text;
}

function parseReviewResponse(text: string): ReviewResponse {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { summary: "", comments: [] };
  }

  const result = reviewResponseSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  // Fallback: handle legacy bare-array responses
  if (Array.isArray(parsed)) {
    const comments: ReviewComment[] = [];
    for (const item of parsed) {
      const itemResult = reviewCommentSchema.safeParse(item);
      if (itemResult.success) {
        comments.push(itemResult.data);
      }
    }
    return { summary: "", comments };
  }

  return { summary: "", comments: [] };
}
