import type { InputHint } from "@/features/workspace/hints";

/* ─── The three buttons ─────────────────────────────────────────────────────
 *
 * There is no mode any more. A View/Edit switch made the same press mean two
 * different things depending on a control at the other end of the toolbar, and
 * the workaround it needed — the right button as a held modifier — spent the
 * one button a chart like this owes to a context menu. Both are gone. Each
 * button does one thing, everywhere in the chart, always:
 *
 * - **Left** selects, and drags what is selected. On a bar: press and release
 *   without travelling and it is selected; travel and every selected bar moves
 *   with it, or resizes if the press landed on an edge. On empty canvas: a
 *   rectangle, which selects everything it touches, and a release that never
 *   travelled clears the selection.
 * - **Middle** moves the chart, from anywhere — on a bar, the gutter, empty
 *   canvas. Panning is navigation, so it must never depend on finding somewhere
 *   safe to put the pointer down.
 * - **Right** opens the menu for whatever is under it: a bar offers to delete
 *   itself, empty lane offers a block on the day that was clicked.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * And the same thing said in the toolbar, always.
 *
 * The chart used to carry one line of prose describing the mode it was in. The
 * hint bar replaces it: what each button does, in the context the pointer is
 * actually in, in the one place in the app that answers that question. See
 * `workspace/hints.ts`.
 */
export const CHART_HINTS: readonly InputHint[] = [
  { button: "left", label: "Box select", drag: true },
  { button: "middle", label: "Pan view", drag: true },
  { button: "right", label: "Actions" },
];

export function chartSelectedHints(keyboardMode: "mac" | "windows"): readonly InputHint[] {
  return [
    CHART_HINTS[0],
    { button: "left", label: "Extend selection", modifier: "Shift", drag: true },
    {
      button: "left",
      label: "Subtract selection",
      modifier: keyboardMode === "mac" ? "⌘" : "Ctrl",
      drag: true,
    },
    CHART_HINTS[1],
    CHART_HINTS[2],
  ];
}

export const BAR_HINTS: readonly InputHint[] = [
  { button: "left", label: "Select" },
  { button: "left", label: "Move", drag: true },
  { button: "right", label: "Actions" },
];

export function barSelectedHints(keyboardMode: "mac" | "windows"): readonly InputHint[] {
  return [
    BAR_HINTS[0],
    BAR_HINTS[1],
    { button: "left", label: "Extend selection", modifier: "Shift" },
    {
      button: "left",
      label: "Subtract selection",
      modifier: keyboardMode === "mac" ? "⌘" : "Ctrl",
    },
    BAR_HINTS[2],
  ];
}

export const RULER_HINTS: readonly InputHint[] = [
  { button: "left", label: "Pan view", drag: true },
];

export const HANDLE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Resize", drag: true },
  { button: "middle", label: "Pan view", drag: true },
  { button: "right", label: "Actions" },
];

export const MOVE_GESTURE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Move", drag: true },
];

export const RESIZE_GESTURE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Resize", drag: true },
];

export const PAN_GESTURE_HINTS: readonly InputHint[] = [
  { button: "middle", label: "Pan view", drag: true },
];
