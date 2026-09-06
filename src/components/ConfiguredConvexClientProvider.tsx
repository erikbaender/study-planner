"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ConvexPlannerAuthProvider } from "@/auth/convex-planner-auth";
import { usePlannerAuth } from "@/auth/use-planner-auth";
import { ConvexRepositoryProvider } from "@/data/convex-repository-provider";
import { Button, Spinner } from "@/ui";

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
  const [signInPending, setSignInPending] = useState(false);
  const [signInError, setSignInError] = useState<Error | null>(null);

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
    const handleSignIn = async () => {
      setSignInPending(true);
      setSignInError(null);
      try {
        await auth.signIn();
      } catch (cause) {
        setSignInError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        setSignInPending(false);
      }
    };

    return (
      <main className="flex min-h-screen items-center justify-center bg-content px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-title font-semibold text-label">Study Planner</h1>
          <p className="mt-2 text-body text-secondary">
            Sign in to open your account-backed study plans.
          </p>
          {signInError ? (
            <p role="alert" className="mt-3 text-body text-negative">
              {signInError.message}
            </p>
          ) : null}
          <Button
            variant="accent"
            className="mt-5"
            disabled={signInPending}
            onClick={() => void handleSignIn()}
          >
            {signInPending ? "Opening GitHub…" : "Continue with GitHub"}
          </Button>
        </div>
      </main>
    );
  }

  return <ConvexRepositoryProvider>{children}</ConvexRepositoryProvider>;
}
