import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../stats/db.js";

type QueryFilters = {
  start?: string;
  end?: string;
  severities: string[];
  outcomes: string[];
  authors: string[];
};

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseFilters(url: URL): QueryFilters {
  const end = url.searchParams.get("end") ?? undefined;
  const startFromQuery = url.searchParams.get("start") ?? undefined;
  const days = Number(url.searchParams.get("days") ?? "0");

  let start = startFromQuery;
  if (!start && Number.isFinite(days) && days > 0) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    start = d.toISOString();
  }

  return {
    start,
    end,
    severities: parseCsv(url.searchParams.get("severities")),
    outcomes: parseCsv(url.searchParams.get("outcomes")),
    authors: parseCsv(url.searchParams.get("authors")),
  };
}

function buildWhere(filters: QueryFilters): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (filters.start) {
    parts.push("datetime(s.created_at) >= datetime(?)");
    params.push(filters.start);
  }
  if (filters.end) {
    parts.push("datetime(s.created_at) <= datetime(?)");
    params.push(filters.end);
  }
  if (filters.severities.length > 0) {
    parts.push(`s.severity IN (${filters.severities.map(() => "?").join(",")})`);
    params.push(...filters.severities);
  }
  if (filters.outcomes.length > 0) {
    parts.push(`s.outcome IN (${filters.outcomes.map(() => "?").join(",")})`);
    params.push(...filters.outcomes);
  }
  if (filters.authors.length > 0) {
    parts.push(`p.author IN (${filters.authors.map(() => "?").join(",")})`);
    params.push(...filters.authors);
  }

  return {
    clause: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "",
    params,
  };
}

function json(res: import("node:http").ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function notFound(res: import("node:http").ServerResponse): void {
  json(res, 404, { error: "Not found" });
}

function getSummary(filters: QueryFilters): Record<string, unknown> {
  const db = getDb();
  const { clause, params } = buildWhere(filters);

  const totals = db
    .prepare(
      `
      SELECT
        COUNT(*) as total_suggestions,
        SUM(CASE WHEN s.outcome = 'accepted' THEN 1 ELSE 0 END) as accepted_count,
        SUM(CASE WHEN s.outcome = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        SUM(CASE WHEN s.outcome = 'ignored' THEN 1 ELSE 0 END) as ignored_count,
        SUM(CASE WHEN s.severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
        SUM(CASE WHEN s.severity = 'warning' THEN 1 ELSE 0 END) as warning_count,
        SUM(CASE WHEN s.severity = 'suggestion' THEN 1 ELSE 0 END) as suggestion_count,
        COUNT(DISTINCT p.id) as prs_with_bot_suggestions
      FROM suggestions s
      JOIN pull_requests p ON p.id = s.pr_id
      ${clause}
    `,
    )
    .get(...params) as Record<string, number | null>;

  const total = Number(totals.total_suggestions ?? 0);
  const accepted = Number(totals.accepted_count ?? 0);
  const rejected = Number(totals.rejected_count ?? 0);
  const ignored = Number(totals.ignored_count ?? 0);

  return {
    totals: {
      totalSuggestions: total,
      accepted,
      rejected,
      ignored,
      prsWithBotSuggestions: Number(totals.prs_with_bot_suggestions ?? 0),
    },
    severity: {
      critical: Number(totals.critical_count ?? 0),
      warning: Number(totals.warning_count ?? 0),
      suggestion: Number(totals.suggestion_count ?? 0),
    },
    rates: {
      acceptedRate: total ? accepted / total : 0,
      rejectedRate: total ? rejected / total : 0,
      ignoredRate: total ? ignored / total : 0,
    },
  };
}

function getTrends(filters: QueryFilters): Array<Record<string, unknown>> {
  const db = getDb();
  const { clause, params } = buildWhere(filters);

  return db
    .prepare(
      `
      SELECT
        date(s.created_at) as day,
        COUNT(*) as total,
        SUM(CASE WHEN s.outcome = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN s.outcome = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN s.outcome = 'ignored' THEN 1 ELSE 0 END) as ignored
      FROM suggestions s
      JOIN pull_requests p ON p.id = s.pr_id
      ${clause}
      GROUP BY date(s.created_at)
      ORDER BY day ASC
    `,
    )
    .all(...params) as Array<Record<string, unknown>>;
}

function getSeverityOutcome(filters: QueryFilters): Array<Record<string, unknown>> {
  const db = getDb();
  const { clause, params } = buildWhere(filters);

  return db
    .prepare(
      `
      SELECT s.severity, s.outcome, COUNT(*) as count
      FROM suggestions s
      JOIN pull_requests p ON p.id = s.pr_id
      ${clause}
      GROUP BY s.severity, s.outcome
      ORDER BY s.severity, s.outcome
    `,
    )
    .all(...params) as Array<Record<string, unknown>>;
}

function getTopPRs(filters: QueryFilters): Array<Record<string, unknown>> {
  const db = getDb();
  const { clause, params } = buildWhere(filters);

  return db
    .prepare(
      `
      SELECT
        p.pr_number as prNumber,
        p.title as title,
        p.url as url,
        p.author as author,
        p.state as state,
        COUNT(*) as totalSuggestions,
        SUM(CASE WHEN s.outcome = 'accepted' THEN 1 ELSE 0 END) as acceptedSuggestions,
        SUM(CASE WHEN s.outcome = 'rejected' THEN 1 ELSE 0 END) as rejectedSuggestions,
        SUM(CASE WHEN s.outcome = 'ignored' THEN 1 ELSE 0 END) as ignoredSuggestions
      FROM suggestions s
      JOIN pull_requests p ON p.id = s.pr_id
      ${clause}
      GROUP BY p.id
      ORDER BY acceptedSuggestions DESC, totalSuggestions DESC
      LIMIT 100
    `,
    )
    .all(...params) as Array<Record<string, unknown>>;
}

function getFilterOptions(): Record<string, unknown> {
  const db = getDb();
  const authors = db
    .prepare("SELECT DISTINCT author FROM pull_requests ORDER BY author")
    .all()
    .map((r: any) => r.author);

  return {
    severities: ["critical", "warning", "suggestion"],
    outcomes: ["accepted", "rejected", "ignored"],
    authors,
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.resolve(__dirname, "index.html");
const html = readFileSync(htmlPath, "utf-8");

const port = Number(process.env.DASHBOARD_PORT ?? 8787);

const server = createServer((req, res) => {
  if (!req.url) return notFound(res);
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (url.pathname === "/api/filters") {
    json(res, 200, getFilterOptions());
    return;
  }

  const filters = parseFilters(url);

  if (url.pathname === "/api/summary") {
    json(res, 200, getSummary(filters));
    return;
  }

  if (url.pathname === "/api/trends") {
    json(res, 200, getTrends(filters));
    return;
  }

  if (url.pathname === "/api/severity-outcome") {
    json(res, 200, getSeverityOutcome(filters));
    return;
  }

  if (url.pathname === "/api/top-prs") {
    json(res, 200, getTopPRs(filters));
    return;
  }

  notFound(res);
});

server.listen(port, () => {
  console.log(`Dashboard running at http://localhost:${port}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the existing process or run with DASHBOARD_PORT=<port>.`,
    );
    process.exit(1);
  }
  console.error("Dashboard server error:", err.message);
  process.exit(1);
});
