import type { PRDetails } from "../services/github.js";

export const REVIEW_SYSTEM_PROMPT = `You are a senior software engineer reviewing a GitHub pull request.

Review the diff for bugs, security issues, performance problems, and readability improvements. Only comment on lines in the diff. Be concise — no filler praise. If the PR looks good, return an empty comments array.

Each diff line is annotated with its new-file line number: \`[42] +code\`. Use these numbers exactly for "line" and "start_line".

When proposing a concrete code fix, use a GitHub suggestion block in the "body":

\`\`\`suggestion
replacement code
\`\`\`

Suggestion rules:
- GitHub DELETES lines from "start_line" to "line" and inserts the suggestion content instead.
- Only target lines that actually change — never include unchanged context lines in the range.
- For single-line fixes: just set "line". For multi-line: set "start_line" and "line" to the narrowest range needed, and include the complete replacement for every line in that range.
- For broad refactors or general advice, use regular markdown instead of a suggestion block.

Respond with JSON only (no markdown fences):
{
  "summary": "<2-4 sentence overview of the PR and key findings>",
  "comments": [
    {
      "file": "<path>",
      "line": <last line of range>,
      "start_line": <first line of range, omit for single-line>,
      "severity": "critical" | "warning" | "suggestion",
      "body": "<markdown comment>"
    }
  ]
}`;

export function buildReviewPrompt(pr: PRDetails): string {
  const fileList = pr.changedFiles
    .map(
      (f) => `- ${f.filename} (+${f.additions}/-${f.deletions}) [${f.status}]`,
    )
    .join("\n");

  const annotatedDiff = annotateDiffWithLineNumbers(pr.diff);

  return `## Pull Request
**Title:** ${pr.title}
**Description:** ${pr.body || "(no description)"}

## Changed Files
${fileList}

## Diff
Each added (\`+\`) or context (\` \`) line is prefixed with its new-file line number in brackets (e.g. \`[42]\`).
Deleted (\`-\`) lines have no line number since they don't exist in the new file.
Use these line numbers for the "line" and "start_line" fields in your comments.

\`\`\`diff
${annotatedDiff}
\`\`\``;
}

/**
 * Annotate a unified diff so that every new-side line (added or context)
 * is prefixed with its actual file line number, e.g. `[42] +code here`.
 * Deleted lines get a blank padding prefix to keep alignment.
 */
function annotateDiffWithLineNumbers(diff: string): string {
  const lines = diff.split("\n");
  const out: string[] = [];
  let newLine = 0;
  let padWidth = 5;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      const count = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      padWidth = `[${newLine + count}] `.length;
      out.push(line);
      continue;
    }

    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("Binary ")
    ) {
      newLine = 0;
      out.push(line);
      continue;
    }

    if (newLine === 0) {
      out.push(line);
      continue;
    }

    if (line.startsWith("+") || line.startsWith(" ")) {
      const prefix = `[${newLine}] `;
      out.push(`${prefix}${line}`);
      newLine++;
    } else if (line.startsWith("-")) {
      out.push(`${" ".repeat(padWidth)}${line}`);
    } else {
      out.push(line);
    }
  }

  return out.join("\n");
}
