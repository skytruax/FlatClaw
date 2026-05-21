import { readServiceOauthToken, setServiceOauthToken } from "./oauth";
import { readOauthApp } from "./oauth-app";
import { getManagedMcpService } from "@/lib/openclaw/managed-mcp";

/**
 * Returns a non-expired access_token for the given (userId, service),
 * refreshing via the plugin's `auth.refreshAccessToken` hook when the cached
 * one is within ~60s of expiry.
 *
 * Refresh tokens never leave this process; only short-lived access tokens
 * cross the loopback boundary to the per-user MCP wrapper.
 */
export async function getValidServiceAccessToken(
  userId: string,
  service: string,
): Promise<{
  accessToken: string;
  expiresAt: Date | null;
  scope: string | null;
  identity: string | null;
}> {
  const svc = getManagedMcpService(service);
  if (!svc) throw new Error(`unknown service '${service}'`);
  if (svc.auth.kind !== "oauth") {
    throw new Error(`service '${service}' is not an OAuth plugin`);
  }

  const token = await readServiceOauthToken(userId, service);
  if (!token) {
    throw new Error(
      `user has not connected '${service}' — no token in service_oauth_tokens`,
    );
  }

  const safeMargin = 60_000;
  const now = Date.now();
  if (token.expiresAt && token.expiresAt.getTime() - safeMargin > now) {
    return {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
      identity: token.identity,
    };
  }

  if (!token.refreshToken) {
    throw new Error(
      `access token expired and no refresh token on file for '${service}' — user needs to re-authorize`,
    );
  }
  if (!svc.auth.refreshAccessToken) {
    throw new Error(
      `plugin '${service}' has no refreshAccessToken hook — re-authorize required`,
    );
  }
  const app = await readOauthApp(service);
  if (!app) {
    throw new Error(
      `tenant OAuth app for '${service}' is not configured — cannot refresh`,
    );
  }

  const bundle = await svc.auth.refreshAccessToken(
    token.refreshToken,
    app.clientId,
    app.clientSecret,
  );
  // Refresh-token-issuance varies by provider:
  //   Google does NOT rotate refresh tokens on refresh — preserve the prior one.
  //   Others (Slack, Notion, Atlassian) sometimes do — replace if provided.
  // setServiceOauthToken treats `refreshToken === undefined` as "preserve",
  // so passing through the bundle's value gives both shapes.
  await setServiceOauthToken(userId, service, {
    accessToken: bundle.accessToken,
    refreshToken: bundle.refreshToken === undefined ? undefined : bundle.refreshToken,
    expiresAt: bundle.expiresAt ?? null,
    scope: bundle.scope ?? token.scope,
    identity: bundle.identity ?? token.identity,
  });

  return {
    accessToken: bundle.accessToken,
    expiresAt: bundle.expiresAt ?? null,
    scope: bundle.scope ?? token.scope,
    identity: bundle.identity ?? token.identity,
  };
}
