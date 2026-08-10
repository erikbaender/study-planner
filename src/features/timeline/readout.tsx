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

export function DragReadout() {
  return (
    <span
      ref={(node) => {
        readoutElement = node;
      }}
      role="status"
      data-visible="false"
      className="timeline-readout material-popover pointer-events-none fixed z-50 -translate-x-1/2 rounded-chip px-1.5 py-0.5 text-caption tabular-nums whitespace-nowrap text-label shadow-popover"
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
