import type { PointerEvent as ReactPointerEvent } from "react";
import type { Span } from "./blocks";
import type { Chart } from "./chart-context";
import {
  MOVE_GESTURE_HINTS,
  PAN_GESTURE_HINTS,
  RESIZE_GESTURE_HINTS,
  RULER_HINTS,
} from "./hints";
import {
  beginReadoutManipulation,
  endReadoutManipulation,
  hideReadout,
  showReadout,
} from "./readout";
import { applyDelta, clampDelta, groupRange, type BarTarget, type DragMode } from "./selection";
import { daysMoved } from "./geometry";
import { stopScrollAnimation } from "@/ui/motion";
import { setInteractionHints } from "@/features/workspace/hints";
import { createRafCoalescer } from "./raf";

/** Below this the pointer was steadying itself, not dragging. The old code had no threshold at all. */
export const DRAG_THRESHOLD_PX = 4;
export const LEFT = 0;
export const MIDDLE = 1;

type GestureOptions = {
  originX: number;
  originY: number;
  threshold: number;
  onMove: (pointer: PointerEvent, dragged: boolean) => void;
  onFinish: (pointer: PointerEvent, dragged: boolean) => void;
  onCancel?: () => void;
  cleanup?: () => void;
};

type GestureSession = { cancel: () => void };
let activeGesture: GestureSession | null = null;

/**
 * A gesture belongs to its pointer, not to whichever pointer event happens to
 * arrive next. Keeping the session here gives every affordance the same
 * finish, cancellation and unmount paths.
 */
export function startGestureSession(
  event: Pick<ReactPointerEvent, "pointerId" | "button">,
  chart: Chart,
  options: GestureOptions,
): GestureSession {
  activeGesture?.cancel();

  const pointerId = event.pointerId;
  const button = event.button;
  let dragged = false;
  let ended = false;

  const belongsToSession = (pointer: Pick<PointerEvent, "pointerId">) => pointer.pointerId === pointerId;
  const teardown = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancelEvent);
    window.removeEventListener("lostpointercapture", lostCapture);
    if (activeGesture === session) activeGesture = null;
    options.cleanup?.();
    setInteractionHints(null);
    hideReadout();
    chart.drafts.set(null);
  };
  const cancel = () => {
    if (ended) return;
    ended = true;
    teardown();
    options.onCancel?.();
  };
  const move = (pointer: PointerEvent) => {
    if (!belongsToSession(pointer)) return;
    if (
      !dragged &&
      Math.abs(pointer.clientX - options.originX) < options.threshold &&
      Math.abs(pointer.clientY - options.originY) < options.threshold
    ) {
      return;
    }
    dragged = true;
    options.onMove(pointer, dragged);
  };
  const up = (pointer: PointerEvent) => {
    if (!belongsToSession(pointer) || pointer.button !== button) return;
    ended = true;
    teardown();
    options.onFinish(pointer, dragged);
  };
  const cancelEvent = (pointer: PointerEvent) => {
    if (!belongsToSession(pointer)) return;
    cancel();
  };
  const lostCapture = (event: Event) => {
    const eventPointerId = (event as Event & { pointerId?: number }).pointerId;
    if (eventPointerId !== undefined && eventPointerId !== pointerId) return;
    cancel();
  };
  const session: GestureSession = { cancel };
  activeGesture = session;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancelEvent);
  window.addEventListener("lostpointercapture", lostCapture);
  return session;
}

/** Dispose the chart's one active pointer gesture, if it has one. */
export function cancelActiveGesture(): void {
  activeGesture?.cancel();
}

/**
 * A drag is not a click.
 *
 * The chart can be grabbed anywhere, including on top of real buttons — a
 * course header, an off-screen marker — and the browser still reports a click
 * on whatever the press started on once the hand comes up. Dragging the canvas
 * from a course name used to collapse the course, which reads as the chart
 * fighting the gesture. The one click a completed pan produces is eaten on
 * the capture phase, before the button under it hears about it; the timeout is
 * for the rare drag that ends where no click follows, so the guard never
 * survives into someone's next press.
 */
export function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

/**
 * Grab-scrolling, on the middle button.
 *
 * The canvas moves under the pointer rather than the pointer picking anything
 * up, and the gesture is identical wherever it starts — on a bar, on a course
 * name, on empty canvas. That is the whole reason it is the middle button:
 * navigation that has to find somewhere safe to press is navigation you have
 * to think about.
 */
export function startPan(event: ReactPointerEvent, chart: Chart) {
  const element = chart.scroller.current;
  if (!element) return;
  cancelActiveGesture();
  event.preventDefault();
  event.stopPropagation();

  const originX = event.clientX;
  const originY = event.clientY;
  let lastX = event.clientX;
  let lastY = event.clientY;

  /**
   * Frame to frame, not press to now.
   *
   * The offset used to be recomputed from the position of the press — and the
   * chart moves the offset out from under a drag by itself: reaching the left
   * of the canvas grows it backward and shifts `scrollLeft` to hold the picture
   * still (see `pendingShiftRef`). Against an absolute origin the next move
   * undid that shift, which put the chart back where it had been, which
   * triggered the extension again. Dragging left simply stopped working, right
   * where the canvas has to grow. Applying each frame's delta instead means
   * anything else that legitimately moves the offset is left alone.
   */
  startGestureSession(event, chart, {
    originX,
    originY,
    threshold: DRAG_THRESHOLD_PX,
    onMove(pointer) {
      const deltaX = pointer.clientX - lastX;
      const deltaY = pointer.clientY - lastY;
      if (deltaX) element.scrollLeft -= deltaX;
      if (deltaY) element.scrollTop -= deltaY;
      lastX = pointer.clientX;
      lastY = pointer.clientY;
    },
    onFinish(_pointer, dragged) {
      if (dragged) swallowNextClick();
    },
    cleanup: () => {
      delete element.dataset.timelinePanning;
    },
  });
  setInteractionHints(PAN_GESTURE_HINTS);
  // Show the closed hand at press time, before the pointer has moved enough
  // to qualify as a drag.
  element.dataset.timelinePanning = "true";
  // A hand on the chart outranks anything it was doing by itself.
  stopScrollAnimation(element);
}

/** The date ruler is its own horizontal drag affordance; it never pans vertically. */
export function startRulerPan(event: ReactPointerEvent, chart: Chart) {
  const element = chart.scroller.current;
  if (!element) return;
  cancelActiveGesture();
  event.preventDefault();
  event.stopPropagation();

  let lastX = event.clientX;
  startGestureSession(event, chart, {
    originX: event.clientX,
    originY: event.clientY,
    threshold: 0,
    onMove(pointer) {
      const deltaX = pointer.clientX - lastX;
      if (deltaX) element.scrollLeft -= deltaX;
      lastX = pointer.clientX;
    },
    onFinish: () => {},
    cleanup: () => {
      delete element.dataset.timelinePanning;
    },
  });
  setInteractionHints(RULER_HINTS);
  element.dataset.timelinePanning = "true";
}

/* ─── The left button ───────────────────────────────────────────────────── */

/**
 * A press on a bar.
 *
 * Blender's rule, because it is the one that never surprises: pressing an
 * unselected bar selects it, and only it, before anything moves — so a drag
 * always moves what you can see is selected. Pressing one that is already
 * selected leaves the selection alone, which is what makes dragging a group
 * possible at all. Shift defers to the release and toggles.
 *
 * Below the threshold nothing has moved, and the release is the selection.
 */
export function startBarGesture(
  event: ReactPointerEvent,
  chart: Chart,
  mode: DragMode,
  blockId: string,
) {
  cancelActiveGesture();
  event.stopPropagation();
  event.preventDefault();

  const scroller = chart.scroller.current;
  if (!scroller) return;
  beginReadoutManipulation();
  const extend = event.shiftKey;
  const subtract = event.ctrlKey || event.metaKey;
  // Selected on the press, not on the release: a drag has to move what you can
  // already see is selected, and the bar is drawn with its accent outline for
  // the whole gesture rather than acquiring one once the hand comes up. A
  // cancelled gesture puts the previous selection back, so the press is only
  // committed by a release.
  const before = chart.selection.getSnapshot();
  const selectsOnPress = !extend && !subtract && !before.includes(blockId);
  if (selectsOnPress) chart.select([blockId]);

  const ids = chart.selection.getSnapshot();
  const registry = chart.registry.current;
  // The bar under the hand always travels, even when the press is a
  // shift-extend that has not been applied yet.
  const targets: BarTarget[] = [];
  const seen = new Set<string>();
  for (const id of ids.includes(blockId) ? ids : [...ids, blockId]) {
    const target = registry.get(id);
    if (target && !seen.has(id)) {
      seen.add(id);
      targets.push(target);
    }
  }
  const limits = groupRange(mode, targets, seen);

  let days = 0;
  const publishDraft = (pointer: PointerEvent) => {
    days = clampDelta(limits, daysMoved(pointer.clientX - event.clientX, chart.zoomRef.current));

    const spans = new Map<string, Span>();
    for (const { block } of targets) spans.set(block.id, applyDelta(mode, block, days));
    chart.drafts.set(spans);
    const grabbed = spans.get(blockId);
    if (grabbed) showReadout({ x: pointer.clientX, y: pointer.clientY, ...grabbed });
  };
  const draftFrame = createRafCoalescer(publishDraft);
  startGestureSession(event, chart, {
    originX: event.clientX,
    originY: event.clientY,
    threshold: DRAG_THRESHOLD_PX,
    onMove(pointer) {
      scroller.dataset.timelineDragging = "true";
      // Pointer events can arrive several times between paints; the readout
      // and every draft bar only need the position the next frame will show.
      draftFrame.schedule(pointer);
    },
    onFinish(pointer, dragged) {
      if (!dragged) {
        // A tap. Shift toggles this bar in or out of the selection, while
        // Ctrl/⌘ removes it without disturbing the rest of the selection.
        if (subtract) {
          const current = chart.selection.getSnapshot();
          if (current.includes(blockId)) {
            chart.select(current.filter((id) => id !== blockId));
          }
        } else if (extend) {
          const current = chart.selection.getSnapshot();
          chart.select(
            current.includes(blockId)
              ? current.filter((id) => id !== blockId)
              : [...current, blockId],
          );
        } else {
          // A new bar was already selected on press so a drag can begin with
          // the right target. Only a bar that was selected before the tap is
          // being toggled off; selecting it again would toggle the inspector
          // selection back immediately.
          if (before.includes(blockId)) chart.select(before.filter((id) => id !== blockId));
        }
        return;
      }

      // The release is authoritative even when it arrived before the queued
      // frame. Commit its position rather than the last draft that painted.
      days = clampDelta(limits, daysMoved(pointer.clientX - event.clientX, chart.zoomRef.current));
      if (days === 0 || !chart.repository) return;
      const repository = chart.repository;
      chart.run(
        Promise.all(
          targets.map(({ block }) => {
            const next = applyDelta(mode, block, days);
            return repository.updateStudyBlock(block.id, {
              startDate: next.startDate,
              endDate: next.endDate,
              plannedUnits: block.plannedUnits,
            });
          }),
        ),
      );
    },
    onCancel: () => {
      if (selectsOnPress) chart.select(before);
    },
    cleanup: () => {
      draftFrame.cancel();
      delete scroller.dataset.timelineDragging;
      delete scroller.dataset.timelineResizing;
      endReadoutManipulation();
    },
  });
  if (mode === "start" || mode === "end") scroller.dataset.timelineResizing = "true";
  setInteractionHints(mode === "move" ? MOVE_GESTURE_HINTS : RESIZE_GESTURE_HINTS);
}

/**
 * A press on empty canvas: the rubber band.
 *
 * Empty canvas used to draw a new block, which meant the one gesture people try
 * first — sweeping across a chart to see what is in a fortnight — silently
 * created work. Creating is now a deliberate act on the right button, and the
 * sweep does what a sweep does everywhere else.
 *
 * Hit-testing is done against the DOM rather than against the plan: the band is
 * a rectangle on the screen, the bars are elements on the screen, and asking
 * the browser which of them overlap is both exact and free of the geometry the
 * scroll offset, the zoom and the gutter would otherwise have to be folded into.
 */
export function startBoxSelect(event: ReactPointerEvent, chart: Chart, band: HTMLElement | null) {
  const scroller = chart.scroller.current;
  if (!scroller) return;
  cancelActiveGesture();
  event.preventDefault();

  const originX = event.clientX;
  const originY = event.clientY;
  const extend = event.shiftKey;
  const subtract = event.ctrlKey || event.metaKey;

  startGestureSession(event, chart, {
    originX,
    originY,
    threshold: DRAG_THRESHOLD_PX,
    onMove(pointer) {
      if (!band) return;
      // Written straight to the element. The band moves with the pointer, and a
      // state update per frame would reconcile every lane in the plan.
      band.style.left = `${Math.min(originX, pointer.clientX)}px`;
      band.style.top = `${Math.min(originY, pointer.clientY)}px`;
      band.style.width = `${Math.abs(pointer.clientX - originX)}px`;
      band.style.height = `${Math.abs(pointer.clientY - originY)}px`;
      band.dataset.visible = "true";
    },
    onFinish(pointer, dragged) {
      if (!dragged) {
        if (!extend && !subtract) chart.clearSelection();
        return;
      }
      swallowNextClick();

      const left = Math.min(originX, pointer.clientX);
      const right = Math.max(originX, pointer.clientX);
      const top = Math.min(originY, pointer.clientY);
      const bottom = Math.max(originY, pointer.clientY);

      const hit: string[] = [];
      const hitSet = new Set<string>();
      for (const element of scroller.querySelectorAll<HTMLElement>("[data-block-id]")) {
        const id = element.dataset.blockId;
        if (!id || hitSet.has(id)) continue;
        const box = element.getBoundingClientRect();
        // Touching counts, as it does in Blender: a band drawn *over* a bar
        // without swallowing it whole has still pointed at it.
        if (box.right >= left && box.left <= right && box.bottom >= top && box.top <= bottom) {
          hitSet.add(id);
          hit.push(id);
        }
      }

      const current = chart.selection.getSnapshot();
      if (subtract) {
        chart.select(current.filter((id) => !hitSet.has(id)));
      } else if (extend) {
        const currentSet = new Set(current);
        chart.select([...current, ...hit.filter((id) => !currentSet.has(id))]);
      } else {
        chart.select(hit);
      }
    },
    cleanup: () => {
      if (band) band.dataset.visible = "false";
    },
  });
}
