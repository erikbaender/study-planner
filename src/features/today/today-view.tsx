"use client";

/**
 * Today — the landing view.
 *
 * It answers the question the app is opened with: *what should I do now?* Two
 * cards, in the order the question actually decomposes:
 *
 * 1. **Today's plan** — every block scheduled across today, each with the
 *    same draggable progress control as the outline, so logging today's work
 *    happens here rather than somewhere else. The `+` in its header is this
 *    view's own way of adding a block — pick a topic and it lands on today,
 *    the one date this view is ever about — and *Reflow* still sits beside it,
 *    because scheduling has not left the app.
 * 2. **Coming up** — the next exams, with how many days and whether the
 *    course will be ready.
 *
 * Pace, streak and the slipping-courses roundup used to live here too, but a
 * landing page answering "what now" is not the place for a dashboard of
 * everything that could go wrong — the course inspector reports pace and
 * velocity for exactly that reason.
 */

import { clsx } from "clsx";
import { CalendarCheck, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import type { Course, CourseHealth, PlannerSnapshot, StudyBlock, StudyLogEntry, Topic } from "@/domain";
import { countStudyDays, isStudyDay } from "@/domain";
import { courseColorValue } from "@/domain";
import {
  Badge,
  Button,
  Card,
  CountdownBadge,
  EmptyState,
  IconButton,
  Popover,
  TextField,
  useReorderAnimation,
  useRowTransitions,
  type RowMotion,
} from "@/ui";
import { TopicProgressCell } from "@/features/topics/progress-cell";
import { PlanningActions } from "@/features/planning/planning-actions";
import { hintScope, useViewHints, type InputHint } from "@/features/workspace/hints";
import { matchesQuery, topicsForQuery } from "@/features/workspace/scope";

/** What the pointer does here, for the toolbar's hint bar. */
const TODAY_HINTS: readonly InputHint[] = [
  { button: "left", label: "Open block" },
  { button: "left", label: "Set progress", drag: true },
];

/** Bound by the trash button, the tallest thing a row carries. */
const TODAY_ROW_HEIGHT = 30;

export function TodayView({
  courses,
  health,
  studyLog,
  snapshot,
  today,
  query = "",
  selectedBlockId,
  onSelectBlock,
  onGoToOutline,
}: {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  studyLog: readonly StudyLogEntry[];
  snapshot: PlannerSnapshot;
  today: string;
  query?: string;
  selectedBlockId: string | null;
  onSelectBlock: (block: StudyBlock) => void;
  onGoToOutline: () => void;
}) {
  useViewHints(TODAY_HINTS);
  const repository = useRepository();
  const run = usePlannerRun();

  const exams = courses
    .flatMap((course) => {
      const courseHealth = health.get(course.id);
      return courseHealth?.exam && courseHealth.daysUntilExam !== null
        ? [{ course, exam: courseHealth.exam, days: courseHealth.daysUntilExam, health: courseHealth }]
        : [];
    })
    .sort((left, right) => left.days - right.days)
    .slice(0, 3);

  // Memoized because `useRowTransitions` compares the list it is handed by
  // identity, and this is the one caller that builds its list in the same
  // component that owns the hook: an unmemoized `todaysWork` would hand back a
  // fresh array on the very render the hook's own state update caused, which is
  // an infinite loop rather than an animation.
  const plannedToday = useMemo(
    () => todaysWork(courses, today, snapshot, query),
    [courses, today, snapshot, query],
  );
  const rows = useRowTransitions(plannedToday, (row) => row.block.id, TODAY_ROW_HEIGHT);
  const rowsRef = useReorderAnimation<HTMLUListElement>(
    rows.map((row) => row.key),
    TODAY_ROW_HEIGHT,
  );

  const loggedToday = studyLog
    .filter((entry) => entry.date === today)
    .reduce((sum, entry) => sum + entry.units, 0);

  if (courses.length === 0) {
    return (
      <div className="h-full" {...hintScope}>
        <EmptyState
          icon={<CalendarCheck />}
          title="Nothing in focus"
          description="No course matches the current focus. Widen it in the sidebar, or add material in the outline."
          action={
            <Button variant="accent" onClick={onGoToOutline}>
              Open the outline
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6" {...hintScope}>
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-title1 font-semibold">{formatToday(today)}</h2>
        <p className="text-body text-secondary">
          {loggedToday > 0
            ? `${loggedToday} units logged today`
            : // Not "0 units logged" — the day is not over, and a zero reads
              // like a verdict rather than a starting point.
              "Nothing logged yet today"}
        </p>
      </header>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-title3 font-semibold">Today’s plan</h3>
          {plannedToday.length > 0 ? (
            <span className="text-callout tabular-nums text-secondary">
              {plannedToday.reduce((sum, row) => sum + row.units, 0)} units across{" "}
              {plannedToday.length} block{plannedToday.length === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <AddToTodayMenu courses={courses} today={today} />
            <PlanningActions size="sm" courses={courses} snapshot={snapshot} today={today} />
          </span>
        </div>
        {plannedToday.length === 0 ? (
          <p className="text-body text-secondary">
            {isStudyDay(today, snapshot.preferences)
              ? "Nothing is scheduled for today. Add something with the + above, or let Reflow build a plan from what is left."
              : // A day off is not an empty day. Saying "nothing scheduled"
                // would read as a failure to plan rather than as a rest day.
                "Today is not one of your study days."}
          </p>
        ) : (
          <ul ref={rowsRef} className="flex flex-col">
            {rows.map(({ key, item, motion }) => (
              <TodayBlockRow
                key={key}
                rowKey={key}
                course={item.course}
                topic={item.topic}
                units={item.units}
                today={today}
                selected={item.block.id === selectedBlockId}
                motion={motion}
                onSelect={() => onSelectBlock(item.block)}
                onDelete={() => run(repository.deleteStudyBlock(item.block.id))}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-title3 font-semibold">Coming up</h3>
        {exams.length === 0 ? (
          <p className="text-body text-secondary">
            No exam dates on the courses in focus. Add one — a provisional window is enough for the
            app to start planning backwards from it.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {exams.map(({ course, exam, days, health: courseHealth }) => (
              <li key={exam.id} className="flex items-center gap-3 text-body">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: courseColorValue(course.color) }}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-tertiary">{course.name} · </span>
                  {exam.name}
                </span>
                {courseHealth.pace ? (
                  <Badge tone={courseHealth.pace.onTrack ? "positive" : "warning"}>
                    {courseHealth.pace.onTrack ? "On track" : "Behind"}
                  </Badge>
                ) : null}
                <span className="w-24 shrink-0 text-right text-callout tabular-nums text-secondary">
                  {exam.startDate}
                </span>
                <CountdownBadge days={days} provisional={exam.status === "provisional"} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * One block in "Today's plan".
 *
 * Deliberately not shared with the outline's topic row: that row selects and
 * deletes a *topic*, and this one selects and deletes a *block* — the same
 * slider, a different subject and a different trash target, so one component
 * would mean threading two incompatible sets of handlers through one prop list.
 */
function TodayBlockRow({
  rowKey,
  course,
  topic,
  units,
  today,
  selected,
  motion,
  onSelect,
  onDelete,
}: {
  rowKey: string;
  course: Course;
  topic: Topic;
  units: number;
  today: string;
  selected: boolean;
  /** Where this row is in an arrival or a departure; see `@/ui/row-motion`. */
  motion: RowMotion;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const tint = courseColorValue(course.color);
  return (
    <li
      data-row-key={rowKey}
      data-course-id={course.id}
      inert={!motion.visible}
      className={clsx(
        "topic-completion-row row-motion group flex items-center gap-3 rounded-control px-2 py-1",
        selected ? "bg-accent-soft" : "hover:bg-fill",
      )}
      style={
        {
          height: motion.height,
          opacity: motion.visible ? 1 : 0,
          "--topic-completion-color": tint,
        } as CSSProperties
      }
    >
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: tint }}
      />
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="min-w-0 flex-1 truncate rounded-chip text-left text-body"
      >
        <span className="text-tertiary">
          {course.name} · {units} today ·{" "}
        </span>
        {topic.name}
      </button>

      <TopicProgressCell
        topic={topic}
        today={today}
        tint={tint}
        sliderClassName="w-48 shrink-0"
        readoutClassName="w-32 shrink-0 text-right text-callout tabular-nums whitespace-nowrap text-secondary"
      />

      <IconButton
        size="sm"
        label={`Remove ${topic.name} from today`}
        icon={<Trash2 />}
        onClick={onDelete}
      />
    </li>
  );
}

/**
 * The `+` beside "Today's plan": this view's own way of adding a block. Every
 * other add path in the app names a topic and a date range; here the range is
 * always today, so the picker only ever has to name the topic.
 */
function AddToTodayMenu({ courses, today }: { courses: readonly Course[]; today: string }) {
  const repository = useRepository();
  const run = usePlannerRun();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const options = useMemo(() => addableTopics(courses, today, search), [courses, today, search]);

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      align="end"
      className="w-72"
      trigger={
        <span>
          <IconButton size="sm" label="Add to today" icon={<Plus />} />
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        <TextField
          label="Search topics"
          hideLabel
          placeholder="Search topics…"
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {options.length === 0 ? (
          <p className="px-1 py-2 text-callout text-tertiary">
            Nothing left to add — every topic in focus is already on today.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {options.map(({ course, topic }) => (
              <li key={topic.id}>
                <button
                  type="button"
                  onClick={() => {
                    run(
                      repository.createStudyBlock({
                        topicId: topic.id,
                        startDate: today,
                        endDate: today,
                        source: "manual",
                      }),
                    );
                    close();
                  }}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-control px-2 py-1 text-left text-body hover:bg-fill"
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: courseColorValue(course.color) }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-tertiary">{course.name} · </span>
                    {topic.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}

/**
 * What the scheduler has put in today, one row per block.
 *
 * A block spans several days and carries the units it means to cover across all
 * of them, so today's share is that total divided by the block's *study* days —
 * dividing by calendar days would quietly under-count every block that spans a
 * weekend, and the number is the one thing the card exists to state.
 */
function todaysWork(
  courses: readonly Course[],
  today: string,
  snapshot: PlannerSnapshot,
  query: string,
): Array<{ course: Course; topic: Topic; block: StudyBlock; units: number }> {
  const rows: Array<{ course: Course; topic: Topic; block: StudyBlock; units: number }> = [];

  for (const course of courses) {
    for (const topic of topicsForQuery(query, course)) {
      for (const block of topic.blocks) {
        if (block.startDate > today || block.endDate < today) continue;
        rows.push({ course, topic, block, units: unitsToday(block, snapshot) });
      }
    }
  }

  return rows;
}

function unitsToday(block: StudyBlock, snapshot: PlannerSnapshot): number {
  const planned = block.plannedUnits ?? 0;
  if (planned === 0) return 0;
  const days = countStudyDays(block.startDate, block.endDate, snapshot.preferences);
  return Math.max(1, Math.round(planned / Math.max(days, 1)));
}

/** Whether a topic already has a block covering today. */
function isScheduledToday(topic: Topic, today: string): boolean {
  return topic.blocks.some((block) => block.startDate <= today && block.endDate >= today);
}

/** Every topic in focus that is not already on today's plan, narrowed by the picker's own search field. */
function addableTopics(
  courses: readonly Course[],
  today: string,
  search: string,
): Array<{ course: Course; topic: Topic }> {
  return courses.flatMap((course) =>
    course.topics
      .filter((topic) => !isScheduledToday(topic, today))
      .filter((topic) => matchesQuery(search, topic.name, course.name))
      .map((topic) => ({ course, topic })),
  );
}

/** "Saturday, 1 August" — the date as a person says it, not as a machine stores it. */
function formatToday(today: string): string {
  return new Date(`${today}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
