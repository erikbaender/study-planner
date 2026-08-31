import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  memo,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  courseColorValue,
  differenceInDays,
  topicProgress,
  UNIT_LABELS,
  type Course,
  type IsoDate,
  type StudyBlock,
  type Topic,
} from "@/domain";
import { useKeyboardMode, type MenuItem } from "@/ui";
import {
  shortDate,
  widthCss,
  xCss,
} from "./geometry";
import { useChart, type Chart, type Viewport, type ViewportStore } from "./chart-context";
import { LEFT, startBarGesture } from "./gestures";
import {
  BAR_HINTS,
  HANDLE_HINTS,
  barSelectedHints,
} from "./hints";
import type { Range } from "./layout";
import { hintTarget } from "@/features/workspace/hints";
import {
  hideBlockHover,
  showBlockHover,
} from "./readout";
/** The one delete item, so the bar's menu and the lane's cannot disagree. */
export function deleteBlockItem(chart: Chart, blockId: string): MenuItem {
  return {
    label: "Delete",
    icon: <Trash2 />,
    danger: true,
    onSelect: () => {
      if (!chart.repository) return;
      chart.selection.set(chart.selection.getSnapshot().filter((id) => id !== blockId));
      chart.run(chart.repository.deleteStudyBlock(blockId));
    },
  };
}

/** An opaque warning mark keeps the chart's brightness while borrowing red's hue. */
function OverdueIcon({ className }: { className?: string } = {}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx(className ?? "size-7", "text-negative")}
    >
      <path
        d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
        fill="color-mix(in srgb, var(--mac-negative) 15%, var(--mac-content) 85%)"
      />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * "There is more of this row over there."
 *
 * A row whose only block sits three months off screen looks, at a glance,
 * exactly like a row with nothing scheduled at all — and at Day zoom most rows
 * look like that most of the time. The markers pin themselves to the edges of
 * the scrollport with `position: sticky`, count what is out there, and scroll
 * the nearest one *just* into view on the side it was hiding past.
 */
export function OffscreenMarkers({ topic, tint, today }: { topic: Topic; tint: string; today: IsoDate }) {
  const chart = useChart();
  const markers = useOffscreenMarkerState(
    topic.blocks,
    chart.viewport,
    today,
    (topicProgress(topic).ratio ?? 0) < 1,
  );
  // Both sides stay mounted while the row has anything to point at, and the
  // last thing each pointed at is kept while it fades: an element removed from
  // the DOM cannot animate its own departure.
  const [shown, setShown] = useState(markers);
  if (
    (markers.before && markers.before !== shown.before) ||
    (markers.after && markers.after !== shown.after)
  ) {
    setShown({ before: markers.before ?? shown.before, after: markers.after ?? shown.after });
  }
  if (topic.blocks.length === 0) return null;

  return (
    <>
      {shown.before ? (
        <Marker
          side="left"
          tint={tint}
          visible={markers.before !== null}
          count={shown.before.count}
          overdue={shown.before.overdue}
          date={shown.before.block.endDate}
          topic={topic.name}
          onGo={() => chart.reveal(shown.before!.block, "left")}
        />
      ) : null}
      {shown.after ? (
        <Marker
          side="right"
          tint={tint}
          visible={markers.after !== null}
          count={shown.after.count}
          overdue={shown.after.overdue}
          date={shown.after.block.startDate}
          topic={topic.name}
          onGo={() => chart.reveal(shown.after!.block, "right")}
        />
      ) : null}
    </>
  );
}

type MarkerSide = { count: number; block: StudyBlock; overdue: boolean } | null;
type OffscreenMarkerState = { before: MarkerSide; after: MarkerSide };

const NO_OFFSCREEN_MARKERS: OffscreenMarkerState = { before: null, after: null };

/** One pass finds both counts and the nearest block in either direction. */
function markersFor(
  blocks: readonly StudyBlock[],
  viewport: Viewport,
  today: IsoDate,
  topicOverdue: boolean,
): OffscreenMarkerState {
  if (!viewport || blocks.length === 0) return NO_OFFSCREEN_MARKERS;

  let beforeCount = 0;
  let afterCount = 0;
  let nearestBefore: StudyBlock | null = null;
  let nearestAfter: StudyBlock | null = null;
  let beforeOverdue = false;
  let afterOverdue = false;

  for (const block of blocks) {
    if (block.endDate < viewport.from) {
      beforeCount += 1;
      beforeOverdue ||= topicOverdue && block.endDate < today;
      if (!nearestBefore || block.endDate > nearestBefore.endDate) nearestBefore = block;
    } else if (block.startDate > viewport.to) {
      afterCount += 1;
      afterOverdue ||= topicOverdue && block.endDate < today;
      if (!nearestAfter || block.startDate < nearestAfter.startDate) nearestAfter = block;
    }
  }

  if (!nearestBefore && !nearestAfter) return NO_OFFSCREEN_MARKERS;
  return {
    before: nearestBefore ? { count: beforeCount, block: nearestBefore, overdue: beforeOverdue } : null,
    after: nearestAfter ? { count: afterCount, block: nearestAfter, overdue: afterOverdue } : null,
  };
}

function sameMarkerState(left: OffscreenMarkerState, right: OffscreenMarkerState): boolean {
  return (
    left.before?.count === right.before?.count &&
    left.before?.block === right.before?.block &&
    left.before?.overdue === right.before?.overdue &&
    left.after?.count === right.after?.count &&
    left.after?.block === right.after?.block
    && left.after?.overdue === right.after?.overdue
  );
}

/**
 * `useSyncExternalStore` only re-renders when a snapshot changes by identity.
 * Reuse the previous result while both off-screen sets are unchanged, so a day
 * crossing in empty canvas costs a few comparisons rather than 344 renders.
 */
function useOffscreenMarkerState(
  blocks: readonly StudyBlock[],
  store: ViewportStore,
  today: IsoDate,
  topicOverdue: boolean,
): OffscreenMarkerState {
  const cacheRef = useRef<{
    blocks: readonly StudyBlock[];
    viewport: Viewport;
    today: IsoDate;
    topicOverdue: boolean;
    result: OffscreenMarkerState;
  } | null>(null);

  const getSnapshot = useCallback(() => {
    const viewport = store.getSnapshot();
    const cached = cacheRef.current;
    if (
      cached?.blocks === blocks &&
      cached.viewport === viewport &&
      cached.today === today &&
      cached.topicOverdue === topicOverdue
    ) return cached.result;

    const selected = markersFor(blocks, viewport, today, topicOverdue);
    const result = cached && sameMarkerState(cached.result, selected) ? cached.result : selected;
    cacheRef.current = { blocks, viewport, today, topicOverdue, result };
    return result;
  }, [blocks, store, today, topicOverdue]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

function Marker({
  side,
  tint,
  visible,
  count,
  date,
  topic,
  overdue,
  onGo,
}: {
  side: "left" | "right";
  tint: string;
  /** Kept mounted while false, so it can fade out rather than vanish. */
  visible: boolean;
  count: number;
  date: IsoDate;
  topic: string;
  overdue: boolean;
  onGo: () => void;
}) {
  const chart = useChart();
  const Chevron = side === "left" ? ChevronLeft : ChevronRight;
  const where = side === "left" ? "earlier" : "later";

  return (
    <span
      data-visible={visible}
      className={clsx(
        "timeline-marker sticky z-30 mt-1 flex h-4 items-center gap-1",
        side === "left" ? "float-left" : "float-right right-1",
      )}
      style={side === "left" ? { left: chart.gutter + 4 } : undefined}
    >
      {side === "right" && overdue ? (
        <span className="pointer-events-none flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          <OverdueIcon className="size-4" />
        </span>
      ) : null}
      <button
      type="button"
      // A press here is neither a rubber band nor a bar gesture: the marker is
      // chrome sitting over the canvas, and the canvas underneath must not hear
      // about it. Middle-button panning still works, because that is taken on
      // the scrollport's capture phase before this ever runs.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onGo}
      aria-hidden={!visible}
      tabIndex={visible ? undefined : -1}
      title={`${count} ${where} block${count === 1 ? "" : "s"} for ${topic} — go to ${shortDate(date)}`}
      aria-label={`${count} ${where} block${count === 1 ? "" : "s"} for ${topic}, go to ${shortDate(date)}`}
      // Clear of the shared label column on the left, whatever width it
      // currently is; flush with the right edge of the scrollport on the
      // other side, which tailwind alone can express.
      //
      // In the colour of the work it points at: a row of grey chips down the
      // edge of the chart says only "something is out there", and in the
      // combined lane the useful half of that is *whose*.
      style={{ background: `color-mix(in srgb, ${tint} 22%, var(--mac-material-inline))`, color: tint }}
      // `mt-1` rather than a sticky `top`: a float sits at the top of the row,
      // and the offset of a sticky element is where it pins against the
      // *scrollport*, not where it sits in its row. The margin puts it on the
      // bars' own centre line, at the bars' own height.
      className={clsx(
        "timeline-chrome",
        "flex h-4 items-center gap-0.5 rounded-chip px-1 text-caption font-semibold tabular-nums",
        "hover:brightness-110",
      )}
    >
      {side === "left" ? <Chevron aria-hidden="true" className="size-3" /> : null}
      {count}
      {side === "right" ? <Chevron aria-hidden="true" className="size-3" /> : null}
      </button>
      {side === "left" && overdue ? (
        <span className="pointer-events-none flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          <OverdueIcon className="size-4" />
        </span>
      ) : null}
    </span>
  );
}

/* ─── The bar ───────────────────────────────────────────────────────────── */

function BlockBar({
  course,
  topic,
  block,
  fill,
  progress,
  range,
  today,
  selected,
  onSelect,
}: {
  course: Course;
  topic: Topic;
  block: StudyBlock;
  /** This bar's share of the topic's progress, 0–1. See `blocks.ts`. */
  fill: number;
  progress: ReturnType<typeof topicProgress>;
  range: Range;
  today: IsoDate;
  selected: boolean;
  onSelect: () => void;
}) {
  const chart = useChart();
  // Both of these are subscriptions to a store rather than props, so that a
  // selection change or a drag frame repaints the bars it touched and no others.
  const draft = useSyncExternalStore(
    chart.drafts.subscribe,
    () => chart.drafts.spanOf(block.id),
    () => null,
  );
  const barSelection = useSyncExternalStore(
    chart.selection.subscribe,
    () => chart.selection.stateOf(block.id),
    () => null,
  );
  const keyboardMode = useKeyboardMode();
  const barHints = barSelection !== null ? barSelectedHints(keyboardMode) : BAR_HINTS;
  const barHintTarget = hintTarget(barHints);

  const shown = draft ?? block;
  const unit = UNIT_LABELS[topic.unit].plural;
  const tint = courseColorValue(course.color);

  const length = differenceInDays(shown.startDate, shown.endDate) + 1;
  const past = shown.endDate < today;
  // "Finished" and "missed" are not the same past. A window that has closed on
  // unfinished work is the one thing on this chart that needs acting on, and it
  // used to be drawn *fainter* than everything else.
  const overdue = past && (progress.ratio ?? 0) < 1;

  return (
    <>
      {/*
        The left button selects and drags; there is no click handler because a
        press that stays under the threshold *is* the tap, and the release that
        decides it may come long after the pointer has left this element.
      */}
      <button
        type="button"
        data-block-id={block.id}
        onPointerDown={(event) => {
          if (event.button === LEFT) startBarGesture(event, chart, "move", block.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          // Right-clicking something unselected acts on it, as it does
          // everywhere: the menu must be about the bar that was pointed at.
          if (chart.selection.stateOf(block.id) === null) chart.select([block.id]);
          chart.openMenu(event, [deleteBlockItem(chart, block.id)]);
        }}
        // Enter and Space still select, because that is a button being pressed
        // rather than a shortcut; the arrow-key nudge is gone with the rest of
        // the app's keyboard bindings.
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const current = chart.selection.getSnapshot();
          if (current.includes(block.id)) chart.select(current.filter((id) => id !== block.id));
          else {
            chart.select([block.id]);
            onSelect();
          }
        }}
        {...barHintTarget}
        onPointerEnter={(event) => {
          barHintTarget.onPointerEnter();
          showBlockHover({
            blockId: block.id,
            topicName: topic.name,
            startDate: shown.startDate,
            endDate: shown.endDate,
            completedUnits: topic.completedUnits,
            totalUnits: topic.totalUnits,
            unit,
            overdue,
            anchor: event.currentTarget.getBoundingClientRect(),
          });
        }}
        onPointerLeave={() => {
          barHintTarget.onPointerLeave();
          hideBlockHover(block.id);
        }}
        onFocus={(event) => {
          barHintTarget.onFocus();
          showBlockHover({
            blockId: block.id,
            topicName: topic.name,
            startDate: shown.startDate,
            endDate: shown.endDate,
            completedUnits: topic.completedUnits,
            totalUnits: topic.totalUnits,
            unit,
            overdue,
            anchor: event.currentTarget.getBoundingClientRect(),
          });
        }}
        onBlur={() => {
          barHintTarget.onBlur();
          hideBlockHover(block.id);
        }}
        // Everything a bar means, spoken. The old bars were `div`s and said
        // nothing at all.
        aria-label={`${topic.name}, ${shown.startDate} to ${shown.endDate}, ${length} day${length === 1 ? "" : "s"}, ${topic.completedUnits} of ${topic.totalUnits} ${unit} done${overdue ? ", overdue" : ""}`}
        aria-current={barSelection !== null || selected ? "true" : undefined}
        data-selection={barSelection ?? undefined}
        style={{
          left: xCss(shown.startDate, range.start),
          width: widthCss(shown.startDate, shown.endDate, 6),
          backgroundColor: `color-mix(in srgb, ${tint} 22%, transparent)`,
          // One outline per bar, always. It used to be a ring *and*, on a
          // hand-placed block, a dashed border half a pixel outside it — two
          // edges on a shape four pixels tall, which read as a rendering
          // artefact rather than as the two facts it was trying to state. Drawn
          // inside the bar's own box so a six-pixel block keeps its width, and
          // dashed only when the block is one the scheduler does not own.
          //
          // Selected, that outline is replaced by the accent one — at full
          // strength for the primary bar, the one the inspector is describing,
          // and at half for the rest of the selection. An element has one
          // outline, and while a bar is selected this is the one that matters.
          outline:
            barSelection === "primary"
              ? "2px solid var(--mac-accent)"
              : barSelection === "secondary"
                ? "2px solid color-mix(in srgb, var(--mac-accent) 50%, transparent)"
                : overdue
                  ? "1.5px solid var(--mac-negative)"
                  : `1px ${block.source === "manual" ? "dashed" : "solid"} color-mix(in srgb, ${tint} 55%, transparent)`,
          outlineOffset: barSelection ? 2 : -1,
        }}
        className={clsx(
          "timeline-bar timeline-tint group absolute top-1 h-4 touch-none overflow-visible rounded-chip",
          barSelection && "z-10",
        )}
      >
        <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
          {/* Progress as an internal fill. Each bar carries its *share* of the
            topic's progress, so a topic split across four windows reads as one
            quantity spread over four bars rather than as four times the work. */}
          <span
            aria-hidden="true"
            className="topic-motion-width block h-full"
            style={{ width: `${fill * 100}%`, background: tint }}
          />
        </span>
        {overdue ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          >
            <OverdueIcon />
          </span>
        ) : null}
        {/* The resize edges, shown on hover. There is no mode to reveal them in
            any more, so they appear where the hand already is. */}
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button === LEFT) startBarGesture(event, chart, "start", block.id);
          }}
          {...hintTarget(HANDLE_HINTS)}
          className="timeline-bar-handle timeline-tint absolute inset-y-0 left-0 w-1.5 rounded-l-[inherit] opacity-0"
          style={{ background: "var(--mac-label-secondary)" }}
        />
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button === LEFT) startBarGesture(event, chart, "end", block.id);
          }}
          {...hintTarget(HANDLE_HINTS)}
          className="timeline-bar-handle timeline-tint absolute inset-y-0 right-0 w-1.5 rounded-r-[inherit] opacity-0"
          style={{ background: "var(--mac-label-secondary)" }}
        />
      </button>
    </>
  );
}
export const MemoBlockBar = memo(BlockBar, (left, right) =>
  left.course === right.course &&
  left.topic === right.topic &&
  left.block === right.block &&
  left.fill === right.fill &&
  left.progress === right.progress &&
  left.range === right.range &&
  left.today === right.today &&
  left.selected === right.selected,
);
