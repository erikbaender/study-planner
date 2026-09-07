"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { usePlannerAuth, type PlannerAccount } from "./use-planner-auth";
import { Button, TextField } from "@/ui";

/** Signed-in account maintenance. Email ownership changes only after code verification. */
export function AccountSettings({ account, onSignOut }: { account: PlannerAccount | null; onSignOut: () => void }) {
  const auth = usePlannerAuth();
  const authConfiguration = useQuery(api.account.authConfiguration);
  const [email, setEmail] = useState(account?.email ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setMessage(null);
    try {
      if (step === "email") {
        await auth.signIn("email-change", { email: email.trim().toLowerCase() }); setStep("code"); setMessage("Check your new email for an 8-digit code.");
      } else {
        await auth.signIn("email-change", { email: email.trim().toLowerCase(), code: code.trim() });
        setMessage("Email updated. Sign in again to continue.");
      }
    } catch { setMessage("We couldn’t complete that request. Please try again."); }
    finally { setPending(false); }
  };

  return (
    <div className="flex w-72 flex-col gap-3 p-1">
      <div><p className="text-callout font-semibold text-secondary">Account</p><p className="text-footnote text-tertiary">{account?.email ?? "Signed in"}</p></div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        {step === "email" ? <TextField label="New email address" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /> : <TextField label="Verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} />}
        <Button size="sm" variant="push" type="submit" disabled={pending}>{pending ? "Working…" : step === "email" ? "Send change code" : "Confirm email"}</Button>
      </form>
      {message ? <p role="status" className="text-footnote text-secondary">{message}</p> : null}
      {authConfiguration?.githubMigrationEnabled ? <Button size="sm" variant="plain" onClick={() => void auth.signIn("github")}>Migrate existing GitHub account</Button> : null}
      <Button size="sm" variant="plain" onClick={onSignOut}>Sign out</Button>
    </div>
  );
}
