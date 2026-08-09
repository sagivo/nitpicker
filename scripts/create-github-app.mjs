#!/usr/bin/env node
/**
 * Creates a GitHub App via the App Manifest flow.
 * Opens the browser, waits for the OAuth-style callback, exchanges the code,
 * prints JSON credentials to stdout.
 *
 * Usage:
 *   node scripts/create-github-app.mjs [--name nitpicker] [--org ORG] [--port 9876]
 */
import http from "node:http";
import { createServer } from "node:net";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { URL } from "node:url";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1] ?? fallback;
}
function has(name) {
  return args.includes(`--${name}`);
}

const APP_NAME = flag("name", "nitpicker");
const ORG = flag("org", "");
const PREFERRED_PORT = Number(flag("port", "9876"));
const STATE = crypto.randomBytes(16).toString("hex");
const TIMEOUT_MS = 5 * 60 * 1000;

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === "darwin") execSync(`open ${JSON.stringify(url)}`, { stdio: "ignore" });
    else if (platform === "win32") execSync(`start "" ${JSON.stringify(url)}`, { stdio: "ignore", shell: true });
    else execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: "ignore" });
  } catch {
    log(`Open this URL in your browser:\n  ${url}`);
  }
}

async function findFreePort(start) {
  for (let port = start; port < start + 20; port++) {
    const free = await new Promise((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => {
        srv.close(() => resolve(true));
      });
    });
    if (free) return port;
  }
  throw new Error("No free port found for GitHub App callback");
}

function buildManifest(redirectUrl) {
  return {
    name: APP_NAME,
    url: "https://github.com/sagivo/nitpicker",
    hook_attributes: {
      url: "https://example.com/github/webhooks",
      active: true,
    },
    redirect_url: redirectUrl,
    callback_urls: [redirectUrl],
    public: false,
    default_permissions: {
      contents: "read",
      issues: "write",
      metadata: "read",
      pull_requests: "write",
    },
    default_events: [
      "pull_request",
      "issue_comment",
      "pull_request_review_comment",
    ],
  };
}

function setupPage(manifest, githubNewAppUrl) {
  const manifestJson = JSON.stringify(manifest);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Create Nitpicker GitHub App</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; color: #111; }
    button { background: #238636; color: #fff; border: 0; padding: 0.75rem 1.25rem; border-radius: 6px; font-size: 1rem; cursor: pointer; }
    button:hover { background: #2ea043; }
    code { background: #f6f8fa; padding: 0.1rem 0.35rem; border-radius: 4px; }
    .muted { color: #57606a; }
  </style>
</head>
<body>
  <h1>Create Nitpicker GitHub App</h1>
  <p>Click below to register the app on GitHub with the right permissions and events. You’ll return here automatically.</p>
  <form id="f" action="${githubNewAppUrl}" method="post">
    <input type="hidden" name="manifest" id="manifest" />
    <input type="hidden" name="state" value="${STATE}" />
    <button type="submit">Continue on GitHub →</button>
  </form>
  <p class="muted">Permissions: Pull requests (R/W), Issues (R/W), Contents (R), Metadata (R).<br/>
  Events: pull_request, issue_comment, pull_request_review_comment.</p>
  <script>
    document.getElementById('manifest').value = ${JSON.stringify(manifestJson)};
    if (new URLSearchParams(location.search).get('auto') === '1') {
      document.getElementById('f').submit();
    }
  </script>
</body>
</html>`;
}

function donePage(ok, message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Nitpicker setup</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem}</style>
</head><body>
  <h1>${ok ? "✓ GitHub App created" : "Setup failed"}</h1>
  <p>${message}</p>
  <p>You can close this tab and return to the terminal.</p>
</body></html>`;
}

async function exchangeCode(code) {
  const res = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "nitpicker-install",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Manifest conversion failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function main() {
  const port = await findFreePort(PREFERRED_PORT);
  const redirectUrl = `http://127.0.0.1:${port}/callback`;
  const manifest = buildManifest(redirectUrl);
  const githubNewAppUrl = ORG
    ? `https://github.com/organizations/${encodeURIComponent(ORG)}/settings/apps/new`
    : "https://github.com/settings/apps/new";

  const app = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

        if (url.pathname === "/" || url.pathname === "/setup") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(setupPage(manifest, githubNewAppUrl));
          return;
        }

        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(donePage(false, "Missing <code>code</code> from GitHub."));
            return;
          }
          if (state && state !== STATE) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(donePage(false, "Invalid state parameter."));
            return;
          }

          log("Exchanging manifest code for app credentials...");
          const data = await exchangeCode(code);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            donePage(
              true,
              `App <strong>${data.slug || data.name}</strong> (id ${data.id}) is ready.`,
            ),
          );
          server.close();
          resolve(data);
          return;
        }

        res.writeHead(404).end("Not found");
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(donePage(false, String(err?.message || err)));
        server.close();
        reject(err);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const setupUrl = `http://127.0.0.1:${port}/setup?auto=1`;
      log("");
      log("Creating GitHub App via browser…");
      log(`  Local callback: ${redirectUrl}`);
      if (ORG) log(`  Organization: ${ORG}`);
      log("  If the browser does not open, visit:");
      log(`  ${setupUrl}`);
      log("");
      openBrowser(setupUrl);
    });

    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for GitHub App creation (5 minutes)"));
    }, TIMEOUT_MS);
  });

  const out = {
    id: app.id,
    slug: app.slug,
    name: app.name,
    client_id: app.client_id,
    webhook_secret: app.webhook_secret,
    pem: app.pem,
    html_url: app.html_url,
    owner: app.owner?.login ?? null,
  };

  process.stdout.write(JSON.stringify(out, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  log(`Error: ${err.message || err}`);
  process.exit(1);
});
