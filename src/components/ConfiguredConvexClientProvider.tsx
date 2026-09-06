"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ConvexPlannerAuthProvider } from "@/auth/convex-planner-auth";
import { usePlannerAuth } from "@/auth/use-planner-auth";
import { ConvexRepositoryProvider } from "@/data/convex-repository-provider";
import { Button, Spinner, TextField } from "@/ui";

/** The application's single Convex/Auth runtime. */
export function ConfiguredConvexClientProvider({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const convex = useMemo(() => new ConvexReactClient(url), [url]);

  return (
    <ConvexAuthProvider client={convex}>
      <ConvexPlannerAuthProvider>
        <AuthenticatedPlanner>{children}</AuthenticatedPlanner>
      </ConvexPlannerAuthProvider>
    </ConvexAuthProvider>
  );
}

/** Prevents protected planner queries from starting until authentication succeeds. */
export function AuthenticatedPlanner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const auth = usePlannerAuth();

  // OAuth metadata links here before a user has an account or session.
  if (pathname === "/mcp/privacy") return children;

  if (auth.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-content">
        <Spinner label="Checking your account" />
      </main>
    );
  }

  if (auth.status === "signed-out") {
    return <EmailSignIn />;
  }

  return <ConvexRepositoryProvider>{children}</ConvexRepositoryProvider>;
}

type SignInStep = "email" | "code";

/** Email OTP gate. The same page owns the email and code so MCP consent return state survives. */
export function EmailSignIn() {
  const auth = usePlannerAuth();
  const [step, setStep] = useState<SignInStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true); setError(null);
    try {
      await auth.signIn("email-otp", { email: normalized });
      setEmail(normalized); setStep("code"); setCooldown(30);
    } catch {
      setError("We couldn’t send a code. Check the address and try again.");
    } finally { setPending(false); }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{8}$/.test(code.trim())) { setError("Enter the 8-digit code from your email."); return; }
    setPending(true); setError(null);
    try { await auth.signIn("email-otp", { email, code: code.trim() }); }
    catch { setError("That code is invalid or expired. Request a new one and try again."); }
    finally { setPending(false); }
  };

  const resend = async () => {
    if (cooldown > 0 || pending) return;
    setPending(true); setError(null);
    try { await auth.signIn("email-otp", { email }); setCooldown(30); }
    catch { setError("We couldn’t resend the code. Please try again."); }
    finally { setPending(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-content px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-title font-semibold text-label text-center">Study Planner</h1>
        <p className="mt-2 text-body text-secondary text-center">Sign in with your email to open your study plans.</p>
        {step === "email" ? (
          <form className="mt-6 flex flex-col gap-4" onSubmit={submitEmail}>
            <TextField label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error ?? undefined} autoFocus />
            <Button variant="accent" type="submit" disabled={pending}>{pending ? "Sending code…" : "Send sign-in code"}</Button>
          </form>
        ) : (
          <form className="mt-6 flex flex-col gap-4" onSubmit={submitCode}>
            <TextField label={`Code sent to ${email}`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} error={error ?? undefined} autoFocus />
            <Button variant="accent" type="submit" disabled={pending}>{pending ? "Verifying…" : "Verify code"}</Button>
            <div className="flex items-center justify-between text-callout">
              <Button variant="plain" size="sm" disabled={pending} onClick={() => { setStep("email"); setCode(""); setError(null); }}>Change email</Button>
              <Button variant="plain" size="sm" disabled={pending || cooldown > 0} onClick={() => void resend()}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}</Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
