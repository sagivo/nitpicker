import "dotenv/config";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { ensureSchema, upsertPR, upsertSuggestion, closeDb, type PRRow, type SuggestionRow } from "./db.js";
import {
  determineOutcome,
  parseSeverity,
  type ReactionData,
  type ThreadReply,
  type SuggestionSignals,
  type Severity,
} from "./analyzer.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { owner: string; repo: string; days: number } {
  const args = process.argv.slice(2);
  const repoArg = args.find((a) => !a.startsWith("--"));
  if (!repoArg || !repoArg.includes("/")) {
    console.error("Usage: npx tsx src/stats/collect.ts <owner/repo> [--days N]");
    process.exit(1);
  }

  const [owner, repo] = repoArg.split("/");
  let days = 7;
  const daysIdx = args.indexOf("--days");
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    days = parseInt(args[daysIdx + 1], 10);
    if (isNaN(days) || days < 1) days = 7;
  }

  return { owner, repo, days };
}

// ---------------------------------------------------------------------------
// GitHub client setup (GitHub App auth)
// ---------------------------------------------------------------------------

function getPrivateKey(): string {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY;
  if (process.env.PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.PRIVATE_KEY_BASE64, "base64").toString("utf-8");
  }
  console.error("Missing PRIVATE_KEY or PRIVATE_KEY_BASE64 in .env");
  process.exit(1);
}

async function createOctokit(owner: string, repo: string): Promise<Octokit> {
  const appId = process.env.APP_ID;
  if (!appId) {
    console.error("Missing APP_ID in .env");
    process.exit(1);
  }

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: getPrivateKey(),
    },
  });

  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: getPrivateKey(),
      installationId: installation.id,
    },
  });
}

// ---------------------------------------------------------------------------
// Data types from GitHub API
// ---------------------------------------------------------------------------

interface GHPullRequest {
  number: number;
  title: string;
  user: { login: string } | null;
  html_url: string;
  state: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

interface GHReviewComment {
  id: number;
  user: { login: string } | null;
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  created_at: string;
  in_reply_to_id?: number;
  reactions?: {
    "+1"?: number;
    "-1"?: number;
    heart?: number;
    hooray?: number;
    rocket?: number;
    confused?: number;
    laugh?: number;
    eyes?: number;
  };
}

interface GHCommit {
  sha: string;
  commit: { committer: { date?: string } | null };
  files?: { filename: string }[];
}

// ---------------------------------------------------------------------------
// Collection logic
// ---------------------------------------------------------------------------

async function fetchRecentPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: Date,
): Promise<GHPullRequest[]> {
  const prs: GHPullRequest[] = await octokit.paginate(
    octokit.rest.pulls.list,
    {
      owner,
      repo,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    },
    (response, done) => {
      const items = response.data as GHPullRequest[];
      // Stop paginating once we've passed the time window
      const oldest = items[items.length - 1];
      if (oldest && new Date(oldest.created_at) < since) {
        done();
      }
      return items.filter((pr) => new Date(pr.created_at) >= since);
    },
  );

  return prs;
}

async function fetchAllReviewComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GHReviewComment[]> {
  return octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  }) as Promise<GHReviewComment[]>;
}

async function fetchCommentReactions(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
): Promise<ReactionData> {
  const reactions = await octokit.paginate(
    octokit.rest.reactions.listForPullRequestReviewComment,
    { owner, repo, comment_id: commentId, per_page: 100 },
  );

  const data: ReactionData = {
    plusOne: 0,
    minusOne: 0,
    heart: 0,
    hooray: 0,
    rocket: 0,
    confused: 0,
    laugh: 0,
    eyes: 0,
  };

  for (const r of reactions as any[]) {
    switch (r.content) {
      case "+1": data.plusOne++; break;
      case "-1": data.minusOne++; break;
      case "heart": data.heart++; break;
      case "hooray": data.hooray++; break;
      case "rocket": data.rocket++; break;
      case "confused": data.confused++; break;
      case "laugh": data.laugh++; break;
      case "eyes": data.eyes++; break;
    }
  }

  return data;
}

async function fetchPRCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GHCommit[]> {
  return octokit.paginate(octokit.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  }) as Promise<GHCommit[]>;
}

/**
 * For each commit, fetch the list of files it touched.
 * We only need this for commits that occurred after a bot comment.
 */
async function fetchCommitFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
): Promise<string[]> {
  const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: sha });
  return (data.files ?? []).map((f: any) => f.filename as string);
}

/**
 * Check if any commit after `afterDate` modified `filePath`.
 */
async function fileChangedAfterDate(
  octokit: Octokit,
  owner: string,
  repo: string,
  commits: GHCommit[],
  filePath: string,
  afterDate: Date,
): Promise<boolean> {
  const laterCommits = commits.filter((c) => {
    const d = c.commit.committer?.date;
    return d && new Date(d) > afterDate;
  });

  for (const commit of laterCommits) {
    const files = await fetchCommitFiles(octokit, owner, repo, commit.sha);
    if (files.includes(filePath)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { owner, repo, days } = parseArgs();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const botName = process.env.BOT_NAME ?? "pr-reviewer-bot";
  // GitHub App bots have a "[bot]" suffix on their login
  const botLogin = `${botName}[bot]`;

  console.log(`Collecting stats for ${owner}/${repo} (last ${days} days)`);
  console.log(`Bot user: ${botLogin}`);
  console.log(`Since: ${since.toISOString()}\n`);

  const octokit = await createOctokit(owner, repo);
  ensureSchema();

  const prs = await fetchRecentPRs(octokit, owner, repo, since);
  console.log(`Found ${prs.length} PR(s) in the time window\n`);

  let totalSuggestions = 0;

  for (const pr of prs) {
    console.log(`--- PR #${pr.number}: ${pr.title}`);

    const allComments = await fetchAllReviewComments(octokit, owner, repo, pr.number);

    // Identify root comments from the bot (not replies — those have in_reply_to_id)
    const botRootComments = allComments.filter(
      (c) =>
        c.user?.login.toLowerCase() === botLogin.toLowerCase() &&
        !c.in_reply_to_id,
    );

    if (botRootComments.length === 0) {
      console.log("  No bot suggestions found, skipping\n");
      continue;
    }

    // Parse severity counts
    const severityCounts = { critical: 0, warning: 0, suggestion: 0 };
    for (const c of botRootComments) {
      const sev = parseSeverity(c.body);
      if (sev) severityCounts[sev]++;
    }

    const prRow: PRRow = {
      repo_owner: owner,
      repo_name: repo,
      pr_number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? "unknown",
      url: pr.html_url,
      state: pr.merged_at ? "merged" : pr.state,
      created_at: pr.created_at,
      merged_at: pr.merged_at ?? null,
      closed_at: pr.closed_at ?? null,
      total_bot_comments: botRootComments.length,
      total_critical: severityCounts.critical,
      total_warnings: severityCounts.warning,
      total_suggestions: severityCounts.suggestion,
    };

    const prId = upsertPR(prRow);

    // Fetch commits once per PR for the file-change heuristic
    const commits = await fetchPRCommits(octokit, owner, repo, pr.number);

    // Build a map of replies per root comment id
    const repliesByRoot = new Map<number, GHReviewComment[]>();
    for (const c of allComments) {
      if (c.in_reply_to_id) {
        const list = repliesByRoot.get(c.in_reply_to_id) ?? [];
        list.push(c);
        repliesByRoot.set(c.in_reply_to_id, list);
      }
    }

    console.log(`  ${botRootComments.length} bot suggestion(s): ` +
      `${severityCounts.critical} critical, ${severityCounts.warning} warning, ${severityCounts.suggestion} suggestion`);

    for (const comment of botRootComments) {
      const severity: Severity = parseSeverity(comment.body) ?? "suggestion";

      // Gather signals
      const reactions = await fetchCommentReactions(octokit, owner, repo, comment.id);

      const threadReplies: ThreadReply[] = (repliesByRoot.get(comment.id) ?? []).map((r) => ({
        user: r.user?.login ?? "unknown",
        body: r.body,
        createdAt: r.created_at,
      }));

      const hasCodeChange = await fileChangedAfterDate(
        octokit, owner, repo, commits, comment.path, new Date(comment.created_at),
      );

      const signals: SuggestionSignals = {
        reactions,
        replies: threadReplies,
        fileChangedAfterComment: hasCodeChange,
        botUsername: botLogin,
      };

      const result = determineOutcome(signals);

      const suggestionRow: SuggestionRow = {
        pr_id: prId,
        github_comment_id: comment.id,
        severity,
        file_path: comment.path,
        line_number: comment.line ?? comment.original_line ?? null,
        body: comment.body,
        outcome: result.outcome,
        outcome_reason: result.reason,
        positive_reactions: result.positiveReactions,
        negative_reactions: result.negativeReactions,
        reply_count: result.replyCount,
        has_code_change: hasCodeChange,
        created_at: comment.created_at,
      };

      upsertSuggestion(suggestionRow);
      totalSuggestions++;

      const icon = result.outcome === "accepted" ? "✅" : result.outcome === "rejected" ? "❌" : "⏸️";
      console.log(`    ${icon} [${severity}] ${comment.path}:${comment.line ?? "?"} → ${result.outcome} (${result.reason})`);
    }

    console.log();
  }

  console.log(`Done. ${totalSuggestions} suggestion(s) processed across ${prs.length} PR(s).`);

  closeDb();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
