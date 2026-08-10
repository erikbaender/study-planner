/** Keep high-rate input work to the latest value the next frame can paint. */
export function createRafCoalescer<T>(publish: (value: T) => void) {
  let frame: number | null = null;
  let latest: T | undefined;

  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    latest = undefined;
  };

  return {
    schedule(value: T) {
      latest = value;
      if (frame !== null) return;
      if (typeof requestAnimationFrame !== "function") {
        const current = latest;
        latest = undefined;
        publish(current as T);
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        const current = latest;
        latest = undefined;
        if (current !== undefined) publish(current);
      });
    },
    cancel,
  };
}
