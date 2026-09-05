import { api } from "../../../../convex/_generated/api";
import {
  convexServerClient,
  formData,
  issuerFor,
  oauthErrorResponse,
  OAuthError,
  randomOpaque,
  resourceFor,
  sha256Base64url,
  validateRedirectUri,
} from "@/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(params: URLSearchParams, name: string) {
  const value = params.get(name);
  if (!value) throw new OAuthError("invalid_request", `${name} is required`);
  return value;
}

function tokenResponse(result: { scopes: string[]; accessExpiresIn: number; refreshExpiresIn: number }, accessToken: string, refreshToken: string) {
  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: result.accessExpiresIn,
      refresh_token: refreshToken,
      refresh_token_expires_in: result.refreshExpiresIn,
      scope: result.scopes.join(" "),
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

export async function POST(request: Request) {
  try {
    const params = await formData(request);
    if (params.has("client_secret")) throw new OAuthError("invalid_client", "This authorization server supports public clients only", 401);
    const grantType = required(params, "grant_type");
    const clientId = required(params, "client_id");
    const resource = required(params, "resource");
    if (resource !== resourceFor(request)) throw new OAuthError("invalid_target", "resource must be the canonical MCP endpoint");
    const issuer = issuerFor(request);
    const accessToken = randomOpaque("mcp_access");
    const refreshToken = randomOpaque("mcp_refresh");
    const client = convexServerClient();

    if (grantType === "authorization_code") {
      const verifier = required(params, "code_verifier");
      if (verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(verifier)) {
        throw new OAuthError("invalid_grant", "code_verifier must be 43–128 unreserved characters");
      }
      const redirectUri = validateRedirectUri(required(params, "redirect_uri"));
      const result = await client.mutation(api.mcpOAuth.exchangeAuthorizationCode, {
        codeDigest: sha256Base64url(required(params, "code")),
        verifierChallenge: sha256Base64url(verifier),
        clientId,
        redirectUri,
        resource,
        issuer,
        accessTokenDigest: sha256Base64url(accessToken),
        refreshTokenDigest: sha256Base64url(refreshToken),
      });
      return tokenResponse(result, accessToken, refreshToken);
    }

    if (grantType === "refresh_token") {
      const result = await client.mutation(api.mcpOAuth.refreshAccessToken, {
        refreshTokenDigest: sha256Base64url(required(params, "refresh_token")),
        clientId,
        resource,
        issuer,
        accessTokenDigest: sha256Base64url(accessToken),
        nextRefreshTokenDigest: sha256Base64url(refreshToken),
      });
      if ("error" in result) {
        throw new OAuthError("invalid_grant", "Refresh token reuse detected; the connection has been revoked");
      }
      return tokenResponse(result, accessToken, refreshToken);
    }

    throw new OAuthError("unsupported_grant_type", "Only authorization_code and refresh_token grants are supported");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Token exchange failed";
    return oauthErrorResponse(
      cause instanceof OAuthError
        ? cause
        : new OAuthError(message.toLowerCase().includes("client") ? "invalid_client" : "invalid_grant", message),
    );
  }
}
