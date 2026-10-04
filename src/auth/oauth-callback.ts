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
