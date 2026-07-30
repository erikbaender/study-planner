"use client";

import {
  CalendarDays,
  Clock3,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  assessCourse,
  daysUntil,
  nextExam,
  UNIT_LABELS,
  type Course,
  type Plan,
  type PlannerSnapshot,
  type ScheduleResult,
  type Topic,
} from "@/domain";
import { Badge, Button, Card, Checkbox, EmptyState, ProgressBar, Stepper } from "@/ui";
import {
  CoursePaceBadge,
  describeCoursePace,
} from "@/features/progress/CoursePace";
import type { SmartView } from "@/features/shell/workspace-store";

type ScheduledTopic = {
  course: Course;
  topic: Topic;
  target: number | null;
  loggedToday: number;
};

const UNIT_NUMBER = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function TodayView({
  plan,
  snapshot,
  today,
  smartView,
  onSelectCourse,
  onSelectTopic,
  onCreate,
  schedule,
  capacity,
  hasAutoSchedule,
  planning,
  onCapacityChange,
  onApplySchedule,
  onLogStudy,
}: {
  plan: Plan;
  snapshot: PlannerSnapshot;
  today: string;
  smartView: SmartView;
  onSelectCourse: (courseId: string) => void;
  onSelectTopic: (topicId: string, courseId: string) => void;
  onCreate: () => void;
  schedule: ScheduleResult;
  capacity: string;
  hasAutoSchedule: boolean;
  planning: boolean;
  onCapacityChange: (value: string) => void;
  onApplySchedule: () => void;
  onLogStudy: (topicId: string, units: number) => void;
}) {
  const data = useMemo(() => {
    const scheduled: ScheduledTopic[] = [];
    const loggedTodayByTopic = new Map<string, number>();
    for (const entry of snapshot.studyLog) {
      if (entry.date !== today) continue;
      loggedTodayByTopic.set(
        entry.topicId,
        (loggedTodayByTopic.get(entry.topicId) ?? 0) + entry.units,
      );
    }

    for (const course of plan.courses) {
      for (const topic of course.topics) {
        const blocks = topic.blocks.filter(
          (block) => block.startDate <= today && block.endDate >= today,
        );
        if (blocks.length) {
          scheduled.push({
            course,
            topic,
            target: blocks.reduce((sum, block) => sum + (block.plannedUnits ?? 0), 0) || null,
            loggedToday: loggedTodayByTopic.get(topic.id) ?? 0,
          });
        }
      }
    }

    const upcoming = plan.courses
      .flatMap((course) =>
        course.exams.map((exam) => ({
          course,
          exam,
          days: daysUntil(exam.startDate, today),
        })),
      )
      .filter(({ days }) => days >= 0 && days <= 30)
      .sort((a, b) => a.days - b.days);

    const health = plan.courses.map((course) => ({
        course,
        health: assessCourse({
          course,
          today,
          calendar: snapshot.preferences,
          log: snapshot.studyLog,
          dailyCapacityUnits: snapshot.preferences.dailyCapacityUnits,
        }),
      }));
    const healthByCourse = new Map(health.map((item) => [item.course.id, item.health]));
    const behind = health.filter(({ health }) => health.pace && !health.pace.onTrack);

    return { scheduled, upcoming, healthByCourse, behind };
  }, [plan, snapshot, today]);

  if (smartView === "upcoming") {
    return (
      <ViewFrame
        icon={<Clock3 />}
        eyebrow="Smart view"
        title="Upcoming"
        description="Exams and deadlines in the next 30 days."
      >
        {data.upcoming.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.upcoming.map(({ course, exam, days }) => (
              <button
                key={exam.id}
                type="button"
                onClick={() => onSelectCourse(course.id)}
                className="text-left"
              >
                <Card className="flex h-full items-center gap-3 transition-colors hover:bg-fill">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: course.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold">{exam.name}</span>
                    <span className="block truncate text-callout text-secondary">
                      {course.name} · {exam.startDate}
                    </span>
                  </span>
                  <Badge tone={days <= 3 ? "red" : days <= 10 ? "orange" : "neutral"}>
                    {days === 0 ? "Today" : `${days}d`}
                  </Badge>
                </Card>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing due soon"
            description="No exams or deadlines fall within the next 30 days."
            action={<Button onClick={onCreate}>Add an exam or course</Button>}
          />
        )}
      </ViewFrame>
    );
  }

  if (smartView === "behind") {
    return (
      <ViewFrame
        icon={<TriangleAlert />}
        eyebrow="Smart view"
        title="Behind"
        description="Courses whose current pace does not reach the next exam."
      >
        {data.behind.length ? (
          <div className="flex flex-col gap-3">
            {data.behind.map(({ course, health }) => (
              <Card key={course.id} className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onSelectCourse(course.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: course.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold">{course.name}</span>
                    <span className="block text-callout text-secondary">
                      {health.pace?.daysLate
                        ? `Projected ${health.pace.daysLate} days late`
                        : "Current pace is below the required pace"}
                    </span>
                  </span>
                  <ProgressBar
                    ratio={health.progress.ratio}
                    label={`${course.name} progress`}
                    tint={course.color}
                    className="w-32"
                  />
                </button>
                <Button
                  size="sm"
                  leadingIcon={<RefreshCw />}
                  disabled={planning || schedule.capacityUnits === null}
                  onClick={onApplySchedule}
                >
                  Reflow
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No course is behind"
            description="Every measurable course with an upcoming exam is currently on pace."
            action={<Button onClick={onCreate}>Add material</Button>}
          />
        )}
      </ViewFrame>
    );
  }

  const nextExam = plan.courses
    .map((course) => ({ course, exam: nextExamForCourse(course, today) }))
    .filter((item): item is { course: Course; exam: NonNullable<typeof item.exam> } =>
      Boolean(item.exam),
    )
    .sort((a, b) => a.exam.startDate.localeCompare(b.exam.startDate))
    .slice(0, 3);

  return (
    <ViewFrame
      icon={<CalendarDays />}
      eyebrow={today}
      title="Today"
      description="The work scheduled for today and the nearest exams."
    >
      {data.behind.length ? (
        <div className="flex flex-col gap-2">
          {data.behind.slice(0, 3).map(({ course, health }) => (
            <div
              key={course.id}
              role="status"
              className="flex items-center gap-3 rounded-card bg-orange/10 px-4 py-3 text-body inset-ring inset-ring-orange/25"
            >
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-orange" />
              <p className="min-w-0 flex-1">
                <strong>{course.name}</strong>{" "}
                {behindMessage(health.pace?.daysLate ?? 0)}
              </p>
              <Button
                size="sm"
                leadingIcon={<RefreshCw />}
                disabled={planning || schedule.capacityUnits === null}
                onClick={onApplySchedule}
              >
                Reflow
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {data.scheduled[0] ? (
            <Card className="flex items-center gap-3 bg-accent/8">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
              >
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-callout font-semibold text-accent">Next up</h3>
                <p className="truncate text-title3 font-semibold">{data.scheduled[0].topic.name}</p>
                <p className="truncate text-callout text-secondary">
                  {data.scheduled[0].course.name} ·{" "}
                  {data.scheduled[0].target === null
                    ? "Target not set"
                    : `${formatUnits(data.scheduled[0].target)} ${
                        UNIT_LABELS[data.scheduled[0].topic.unit].plural
                      }`}
                </p>
              </div>
            </Card>
          ) : null}

          <Card className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-title3 font-semibold">Study plan</h3>
              <span className="text-callout text-secondary">{data.scheduled.length} topics</span>
            </div>
            {data.scheduled.length ? (
              <ul className="flex flex-col gap-1">
                {data.scheduled.map((item) => (
                  <TodayStudyRow
                    key={item.topic.id}
                    {...item}
                    onSelect={() => onSelectTopic(item.topic.id, item.course.id)}
                    onLog={(units) => onLogStudy(item.topic.id, units)}
                  />
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-body text-secondary">
                No study blocks are scheduled for today.
              </p>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <SchedulePanel
            plan={plan}
            schedule={schedule}
            capacity={capacity}
            hasAutoSchedule={hasAutoSchedule}
            planning={planning}
            onCapacityChange={onCapacityChange}
            onApplySchedule={onApplySchedule}
          />

          <Card className="flex flex-col gap-3">
            <h3 className="text-title3 font-semibold">Next exams</h3>
            {nextExam.length ? (
              <ul className="flex flex-col gap-2">
                {nextExam.map(({ course, exam }) => {
                  const health = data.healthByCourse.get(course.id);
                  return (
                    <li key={exam.id}>
                      <button
                        type="button"
                        onClick={() => onSelectCourse(course.id)}
                        className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-fill"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium">{exam.name}</span>
                          <span className="block truncate text-caption text-tertiary">
                            {course.name}
                          </span>
                          {health ? (
                            <span className="block truncate text-caption text-secondary">
                              {describeCoursePace(health)}
                            </span>
                          ) : null}
                        </span>
                        {health ? <CoursePaceBadge health={health} /> : null}
                        <Badge variant={exam.status === "provisional" ? "outline" : "solid"}>
                          {daysUntil(exam.startDate, today)}d
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-body text-secondary">No upcoming exams are recorded.</p>
            )}
          </Card>
        </div>
      </div>
    </ViewFrame>
  );
}

function TodayStudyRow({
  course,
  topic,
  target,
  loggedToday,
  onSelect,
  onLog,
}: ScheduledTopic & {
  onSelect: () => void;
  onLog: (units: number) => void;
}) {
  const remainingTopic = Math.max(0, topic.totalUnits - topic.completedUnits);
  const remainingTarget = target === null ? null : Math.max(0, target - loggedToday);
  const [units, setUnits] = useState(() =>
    Math.min(remainingTopic, Math.max(0, remainingTarget ?? Math.min(1, remainingTopic))),
  );

  const targetComplete = remainingTarget !== null && remainingTarget === 0;
  const safeUnits = Math.min(units, remainingTopic);
  const context = topic.section
    ? `${topic.name}, ${topic.section}, ${course.name}`
    : `${topic.name}, ${course.name}`;

  return (
    <li className="flex min-w-0 items-center gap-2 rounded-control px-2 py-2 hover:bg-fill">
      <Checkbox
        checked={targetComplete}
        disabled={remainingTarget === null || targetComplete}
        ariaLabel={`Complete ${context} target`}
        label={null}
        onCheckedChange={(checked) => {
          if (checked && remainingTarget && remainingTarget > 0) onLog(remainingTarget);
        }}
      />
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: course.color }}
      />
      <button
        type="button"
        aria-label={`Open ${context}`}
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-body font-medium">{topic.name}</span>
        <span className="block truncate text-caption text-tertiary">
          {course.name}
          {target === null
            ? " · Target not set"
            : ` · ${formatUnits(loggedToday)}/${formatUnits(target)} ${
                UNIT_LABELS[topic.unit].plural
              }`}
        </span>
      </button>
      <Stepper
        value={safeUnits}
        min={0}
        max={remainingTopic}
        step={topic.unit === "hours" ? 0.5 : 1}
        label={`${context} units done`}
        disabled={remainingTopic === 0}
        onValueChange={setUnits}
      />
      <Button
        size="sm"
        aria-label={`Log ${context} units`}
        disabled={safeUnits <= 0 || remainingTopic === 0}
        onClick={() => {
          onLog(safeUnits);
          setUnits(0);
        }}
      >
        Log
      </Button>
    </li>
  );
}

function SchedulePanel({
  plan,
  schedule,
  capacity,
  hasAutoSchedule,
  planning,
  onCapacityChange,
  onApplySchedule,
}: {
  plan: Plan;
  schedule: ScheduleResult;
  capacity: string;
  hasAutoSchedule: boolean;
  planning: boolean;
  onCapacityChange: (value: string) => void;
  onApplySchedule: () => void;
}) {
  const infeasible = schedule.courses.filter((course) => course.status === "infeasible");
  const withoutDeadline = schedule.courses.filter((course) => course.status === "no-deadline");
  const courseById = new Map(plan.courses.map((course) => [course.id, course]));

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="schedule-heading">
      <div>
        <h3 id="schedule-heading" className="text-title3 font-semibold">
          Schedule
        </h3>
        <p className="text-callout text-secondary">
          Preview generated work before replacing future automatic blocks.
        </p>
      </div>

      <label className="flex items-center justify-between gap-3 text-body">
        <span>Daily capacity</span>
        <span className="flex items-center gap-1.5">
          <input
            type="number"
            min={0.1}
            step="any"
            inputMode="decimal"
            aria-label="What-if daily capacity"
            value={capacity}
            onChange={(event) => onCapacityChange(event.currentTarget.value)}
            className="h-control-lg w-20 rounded-control bg-content px-2 text-right text-body tabular-nums inset-ring inset-ring-[var(--mac-control-border)]"
          />
          <span className="text-callout text-secondary">units/day</span>
        </span>
      </label>

      <div aria-live="polite" className="rounded-control bg-fill px-3 py-2 text-callout">
        {schedule.capacityUnits === null ? (
          <p>Set a positive capacity to preview a schedule.</p>
        ) : infeasible.length ? (
          <div className="flex flex-col gap-1.5">
            <p className="font-semibold text-orange">
              {formatUnits(schedule.shortfallUnits)} units do not fit before the exams.
            </p>
            {infeasible.slice(0, 3).map((course) => (
              <p key={course.courseId} className="text-secondary">
                {courseById.get(course.courseId)?.name ?? "Course"} needs{" "}
                {formatUnits(course.requiredDailyUnits ?? 0)}/day;{" "}
                {formatUnits(course.shortfallUnits)} units over.
              </p>
            ))}
          </div>
        ) : (
          <p className="text-green">
            {schedule.blocks.length
              ? `${formatUnits(
                  schedule.blocks.reduce((sum, block) => sum + block.plannedUnits, 0),
                )} units fit across ${schedule.blocks.length} study blocks.`
              : "No measured work needs an automatic block."}
          </p>
        )}
      </div>

      {withoutDeadline.length ? (
        <p className="text-callout text-secondary">
          {withoutDeadline.length}{" "}
          {withoutDeadline.length === 1 ? "course has" : "courses have"} remaining work but no
          upcoming exam, so {withoutDeadline.length === 1 ? "it was" : "they were"} not scheduled.
        </p>
      ) : null}
      {schedule.unsizedTopicCount ? (
        <p className="text-callout text-secondary">
          {schedule.unsizedTopicCount} unmeasured{" "}
          {schedule.unsizedTopicCount === 1 ? "topic was" : "topics were"} excluded.
        </p>
      ) : null}
      {schedule.unmeasuredManualBlockCount ? (
        <p className="text-callout text-secondary">
          {schedule.unmeasuredManualBlockCount} manual{" "}
          {schedule.unmeasuredManualBlockCount === 1 ? "block has" : "blocks have"} no target;
          preserved without guessing its capacity.
        </p>
      ) : null}

      <Button
        variant="accent"
        leadingIcon={hasAutoSchedule ? <RefreshCw /> : <Sparkles />}
        disabled={planning || schedule.capacityUnits === null}
        onClick={onApplySchedule}
      >
        {planning
          ? "Updating schedule…"
          : hasAutoSchedule
            ? "Reflow from today"
            : "Auto-plan semester"}
      </Button>
    </Card>
  );
}

function behindMessage(daysLate: number): string {
  return daysLate > 0
    ? `is projected ${daysLate} ${daysLate === 1 ? "day" : "days"} late.`
    : "is below the pace needed for its next exam.";
}

function formatUnits(value: number): string {
  return UNIT_NUMBER.format(value);
}

function ViewFrame({
  icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 flex size-8 items-center justify-center rounded-control bg-fill text-secondary [&_svg]:size-4"
        >
          {icon}
        </span>
        <div>
          <p className="text-callout text-secondary">{eyebrow}</p>
          <h2 className="text-title1 font-semibold">{title}</h2>
          <p className="mt-1 text-body text-secondary">{description}</p>
        </div>
      </header>
      {children}
    </div>
  );
}

function nextExamForCourse(course: Course, today: string) {
  return nextExam(course, today);
}
