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
}: {
  view: T;
  render: (view: T) => ReactNode;
}) {
  const [shown, setShown] = useState(view);
  const [phase, setPhase] = useState<"waiting" | "out" | "in">("waiting");

  // Adjusted during render so the fade begins in the commit the click caused,
  // rather than a frame after it. Bounded: `phase` only becomes `out` when the
  // two views disagree, and only the timeout below moves it to the next view.
  // Someone who has asked for less motion gets the swap immediately and never
  // enters the fade at all, rather than waiting out a transition that is not
  // being drawn.
  if (view !== shown && phase !== "out") {
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
      setPhase(prefersReducedMotion() ? "in" : "waiting");
    }, motionDuration(document.documentElement) / 2);
    return () => window.clearTimeout(timer);
  }, [phase, view]);

  const ready = useCallback(() => {
    setPhase((current) => (current === "waiting" ? "in" : current));
  }, []);
  const reducedMotion = prefersReducedMotion();

  return (
    <div className="view-fade h-full" data-view-fade={phase === "in" ? "in" : "out"}>
      <ViewFadeGate key={shown} disabled={reducedMotion} onReady={ready}>
        {render(shown)}
      </ViewFadeGate>
    </div>
  );
}
