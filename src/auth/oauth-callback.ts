import type { createAccountTokenStorage } from "./account-sessions";

const CALLBACK_PARAM = "authCallback";

/** Mark the explicit GitHub migration return, preserving its destination. */
export function githubMigrationRedirect(redirectTo: string): string {
  const url = new URL(redirectTo, window.location.origin);
  url.searchParams.delete("code");
  url.searchParams.set(CALLBACK_PARAM, "github");
  return url.origin === window.location.origin
    ? url.pathname + url.search + url.hash
    : url.href;
}

/** MCP and other clients own their codes; only a pending app migration is ours. */
export function shouldHandleApplicationCode(storage: Pick<ReturnType<typeof createAccountTokenStorage>, "getItem">, namespace: string): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get(CALLBACK_PARAM) === "github"
    && !!storage.getItem(`__convexAuthOAuthVerifier_${namespace.replace(/[^a-zA-Z0-9]/g, "")}`);
}

/** Exchange callbacks without letting a rejected code clear an existing session. */
export async function handleApplicationCode(
  storage: ReturnType<typeof createAccountTokenStorage>,
  namespace: string,
  exchange: (args: { params: { code: string }; verifier: string }) => Promise<{
    tokens?: { token: string; refreshToken: string } | null;
  }>,
): Promise<"ignored" | "signed-in" | "failed"> {
  if (typeof window === "undefined" || !shouldHandleApplicationCode(storage, namespace)) return "ignored";
  const destination = new URL(window.location.href);
  const code = destination.searchParams.get("code");
  if (!code) return "ignored";

  const suffix = namespace.replace(/[^a-zA-Z0-9]/g, "");
  const verifierKey = `__convexAuthOAuthVerifier_${suffix}`;
  const verifier = storage.getItem(verifierKey)!;
  storage.removeItem(verifierKey);
  destination.searchParams.delete("code");
  destination.searchParams.delete(CALLBACK_PARAM);
  window.history.replaceState({}, "", destination.pathname + destination.search + destination.hash);

  try {
    const { tokens } = await exchange({ params: { code }, verifier });
    // Convex Auth returns null for wrong, expired, or already-consumed codes.
    if (!tokens) return "failed";
    storage.setItem(`__convexAuthJWT_${suffix}`, tokens.token);
    storage.setItem(`__convexAuthRefreshToken_${suffix}`, tokens.refreshToken);
    return "signed-in";
  } catch {
    return "failed";
  }
}
