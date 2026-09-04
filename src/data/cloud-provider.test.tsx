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

import {
  ConvexClientProvider,
  missingCloudConfiguration,
} from "@/components/ConvexClientProvider";

const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const originalConvexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

describe("ConvexClientProvider", () => {
  afterEach(() => {
    if (originalConvexUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
    else process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    if (originalConvexSiteUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    else process.env.NEXT_PUBLIC_CONVEX_SITE_URL = originalConvexSiteUrl;
  });

  it("fails explicitly instead of mounting a planner when cloud configuration is missing", () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "   ";

    render(
      <ConvexClientProvider>
        <span>Planner data</span>
      </ConvexClientProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Cloud configuration required");
    expect(screen.getByRole("alert")).toHaveTextContent("NEXT_PUBLIC_CONVEX_URL");
    expect(screen.getByRole("alert")).toHaveTextContent("NEXT_PUBLIC_CONVEX_SITE_URL");
    expect(screen.queryByText("Planner data")).not.toBeInTheDocument();
    expect(screen.queryByTestId("configured-provider")).not.toBeInTheDocument();
  });

  it("mounts the only runtime when both public Convex URLs are configured", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = " https://configured.convex.cloud ";
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://configured.convex.site";

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

describe("missingCloudConfiguration", () => {
  it("treats blank values as missing", () => {
    expect(missingCloudConfiguration({ convexUrl: " ", convexSiteUrl: undefined })).toEqual([
      "NEXT_PUBLIC_CONVEX_URL",
      "NEXT_PUBLIC_CONVEX_SITE_URL",
    ]);
  });
});
