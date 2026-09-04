import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructClient: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  currentAccount: undefined as
    | undefined
    | null
    | { name: string | null; email: string | null; image: string | null },
  auth: { isAuthenticated: false, isLoading: false },
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    constructor(url: string) {
      mocks.constructClient(url);
    }
  },
  useConvexAuth: () => mocks.auth,
  useQuery: () => mocks.currentAccount,
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
      <output>{auth.account?.name ?? "No account"}</output>
      <button type="button" onClick={() => void auth.signOut()}>
        Sign out probe
      </button>
    </>
  );
}

function renderProvider() {
  return render(
    <ConfiguredConvexClientProvider url="https://configured.convex.cloud">
      <AuthProbe />
    </ConfiguredConvexClientProvider>,
  );
}

describe("ConfiguredConvexClientProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signIn.mockResolvedValue(undefined);
    mocks.signOut.mockResolvedValue(undefined);
    mocks.auth.isAuthenticated = false;
    mocks.auth.isLoading = false;
    mocks.currentAccount = undefined;
  });

  it("shows a stable loading screen without mounting protected subscriptions", () => {
    mocks.auth.isLoading = true;
    renderProvider();

    expect(screen.getByRole("status", { name: "Checking your account" })).toBeInTheDocument();
    expect(screen.queryByTestId("configured-repository-provider")).not.toBeInTheDocument();
    expect(mocks.constructClient).toHaveBeenCalledWith("https://configured.convex.cloud");
  });

  it("gates signed-out users and starts GitHub sign-in without mounting planner data", async () => {
    const user = userEvent.setup();
    renderProvider();

    expect(screen.getByText("Sign in to open your account-backed study plans.")).toBeInTheDocument();
    expect(screen.queryByText("authenticated")).not.toBeInTheDocument();
    expect(screen.queryByTestId("configured-repository-provider")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(mocks.signIn).toHaveBeenCalledWith("github");
  });

  it("presents sign-in failures and lets the user retry", async () => {
    mocks.signIn
      .mockRejectedValueOnce(new Error("GitHub sign-in was interrupted"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("GitHub sign-in was interrupted");

    await user.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
  });

  it("mounts planner subscriptions only while authenticated and returns to the gate", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.currentAccount = { name: "Ada Lovelace", email: "ada@example.com", image: null };
    const user = userEvent.setup();
    const view = renderProvider();

    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByTestId("configured-repository-provider")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out probe" }));
    expect(mocks.signOut).toHaveBeenCalledOnce();

    mocks.auth.isAuthenticated = false;
    view.rerender(
      <ConfiguredConvexClientProvider url="https://configured.convex.cloud">
        <AuthProbe />
      </ConfiguredConvexClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.queryByTestId("configured-repository-provider")).not.toBeInTheDocument();
  });
});
