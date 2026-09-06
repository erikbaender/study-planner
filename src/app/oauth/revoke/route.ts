import { api } from "../../../../convex/_generated/api";
import {
  convexServerClient,
  formData,
  oauthErrorResponse,
  OAuthError,
  sha256Base64url,
} from "@/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const params = await formData(request);
    const token = params.get("token");
    const clientId = params.get("client_id");
    if (!token || !clientId) throw new OAuthError("invalid_request", "token and client_id are required");
    await convexServerClient().mutation(api.mcpOAuth.revokeToken, {
      tokenDigest: sha256Base64url(token),
      clientId,
    });
    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return oauthErrorResponse(cause);
  }
}
