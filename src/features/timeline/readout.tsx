import { clsx } from "clsx";
import { createPortal } from "react-dom";
import { forwardRef, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { differenceInDays, type IsoDate } from "@/domain";
import { shortDate } from "./geometry";

/** Where the pointer is, and what the drag under it currently means. */
type Readout = { x: number; y: number; startDate: IsoDate; endDate: IsoDate };

/**
 * The dates under a drag, at the pointer.
 *
 * Fixed rather than absolute so it is never clipped by the scroller, and offset
 * above the cursor so it does not cover the bar it is describing.
 *
 * One element for the whole chart, written to directly. A drag now moves a whole
 * selection, so the readout cannot belong to a bar; and it follows the pointer,
 * so it cannot be React state — an update per frame would reconcile every lane
 * in the plan to move a caption.
 */
let readoutElement: HTMLElement | null = null;

export const TimelineInfoBox = forwardRef<HTMLSpanElement, ComponentPropsWithoutRef<"span">>(
  function TimelineInfoBox({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        {...props}
        className={clsx(
          "timeline-info-box material-popover pointer-events-none fixed z-50 max-w-[calc(100vw-1rem)] rounded-chip px-1.5 py-0.5 text-caption tabular-nums whitespace-nowrap text-label shadow-popover",
          className,
        )}
      />
    );
  },
);

export function DragReadout() {
  return (
    <TimelineInfoBox
      ref={(node) => {
        readoutElement = node;
      }}
      role="status"
      data-visible="false"
      className="timeline-readout -translate-x-1/2"
    />
  );
}

export function showReadout({ x, y, startDate, endDate }: Readout) {
  if (!readoutElement) return;
  const length = differenceInDays(startDate, endDate) + 1;
  readoutElement.textContent = `${shortDate(startDate)} – ${shortDate(endDate)} · ${length} day${length === 1 ? "" : "s"}`;
  readoutElement.style.left = `${x}px`;
  readoutElement.style.top = `${y - 28}px`;
  readoutElement.dataset.visible = "true";
}

export function hideReadout() {
  if (readoutElement) readoutElement.dataset.visible = "false";
}

export function BlockHoverInfo({
  topicName,
  startDate,
  endDate,
  completedUnits,
  totalUnits,
  unit,
  overdue,
  anchor,
  visible,
}: {
  topicName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  completedUnits: number;
  totalUnits: number;
  unit: string;
  overdue: boolean;
  anchor: DOMRect | null;
  visible: boolean;
}) {
  const cardRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const length = differenceInDays(startDate, endDate) + 1;

  useLayoutEffect(() => {
    if (!visible || !anchor || !cardRef.current) return;
    const card = cardRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - card.width / 2, window.innerWidth - card.width - 8));
    const above = anchor.top - card.height - 8;
    const top = above >= 8 ? above : Math.min(window.innerHeight - card.height - 8, anchor.bottom + 8);
    setPosition({ left, top: Math.max(8, top), ready: true });
  }, [anchor, visible, topicName, startDate, endDate, completedUnits, totalUnits, unit, overdue]);

  if (!visible || !anchor || typeof document === "undefined") return null;

  return createPortal(
    <TimelineInfoBox
      ref={cardRef}
      role="tooltip"
      aria-hidden="true"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden",
      }}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{topicName}</span>
        <span>
          {shortDate(startDate)} – {shortDate(endDate)} · {length} day{length === 1 ? "" : "s"}
        </span>
        <span>
          {completedUnits} of {totalUnits} {unit} done{overdue ? " · overdue" : ""}
        </span>
      </span>
    </TimelineInfoBox>,
    document.body,
  );
}
