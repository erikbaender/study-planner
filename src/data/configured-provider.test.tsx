import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructClient: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  auth: { isAuthenticated: false, isLoading: false },
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    constructor(url: string) {
      mocks.constructClient(url);
    }
  },
  useConvexAuth: () => mocks.auth,
}));

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="convex-auth-provider">{children}</div>
  ),
  useAuthActions: () => ({ signIn: mocks.signIn, signOut: mocks.signOut }),
}));

vi.mock("@/data/convex-repository-provider", () => ({
  ConvexRepositoryProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="configured-repository-provider">{children}</div>
  ),
}));

import { usePlannerAuth } from "@/auth/use-planner-auth";
import { ConfiguredConvexClientProvider } from "@/components/ConfiguredConvexClientProvider";

function AuthProbe() {
  const auth = usePlannerAuth();
  return (
    <>
      <output>{auth.status}</output>
      <button type="button" onClick={() => void auth.signIn()}>
        Sign in probe
      </button>
      <button type="button" onClick={() => void auth.signOut()}>
        Sign out probe
      </button>
    </>
  );
}

describe("ConfiguredConvexClientProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.isAuthenticated = false;
    mocks.auth.isLoading = false;
  });

  it("preserves configured auth states and provider actions", async () => {
    mocks.auth.isLoading = true;
    const user = userEvent.setup();

    const view = render(
      <ConfiguredConvexClientProvider url="https://configured.convex.cloud">
        <AuthProbe />
      </ConfiguredConvexClientProvider>,
    );

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.getByTestId("convex-auth-provider")).toBeInTheDocument();
    expect(screen.getByTestId("configured-repository-provider")).toBeInTheDocument();
    expect(mocks.constructClient).toHaveBeenCalledWith("https://configured.convex.cloud");

    mocks.auth.isLoading = false;
    view.rerender(
      <ConfiguredConvexClientProvider url="https://configured.convex.cloud">
        <AuthProbe />
      </ConfiguredConvexClientProvider>,
    );
    expect(screen.getByText("local")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in probe" }));
    expect(mocks.signIn).toHaveBeenCalledWith("github");

    mocks.auth.isAuthenticated = true;
    view.rerender(
      <ConfiguredConvexClientProvider url="https://configured.convex.cloud">
        <AuthProbe />
      </ConfiguredConvexClientProvider>,
    );
    expect(screen.getByText("synced")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out probe" }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
