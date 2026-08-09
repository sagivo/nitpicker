import type { Probot } from "probot";

export type WebhookResult = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

function header(
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value;
  }
  return undefined;
}

/**
 * Shared HTTP webhook handler for Lambda and Cloudflare Workers.
 */
export async function handleWebhookHttp(
  probot: Probot,
  method: string,
  headers: Record<string, string | undefined>,
  body: string | null | undefined,
): Promise<WebhookResult> {
  const verb = method.toUpperCase();

  if (verb === "GET") {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ok" }),
    };
  }

  if (verb !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const id = header(headers, "x-github-delivery");
  const name = header(headers, "x-github-event");
  const signature = header(headers, "x-hub-signature-256");
  const payload = body ?? undefined;

  if (!id || !name || !signature || payload === undefined) {
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
    const message = error instanceof Error ? error.message : "Unknown error";
    probot.log.error({ err: error }, "Webhook processing failed");

    if (message.toLowerCase().includes("signature")) {
      return { statusCode: 401, body: "Invalid signature" };
    }

    return { statusCode: 500, body: "Internal Server Error" };
  }
}

export function applyPrivateKeyFromBase64(): void {
  if (process.env.PRIVATE_KEY_BASE64 && !process.env.PRIVATE_KEY) {
    process.env.PRIVATE_KEY = Buffer.from(
      process.env.PRIVATE_KEY_BASE64,
      "base64",
    ).toString("utf8");
  }
}
