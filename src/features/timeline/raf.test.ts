import { describe, expect, it, vi } from "vitest";
import { createViewportStore } from "./chart-context";
import { createRafCoalescer } from "./raf";

function manualFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    pending.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    pending.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return {
    request,
    cancel,
    runNext() {
      const next = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) return;
      pending.delete(next[0]);
      next[1](0);
    },
  };
}

describe("createRafCoalescer", () => {
  it("publishes one latest viewport update per frame", () => {
    const frames = manualFrames();
    const viewport = createViewportStore();
    const update = vi.fn();
    viewport.subscribe(update);
    const coalescer = createRafCoalescer((day: number) =>
      viewport.setSnapshot({ from: `2026-05-${day}`, to: `2026-05-${day}` }),
    );

    coalescer.schedule(10);
    coalescer.schedule(20);
    coalescer.schedule(30);
    expect(update).not.toHaveBeenCalled();
    expect(frames.request).toHaveBeenCalledTimes(1);

    frames.runNext();
    expect(update).toHaveBeenCalledOnce();
    expect(viewport.getSnapshot()).toEqual({ from: "2026-05-30", to: "2026-05-30" });
  });

  it("cancels a queued publication", () => {
    const frames = manualFrames();
    const publish = vi.fn();
    const coalescer = createRafCoalescer(publish);

    coalescer.schedule(10);
    coalescer.cancel();
    frames.runNext();

    expect(frames.cancel).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });
});
