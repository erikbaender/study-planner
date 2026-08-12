"use client";

/**
 * Today — the landing view.
 *
 * It answers the question the app is opened with: *what should I do now?* Three
 * cards, in the order the question actually decomposes:
 *
 * 1. **What is coming** — the next exams, with how many days and whether the
 *    course will be ready.
 * 2. **What is slipping** — the courses that will not finish in time, with the
 *    size of the gap.
 * 3. **What to pick up** — the topics already in progress, each with the same
 *    draggable bar as the outline, so logging today's work happens here rather
 *    than somewhere else.
 *
 * Phase 6 adds the scheduler's blocks for the day above all three, and the
 * *Reflow* recovery action to card 2. Everything here is computed from work
 * already recorded, which is why it can exist before the scheduler does.
 */

import { CalendarCheck } from "lucide-react";
import type {
  Course,
  CourseHealth,
  StudyLogEntry,
  Topic,
} from "@/domain";
import type { PlannerSnapshot, StudyBlock } from "@/domain";
import { countStudyDays, isStudyDay, studyStreak, velocity, VELOCITY_WINDOW_DAYS } from "@/domain";
import { courseColorValue } from "@/domain";
import { Badge, Button, Card, CountdownBadge, EmptyState } from "@/ui";
import { TopicRow } from "@/features/topics/topic-row";
import { PlanningActions } from "@/features/planning/planning-actions";
import { hintScope, useViewHints, type InputHint } from "@/features/workspace/hints";
import { topicsForQuery } from "@/features/workspace/scope";

/** What the pointer does here, for the toolbar's hint bar. */
const TODAY_HINTS: readonly InputHint[] = [
  { button: "left", label: "Select topic" },
  { button: "left", label: "Set progress", drag: true },
  { button: "right", label: "Actions" },
];

/** How many topics the "continue" card offers. A list you scroll is a backlog, not a suggestion. */
const CONTINUE_LIMIT = 8;

/**
 * And at most this many from any one course. Without it the course with the
 * nearest exam fills every slot, which is a plan for the week rather than a
 * shortlist for today, and hides that nine other courses exist.
 */
const CONTINUE_PER_COURSE = 2;

/** How many slipping courses the card names before it starts counting them instead. */
const BEHIND_LIMIT = 5;

export function TodayView({
  courses,
  health,
  studyLog,
  snapshot,
  today,
  query = "",
  selectedTopicId,
  onSelectTopic,
  onDeleteTopic,
  onGoToOutline,
}: {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  studyLog: readonly StudyLogEntry[];
  snapshot: PlannerSnapshot;
  today: string;
  query?: string;
  selectedTopicId: string | null;
  onSelectTopic: (course: Course, topic: Topic) => void;
  onDeleteTopic: (course: Course, topic: Topic) => void;
  onGoToOutline: () => void;
}) {
  useViewHints(TODAY_HINTS);
  const exams = courses
    .flatMap((course) => {
      const courseHealth = health.get(course.id);
      return courseHealth?.exam && courseHealth.daysUntilExam !== null
        ? [{ course, exam: courseHealth.exam, days: courseHealth.daysUntilExam, health: courseHealth }]
        : [];
    })
    .sort((left, right) => left.days - right.days)
    .slice(0, 3);

  const behind = courses.filter((course) => {
    const pace = health.get(course.id)?.pace;
    return pace ? !pace.onTrack : false;
  });

  // Capped: a ten-row list of everything that is slipping is a wall, and the
  // two courses at the bottom of it are the ones you were never going to reach
  // today anyway. Sorted by how near the exam is, so the cut falls in the right
  // place.
  const behindShown = behind
    .slice()
    .sort(
      (left, right) =>
        (health.get(left.id)?.daysUntilExam ?? Infinity) -
        (health.get(right.id)?.daysUntilExam ?? Infinity),
    )
    .slice(0, BEHIND_LIMIT);

  const plannedToday = todaysWork(courses, today, snapshot, query);

  // Measured over the whole plan rather than the focus: a pace figure that
  // changed when you clicked a sidebar row would be describing the filter
  // rather than the person.
  const pace = velocity(snapshot.studyLog, today, snapshot.preferences, VELOCITY_WINDOW_DAYS);
  const streak = studyStreak(snapshot.studyLog, today, snapshot.preferences);

  const continueTopics = pickUpNext(courses, health, CONTINUE_LIMIT, query);

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
        <dl className="ml-auto flex items-baseline gap-5">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-callout text-tertiary">Pace</dt>
            <dd className="text-body tabular-nums">
              {pace > 0
                ? `${pace.toFixed(1)} / day`
                : // No work in the window is not a pace of zero, it is no
                  // measurement. A "0.0 / day" here would be a verdict drawn
                  // from an empty week.
                  "not measured yet"}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-callout text-tertiary">Streak</dt>
            <dd className="text-body tabular-nums">
              {streak > 0 ? `${streak} day${streak === 1 ? "" : "s"}` : "—"}
            </dd>
          </div>
        </dl>
      </header>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-title3 font-semibold">Today’s plan</h3>
          {plannedToday.length > 0 ? (
            <span className="text-callout tabular-nums text-secondary">
              {plannedToday.reduce((sum, row) => sum + row.units, 0)} units across{" "}
              {plannedToday.length} topic{plannedToday.length === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="ml-auto">
            <PlanningActions size="sm" courses={courses} snapshot={snapshot} today={today} />
          </span>
        </div>
        {plannedToday.length === 0 ? (
          <p className="text-body text-secondary">
            {isStudyDay(today, snapshot.preferences)
              ? "Nothing is scheduled for today. Reflow builds a plan from what is left and how long there is to do it."
              : // A day off is not an empty day. Saying "nothing scheduled"
                // would read as a failure to plan rather than as a rest day.
                "Today is not one of your study days."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {plannedToday.map(({ course, topic, units }) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                today={today}
                courseId={course.id}
                courseColor={courseColorValue(course.color)}
                prefix={`${course.name} · ${units} today`}
                selected={topic.id === selectedTopicId}
                onSelect={() => onSelectTopic(course, topic)}
                onDelete={() => onDeleteTopic(course, topic)}
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

      {behind.length > 0 ? (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-title3 font-semibold">Behind</h3>
            <span className="ml-auto">
              <PlanningActions size="sm" courses={behind} snapshot={snapshot} today={today} />
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {behindShown.map((course) => {
              const pace = health.get(course.id)!.pace!;
              return (
                <li key={course.id} className="flex items-center gap-3 text-body">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: courseColorValue(course.color) }}
                  />
                  <span className="min-w-0 flex-1 truncate">{course.name}</span>
                  <span className="shrink-0 text-callout tabular-nums text-secondary">
                    {pace.remainingUnits} units left
                  </span>
                  <Badge tone="warning">
                    {Number.isFinite(pace.requiredPace)
                      ? `${Math.ceil(pace.requiredPace)} / day needed`
                      : "No days left"}
                  </Badge>
                </li>
              );
            })}
          </ul>
          <p className="text-footnote text-tertiary">
            {behind.length > behindShown.length
              ? `${behind.length - behindShown.length} more behind. Needed pace counts only the days you have marked as study days.`
              : "Needed pace counts only the days you have marked as study days."}
          </p>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h3 className="text-title3 font-semibold">Pick up where you left off</h3>
        {continueTopics.length === 0 ? (
          <p className="text-body text-secondary">
            Nothing is part-finished. Start anything from the outline and it will appear here.
          </p>
        ) : (
          <ul className="flex flex-col">
            {continueTopics.map(({ course, topic }) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                today={today}
                courseId={course.id}
                courseColor={courseColorValue(course.color)}
                prefix={course.name}
                selected={topic.id === selectedTopicId}
                onSelect={() => onSelectTopic(course, topic)}
                onDelete={() => onDeleteTopic(course, topic)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * What the scheduler has put in today.
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
): Array<{ course: Course; topic: Topic; units: number }> {
  const rows: Array<{ course: Course; topic: Topic; units: number }> = [];

  for (const course of courses) {
    for (const topic of topicsForQuery(query, course)) {
      for (const block of topic.blocks) {
        if (block.startDate > today || block.endDate < today) continue;
        rows.push({ course, topic, units: unitsToday(block, snapshot) });
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

/**
 * What to offer next.
 *
 * Started-but-unfinished topics first, because finishing something in flight
 * beats opening something new; within that, the courses with the nearest exam
 * come first. Untouched topics are only offered once there is nothing in
 * flight — this is a "carry on" list, not a scheduler, and the scheduler in
 * phase 6 is what will make the ordering answerable properly.
 */
function pickUpNext(
  courses: readonly Course[],
  health: Map<string, CourseHealth>,
  limit: number,
  query: string,
): Array<{ course: Course; topic: Topic }> {
  const urgency = (course: Course) => health.get(course.id)?.daysUntilExam ?? Infinity;

  const rows = courses.flatMap((course) =>
    topicsForQuery(query, course)
      .filter((topic) => topic.status !== "done" && topic.totalUnits > 0)
      .map((topic) => ({ course, topic })),
  );

  const started = rows.filter(
    ({ topic }) => topic.completedUnits > 0 && topic.completedUnits < topic.totalUnits,
  );
  const untouched = rows.filter(({ topic }) => topic.completedUnits === 0);

  const byUrgency = (
    left: { course: Course; topic: Topic },
    right: { course: Course; topic: Topic },
  ) => urgency(left.course) - urgency(right.course) || left.topic.order - right.topic.order;

  return capPerCourse([...started.sort(byUrgency), ...untouched.sort(byUrgency)], limit);
}

function capPerCourse(
  rows: Array<{ course: Course; topic: Topic }>,
  limit: number,
): Array<{ course: Course; topic: Topic }> {
  const taken = new Map<string, number>();
  const kept: Array<{ course: Course; topic: Topic }> = [];

  for (const row of rows) {
    if (kept.length === limit) break;
    const used = taken.get(row.course.id) ?? 0;
    if (used === CONTINUE_PER_COURSE) continue;
    taken.set(row.course.id, used + 1);
    kept.push(row);
  }

  return kept;
}

/** "Saturday, 1 August" — the date as a person says it, not as a machine stores it. */
function formatToday(today: string): string {
  return new Date(`${today}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
