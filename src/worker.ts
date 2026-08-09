import { createProbot, type Probot } from "probot";
import { app } from "./app.js";
import { applyPrivateKeyFromBase64, handleWebhookHttp } from "./webhook.js";

export interface WorkerEnv {
  APP_ID: string;
  PRIVATE_KEY_BASE64: string;
  WEBHOOK_SECRET: string;
  LLM_API_KEY: string;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  BOT_NAME?: string;
  MAX_DIFF_SIZE?: string;
  REVIEW_ON_OPEN?: string;
  MAX_REVIEWER_GUIDE_SIZE?: string;
  MAX_COPILOT_INSTRUCTIONS_SIZE?: string;
}

function applyEnv(env: WorkerEnv): void {
  process.env.APP_ID = env.APP_ID;
  process.env.PRIVATE_KEY_BASE64 = env.PRIVATE_KEY_BASE64;
  process.env.WEBHOOK_SECRET = env.WEBHOOK_SECRET;
  process.env.LLM_API_KEY = env.LLM_API_KEY;
  if (env.AI_PROVIDER) process.env.AI_PROVIDER = env.AI_PROVIDER;
  if (env.AI_MODEL) process.env.AI_MODEL = env.AI_MODEL;
  if (env.BOT_NAME) process.env.BOT_NAME = env.BOT_NAME;
  if (env.MAX_DIFF_SIZE) process.env.MAX_DIFF_SIZE = env.MAX_DIFF_SIZE;
  if (env.REVIEW_ON_OPEN) process.env.REVIEW_ON_OPEN = env.REVIEW_ON_OPEN;
  if (env.MAX_REVIEWER_GUIDE_SIZE) {
    process.env.MAX_REVIEWER_GUIDE_SIZE = env.MAX_REVIEWER_GUIDE_SIZE;
  }
  if (env.MAX_COPILOT_INSTRUCTIONS_SIZE) {
    process.env.MAX_COPILOT_INSTRUCTIONS_SIZE = env.MAX_COPILOT_INSTRUCTIONS_SIZE;
  }
  delete process.env.PRIVATE_KEY;
  applyPrivateKeyFromBase64();
}

let probot: Probot | undefined;
let probotKey = "";

function getProbot(env: WorkerEnv): Probot {
  const key = `${env.APP_ID}:${env.WEBHOOK_SECRET}:${env.PRIVATE_KEY_BASE64?.slice(0, 32)}`;
  if (!probot || probotKey !== key) {
    applyEnv(env);
    probot = createProbot();
    probot.load(app);
    probotKey = key;
  } else {
    applyEnv(env);
  }
  return probot;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const body =
      request.method === "POST" || request.method === "PUT"
        ? await request.text()
        : null;

    const result = await handleWebhookHttp(
      getProbot(env),
      request.method,
      headers,
      body,
    );

    return new Response(result.body, {
      status: result.statusCode,
      headers: result.headers,
    });
  },
};
