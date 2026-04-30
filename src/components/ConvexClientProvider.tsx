"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convex = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      return null;
    }

    return new ConvexReactClient(url);
  }, []);

  if (!convex) {
    return children;
  }

  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}