import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function ConfiguredProviderStub({
      url,
      children,
    }: {
      url: string;
      children: ReactNode;
    }) {
      return (
        <div data-testid="configured-provider" data-url={url}>
          {children}
        </div>
      );
    },
}));

vi.mock("@/data/use-repository", () => ({
  LocalRepositoryProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="local-repository-provider">{children}</div>
  ),
}));

import { usePlannerAuth } from "@/auth/use-planner-auth";
import {
  ConfiguredProviderLoading,
  ConvexClientProvider,
} from "@/components/ConvexClientProvider";

const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function AuthProbe() {
  const auth = usePlannerAuth();
  return <output>{auth.status}</output>;
}

describe("ConvexClientProvider", () => {
  afterEach(() => {
    if (originalConvexUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
    else process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
  });

  it("uses the stable local providers when no URL is configured", () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;

    render(
      <ConvexClientProvider>
        <AuthProbe />
      </ConvexClientProvider>,
    );

    expect(screen.getByText("local-only")).toBeInTheDocument();
    expect(screen.getByTestId("local-repository-provider")).toBeInTheDocument();
    expect(screen.queryByTestId("configured-provider")).not.toBeInTheDocument();
  });

  it("selects the asynchronously loaded provider for a configured URL", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://configured.convex.cloud";

    render(
      <ConvexClientProvider>
        <span>Planner</span>
      </ConvexClientProvider>,
    );

    expect(screen.getByTestId("configured-provider")).toHaveAttribute(
      "data-url",
      "https://configured.convex.cloud",
    );
    expect(screen.queryByTestId("local-repository-provider")).not.toBeInTheDocument();
  });

  it("announces an accessible, viewport-stable loading state", () => {
    render(<ConfiguredProviderLoading />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Connecting to sync…");
    expect(status).toHaveClass("min-h-screen");
  });
});
