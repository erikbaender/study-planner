import { clsx } from "clsx";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
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
let manipulating = false;
let hoveredBlockId: string | null = null;

export type BlockHoverReadout = {
  blockId: string;
  topicName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  completedUnits: number;
  totalUnits: number;
  unit: string;
  overdue: boolean;
  anchor: DOMRect;
};

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

export function TimelineReadout() {
  return (
    <TimelineInfoBox
      ref={(node) => {
        readoutElement = node;
      }}
      role="status"
      data-visible="false"
      data-mode="idle"
      className="timeline-readout -translate-x-1/2"
    />
  );
}

function setReadoutVisible(visible: boolean) {
  if (!readoutElement) return;
  readoutElement.dataset.visible = String(visible);
  readoutElement.style.visibility = visible ? "visible" : "hidden";
}

function setReadoutText(text: string) {
  if (!readoutElement) return;
  readoutElement.replaceChildren(document.createTextNode(text));
}

export function showReadout({ x, y, startDate, endDate }: Readout) {
  if (!readoutElement) return;
  const length = differenceInDays(startDate, endDate) + 1;
  readoutElement.dataset.mode = "manipulation";
  setReadoutText(`${shortDate(startDate)} – ${shortDate(endDate)} · ${length} day${length === 1 ? "" : "s"}`);
  readoutElement.style.left = `${x}px`;
  readoutElement.style.top = `${y - 28}px`;
  setReadoutVisible(true);
}

export function hideReadout() {
  setReadoutVisible(false);
}

/** Hide the hover content before a block's manipulation session takes over the same box. */
export function beginReadoutManipulation() {
  manipulating = true;
  hoveredBlockId = null;
  if (!readoutElement) return;
  readoutElement.dataset.mode = "manipulation";
  hideReadout();
}

/** Release the shared box after a move/resize, leaving it hidden until the next hover. */
export function endReadoutManipulation() {
  manipulating = false;
  hoveredBlockId = null;
  hideReadout();
  if (readoutElement) readoutElement.dataset.mode = "idle";
}

function appendHoverContent(readout: BlockHoverReadout) {
  if (!readoutElement) return;
  const length = differenceInDays(readout.startDate, readout.endDate) + 1;
  const content = document.createElement("span");
  content.className = "flex flex-col gap-0.5";

  const topic = document.createElement("span");
  topic.className = "font-semibold";
  topic.textContent = readout.topicName;
  content.append(topic);

  const dates = document.createElement("span");
  dates.textContent = `${shortDate(readout.startDate)} – ${shortDate(readout.endDate)} · ${length} day${length === 1 ? "" : "s"}`;
  content.append(dates);

  const progress = document.createElement("span");
  progress.textContent = `${readout.completedUnits} of ${readout.totalUnits} ${readout.unit} done${readout.overdue ? " · overdue" : ""}`;
  content.append(progress);

  readoutElement.replaceChildren(content);
}

export function showBlockHover(readout: BlockHoverReadout) {
  if (manipulating || !readoutElement) return;
  hoveredBlockId = readout.blockId;
  appendHoverContent(readout);

  readoutElement.dataset.mode = "hover";
  readoutElement.dataset.visible = "true";
  readoutElement.style.visibility = "hidden";
  readoutElement.style.left = "0px";
  readoutElement.style.top = "0px";

  const card = readoutElement.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(
      readout.anchor.left + readout.anchor.width / 2 - card.width / 2,
      window.innerWidth - card.width - 8,
    ),
  );
  const above = readout.anchor.top - card.height - 8;
  const top =
    above >= 8
      ? above
      : Math.min(window.innerHeight - card.height - 8, readout.anchor.bottom + 8);

  readoutElement.style.left = `${left}px`;
  readoutElement.style.top = `${Math.max(8, top)}px`;
  readoutElement.style.visibility = "visible";
}

export function hideBlockHover(blockId: string) {
  if (manipulating || hoveredBlockId !== blockId) return;
  hoveredBlockId = null;
  hideReadout();
}
