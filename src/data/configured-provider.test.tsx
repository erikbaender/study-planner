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
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
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
    mocks.pathname = "/";
  });

  it("shows a stable loading screen without mounting protected subscriptions", () => {
    mocks.auth.isLoading = true;
    renderProvider();

    expect(screen.getByRole("status", { name: "Checking your account" })).toBeInTheDocument();
    expect(screen.queryByTestId("configured-repository-provider")).not.toBeInTheDocument();
    expect(mocks.constructClient).toHaveBeenCalledWith("https://configured.convex.cloud");
  });

  it("requests an email code without mounting planner data, then verifies it", async () => {
    const user = userEvent.setup();
    renderProvider();

    expect(screen.getByText("Sign in with your email to open your study plans.")).toBeInTheDocument();
    expect(screen.queryByText("authenticated")).not.toBeInTheDocument();
    expect(screen.queryByTestId("configured-repository-provider")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Email address"), "Ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(mocks.signIn).toHaveBeenCalledWith("email-otp", { email: "ada@example.com", redirectTo: "/" });
    expect(await screen.findByLabelText("Code sent to ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend in 30s" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    await user.type(screen.getByLabelText("Code sent to ada@example.com"), "12345678");
    await user.click(screen.getByRole("button", { name: "Verify code" }));
    expect(mocks.signIn).toHaveBeenLastCalledWith("email-otp", { email: "ada@example.com", code: "12345678", redirectTo: "/" });
  });

  it("leaves the MCP privacy notice public", () => {
    mocks.pathname = "/mcp/privacy";
    renderProvider();

    expect(screen.getByText("No account")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send sign-in code" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("configured-repository-provider")).not.toBeInTheDocument();
  });

  it("presents sign-in failures and lets the user retry", async () => {
    mocks.signIn.mockRejectedValueOnce(new Error("delivery failed")).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderProvider();

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t send a code");

    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
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
    expect(screen.getByRole("button", { name: "Send sign-in code" })).toBeInTheDocument();
    expect(screen.queryByTestId("configured-repository-provider")).not.toBeInTheDocument();
  });
});
