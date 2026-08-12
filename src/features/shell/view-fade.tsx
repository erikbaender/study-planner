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

import { useEffect, useState, type ReactNode } from "react";
import { motionDuration, prefersReducedMotion } from "@/ui/motion";

export function ViewFade<T extends string>({
  view,
  render,
}: {
  view: T;
  render: (view: T) => ReactNode;
}) {
  const [shown, setShown] = useState(view);
  const [fading, setFading] = useState(false);

  // Adjusted during render so the fade begins in the commit the click caused,
  // rather than a frame after it. Bounded: `fading` only turns on when the two
  // disagree, and only the timeout below turns it off again. Someone who has
  // asked for less motion gets the swap immediately and never enters the fade
  // at all, rather than waiting out a transition that is not being drawn.
  if (view !== shown && !fading) {
    if (prefersReducedMotion()) setShown(view);
    else setFading(true);
  }

  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(() => {
      setShown(view);
      setFading(false);
    }, motionDuration(document.documentElement) / 2);
    return () => window.clearTimeout(timer);
  }, [fading, view]);

  return (
    <div className="view-fade h-full" data-view-fade={fading ? "out" : "in"}>
      {render(shown)}
    </div>
  );
}
