import { AuthorizationConsent } from "./authorization-consent";
import { DEFAULT_MCP_SCOPES, parseScopes, validateRedirectUri } from "@/mcp/oauth";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(params: Awaited<SearchParams>, name: string) {
  const value = params[name];
  return typeof value === "string" ? value : undefined;
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  let request: React.ComponentProps<typeof AuthorizationConsent>["request"] | null = null;
  let error: string | null = null;
  try {
    if (one(params, "response_type") !== "code") throw new Error("Only response_type=code is supported.");
    if (one(params, "code_challenge_method") !== "S256") throw new Error("PKCE with code_challenge_method=S256 is required.");
    const clientId = one(params, "client_id");
    const redirectUri = one(params, "redirect_uri");
    const resource = one(params, "resource");
    const codeChallenge = one(params, "code_challenge");
    if (!clientId || !redirectUri || !resource || !codeChallenge) throw new Error("client_id, redirect_uri, resource, and code_challenge are required.");
    const scopes = parseScopes(one(params, "scope") ?? null, DEFAULT_MCP_SCOPES);
    validateRedirectUri(redirectUri);
    request = { clientId, redirectUri, resource, codeChallenge, scopes, state: one(params, "state") };
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "The request is invalid.";
  }

  if (!request) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-content px-6">
        <div role="alert" className="max-w-md text-center">
          <h1 className="text-title font-semibold text-label">Authorization request rejected</h1>
          <p className="mt-2 text-body text-secondary">
            {error}
          </p>
        </div>
      </main>
    );
  }
  return <AuthorizationConsent request={request} />;
}
