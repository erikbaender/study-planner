import { api } from "../../../../convex/_generated/api";
import {
  convexServerClient,
  oauthErrorResponse,
  OAuthError,
  randomOpaque,
  validateRedirectUri,
} from "@/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 16_384) throw new OAuthError("invalid_client_metadata", "Registration payload is too large");
    const body = JSON.parse(text) as Record<string, unknown>;
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") {
      throw new OAuthError("invalid_client_metadata", "Only public clients using token_endpoint_auth_method=none are supported");
    }
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.some((uri) => typeof uri !== "string")) {
      throw new OAuthError("invalid_redirect_uri", "redirect_uris must be an array of absolute URIs");
    }
    const redirectUris = body.redirect_uris.map((uri) => validateRedirectUri(uri as string));
    const name = typeof body.client_name === "string" ? body.client_name.trim() : "MCP client";
    if (!name || name.length > 100) throw new OAuthError("invalid_client_metadata", "client_name must be 1–100 characters");
    const clientId = randomOpaque("mcp_client");
    await convexServerClient().mutation(api.mcpOAuth.registerClient, {
      clientId,
      name,
      redirectUris,
    });
    return Response.json(
      {
        client_id: clientId,
        client_name: name,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return oauthErrorResponse(
      cause instanceof SyntaxError
        ? new OAuthError("invalid_client_metadata", "Registration body must be valid JSON")
        : cause,
    );
  }
}
