import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useViewFadeHold, ViewFade } from "./view-fade";

function HoldingView() {
  const release = useViewFadeHold();
  return <button onClick={release}>Release</button>;
}

describe("ViewFade", () => {
  it("holds an incoming view until its work releases the gate", () => {
    const { container, getByRole } = render(
      <ViewFade view="timeline" render={() => <HoldingView />} />,
    );

    const fade = container.firstElementChild!;
    expect(fade).toHaveAttribute("data-view-fade", "out");

    fireEvent.click(getByRole("button", { name: "Release" }));

    expect(fade).toHaveAttribute("data-view-fade", "in");
  });

  it("opens a view without a hold after layout has had a frame to settle", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { container } = render(<ViewFade view="today" render={() => <div>Today</div>} />);
    const fade = container.firstElementChild!;
    expect(fade).toHaveAttribute("data-view-fade", "out");

    act(() => callbacks.shift()!(0));
    expect(fade).toHaveAttribute("data-view-fade", "out");
    act(() => callbacks.shift()!(0));

    expect(fade).toHaveAttribute("data-view-fade", "in");
  });
});
