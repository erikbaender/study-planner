"use client";

/**
 * Switching views, without the cut.
 *
 * Today, Timeline and Outline used to replace each other between two frames.
 * That is the one transition in the app the eye cannot follow: the whole
 * content column changes at once, so there is nothing left on screen to relate
 * the new arrangement to the old one, and every switch reads as a page load.
 *
 * The outgoing view is *not* kept mounted underneath the incoming one. Two
 * timelines in the tree at the same time is the most expensive frame this app
 * can produce, and the second copy would have to build itself from nothing
 * anyway. So the fade is sequential — out, swap, in — and the swap happens in
 * the frame where nothing is visible. Each half is half the shared duration, so
 * a view change costs exactly what a disclosure or a filter change costs.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motionDuration, prefersReducedMotion } from "@/ui/motion";

type ViewFadeGate = {
  register: () => () => void;
};

const ViewFadeGateContext = createContext<ViewFadeGate | null>(null);

const noop = () => {};

/**
 * Hold the surrounding view invisible until the work that must be complete
 * before presentation has settled. The registration happens in a layout
 * effect so a hold is present before the first frame can open the gate.
 */
export function useViewFadeHold(): () => void {
  const gate = useContext(ViewFadeGateContext);
  const releaseRef = useRef<() => void>(noop);
  const release = useCallback(() => releaseRef.current(), []);

  useLayoutEffect(() => {
    releaseRef.current = gate?.register() ?? noop;
    return () => {
      releaseRef.current();
      releaseRef.current = noop;
    };
  }, [gate]);

  return release;
}

function ViewFadeGate({
  disabled,
  onReady,
  children,
}: {
  disabled: boolean;
  onReady: () => void;
  children: ReactNode;
}) {
  const holdsRef = useRef(new Set<symbol>());
  const openedRef = useRef(false);
  const open = useCallback((force = false) => {
    if (openedRef.current || (!force && holdsRef.current.size > 0)) return;
    openedRef.current = true;
    onReady();
  }, [onReady]);
  const register = useCallback(() => {
    if (openedRef.current) return noop;
    const token = Symbol("view-fade-hold");
    holdsRef.current.add(token);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holdsRef.current.delete(token);
      open();
    };
  }, [open]);
  const contextValue = useMemo(() => ({ register }), [register]);

  useLayoutEffect(() => {
    if (disabled) {
      open(true);
      return;
    }

    if (typeof requestAnimationFrame !== "function") {
      open();
      return;
    }

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => open());
    });
    // Background tabs can throttle animation frames. This guarded fallback
    // has the same purpose as the chart's timeout: do not stay hidden forever
    // when a throttled tab never reaches the settled frame sequence.
    const fallback = window.setTimeout(() => open(true), 700);
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(fallback);
    };
  }, [disabled, open]);

  return <ViewFadeGateContext.Provider value={contextValue}>{children}</ViewFadeGateContext.Provider>;
}

export function ViewFade<T extends string>({
  view,
  render,
  /**
   * Views that arrive without a fade.
   *
   * The timeline is one. It reveals itself: the chart paints hidden, positions
   * onto today, lets its range extension and the scroll correction that follows
   * settle, and only then fades its canvas in — a sequence tuned against the
   * jumps it exists to hide. A second fade wrapped around that one does not
   * compose with it. It ran on its own clock, so the view arrived and the chart
   * then finished settling in full view, which is the exact jump the chart's own
   * reveal was written to prevent. Two attempts to make the outer fade wait for
   * the inner one — a frame count, then a stability check on the viewport —
   * both still let it through, so the chart keeps the reveal it already had and
   * the outer fade stays out of its way.
   */
  instant,
}: {
  view: T;
  render: (view: T) => ReactNode;
  instant?: readonly T[];
}) {
  const [shown, setShown] = useState(view);
  const arrivesInstantly = (candidate: T) => instant?.includes(candidate) ?? false;
  // A view that arrives without a fade is also not held back on first paint.
  const [phase, setPhase] = useState<"waiting" | "out" | "in">(() =>
    arrivesInstantly(view) ? "in" : "waiting",
  );

  // Adjusted during render so the fade begins in the commit the click caused,
  // rather than a frame after it. Bounded: `phase` only becomes `out` when the
  // two views disagree, and only the timeout below moves it to the next view.
  // Someone who has asked for less motion gets the swap immediately and never
  // enters the fade at all, rather than waiting out a transition that is not
  // being drawn.
  if (view !== shown && phase !== "out") {
    // Leaving still fades, even for a view that arrives without one: the
    // outgoing view is being taken away, and that half has nothing to collide
    // with. Only the arrival is instant.
    if (prefersReducedMotion()) {
      setShown(view);
      setPhase("in");
    } else {
      setPhase("out");
    }
  }

  useEffect(() => {
    if (phase !== "out") return;
    const timer = window.setTimeout(() => {
      setShown(view);
      setPhase(prefersReducedMotion() || arrivesInstantly(view) ? "in" : "waiting");
    }, motionDuration(document.documentElement) / 2);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, view]);

  const ready = useCallback(() => {
    setPhase((current) => (current === "waiting" ? "in" : current));
  }, []);
  const reducedMotion = prefersReducedMotion();

  return (
    <div
      className="view-fade h-full"
      // `instant` rather than `in`: the outgoing half leaves this box at zero,
      // so simply marking it shown would transition it back up — a fade of the
      // whole view, which is the thing the chart must not be given. `instant`
      // restores it in one frame, with no transition to interfere.
      data-view-fade={phase !== "in" ? "out" : arrivesInstantly(shown) ? "instant" : "in"}
    >
      <ViewFadeGate key={shown} disabled={reducedMotion} onReady={ready}>
        {render(shown)}
      </ViewFadeGate>
    </div>
  );
}
