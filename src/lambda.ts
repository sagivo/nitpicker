import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createProbot } from "probot";
import { app } from "./app.js";
import { applyPrivateKeyFromBase64, handleWebhookHttp } from "./webhook.js";

applyPrivateKeyFromBase64();

const probot = createProbot();
probot.load(app);

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const result = await handleWebhookHttp(
    probot,
    event.requestContext.http.method,
    event.headers as Record<string, string | undefined>,
    event.body ?? null,
  );

  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: result.body,
  };
}
