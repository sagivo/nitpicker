import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createProbot } from "probot";
import { app } from "./app.js";

if (process.env.PRIVATE_KEY_BASE64 && !process.env.PRIVATE_KEY) {
  process.env.PRIVATE_KEY = Buffer.from(
    process.env.PRIVATE_KEY_BASE64,
    "base64",
  ).toString("utf8");
}

const probot = createProbot();
probot.load(app);

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;

  if (method === "GET") {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ok" }),
    };
  }

  if (method !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const id = event.headers["x-github-delivery"];
  const name = event.headers["x-github-event"];
  const signature = event.headers["x-hub-signature-256"];
  const payload = event.body;

  if (!id || !name || !signature || !payload) {
    return { statusCode: 400, body: "Missing required GitHub webhook headers" };
  }

  try {
    await probot.webhooks.verifyAndReceive({
      id,
      name: name as any,
      signature,
      payload,
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    probot.log.error({ err: error }, "Webhook processing failed");

    if (message.includes("signature")) {
      return { statusCode: 401, body: "Invalid signature" };
    }

    return { statusCode: 500, body: "Internal Server Error" };
  }
}
