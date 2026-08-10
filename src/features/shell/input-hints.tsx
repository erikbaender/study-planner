"use client";

/**
 * The hint bar.
 *
 * Centred in the toolbar, showing what the three mouse buttons do only while
 * the central view is hovered. See `workspace/hints.ts` for the scope rules.
 *
 * Kept out of the toolbar's own flex row and centred against the *window*
 * instead: the controls either side are of unequal width, and a hint that
 * drifted with them would not read as a fixed place to look. Its presentation
 * slot also has a stable width, so changing copy cannot shift the toolbar. It
 * is inert to the pointer so a press still lands on the real control beneath.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DragIcon, MouseButtonIcon } from "@/ui";
import {
  getActiveHints,
  subscribeToActiveHints,
  type InputHint,
} from "@/features/workspace/hints";

export function InputHintBar() {
  const [displayed, setDisplayed] = useState(getActiveHints);
  const [visible, setVisible] = useState(() => getActiveHints().length > 0);
  const displayedRef = useRef(displayed);
  const visibleRef = useRef(visible);
  const pendingRef = useRef(displayed);
  const fadingOutRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);

  const showPending = useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);

    const next = pendingRef.current;
    displayedRef.current = next;
    setDisplayed(next);
    if (next.length === 0) return;

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      frameRef.current = null;
      revealTimerRef.current = null;
      visibleRef.current = true;
      setVisible(true);
    };
    frameRef.current = window.requestAnimationFrame(reveal);
    // requestAnimationFrame may be throttled in a background or embedded tab.
    // This is deliberately longer than one paint, so the hidden content is
    // committed before opacity changes.
    revealTimerRef.current = window.setTimeout(reveal, 48);
  }, []);

  const finishFadeOut = useCallback(() => {
    if (!fadingOutRef.current) return;
    fadingOutRef.current = false;
    if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = null;
    showPending();
  }, [showPending]);

  const transitionTo = useCallback((hints: readonly InputHint[], immediate = false) => {
    pendingRef.current = hints;
    if (immediate) {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
      fadingOutRef.current = false;
      displayedRef.current = hints;
      visibleRef.current = hints.length > 0;
      setDisplayed(hints);
      setVisible(hints.length > 0);
      return;
    }
    if (sameHints(displayedRef.current, hints)) {
      // Re-entering the same scope while it is fading out should reverse the
      // opacity transition from its current value, not wait for the old exit.
      if (hints.length > 0 && !visibleRef.current) {
        fadingOutRef.current = false;
        if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
        visibleRef.current = true;
        setVisible(true);
      }
      return;
    }

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayedRef.current = hints;
      visibleRef.current = hints.length > 0;
      setDisplayed(hints);
      setVisible(hints.length > 0);
      return;
    }

    if (visibleRef.current) {
      fadingOutRef.current = true;
      visibleRef.current = false;
      setVisible(false);
      // transitionend is the normal completion path. The timer covers hidden
      // tabs and interrupted style recalculation, where browsers may omit it.
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = window.setTimeout(finishFadeOut, 240);
    } else if (!fadingOutRef.current) {
      showPending();
    }
  }, [finishFadeOut, showPending]);

  useEffect(() => subscribeToActiveHints(transitionTo), [transitionTo]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    },
    [],
  );

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 flex justify-center"
    >
      <div className="flex w-[32rem] max-w-[46vw] justify-center overflow-hidden text-caption text-tertiary">
        <HintGroup
          hints={displayed}
          className="flex items-center gap-3 whitespace-nowrap input-hint-fade"
          visible={visible}
          onFadeOut={finishFadeOut}
        />
      </div>
    </div>
  );
}

function HintGroup({
  hints,
  className,
  visible,
  onFadeOut,
}: {
  hints: readonly InputHint[];
  className: string;
  visible: boolean;
  onFadeOut: () => void;
}) {
  return (
    <div
      className={className}
      style={{ opacity: visible ? 1 : 0 }}
      onTransitionEnd={(event) => {
        if (event.propertyName === "opacity" && !visible) onFadeOut();
      }}
    >
      {hints.map((hint) => (
        <Hint key={`${hint.button}:${hint.modifier ?? ""}:${hint.label}`} hint={hint} />
      ))}
    </div>
  );
}

function sameHints(left: readonly InputHint[], right: readonly InputHint[]) {
  return (
    left.length === right.length &&
    left.every(
      (hint, index) =>
        hint.button === right[index]?.button &&
        hint.label === right[index]?.label &&
        hint.modifier === right[index]?.modifier &&
        hint.drag === right[index]?.drag,
    )
  );
}

function Hint({ hint }: { hint: InputHint }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      {hint.modifier ? <span className="font-medium text-secondary">{hint.modifier}</span> : null}
      <MouseButtonIcon button={hint.button} className="text-secondary" />
      {hint.drag ? <DragIcon className="text-secondary" /> : null}
      <span>{hint.label}</span>
    </span>
  );
}
