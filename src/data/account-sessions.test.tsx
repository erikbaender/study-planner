import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { StrictMode } from "react";
import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountTokenStorage } from "@/auth/account-sessions";
import { ApplicationConvexAuthProvider } from "@/auth/application-convex-auth-provider";
import { githubMigrationRedirect, shouldHandleApplicationCode } from "@/auth/oauth-callback";

const deployment = "https://test.convex.cloud";
const key = (name: string, namespace = deployment) => `${name}_${namespace.replace(/[^a-zA-Z0-9]/g, "")}`;
const jwt = key("__convexAuthJWT");
const refresh = key("__convexAuthRefreshToken");
const verifier = key("__convexAuthOAuthVerifier");

describe("account auth storage", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"));

  it("writes and removes verifier and metadata without changing the session tokens", () => {
    const storage = createAccountTokenStorage("ada", deployment);
    storage.setItem(jwt, "session-jwt");
    storage.setItem(refresh, "session-refresh");
    storage.setItem(verifier, "oauth-verifier");
    storage.setItem(key("__convexAuthServerStateFetchTime"), "123");
    storage.setItem("metadataContainingRefreshToken", "metadata");

    expect(storage.getItem(jwt)).toBe("session-jwt");
    expect(storage.getItem(refresh)).toBe("session-refresh");
    expect(storage.getItem(verifier)).toBe("oauth-verifier");
    storage.removeItem(verifier);
    storage.removeItem(key("__convexAuthServerStateFetchTime"));
    expect(storage.getItem(verifier)).toBeNull();
    expect(storage.getItem(key("__convexAuthServerStateFetchTime"))).toBeNull();
    expect(storage.getItem("metadataContainingRefreshToken")).toBe("metadata");
    expect(storage.getItem(jwt)).toBe("session-jwt");
    expect(storage.getItem(refresh)).toBe("session-refresh");
    storage.removeItem(jwt);
    expect(storage.getItem(jwt)).toBeNull();
    expect(storage.getItem(refresh)).toBe("session-refresh");
    storage.removeItem(refresh);
    expect(storage.getItem(refresh)).toBeNull();
  });

  it("keeps every key isolated by account, deployment, and library namespace", () => {
    const storages = [
      createAccountTokenStorage("ada", deployment),
      createAccountTokenStorage("grace", deployment),
      createAccountTokenStorage("ada", "https://other.convex.cloud"),
    ];
    storages.forEach((storage, i) => {
      for (const name of [jwt, refresh, verifier]) storage.setItem(name, `value-${i}`);
    });
    storages[0].setItem(key("__convexAuthOAuthVerifier", "other-namespace"), "other-verifier");
    storages[0].removeItem(verifier);
    expect(storages[0].getItem(key("__convexAuthOAuthVerifier", "other-namespace"))).toBe("other-verifier");
    for (const name of [jwt, refresh, verifier]) {
      expect(storages[1].getItem(name)).toBe("value-1");
      expect(storages[2].getItem(name)).toBe("value-2");
    }
  });

  it("preserves existing account token slots and legacy token compatibility", () => {
    const storage = createAccountTokenStorage("legacy", deployment);
    window.localStorage.setItem(jwt, "legacy-jwt");
    window.localStorage.setItem(refresh, "legacy-refresh");
    expect(storage.getItem(jwt)).toBe("legacy-jwt");
    storage.setItem(jwt, "updated-jwt");
    expect(window.localStorage.getItem(jwt)).toBe("updated-jwt");
    expect(window.localStorage.getItem("study-planner.auth-session.v1:httpstestconvexcloud:legacy:jwt")).toBe("updated-jwt");
    storage.removeItem(verifier);
    expect(storage.getItem(jwt)).toBe("updated-jwt");
    expect(storage.getItem(refresh)).toBe("legacy-refresh");
    storage.removeItem(jwt);
    expect(window.localStorage.getItem(jwt)).toBeNull();
    expect(storage.getItem(refresh)).toBe("legacy-refresh");
  });
});

function SessionProbe() {
  const token = useAuthToken();
  const { signIn, signOut } = useAuthActions();
  return <>
    {token ? <p>Existing plan</p> : <p>Signed out</p>}
    <output aria-label="Session token">{token}</output>
    <button onClick={() => void signIn("github", { code: "invalid" }).catch(() => {})}>Reject code</button>
    <button onClick={() => void signOut()}>Sign out</button>
  </>;
}

describe("application OAuth callbacks", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"));

  it("marks GitHub migration returns while preserving consent state and destination", () => {
    const redirect = githubMigrationRedirect("/oauth/authorize?state=client-state&code=stale#return");
    expect(redirect).toBe("/oauth/authorize?state=client-state&authCallback=github#return");
    const storage = createAccountTokenStorage("ada", deployment);
    window.history.replaceState({}, "", `${redirect.replace("#return", "")}&code=github-code`);
    expect(shouldHandleApplicationCode(storage, deployment)).toBe(false);
    storage.setItem(verifier, "pending-verifier");
    expect(shouldHandleApplicationCode(storage, deployment)).toBe(true);
    expect(shouldHandleApplicationCode(createAccountTokenStorage("grace", deployment), deployment)).toBe(false);
  });

  it("ignores an unrelated callback and preserves plan access and both session tokens", async () => {
    window.history.replaceState({}, "", "/?code=invalid-mcp-code&state=client-state");
    const storage = createAccountTokenStorage("ada", deployment);
    storage.setItem(jwt, "active-jwt");
    storage.setItem(refresh, "active-refresh");
    storage.setItem(verifier, "pending-verifier");
    const action = vi.fn().mockRejectedValue(new Error("Invalid code"));
    // Exercise the real auth library without opening a backend subscription.
    const client = { action, setAuth: vi.fn(), clearAuth: vi.fn() } as unknown as ConvexReactClient;
    render(<ApplicationConvexAuthProvider client={client} storage={storage} namespace={deployment}>
      <SessionProbe />
    </ApplicationConvexAuthProvider>);

    expect(await screen.findByText("Existing plan")).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    expect(window.location.search).toContain("code=invalid-mcp-code");
    // The SDK also clears its verifier before an explicitly rejected sign-in.
    fireEvent.click(screen.getByRole("button", { name: "Reject code" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(storage.getItem(verifier)).toBeNull();
    expect(storage.getItem(jwt)).toBe("active-jwt");
    expect(storage.getItem(refresh)).toBe("active-refresh");
    expect(screen.getByText("Existing plan")).toBeInTheDocument();
  });

  it.each([false, true])("exchanges a marked GitHub return using the account's verifier (existing session: %s)", async (existingSession) => {
    window.history.replaceState({}, "", "/?authCallback=github&code=github-code");
    const storage = createAccountTokenStorage("ada", deployment);
    if (existingSession) {
      storage.setItem(jwt, "old-jwt");
      storage.setItem(refresh, "old-refresh");
    }
    storage.setItem(verifier, "github-verifier");
    const action = vi.fn().mockResolvedValue({ tokens: { token: "github-jwt", refreshToken: "github-refresh" } });
    const client = { action, setAuth: vi.fn(), clearAuth: vi.fn() } as unknown as ConvexReactClient;
    render(<StrictMode><ApplicationConvexAuthProvider client={client} storage={storage} namespace={deployment}>
      <SessionProbe />
    </ApplicationConvexAuthProvider></StrictMode>);

    expect(await screen.findByText("Existing plan")).toBeInTheDocument();
    expect(getFunctionName(action.mock.calls[0][0])).toBe("auth:signIn");
    expect(action.mock.calls[0][1]).toEqual({
      params: { code: "github-code" }, verifier: "github-verifier",
    });
    expect(action).toHaveBeenCalledOnce();
    await waitFor(() => expect(storage.getItem(jwt)).toBe("github-jwt"));
    await waitFor(() => expect(screen.getByLabelText("Session token")).toHaveTextContent("github-jwt"));
    expect(storage.getItem(refresh)).toBe("github-refresh");
    expect(storage.getItem(verifier)).toBeNull();
    expect(window.location.search).not.toContain("code=");
    expect(window.location.search).not.toContain("authCallback=");
  });

  it.each(["null tokens", "exception"])("keeps the active session after a marked callback fails with %s", async (failure) => {
    window.history.replaceState({}, "", "/?authCallback=github&code=invalid-github-code&state=consent#return");
    const storage = createAccountTokenStorage("ada", deployment);
    storage.setItem(jwt, "active-jwt");
    storage.setItem(refresh, "active-refresh");
    storage.setItem(verifier, "pending-verifier");
    const action = failure === "null tokens"
      ? vi.fn().mockResolvedValue({ tokens: null })
      : vi.fn().mockRejectedValue(new Error("Invalid code"));
    const client = { action, setAuth: vi.fn(), clearAuth: vi.fn() } as unknown as ConvexReactClient;
    render(<StrictMode><ApplicationConvexAuthProvider client={client} storage={storage} namespace={deployment}>
      <SessionProbe />
    </ApplicationConvexAuthProvider></StrictMode>);

    expect(await screen.findByRole("alert")).toHaveTextContent("GitHub migration failed");
    expect(await screen.findByText("Existing plan")).toBeInTheDocument();
    expect(action).toHaveBeenCalledOnce();
    expect(storage.getItem(jwt)).toBe("active-jwt");
    expect(storage.getItem(refresh)).toBe("active-refresh");
    expect(storage.getItem(verifier)).toBeNull();
    expect(window.location.search).toBe("?state=consent");
    expect(window.location.hash).toBe("#return");

    // Callback rejection must not interfere with an intentional sign-out.
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Signed out")).toBeInTheDocument();
    expect(storage.getItem(jwt)).toBeNull();
    expect(storage.getItem(refresh)).toBeNull();
  });

  it("shows a failed signed-out migration without leaving authentication loading", async () => {
    window.history.replaceState({}, "", "/?authCallback=github&code=invalid-github-code");
    const storage = createAccountTokenStorage("ada", deployment);
    storage.setItem(verifier, "pending-verifier");
    const action = vi.fn().mockResolvedValue({ tokens: null });
    const client = { action, setAuth: vi.fn(), clearAuth: vi.fn() } as unknown as ConvexReactClient;
    render(<ApplicationConvexAuthProvider client={client} storage={storage} namespace={deployment}>
      <SessionProbe />
    </ApplicationConvexAuthProvider>);

    expect(await screen.findByRole("alert")).toHaveTextContent("GitHub migration failed");
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(storage.getItem(jwt)).toBeNull();
    expect(storage.getItem(refresh)).toBeNull();
  });
});
