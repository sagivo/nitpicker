import type { PRDetails } from "../services/github.js";
import type { ThreadComment } from "../services/github.js";

export const QUESTION_SYSTEM_PROMPT = `You are an AI assistant embedded in a GitHub pull request. A developer has tagged you in a comment and is asking a question about this PR.

Your goals:
- Answer the question accurately based on the PR diff and description
- Reference specific files and code when relevant
- Be concise but thorough
- Use markdown formatting for readability
- If you're unsure about something, say so rather than guessing

Do NOT produce JSON — respond in plain markdown.`;

export function buildQuestionPrompt(pr: PRDetails, question: string): string {
  return `## Pull Request Context
**Title:** ${pr.title}
**Description:** ${pr.body || "(no description)"}

## Changed Files
${pr.changedFiles.map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`).join("\n")}

## Diff
\`\`\`diff
${pr.diff}
\`\`\`

## Developer Question
${question}`;
}

export const THREAD_SYSTEM_PROMPT = `You are an AI assistant embedded in a GitHub pull request review thread. You are replying to an ongoing code review conversation.

Your goals:
- Continue the conversation naturally based on the thread history
- Reference the specific code under review when relevant
- Be concise and helpful
- Use markdown formatting for readability
- If asked to fix something, suggest concrete code changes using GitHub's suggestion block syntax so the author can apply them directly:

\`\`\`suggestion
replacement code here
\`\`\`

  The suggestion block REPLACES the line(s) the comment is attached to — only include the replacement code, not surrounding context.
- Only reply if you have something useful to add; if the conversation is resolved, say so briefly

Do NOT produce JSON — respond in plain markdown.`;

export function buildThreadPrompt(
  thread: ThreadComment[],
  filePath: string,
  diffHunk: string,
  question: string,
): string {
  const history = thread
    .map((c) => `**@${c.user}** (${c.createdAt}):\n${c.body}`)
    .join("\n\n---\n\n");

  return `## Code Under Review
**File:** ${filePath}

\`\`\`diff
${diffHunk}
\`\`\`

## Conversation History
${history}

## Latest Message Directed at You
${question}`;
}
