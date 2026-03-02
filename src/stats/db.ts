import Database from "better-sqlite3";
import path from "node:path";

export interface PRRow {
  repo_owner: string;
  repo_name: string;
  pr_number: number;
  title: string;
  author: string;
  url: string;
  state: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  total_bot_comments: number;
  total_critical: number;
  total_warnings: number;
  total_suggestions: number;
}

export interface SuggestionRow {
  pr_id: number;
  github_comment_id: number;
  severity: "critical" | "warning" | "suggestion";
  file_path: string;
  line_number: number | null;
  body: string;
  outcome: "accepted" | "rejected" | "ignored";
  outcome_reason: string;
  positive_reactions: number;
  negative_reactions: number;
  reply_count: number;
  has_code_change: boolean;
  created_at: string;
}

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.SQLITE_PATH ?? path.resolve("pr_reviewer_stats.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function ensureSchema(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      url TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      merged_at TEXT,
      closed_at TEXT,
      total_bot_comments INTEGER NOT NULL DEFAULT 0,
      total_critical INTEGER NOT NULL DEFAULT 0,
      total_warnings INTEGER NOT NULL DEFAULT 0,
      total_suggestions INTEGER NOT NULL DEFAULT 0,
      UNIQUE(repo_owner, repo_name, pr_number)
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
      github_comment_id INTEGER NOT NULL UNIQUE,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'suggestion')),
      file_path TEXT NOT NULL,
      line_number INTEGER,
      body TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'ignored' CHECK(outcome IN ('accepted', 'rejected', 'ignored')),
      outcome_reason TEXT NOT NULL DEFAULT '',
      positive_reactions INTEGER NOT NULL DEFAULT 0,
      negative_reactions INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      has_code_change INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  d.exec(`CREATE INDEX IF NOT EXISTS idx_suggestions_pr_id ON suggestions(pr_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_suggestions_outcome ON suggestions(outcome)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_suggestions_severity ON suggestions(severity)`);
}

const upsertPRStmt = () =>
  getDb().prepare(`
    INSERT INTO pull_requests
      (repo_owner, repo_name, pr_number, title, author, url, state,
       created_at, merged_at, closed_at,
       total_bot_comments, total_critical, total_warnings, total_suggestions)
    VALUES (@repo_owner, @repo_name, @pr_number, @title, @author, @url, @state,
            @created_at, @merged_at, @closed_at,
            @total_bot_comments, @total_critical, @total_warnings, @total_suggestions)
    ON CONFLICT(repo_owner, repo_name, pr_number) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      url = excluded.url,
      state = excluded.state,
      merged_at = excluded.merged_at,
      closed_at = excluded.closed_at,
      total_bot_comments = excluded.total_bot_comments,
      total_critical = excluded.total_critical,
      total_warnings = excluded.total_warnings,
      total_suggestions = excluded.total_suggestions
  `);

const selectPRIdStmt = () =>
  getDb().prepare(
    `SELECT id FROM pull_requests WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?`,
  );

/**
 * Upsert a PR row and return its database id.
 */
export function upsertPR(row: PRRow): number {
  const result = upsertPRStmt().run(row);

  if (result.changes > 0 && result.lastInsertRowid) {
    const rowid = Number(result.lastInsertRowid);
    // lastInsertRowid is set on INSERT but also on conflict-update;
    // for updates it may be the existing rowid, which is fine.
    if (rowid > 0) return rowid;
  }

  const found = selectPRIdStmt().get(row.repo_owner, row.repo_name, row.pr_number) as
    | { id: number }
    | undefined;
  return found!.id;
}

const upsertSuggestionStmt = () =>
  getDb().prepare(`
    INSERT INTO suggestions
      (pr_id, github_comment_id, severity, file_path, line_number, body,
       outcome, outcome_reason, positive_reactions, negative_reactions,
       reply_count, has_code_change, created_at)
    VALUES (@pr_id, @github_comment_id, @severity, @file_path, @line_number, @body,
            @outcome, @outcome_reason, @positive_reactions, @negative_reactions,
            @reply_count, @has_code_change, @created_at)
    ON CONFLICT(github_comment_id) DO UPDATE SET
      severity = excluded.severity,
      file_path = excluded.file_path,
      line_number = excluded.line_number,
      body = excluded.body,
      outcome = excluded.outcome,
      outcome_reason = excluded.outcome_reason,
      positive_reactions = excluded.positive_reactions,
      negative_reactions = excluded.negative_reactions,
      reply_count = excluded.reply_count,
      has_code_change = excluded.has_code_change
  `);

/**
 * Upsert a suggestion row.
 */
export function upsertSuggestion(row: SuggestionRow): void {
  upsertSuggestionStmt().run({
    ...row,
    has_code_change: row.has_code_change ? 1 : 0,
  });
}

export function closeDb(): void {
  if (db) db.close();
}
