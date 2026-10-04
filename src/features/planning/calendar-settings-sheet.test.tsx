import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES } from "@/domain";
import { CalendarSettingsSheet } from "./calendar-settings-sheet";

describe("CalendarSettingsSheet", () => {
  it("saves account-wide weekdays, valid blackout dates, and an IANA timezone", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const preferences = {
      ...DEFAULT_PREFERENCES,
      dailyCapacityUnits: 75,
      blackoutDates: ["2026-10-16"],
      timezone: "Europe/Berlin",
      theme: "dark" as const,
    };
    render(
      <CalendarSettingsSheet
        open
        onOpenChange={vi.fn()}
        preferences={preferences}
        onSave={onSave}
      />,
    );

    expect(screen.getByText(/apply across all semesters in this account/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Sunday" }));
    const dateField = screen.getByLabelText("Add a day off");
    fireEvent.change(dateField, { target: { value: "2026-02-31" } });
    expect(screen.getByRole("button", { name: "Add date" })).toBeDisabled();
    fireEvent.change(dateField, { target: { value: "2026-12-25" } });
    await user.click(screen.getByRole("button", { name: "Add date" }));

    const timezone = screen.getByLabelText("IANA timezone");
    await user.clear(timezone);
    await user.type(timezone, "Not/A_Timezone");
    expect(screen.getByText("Enter a valid IANA timezone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();

    await user.clear(timezone);
    await user.type(timezone, "Europe/Berlin");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onSave).toHaveBeenCalledWith({
      ...preferences,
      studyDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
      blackoutDates: ["2026-10-16", "2026-12-25"],
      timezone: "Europe/Berlin",
    });
  });

  it("does not add a blackout date already on the account calendar", async () => {
    const user = userEvent.setup();
    render(
      <CalendarSettingsSheet
        open
        onOpenChange={vi.fn()}
        preferences={{ ...DEFAULT_PREFERENCES, blackoutDates: ["2026-10-16"] }}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Add a day off"), {
      target: { value: "2026-10-16" },
    });
    expect(screen.getByRole("button", { name: "Add date" })).toBeDisabled();
    expect(screen.getAllByText("2026-10-16")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
  });
});
