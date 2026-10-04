import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { course as makeCourse, topic } from "@/test/factories";
import { TopicCreationSheet } from "./topic-creation-sheet";

describe("TopicCreationSheet bulk mode", () => {
  it("requires correcting an unknown unit before adding and accepts German aliases", async () => {
    const onCreateMany = vi.fn();
    const user = userEvent.setup();
    render(
      <TopicCreationSheet
        open
        onOpenChange={vi.fn()}
        course={makeCourse()}
        onCreate={vi.fn()}
        onCreateMany={onCreateMany}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Paste a list" }));
    const outline = screen.getByLabelText("Outline");
    await user.type(outline, "Anatomy — 30 chapters");

    expect(screen.getByRole("alert")).toHaveTextContent(/unknown unit "chapters".*default slides/i);
    expect(screen.getByRole("button", { name: "Add 1 topic" })).toBeDisabled();
    expect(onCreateMany).not.toHaveBeenCalled();

    await user.clear(outline);
    await user.type(outline, "Anatomy — 30 Seiten");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add 1 topic" }));

    expect(onCreateMany).toHaveBeenCalledWith([
      { name: "Anatomy", unit: "pages", totalUnits: 30 },
    ]);
  });

  it("labels copied existing topics as additive and requires duplicate acknowledgment", async () => {
    const onCreateMany = vi.fn();
    const user = userEvent.setup();
    render(
      <TopicCreationSheet
        open
        onOpenChange={vi.fn()}
        course={makeCourse({ topics: [topic({ name: "Cell biology", totalUnits: 30 })] })}
        onCreate={vi.fn()}
        onCreateMany={onCreateMany}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Paste a list" }));
    await user.click(screen.getByRole("button", { name: "Copy existing topics into list" }));

    expect(screen.getByText(/adding this list will create duplicate topics: cell biology/i)).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add 1 topic" });
    expect(add).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Add these duplicate topics" }));
    expect(add).toBeEnabled();
    await user.click(add);

    expect(onCreateMany).toHaveBeenCalledWith([
      { name: "Cell biology", unit: "slides", totalUnits: 30 },
    ]);
  });
});
