"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import type { ConvexReactClient } from "convex/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { createAccountTokenStorage } from "./account-sessions";
import { handleApplicationCode } from "./oauth-callback";

export function ApplicationConvexAuthProvider({ client, storage, namespace, children }: {
  client: ConvexReactClient;
  storage: ReturnType<typeof createAccountTokenStorage>;
  namespace: string;
  children: ReactNode;
}) {
  const callback = useRef<ReturnType<typeof handleApplicationCode> | null>(null);
  const [authVersion, setAuthVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    // Share the exchange across Strict Mode's effect replay: OAuth codes are single-use.
    callback.current ??= handleApplicationCode(storage, namespace, (args) => client.action(api.auth.signIn, args));
    void callback.current.then((result) => {
      if (!active) return;
      if (result === "signed-in") setAuthVersion(1);
      if (result === "failed") setFailed(true);
    });
    return () => { active = false; };
  }, [client, namespace, storage]);

  return (
    <ConvexAuthProvider key={authVersion} client={client} storage={storage} storageNamespace={namespace} shouldHandleCode={false}>
      {failed ? <p role="alert" className="bg-content px-6 py-3 text-body text-negative">GitHub migration failed. Please try again.</p> : null}
      {children}
    </ConvexAuthProvider>
  );
}
