"use client";

import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { Button, Sheet, TextField } from "@/ui";
import type { PlannerAccount } from "./use-planner-auth";

const ACCOUNT_TOKEN_PREFIX = "study-planner.auth-session.v1";
const LEGACY_SESSION_ID = "legacy";
const PENDING_SESSION_ID = "pending-add-account";

export type PlannerAccountEntry = PlannerAccount & { id: string };

export function accountId(account: PlannerAccount): string {
  return account.email?.trim().toLowerCase() || `${account.name ?? "account"}:${account.image ?? ""}`;
}

function legacyStorageKey(key: string, url: string) {
  return `${key}_${url.replace(/[^a-zA-Z0-9]/g, "")}`;
}

function metadataStorageKey(url: string) {
  return `study-planner.accounts.v1:${url.replace(/[^a-zA-Z0-9]/g, "")}`;
}

function tokenStorageKey(sessionId: string, kind: "jwt" | "refresh", url: string) {
  return `${ACCOUNT_TOKEN_PREFIX}:${url.replace(/[^a-zA-Z0-9]/g, "")}:${sessionId}:${kind}`;
}

function readJson<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Authentication still works for this session if browser storage is full.
  }
}

function readMetadata(url: string): { activeId: string; accounts: PlannerAccountEntry[] } {
  const saved = readJson<{ activeId?: string; accounts?: PlannerAccountEntry[] }>(metadataStorageKey(url));
  return {
    activeId: saved?.activeId ?? LEGACY_SESSION_ID,
    accounts: Array.isArray(saved?.accounts) ? saved.accounts : [],
  };
}

function removeTokenPair(sessionId: string, url: string) {
  try {
    window.localStorage.removeItem(tokenStorageKey(sessionId, "jwt", url));
    window.localStorage.removeItem(tokenStorageKey(sessionId, "refresh", url));
    if (sessionId === LEGACY_SESSION_ID) {
      window.localStorage.removeItem(legacyStorageKey("__convexAuthJWT", url));
      window.localStorage.removeItem(legacyStorageKey("__convexAuthRefreshToken", url));
    }
  } catch {
    // Ignore storage cleanup failures; Convex Auth has already signed out.
  }
}

function moveTokenPair(from: string, to: string, url: string) {
  const fromJwt = readToken(from, "jwt", url);
  const fromRefresh = readToken(from, "refresh", url);
  if (fromJwt) writeToken(to, "jwt", fromJwt, url);
  if (fromRefresh) writeToken(to, "refresh", fromRefresh, url);
  if (from !== to) removeTokenPair(from, url);
}

function readToken(sessionId: string, kind: "jwt" | "refresh", url: string): string | null {
  try {
    const stored = window.localStorage.getItem(tokenStorageKey(sessionId, kind, url));
    if (stored) return stored;
    if (sessionId === LEGACY_SESSION_ID) {
      return window.localStorage.getItem(
        legacyStorageKey(kind === "jwt" ? "__convexAuthJWT" : "__convexAuthRefreshToken", url),
      );
    }
  } catch {
    return null;
  }
  return null;
}

function writeToken(sessionId: string, kind: "jwt" | "refresh", value: string, url: string) {
  try {
    window.localStorage.setItem(tokenStorageKey(sessionId, kind, url), value);
    if (sessionId === LEGACY_SESSION_ID) {
      window.localStorage.setItem(
        legacyStorageKey(kind === "jwt" ? "__convexAuthJWT" : "__convexAuthRefreshToken", url),
        value,
      );
    }
  } catch {
    // The Convex Auth provider will surface a sign-in error if storage cannot be used.
  }
}

/** Adapts Convex Auth's two token keys to one account's stored session. */
export function createAccountTokenStorage(sessionId: string, url: string) {
  return {
    getItem: (key: string) => readToken(sessionId, key.includes("RefreshToken") ? "refresh" : "jwt", url),
    setItem: (key: string, value: string) =>
      writeToken(sessionId, key.includes("RefreshToken") ? "refresh" : "jwt", value, url),
    removeItem: () => removeTokenPair(sessionId, url),
  };
}

type AccountSessionsContextValue = {
  accounts: readonly PlannerAccountEntry[];
  activeSessionId: string;
  activeStorage: ReturnType<typeof createAccountTokenStorage>;
  addAccountOpen: boolean;
  openAddAccount: () => void;
  closeAddAccount: () => void;
  registerActiveAccount: (account: PlannerAccount) => void;
  completeAddedAccount: (account: PlannerAccount) => void;
  switchAccount: (id: string) => void;
  removeActiveAccount: () => void;
};

const AccountSessionsContext = createContext<AccountSessionsContextValue | null>(null);

export function useAccountSessions() {
  const value = useContext(AccountSessionsContext);
  if (!value) throw new Error("useAccountSessions must be used inside an account sessions provider");
  return value;
}

export function AccountSessionsProvider({ url, children }: { url: string; children: ReactNode }) {
  const initial = useMemo(() => readMetadata(url), [url]);
  const [accounts, setAccounts] = useState<PlannerAccountEntry[]>(initial.accounts);
  const [activeSessionId, setActiveSessionId] = useState(initial.activeId);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const activeStorage = useMemo(
    () => createAccountTokenStorage(activeSessionId, url),
    [activeSessionId, url],
  );

  useEffect(() => {
    writeJson(metadataStorageKey(url), { activeId: activeSessionId, accounts });
  }, [activeSessionId, accounts, url]);

  const openAddAccount = useCallback(() => setAddAccountOpen(true), []);
  const closeAddAccount = useCallback(() => {
    removeTokenPair(PENDING_SESSION_ID, url);
    setAddAccountOpen(false);
  }, [url]);

  const registerActiveAccount = useCallback((account: PlannerAccount) => {
    const id = accountId(account);
    if (activeSessionId !== id) moveTokenPair(activeSessionId, id, url);
    setAccounts((current) => {
      const existing = current.find((candidate) => candidate.id === id);
      return existing
        ? current.map((candidate) => (candidate.id === id ? { ...candidate, ...account } : candidate))
        : [...current, { ...account, id }];
    });
    setActiveSessionId(id);
  }, [activeSessionId, url]);

  const completeAddedAccount = useCallback((account: PlannerAccount) => {
    const id = accountId(account);
    moveTokenPair(PENDING_SESSION_ID, id, url);
    setAccounts((current) => {
      const existing = current.find((candidate) => candidate.id === id);
      return existing
        ? current.map((candidate) => (candidate.id === id ? { ...candidate, ...account } : candidate))
        : [...current, { ...account, id }];
    });
    setActiveSessionId(id);
    setAddAccountOpen(false);
  }, [url]);

  const switchAccount = useCallback((id: string) => {
    if (accounts.some((account) => account.id === id)) setActiveSessionId(id);
  }, [accounts]);

  const removeActiveAccount = useCallback(() => {
    removeTokenPair(activeSessionId, url);
    const remaining = accounts.filter((account) => account.id !== activeSessionId);
    setAccounts(remaining);
    setActiveSessionId(remaining[0]?.id ?? LEGACY_SESSION_ID);
  }, [accounts, activeSessionId, url]);

  const value = useMemo<AccountSessionsContextValue>(
    () => ({
      accounts,
      activeSessionId,
      activeStorage,
      addAccountOpen,
      openAddAccount,
      closeAddAccount,
      registerActiveAccount,
      completeAddedAccount,
      switchAccount,
      removeActiveAccount,
    }),
    [accounts, activeSessionId, activeStorage, addAccountOpen, closeAddAccount, completeAddedAccount, openAddAccount, registerActiveAccount, removeActiveAccount, switchAccount],
  );

  return <AccountSessionsContext.Provider value={value}>{children}</AccountSessionsContext.Provider>;
}

/** A second, isolated auth client lets a new account be verified without replacing the active account. */
export function AddAccountFlow({ url }: { url: string }) {
  const { addAccountOpen, closeAddAccount } = useAccountSessions();
  const client = useMemo(() => new ConvexReactClient(url), [url]);

  if (!addAccountOpen) return null;
  return (
    <ConvexAuthProvider
      key="add-account"
      client={client}
      storage={createAccountTokenStorage(PENDING_SESSION_ID, url)}
      storageNamespace="study-planner-add-account"
    >
      <AddAccountSignIn onCancel={closeAddAccount} />
    </ConvexAuthProvider>
  );
}

function AddAccountSignIn({ onCancel }: { onCancel: () => void }) {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const account = useQuery(api.account.current, isAuthenticated ? {} : "skip");
  const { completeAddedAccount } = useAccountSessions();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && account) completeAddedAccount(account);
  }, [account, completeAddedAccount, isAuthenticated]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true); setError(null);
    try {
      await signIn("email-otp", { email: normalized });
      setEmail(normalized); setStep("code"); setCooldown(30);
    } catch {
      setError("We couldn’t send a code. Check the address and try again.");
    } finally { setPending(false); }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{8}$/.test(code.trim())) {
      setError("Enter the 8-digit code from your email.");
      return;
    }
    setPending(true); setError(null);
    try {
      await signIn("email-otp", { email, code: code.trim() });
    } catch {
      setError("That code is invalid or expired. Request a new one and try again.");
    } finally { setPending(false); }
  };

  const resend = async () => {
    if (cooldown > 0 || pending) return;
    setPending(true); setError(null);
    try { await signIn("email-otp", { email }); setCooldown(30); }
    catch { setError("We couldn’t resend the code. Please try again."); }
    finally { setPending(false); }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title="Add account"
      description="Sign in to another Study Planner account. Your current account will stay signed in."
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="accent"
            type="submit"
            form="add-account-form"
            disabled={pending}
          >
            {pending ? (step === "email" ? "Sending code…" : "Verifying…") : step === "email" ? "Send sign-in code" : "Verify code"}
          </Button>
        </>
      }
    >
      <form id="add-account-form" className="flex w-full flex-col gap-4" onSubmit={step === "email" ? submitEmail : submitCode}>
        {step === "email" ? (
          <TextField label="Email address" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={error ?? undefined} autoFocus />
        ) : (
          <>
            <TextField label={`Code sent to ${email}`} inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} error={error ?? undefined} autoFocus />
            <div className="flex items-center justify-between text-callout">
              <Button variant="plain" size="sm" disabled={pending} onClick={() => { setStep("email"); setCode(""); setError(null); }}>Change email</Button>
              <Button variant="plain" size="sm" disabled={pending || cooldown > 0} onClick={() => void resend()}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}</Button>
            </div>
          </>
        )}
      </form>
    </Sheet>
  );
}
