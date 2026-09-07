import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountSettings } from "@/auth/account-settings";
import { PlannerAuthProvider } from "@/auth/use-planner-auth";

const signIn = vi.fn();
vi.mock("convex/react", () => ({ useQuery: () => ({ githubMigrationEnabled: false }) }));

describe("AccountSettings", () => {
  it("requests and verifies a new email through separate backend calls", async () => {
    signIn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PlannerAuthProvider value={{ status: "authenticated", account: { name: "Ada", email: "old@example.com", image: null }, signIn, signOut: vi.fn() }}><AccountSettings account={{ name: "Ada", email: "old@example.com", image: null }} open onOpenChange={vi.fn()} /></PlannerAuthProvider>);
    await user.clear(screen.getByLabelText("New email address"));
    await user.type(screen.getByLabelText("New email address"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(signIn).toHaveBeenCalledWith("email-change", { email: "new@example.com" });
    await user.type(screen.getByLabelText("Verification code"), "12345678");
    await user.click(screen.getByRole("button", { name: "Confirm email" }));
    expect(signIn).toHaveBeenLastCalledWith("email-change", { email: "new@example.com", code: "12345678" });
  });
});
