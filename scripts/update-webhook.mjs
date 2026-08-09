#!/usr/bin/env node
/**
 * Updates the GitHub App webhook URL using the App JWT.
 *
 * Usage:
 *   node scripts/update-webhook.mjs --app-id ID --pem-file path --url https://...
 *   APP_ID=... PRIVATE_KEY=... WEBHOOK_URL=... node scripts/update-webhook.mjs
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}

function loadPem() {
  const pemFile = flag("pem-file");
  if (pemFile) return readFileSync(pemFile, "utf8");
  if (process.env.PRIVATE_KEY) {
    return process.env.PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (process.env.PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }
  throw new Error("Provide --pem-file or PRIVATE_KEY / PRIVATE_KEY_BASE64");
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function appJwt(appId, pem) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(appId) }),
  );
  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  const sig = sign
    .sign(pem)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${sig}`;
}

async function main() {
  const appId = flag("app-id") || process.env.APP_ID;
  const webhookUrl = flag("url") || process.env.WEBHOOK_URL;
  const secret = flag("secret") || process.env.WEBHOOK_SECRET;

  if (!appId) throw new Error("Missing app id (--app-id or APP_ID)");
  if (!webhookUrl) throw new Error("Missing webhook url (--url or WEBHOOK_URL)");

  const pem = loadPem();
  const token = appJwt(appId, pem);

  const body = { url: webhookUrl, content_type: "json", insecure_ssl: "0" };
  if (secret) body.secret = secret;

  const res = await fetch("https://api.github.com/app/hook/config", {
    method: "PATCH",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nitpicker-install",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update webhook (${res.status}): ${text}`);
  }

  const data = await res.json();
  process.stdout.write(`${data.url}\n`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message || err}\n`);
  process.exit(1);
});
