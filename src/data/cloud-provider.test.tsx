import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ConfiguredConvexClientProvider", () => ({
  ConfiguredConvexClientProvider: ({
    url,
    children,
  }: {
    url: string;
    children: ReactNode;
  }) => (
    <div data-testid="configured-provider" data-url={url}>
      {children}
    </div>
  ),
}));

import { ConvexClientProvider } from "@/components/ConvexClientProvider";

const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

describe("ConvexClientProvider", () => {
  afterEach(() => {
    if (originalConvexUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
    else process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
  });

  it("fails explicitly instead of mounting a planner when cloud configuration is missing", () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;

    render(
      <ConvexClientProvider>
        <span>Planner data</span>
      </ConvexClientProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Cloud configuration required");
    expect(screen.getByRole("alert")).toHaveTextContent("NEXT_PUBLIC_CONVEX_URL");
    expect(screen.queryByText("Planner data")).not.toBeInTheDocument();
    expect(screen.queryByTestId("configured-provider")).not.toBeInTheDocument();
  });

  it("mounts the only runtime when the public Convex URL is configured", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = " https://configured.convex.cloud/ ";

    render(
      <ConvexClientProvider>
        <span>Planner</span>
      </ConvexClientProvider>,
    );

    expect(screen.getByTestId("configured-provider")).toHaveAttribute(
      "data-url",
      "https://configured.convex.cloud",
    );
    expect(screen.getByText("Planner")).toBeInTheDocument();
  });
});
