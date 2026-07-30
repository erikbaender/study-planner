import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProgressSlider } from "./progress-slider";

/**
 * A caller that behaves like the real one: it owns the value and only updates
 * it when the slider commits, which is what makes the draft/settled handoff
 * observable.
 */
function Harness({ onCommit, start = 40 }: { onCommit?: (value: number) => void; start?: number }) {
  const [value, setValue] = useState(start);
  return (
    <ProgressSlider
      value={value}
      max={100}
      label="Glycolysis progress"
      valueText={(units) => `${units} of 100 slides`}
      onCommit={(next) => {
        onCommit?.(next);
        setValue(next);
      }}
    />
  );
}

describe("ProgressSlider", () => {
  it("is a slider that reports where the topic is", () => {
    render(<Harness />);

    const slider = screen.getByRole("slider", { name: "Glycolysis progress" });
    expect(slider).toHaveAttribute("aria-valuenow", "40");
    expect(slider).toHaveAttribute("aria-valuemax", "100");
    expect(slider).toHaveAttribute("aria-valuetext", "40 of 100 slides");
  });

  it("moves and commits from the keyboard", async () => {
    // The control it replaced was a number field and a button. Whatever the
    // pointer can do here, the keyboard has to do as well.
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);

    const slider = screen.getByRole("slider");
    await user.click(slider);
    await user.keyboard("{ArrowRight}");

    expect(onCommit).toHaveBeenCalledWith(41);
    expect(slider).toHaveAttribute("aria-valuenow", "41");
  });

  it("commits an absolute position, not a delta", async () => {
    // The caller subtracts to get the study-log entry. If this ever reported a
    // delta instead, every log would double-count.
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} start={40} />);

    await user.click(screen.getByRole("slider"));
    await user.keyboard("{ArrowRight}{ArrowRight}");

    expect(onCommit).toHaveBeenLastCalledWith(42);
  });

  it("goes backwards, because correcting an over-log is the same gesture", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} />);

    await user.click(screen.getByRole("slider"));
    await user.keyboard("{ArrowLeft}");

    expect(onCommit).toHaveBeenCalledWith(39);
  });

  it("stops at both ends", async () => {
    const user = userEvent.setup();
    render(<Harness start={0} />);

    const slider = screen.getByRole("slider");
    await user.click(slider);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(slider).toHaveAttribute("aria-valuenow", "0");

    await user.keyboard("{End}");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    await user.keyboard("{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
  });

  it("does not commit when the value has not moved", async () => {
    // A click that lands on the current position is not a study session.
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCommit={onCommit} start={0} />);

    await user.click(screen.getByRole("slider"));
    await user.keyboard("{Home}");

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps its announced text in step with the value", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const slider = screen.getByRole("slider");
    await user.click(slider);
    await user.keyboard("{ArrowRight}");

    expect(slider).toHaveAttribute("aria-valuetext", "41 of 100 slides");
  });

  it("shows the store's value again when it changes underneath", () => {
    // The draft only outlives a commit until the repository answers. A value
    // arriving from elsewhere — a sync, an undo — must win.
    const { rerender } = render(
      <ProgressSlider value={40} max={100} label="Glycolysis progress" onCommit={vi.fn()} />,
    );
    rerender(
      <ProgressSlider value={72} max={100} label="Glycolysis progress" onCommit={vi.fn()} />,
    );

    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "72");
  });

  it("clamps an over-logged topic to its own scale", () => {
    // The domain allows completedUnits > totalUnits; a thumb past the end of
    // the track is not a way to show it.
    render(<ProgressSlider value={130} max={100} label="Glycolysis progress" onCommit={vi.fn()} />);

    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "100");
  });

  it("does not impose a width on its row", () => {
    // Twice now a base `w-full` on a bar has beaten the caller's `w-28`/`w-48`
    // — Tailwind emits `w-full` last, so authoring order does not save you —
    // and squeezed the topic's name out of existence. jsdom applies no
    // stylesheet, so the class list is the only thing there is to assert on.
    const { container } = render(
      <ProgressSlider
        value={40}
        max={100}
        label="Glycolysis progress"
        onCommit={vi.fn()}
        className="w-48"
      />,
    );

    const root = container.firstElementChild!;
    expect(root.className).toContain("w-48");
    expect(root.className).not.toContain("w-full");
  });

  it("does not respond when disabled", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(
      <ProgressSlider value={40} max={100} label="Glycolysis progress" onCommit={onCommit} disabled />,
    );

    await user.click(screen.getByRole("slider"));
    await user.keyboard("{ArrowRight}");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
