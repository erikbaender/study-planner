import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OneDrivePermissionProbe } from "./OneDrivePermissionProbe";
import type { OneDriveClient } from "./onedrive-client";

function testClient(overrides: Partial<OneDriveClient> = {}): OneDriveClient {
  return {
    connect: vi.fn().mockResolvedValue({
      accountName: "student@example.edu",
      drive: {
        id: "drive-1",
        driveType: "business",
        webUrl: "https://example.sharepoint.com/personal/student",
      },
      items: [
        {
          id: "file-1",
          name: "Biochemistry slides.pdf",
          webUrl: "https://example.sharepoint.com/slides",
          size: 2_500_000,
          file: { mimeType: "application/pdf" },
        },
      ],
    }),
    listChildren: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("OneDrivePermissionProbe", () => {
  it("confirms Files.Read and exposes the resource browser link", async () => {
    const user = userEvent.setup();
    const client = testClient();
    render(<OneDrivePermissionProbe client={client} configured />);

    await user.click(screen.getByRole("button", { name: "OneDrive test" }));
    await user.click(screen.getByRole("button", { name: "Connect Microsoft account" }));

    expect(await screen.findByText("Read permission confirmed")).toBeInTheDocument();
    expect(screen.getByText("student@example.edu · business")).toBeInTheDocument();
    expect(screen.getByText("Files.Read")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "https://example.sharepoint.com/slides",
    );
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank");
  });

  it("shows the Microsoft diagnostic code when university policy blocks consent", async () => {
    const user = userEvent.setup();
    const client = testClient({
      connect: vi
        .fn()
        .mockRejectedValue(
          new Error("AADSTS90094: The grant requires admin permission."),
        ),
    });
    render(<OneDrivePermissionProbe client={client} configured />);

    await user.click(screen.getByRole("button", { name: "OneDrive test" }));
    await user.click(screen.getByRole("button", { name: "Connect Microsoft account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Microsoft access failed");
    expect(alert).toHaveTextContent("AADSTS90094");
  });

  it("explains how to configure the app registration", async () => {
    const user = userEvent.setup();
    render(<OneDrivePermissionProbe client={testClient()} configured={false} />);

    await user.click(screen.getByRole("button", { name: "OneDrive test" }));

    expect(await screen.findByText("App registration required")).toBeInTheDocument();
    expect(screen.getByText("NEXT_PUBLIC_MICROSOFT_CLIENT_ID")).toBeInTheDocument();
  });
});
