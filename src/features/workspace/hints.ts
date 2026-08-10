"use client";

/**
 * What the mouse does, here, now.
 *
 * The app used to explain itself with hover tooltips and one line of prose in
 * the timeline's own toolbar: help that is only there once you have already
 * guessed where to put the pointer, and that says nothing at all about the two
 * buttons a chart with drag gestures actually depends on. Blender's answer is a
 * permanent bar of input glyphs — left, middle, right, each followed by the verb
 * it performs *in the current context* — and it is the reason a modal editor
 * with a hundred gestures is learnable at all.
 *
 * So there is one bar, in the toolbar, owned by the central view. Two layers
 * feed it while the pointer is inside that view:
 *
 * - **View hints** are what the visible view does, set by the view itself for as
 *   long as it is on screen and the view is hovered.
 * - **Context hints** are what the thing under the pointer does, pushed on enter
 *   and dropped on leave. A bar in the timeline overrides the chart's own hints
 *   while the pointer is on it, exactly as Blender's bar changes over an object.
 *
 * Toolbar and side-panel controls deliberately publish nothing. A store rather
 * than context keeps pointer updates deep in the chart from re-rendering it.
 */

import { useEffect } from "react";
import { create } from "zustand";
import type { PointerButton } from "@/ui";

export type InputHint = {
  button: PointerButton;
  /** What it does — a verb, not a sentence. */
  label: string;
  /** Held while pressing, printed before the glyph: "Shift". */
  modifier?: string;
  /** A press that has to travel to mean anything. */
  drag?: boolean;
};

type HintState = {
  active: boolean;
  interaction: boolean;
  view: readonly InputHint[];
  context: readonly InputHint[] | null;
  setActive: (active: boolean) => void;
  setViewHints: (hints: readonly InputHint[]) => void;
  setContextHints: (hints: readonly InputHint[] | null) => void;
};

const NONE: readonly InputHint[] = [];

/** A context hint must stay focused this long before it replaces the view hint. */
export const CONTEXT_HINT_DELAY_MS = 200;

let pendingContext: readonly InputHint[] | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;
let interactionContext: readonly InputHint[] | null = null;
let pointerInsideScope = false;
let pointerInsideExcludedScope = false;

export const useHintStore = create<HintState>((set) => ({
  active: false,
  interaction: false,
  view: NONE,
  context: null,
  setActive: (active) => set({ active }),
  setViewHints: (view) => set({ view }),
  setContextHints: (context) => set({ context }),
}));

/** What the bar should print: the pointer's context if it has one, else the view's. */
export function getActiveHints(): readonly InputHint[] {
  const state = useHintStore.getState();
  return state.active ? (state.context ?? state.view) : NONE;
}

export function subscribeToActiveHints(
  listener: (hints: readonly InputHint[], immediate: boolean) => void,
) {
  return useHintStore.subscribe((state) => {
    listener(state.active ? (state.context ?? state.view) : NONE, state.interaction);
  });
}

/** Only the central view owns the hint bar; chrome and side panels leave it empty. */
export const hintScope = {
  onPointerEnter: () => {
    pointerInsideScope = true;
    useHintStore.getState().setActive(true);
  },
  onPointerLeave: () => {
    pointerInsideScope = false;
    // A drag can leave the element that started it (the ruler is the common
    // case) while the gesture is still the only meaningful context.  Do not
    // let the canvas' leave event blank the bar in the middle of that drag.
    if (interactionContext !== null) return;
    pendingContext = null;
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    if (clearTimer !== null) clearTimeout(clearTimer);
    pendingTimer = null;
    clearTimer = null;
    useHintStore.setState({ active: false, context: null });
  },
};

/** A panel inside a view that should not activate the view's hint bar. */
export const hintExcludedScope = {
  onPointerEnter: () => {
    pointerInsideExcludedScope = true;
    if (interactionContext !== null) return;
    useHintStore.getState().setActive(false);
  },
  onPointerLeave: () => {
    pointerInsideExcludedScope = false;
    if (interactionContext !== null) return;
    useHintStore.getState().setActive(true);
  },
};

/** Lock the hint bar to the gesture that is currently being dragged. */
export function setInteractionHints(hints: readonly InputHint[] | null) {
  interactionContext = hints;
  if (hints === null) {
    useHintStore.setState({
      active: pointerInsideScope && !pointerInsideExcludedScope,
      interaction: false,
    });
    setContextHints(null);
    return;
  }
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  if (clearTimer !== null) clearTimeout(clearTimer);
  pendingTimer = null;
  clearTimer = null;
  pendingContext = hints;
  // Activating here matters when the press starts on a target whose pointer
  // enter has not reached React yet (and makes the gesture hint immediate).
  useHintStore.setState({ active: true, interaction: true });
  useHintStore.getState().setContextHints(hints);
}

/**
 * Publish a view's hints for as long as it is mounted.
 *
 * `hints` is expected to be a module-level constant: it is the effect's
 * dependency, and a fresh array per render would republish on every one of them.
 */
export function useViewHints(hints: readonly InputHint[]) {
  useEffect(() => {
    useHintStore.getState().setViewHints(hints);
    return () => {
      // Only if nothing else has claimed the bar since. React runs this cleanup
      // before the incoming view's effect, but an unrelated late unmount must
      // not blank the hints the visible view has already set.
      if (useHintStore.getState().view === hints) useHintStore.getState().setViewHints(NONE);
    };
  }, [hints]);
}

export function setContextHints(hints: readonly InputHint[] | null) {
  if (interactionContext !== null) return;
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }

  if (hints === null) {
    pendingContext = null;
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    // Keep the current hint while the pointer crosses a gap. If another target
    // is entered during this window it cancels the clear and starts its own
    // short dwell, so the bar never flashes back to the view hint between
    // adjacent targets.
    clearTimer = setTimeout(() => {
      clearTimer = null;
      if (pendingContext === null) useHintStore.getState().setContextHints(null);
    }, CONTEXT_HINT_DELAY_MS);
    return;
  }

  // Focus and pointer-enter can both announce the same target. Do not restart
  // its dwell timer when that happens.
  if (pendingContext === hints || useHintStore.getState().context === hints) return;

  pendingContext = hints;
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    if (pendingContext === hints) useHintStore.getState().setContextHints(hints);
  }, CONTEXT_HINT_DELAY_MS);
}

/**
 * Handlers that make an element describe itself in the bar.
 *
 * Focus counts as well as hover, so tabbing through the toolbar reads the same
 * as pointing at it. Leaving clears unconditionally: the pointer leaves the old
 * element before it enters the new one, so the next element's own enter wins.
 */
export function hintTarget(hints: readonly InputHint[]) {
  const enter = () => setContextHints(hints);
  const leave = () => setContextHints(null);
  return { onPointerEnter: enter, onPointerLeave: leave, onFocus: enter, onBlur: leave };
}

/** The commonest hint of all: one button, one verb. */
export function clickHint(label: string, button: PointerButton = "left"): readonly InputHint[] {
  return [{ button, label }];
}
