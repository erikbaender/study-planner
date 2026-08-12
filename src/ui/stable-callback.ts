"use client";

/**
 * A callback whose identity never changes, and whose body is always the latest.
 *
 * The lists in this app are long — a semester is ninety topic rows — and the
 * rows are memoized so that selecting one re-renders one. That only works if
 * every prop a row receives is stable, and the handlers are the props that
 * never are: a parent writing `onSelect={(topic) => select(course, topic)}`
 * hands down a new function on every render, which defeats `memo` completely
 * and turns one click into ninety reconciliations. Measured on the outline, it
 * was the difference between a frame and half a second.
 *
 * The alternative — asking every caller up the tree to `useCallback` — only
 * works if all of them remember, and one that forgets silently undoes the work
 * of the rest. This keeps the fix where the list is.
 *
 * The ref is written during layout, so an event handled in the same commit runs
 * the version of the callback that commit rendered. Do not call the returned
 * function during render; it is for events and effects.
 */

import { useCallback, useLayoutEffect, useRef } from "react";

export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);

  useLayoutEffect(() => {
    latest.current = callback;
  });

  return useCallback((...args: Args) => latest.current(...args), []);
}
