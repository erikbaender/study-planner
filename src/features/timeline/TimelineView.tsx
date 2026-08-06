"use client";

import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { clsx } from "clsx";
import {
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Flag,
  GitBranch,
  Plus,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePlannerErrors, useRepository } from "@/data/use-repository";
import {
  addDays,
  rangeLengthInDays,
  UNIT_LABELS,
  type Course,
  type IsoDate,
  type Plan,
  type StudyBlock,
  type Topic,
} from "@/domain";
import {
  Badge,
  Button,
  EmptyState,
  Popover,
  SegmentedControl,
  TextField,
  ToolbarSpacer,
} from "@/ui";
import {
  dayOffset,
  formatTimelineTick,
  isTimelineTick,
  moveDateRange,
  snapDragDelta,
  timelineRange,
  TIMELINE_ZOOMS,
  type TimelineZoom,
  ZOOM_CONFIG,
} from "./timeline-model";

const LABEL_WIDTH = 232;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 44;
const DRAG_THRESHOLD = 4;

type TimelineRow =
  | { id: string; kind: "course"; course: Course }
  | { id: string; kind: "topic"; course: Course; topic: Topic };

type TimelineBlock = StudyBlock & {
  course: Course;
  topic: Topic;
};

type BlockUpdate = {
  id: string;
  startDate: IsoDate;
  endDate: IsoDate;
  plannedUnits?: number;
};

export function TimelineView({
  plan,
  today,
  onCreate,
  onSelectTopic,
}: {
  plan: Plan;
  today: IsoDate;
  onCreate: () => void;
  onSelectTopic: (topicId: string, courseId: string) => void;
}) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<TimelineZoom>("week");
  const [collapsedCourseIds, setCollapsedCourseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [showDependencies, setShowDependencies] = useState(true);

  const blocks = useMemo(
    () =>
      plan.courses.flatMap((course) =>
        course.topics.flatMap((topic) =>
          topic.blocks.map(
            (block): TimelineBlock => ({ ...block, course, topic }),
          ),
        ),
      ),
    [plan],
  );
  const blocksById = useMemo(
    () => new Map(blocks.map((block) => [block.id, block])),
    [blocks],
  );
  const rows = useMemo<TimelineRow[]>(
    () =>
      plan.courses.flatMap((course) => [
        { id: `course-${course.id}`, kind: "course" as const, course },
        ...(collapsedCourseIds.has(course.id)
          ? []
          : course.topics.map((topic) => ({
              id: `topic-${topic.id}`,
              kind: "topic" as const,
              course,
              topic,
            }))),
      ]),
    [collapsedCourseIds, plan.courses],
  );
  const range = useMemo(() => timelineRange(plan, today), [plan, today]);
  const { pixelsPerDay } = ZOOM_CONFIG[zoom];
  const timelineWidth = range.dayCount * pixelsPerDay;

  // TanStack owns scroll measurement; React Compiler correctly leaves this
  // component un-memoized because those imperative methods must stay live.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    scrollMargin: HEADER_HEIGHT,
    overscan: 8,
  });
  const dayVirtualizer = useVirtualizer({
    count: range.dayCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => pixelsPerDay,
    horizontal: true,
    scrollMargin: LABEL_WIDTH,
    overscan: 14,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualDays = dayVirtualizer.getVirtualItems();
  const visibleDays =
    virtualDays.length > 0
      ? {
          start: Math.max(0, virtualDays[0].index - 1),
          end: Math.min(
            range.dayCount - 1,
            virtualDays[virtualDays.length - 1].index + 1,
          ),
        }
      : { start: 0, end: range.dayCount - 1 };
  const visibleRowIndexes = useMemo(
    () => new Set(virtualRows.map((row) => row.index)),
    [virtualRows],
  );

  useEffect(() => {
    dayVirtualizer.measure();
    dayVirtualizer.scrollToIndex(
      Math.max(0, Math.min(range.dayCount - 1, dayOffset(range.start, today))),
      { align: "center" },
    );
  }, [dayVirtualizer, pixelsPerDay, range.dayCount, range.start, today]);

  const toggleCourse = (courseId: string) => {
    setCollapsedCourseIds((current) => {
      const next = new Set(current);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const moveBlocks = (blockIds: readonly string[], deltaDays: number) => {
    if (deltaDays === 0) return;
    const updates = blockIds.flatMap((id): BlockUpdate[] => {
      const block = blocksById.get(id);
      if (!block) return [];
      return [{ id, ...moveDateRange(block.startDate, block.endDate, deltaDays) }];
    });
    run(
      Promise.all(
        updates.map(({ id, ...input }) => repository.updateStudyBlock(id, input)),
      ),
    );
  };

  const resizeBlock = (block: TimelineBlock, deltaDays: number) => {
    if (deltaDays === 0) return;
    run(
      repository.updateStudyBlock(block.id, {
        startDate: block.startDate,
        endDate:
          addDays(block.endDate, deltaDays) < block.startDate
            ? block.startDate
            : addDays(block.endDate, deltaDays),
        plannedUnits: block.plannedUnits,
      }),
    );
  };

  if (blocks.length === 0) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <TimelineHeader zoom={zoom} onZoomChange={setZoom} />
        <EmptyState
          title="No study blocks yet"
          description="Add topics now; scheduled blocks will appear here when planning is available."
          action={
            <Button variant="accent" leadingIcon={<Plus />} onClick={onCreate}>
              Add material
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <TimelineHeader zoom={zoom} onZoomChange={setZoom}>
        <Button
          size="sm"
          variant={showDependencies ? "accent" : "plain"}
          leadingIcon={<GitBranch />}
          aria-pressed={showDependencies}
          onClick={() => setShowDependencies((visible) => !visible)}
        >
          Dependencies
        </Button>
      </TimelineHeader>

      <section
        aria-label={`${plan.name} timeline`}
        className="min-h-0 flex-1 overflow-hidden rounded-card bg-content shadow-raised inset-ring inset-ring-[var(--mac-separator)]"
      >
        <div
          ref={scrollRef}
          role="grid"
          aria-label={`${plan.name} timeline`}
          aria-rowcount={rows.length}
          aria-colcount={range.dayCount + 1}
          className="relative h-full min-h-80 overflow-auto overscroll-contain"
        >
          <div
            className="relative"
            style={{
              width: LABEL_WIDTH + timelineWidth,
              height: HEADER_HEIGHT + rowVirtualizer.getTotalSize(),
            }}
          >
            <TimelineHeaderRow
              rangeStart={range.start}
              zoom={zoom}
              virtualDays={virtualDays}
            />

            {virtualDays.map((virtualDay) => {
              const date = addDays(range.start, virtualDay.index);
              if (!isTimelineTick(date, zoom)) return null;
              return (
                <span
                  key={`grid-${date}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 bottom-0 border-l border-separator"
                  style={{ left: virtualDay.start }}
                />
              );
            })}

            <ExamMarkers
              courses={plan.courses}
              rangeStart={range.start}
              pixelsPerDay={pixelsPerDay}
              timelineHeight={HEADER_HEIGHT + rowVirtualizer.getTotalSize()}
            />

            {showDependencies ? (
              <DependencyArrows
                rows={rows}
                visibleRowIndexes={visibleRowIndexes}
                rangeStart={range.start}
                pixelsPerDay={pixelsPerDay}
              />
            ) : null}

            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <TimelineLane
                  key={row.id}
                  row={row}
                  rowIndex={virtualRow.index}
                  top={virtualRow.start}
                  rangeStart={range.start}
                  pixelsPerDay={pixelsPerDay}
                  visibleDays={visibleDays}
                  collapsed={
                    row.kind === "course" &&
                    collapsedCourseIds.has(row.course.id)
                  }
                  selectedBlockIds={selectedBlockIds}
                  openBlockId={openBlockId}
                  zoom={zoom}
                  onToggleCourse={toggleCourse}
                  onSelectBlock={(blockId, additive) => {
                    setSelectedBlockIds((current) => {
                      if (!additive) return new Set([blockId]);
                      const next = new Set(current);
                      if (next.has(blockId)) next.delete(blockId);
                      else next.add(blockId);
                      return next;
                    });
                  }}
                  onOpenBlock={setOpenBlockId}
                  onSelectTopic={onSelectTopic}
                  onMoveBlocks={(blockId, delta) => {
                    const moving =
                      selectedBlockIds.has(blockId) && selectedBlockIds.size > 1
                        ? [...selectedBlockIds]
                        : [blockId];
                    moveBlocks(moving, delta);
                  }}
                  onResizeBlock={resizeBlock}
                  onSaveBlock={(blockId, input) => {
                    run(repository.updateStudyBlock(blockId, input));
                    setOpenBlockId(null);
                  }}
                />
              );
            })}

            {today >= range.start && today <= range.end ? (
              <div
                aria-label={`Today, ${today}`}
                className="pointer-events-none absolute top-0 bottom-0 z-30 border-l-2 border-accent"
                style={{
                  left:
                    LABEL_WIDTH +
                    (dayOffset(range.start, today) + 0.5) * pixelsPerDay,
                }}
              >
                <span className="absolute top-1 left-1 rounded-chip bg-accent px-1.5 py-0.5 text-caption font-semibold whitespace-nowrap text-on-accent">
                  Today
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <p className="text-footnote text-tertiary">
        Drag after 4 px to move · Shift-click selects a group · arrow keys move ·
        Alt-arrow resizes
      </p>
    </div>
  );
}

function TimelineHeader({
  zoom,
  onZoomChange,
  children,
}: {
  zoom: TimelineZoom;
  onZoomChange: (zoom: TimelineZoom) => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-1 flex size-8 items-center justify-center rounded-control bg-fill text-secondary"
      >
        <CalendarRange className="size-4" />
      </span>
      <div>
        <p className="text-callout text-secondary">Schedule</p>
        <h2 className="text-title1 font-semibold">Timeline</h2>
        <p className="mt-1 text-body text-secondary">
          Course swimlanes show when work lands and how far it has progressed.
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {children}
        <SegmentedControl
          value={zoom}
          label="Timeline zoom"
          size="sm"
          segments={TIMELINE_ZOOMS.map((value) => ({
            value,
            label: `${value.charAt(0).toUpperCase()}${value.slice(1)}`,
          }))}
          onValueChange={onZoomChange}
        />
      </div>
    </header>
  );
}

function TimelineHeaderRow({
  rangeStart,
  zoom,
  virtualDays,
}: {
  rangeStart: IsoDate;
  zoom: TimelineZoom;
  virtualDays: VirtualItem[];
}) {
  return (
    <div
      role="row"
      className="sticky top-0 z-40 border-b border-separator bg-raised/95 text-caption font-semibold text-tertiary backdrop-blur-xl"
      style={{ height: HEADER_HEIGHT }}
    >
      <span
        role="columnheader"
        className="sticky left-0 z-50 flex h-full items-center border-r border-separator bg-raised/95 px-3 tracking-wide uppercase"
        style={{ width: LABEL_WIDTH }}
      >
        Course / topic
      </span>
      {virtualDays.map((virtualDay) => {
        const date = addDays(rangeStart, virtualDay.index);
        if (!isTimelineTick(date, zoom)) return null;
        return (
          <span
            key={date}
            role="columnheader"
            aria-label={date}
            className="absolute top-0 flex h-full items-center border-l border-separator px-1 whitespace-nowrap"
            style={{
              left: virtualDay.start,
              minWidth: Math.max(48, virtualDay.size),
            }}
          >
            {formatTimelineTick(date, zoom)}
          </span>
        );
      })}
    </div>
  );
}

function TimelineLane({
  row,
  rowIndex,
  top,
  rangeStart,
  pixelsPerDay,
  visibleDays,
  collapsed,
  selectedBlockIds,
  openBlockId,
  zoom,
  onToggleCourse,
  onSelectBlock,
  onOpenBlock,
  onSelectTopic,
  onMoveBlocks,
  onResizeBlock,
  onSaveBlock,
}: {
  row: TimelineRow;
  rowIndex: number;
  top: number;
  rangeStart: IsoDate;
  pixelsPerDay: number;
  visibleDays: { start: number; end: number };
  collapsed: boolean;
  selectedBlockIds: ReadonlySet<string>;
  openBlockId: string | null;
  zoom: TimelineZoom;
  onToggleCourse: (courseId: string) => void;
  onSelectBlock: (blockId: string, additive: boolean) => void;
  onOpenBlock: (blockId: string | null) => void;
  onSelectTopic: (topicId: string, courseId: string) => void;
  onMoveBlocks: (blockId: string, deltaDays: number) => void;
  onResizeBlock: (block: TimelineBlock, deltaDays: number) => void;
  onSaveBlock: (
    blockId: string,
    input: { startDate: IsoDate; endDate: IsoDate; plannedUnits?: number },
  ) => void;
}) {
  const blocks =
    row.kind === "course"
      ? row.course.topics.flatMap((topic) =>
          topic.blocks.map(
            (block): TimelineBlock => ({
              ...block,
              course: row.course,
              topic,
            }),
          ),
        )
      : row.topic.blocks.map(
          (block): TimelineBlock => ({
            ...block,
            course: row.course,
            topic: row.topic,
          }),
        );
  const visibleBlocks = blocks.filter(
    (block) =>
      dayOffset(rangeStart, block.endDate) >= visibleDays.start &&
      dayOffset(rangeStart, block.startDate) <= visibleDays.end,
  );

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 1}
      className={clsx(
        "absolute right-0 left-0 border-b border-separator",
        row.kind === "course" ? "bg-fill/80" : "bg-content",
      )}
      style={{ top, height: ROW_HEIGHT }}
    >
      <div
        role="rowheader"
        className={clsx(
          "sticky left-0 z-20 flex h-full items-center gap-2 border-r border-separator px-2",
          row.kind === "course" ? "bg-fill" : "bg-content pl-8",
        )}
        style={{ width: LABEL_WIDTH }}
      >
        {row.kind === "course" ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${row.course.name}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onToggleCourse(row.course.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control px-1 py-1 text-left hover:bg-fill-strong focus-visible:shadow-focus focus-visible:outline-none"
          >
            {collapsed ? (
              <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ background: row.course.color }}
            />
            <span className="truncate text-callout font-semibold">
              {row.course.name}
            </span>
            <span className="ml-auto text-caption text-tertiary">
              {row.course.topics.length}
            </span>
          </button>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: row.course.color }}
            />
            <span className="truncate text-callout">{row.topic.name}</span>
          </>
        )}
      </div>

      {row.kind === "course" ? (
        <CourseRollup
          course={row.course}
          blocks={blocks}
          rangeStart={rangeStart}
          pixelsPerDay={pixelsPerDay}
        />
      ) : (
        visibleBlocks.map((block) => (
          <DraggableBlock
            key={block.id}
            block={block}
            rangeStart={rangeStart}
            pixelsPerDay={pixelsPerDay}
            zoom={zoom}
            selected={selectedBlockIds.has(block.id)}
            open={openBlockId === block.id}
            onSelect={(additive) => onSelectBlock(block.id, additive)}
            onOpenChange={(open) => onOpenBlock(open ? block.id : null)}
            onSelectTopic={() => onSelectTopic(block.topic.id, block.course.id)}
            onMove={(deltaDays) => onMoveBlocks(block.id, deltaDays)}
            onResize={(deltaDays) => onResizeBlock(block, deltaDays)}
            onSave={(input) => onSaveBlock(block.id, input)}
          />
        ))
      )}
    </div>
  );
}

function CourseRollup({
  course,
  blocks,
  rangeStart,
  pixelsPerDay,
}: {
  course: Course;
  blocks: TimelineBlock[];
  rangeStart: IsoDate;
  pixelsPerDay: number;
}) {
  if (blocks.length === 0) return null;
  const startDate = blocks.reduce(
    (earliest, block) =>
      block.startDate < earliest ? block.startDate : earliest,
    blocks[0].startDate,
  );
  const endDate = blocks.reduce(
    (latest, block) => (block.endDate > latest ? block.endDate : latest),
    blocks[0].endDate,
  );
  const measured = course.topics.filter((topic) => topic.totalUnits > 0);
  const total = measured.reduce((sum, topic) => sum + topic.totalUnits, 0);
  const complete = measured.reduce(
    (sum, topic) => sum + Math.min(topic.completedUnits, topic.totalUnits),
    0,
  );
  const ratio = total > 0 ? complete / total : 0;

  return (
    <div
      role="gridcell"
      aria-label={`${course.name} schedule, ${startDate} to ${endDate}, ${Math.round(
        ratio * 100,
      )}% complete`}
      className="absolute top-3 h-5 overflow-hidden rounded-chip bg-fill-strong inset-ring inset-ring-[var(--mac-separator-strong)]"
      style={{
        left: LABEL_WIDTH + dayOffset(rangeStart, startDate) * pixelsPerDay,
        width: Math.max(
          8,
          rangeLengthInDays(startDate, endDate) * pixelsPerDay,
        ),
      }}
    >
      <span
        aria-hidden="true"
        className="block h-full opacity-55"
        style={{ width: `${ratio * 100}%`, background: course.color }}
      />
    </div>
  );
}

function DraggableBlock({
  block,
  rangeStart,
  pixelsPerDay,
  zoom,
  selected,
  open,
  onSelect,
  onOpenChange,
  onSelectTopic,
  onMove,
  onResize,
  onSave,
}: {
  block: TimelineBlock;
  rangeStart: IsoDate;
  pixelsPerDay: number;
  zoom: TimelineZoom;
  selected: boolean;
  open: boolean;
  onSelect: (additive: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onSelectTopic: () => void;
  onMove: (deltaDays: number) => void;
  onResize: (deltaDays: number) => void;
  onSave: (input: {
    startDate: IsoDate;
    endDate: IsoDate;
    plannedUnits?: number;
  }) => void;
}) {
  const pointer = useRef<{
    id: number;
    startX: number;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const previewDelta = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [startDate, setStartDate] = useDraftValue(block.startDate);
  const [endDate, setEndDate] = useDraftValue(block.endDate);
  const [plannedUnits, setPlannedUnits] = useDraftValue(
    block.plannedUnits === undefined ? "" : String(block.plannedUnits),
  );

  const ratio =
    block.topic.totalUnits > 0
      ? Math.min(1, block.topic.completedUnits / block.topic.totalUnits)
      : null;
  const left =
    LABEL_WIDTH +
    dayOffset(rangeStart, block.startDate) * pixelsPerDay;
  const width = Math.max(
    8,
    rangeLengthInDays(block.startDate, block.endDate) * pixelsPerDay,
  );
  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (!pointer.current || pointer.current.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasDragging = pointer.current.dragging;
    pointer.current = null;
    if (wasDragging) {
      suppressClick.current = true;
      onMove(previewDelta.current);
    }
    previewDelta.current = 0;
    event.currentTarget.style.transform = "";
    event.currentTarget.setAttribute("aria-label", blockLabel(block, ratio));
  };

  const cancelPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (!pointer.current || pointer.current.id !== event.pointerId) return;
    pointer.current = null;
    previewDelta.current = 0;
    event.currentTarget.style.transform = "";
    event.currentTarget.setAttribute("aria-label", blockLabel(block, ratio));
  };

  const keyboardMove = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const delta = ZOOM_CONFIG[zoom].snapDays * direction;
    if (event.altKey) onResize(delta);
    else onMove(delta);
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      role="gridcell"
      aria-selected={selected}
      aria-label={blockLabel(block, ratio)}
      className={clsx(
        "group absolute top-2.5 z-10 h-6 touch-none overflow-hidden rounded-control text-left text-caption font-semibold text-white shadow-raised",
        "focus-visible:z-30 focus-visible:shadow-focus focus-visible:outline-none",
        selected && "ring-2 ring-accent ring-offset-1 ring-offset-content",
      )}
      style={{ left, width, background: block.course.color }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pointer.current = {
          id: event.pointerId,
          startX: event.clientX,
          dragging: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pointer.current || pointer.current.id !== event.pointerId) return;
        const distance = event.clientX - pointer.current.startX;
        if (!pointer.current.dragging && Math.abs(distance) < DRAG_THRESHOLD) {
          return;
        }
        pointer.current.dragging = true;
        const delta = snapDragDelta(distance, zoom);
        previewDelta.current = delta;
        event.currentTarget.style.transform = `translateX(${
          delta * pixelsPerDay
        }px)`;
        event.currentTarget.setAttribute(
          "aria-label",
          blockLabel(
            {
              ...block,
              ...moveDateRange(block.startDate, block.endDate, delta),
            },
            ratio,
          ),
        );
      }}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onKeyDown={keyboardMove}
      onClick={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          return;
        }
        onSelect(event.shiftKey);
        if (event.shiftKey) {
          event.preventDefault();
          return;
        }
        onSelectTopic();
        onOpenChange(true);
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-white/30"
        style={{ width: ratio === null ? 0 : `${ratio * 100}%` }}
      />
      {ratio === null ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 5px)",
          }}
        />
      ) : null}
      <span className="relative block truncate px-2 leading-6">
        {block.topic.name}
      </span>
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      align="start"
      className="w-72"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const units = plannedUnits === "" ? undefined : Number(plannedUnits);
          if (
            endDate < startDate ||
            (units !== undefined && (!Number.isFinite(units) || units < 0))
          ) {
            return;
          }
          onSave({ startDate, endDate, plannedUnits: units });
        }}
      >
        <div>
          <p className="truncate text-body font-semibold">{block.topic.name}</p>
          <p className="text-callout text-secondary">
            {block.course.name} · {block.source}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Starts"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <TextField
            label="Ends"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
        <TextField
          label={`Target (${UNIT_LABELS[block.topic.unit].plural})`}
          type="number"
          min={0}
          step="any"
          value={plannedUnits}
          placeholder="Not set"
          onChange={(event) => setPlannedUnits(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Badge>
            {block.source}
          </Badge>
          <span className="text-callout text-secondary">
            {ratio === null ? "Size not set" : `${Math.round(ratio * 100)}% complete`}
          </span>
          <ToolbarSpacer />
          <Button type="submit" size="sm" variant="accent">
            Save
          </Button>
        </div>
      </form>
    </Popover>
  );
}

function blockLabel(block: TimelineBlock, ratio: number | null): string {
  return `${block.topic.name}, ${block.startDate} to ${block.endDate}, ${
    ratio === null ? "size not set" : `${Math.round(ratio * 100)}% complete`
  }, ${block.source} block`;
}

function useDraftValue(source: string): [string, (value: string) => void] {
  const [draft, setDraft] = useState({ source, value: source });
  if (draft.source !== source) {
    setDraft({ source, value: source });
  }
  return [
    draft.source === source ? draft.value : source,
    (value) => setDraft({ source, value }),
  ];
}

function ExamMarkers({
  courses,
  rangeStart,
  pixelsPerDay,
  timelineHeight,
}: {
  courses: Course[];
  rangeStart: IsoDate;
  pixelsPerDay: number;
  timelineHeight: number;
}) {
  const markers = courses
    .flatMap((course) => course.exams.map((exam) => ({ course, exam })))
    .map(({ course, exam }) => ({
      course,
      exam,
      left:
        LABEL_WIDTH +
        (dayOffset(rangeStart, exam.startDate) + 0.5) * pixelsPerDay,
    }))
    .sort((left, right) => left.left - right.left);
  const laneEnds = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  return markers.map(({ course, exam, left }) => {
      let lane = laneEnds.findIndex((end) => end + 4 <= left);
      if (lane === -1) {
        lane = laneEnds.indexOf(Math.min(...laneEnds));
      }
      laneEnds[lane] = left + 112;
      const chipTop = HEADER_HEIGHT + 4 + lane * 18;
      const shortName = course.code ?? course.name;
      if (exam.status === "provisional" && exam.endDate) {
        const width =
          rangeLengthInDays(exam.startDate, exam.endDate) * pixelsPerDay;
        return (
          <div
            key={exam.id}
            aria-label={`${exam.name}, provisional window ${exam.startDate} to ${exam.endDate}`}
            className="pointer-events-none absolute top-0 z-30 border-x border-orange/70 text-orange"
            style={{
              left: left - pixelsPerDay / 2,
              width,
              height: timelineHeight,
              backgroundImage:
                "repeating-linear-gradient(135deg, color-mix(in srgb, currentColor 10%, transparent) 0 4px, transparent 4px 9px)",
            }}
          >
            <span
              className="absolute left-1 flex h-4 max-w-28 items-center gap-1 truncate rounded-chip bg-content/95 px-1.5 text-caption font-semibold shadow-raised"
              style={{ top: chipTop }}
            >
              <span className="truncate">{shortName} · window</span>
            </span>
          </div>
        );
      }
      return (
        <div
          key={exam.id}
          aria-label={`${exam.name}, ${exam.startDate}`}
          className="pointer-events-none absolute top-0 z-30 border-l border-red/80 text-red"
          style={{ left, height: timelineHeight }}
        >
          <span
            className="absolute left-1 flex h-4 max-w-28 items-center gap-1 rounded-chip bg-content/95 px-1.5 text-caption font-semibold shadow-raised"
            style={{ top: chipTop }}
          >
            <Flag aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">{shortName}</span>
          </span>
        </div>
      );
    });
}

function DependencyArrows({
  rows,
  visibleRowIndexes,
  rangeStart,
  pixelsPerDay,
}: {
  rows: TimelineRow[];
  visibleRowIndexes: ReadonlySet<number>;
  rangeStart: IsoDate;
  pixelsPerDay: number;
}) {
  const topicRows = new Map(
    rows.flatMap((row, index) =>
      row.kind === "topic" ? [[row.topic.id, { row, index }] as const] : [],
    ),
  );
  const paths = rows.flatMap((row, targetIndex) => {
    if (row.kind !== "topic" || !visibleRowIndexes.has(targetIndex)) return [];
    const targetBlock = [...row.topic.blocks].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    )[0];
    if (!targetBlock) return [];
    return row.topic.dependencyIds.flatMap((dependencyId) => {
      const dependency = topicRows.get(dependencyId);
      if (!dependency || !visibleRowIndexes.has(dependency.index)) return [];
      const dependencyBlock = [...dependency.row.topic.blocks].sort((a, b) =>
        a.endDate.localeCompare(b.endDate),
      )[0];
      if (!dependencyBlock) return [];
      const x1 =
        LABEL_WIDTH +
        (dayOffset(rangeStart, dependencyBlock.endDate) + 1) * pixelsPerDay;
      const x2 =
        LABEL_WIDTH +
        dayOffset(rangeStart, targetBlock.startDate) * pixelsPerDay;
      const y1 =
        HEADER_HEIGHT + dependency.index * ROW_HEIGHT + ROW_HEIGHT / 2;
      const y2 = HEADER_HEIGHT + targetIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const control = Math.max(24, Math.abs(x2 - x1) / 2);
      return [
        <path
          key={`${dependencyId}-${row.topic.id}`}
          d={`M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          markerEnd="url(#timeline-arrow)"
        />,
      ];
    });
  });
  if (paths.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible text-tertiary"
    >
      <defs>
        <marker
          id="timeline-arrow"
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 6 3 L 0 6 z" fill="currentColor" />
        </marker>
      </defs>
      {paths}
    </svg>
  );
}
