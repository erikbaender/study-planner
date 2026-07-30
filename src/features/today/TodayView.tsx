"use client";

import { CalendarDays, Clock3, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import {
  assessCourse,
  daysUntil,
  nextExam,
  type Course,
  type Plan,
  type PlannerSnapshot,
  type Topic,
} from "@/domain";
import { Badge, Button, Card, EmptyState, ProgressBar } from "@/ui";
import type { SmartView } from "@/features/shell/workspace-store";

type ScheduledTopic = {
  course: Course;
  topic: Topic;
  target: number | null;
};

export function TodayView({
  plan,
  snapshot,
  today,
  smartView,
  onSelectCourse,
  onSelectTopic,
  onCreate,
}: {
  plan: Plan;
  snapshot: PlannerSnapshot;
  today: string;
  smartView: SmartView;
  onSelectCourse: (courseId: string) => void;
  onSelectTopic: (topicId: string, courseId: string) => void;
  onCreate: () => void;
}) {
  const data = useMemo(() => {
    const scheduled: ScheduledTopic[] = [];

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

    const behind = plan.courses
      .map((course) => ({
        course,
        health: assessCourse({
          course,
          today,
          calendar: snapshot.preferences,
          log: snapshot.studyLog,
          dailyCapacityUnits: snapshot.preferences.dailyCapacityUnits,
        }),
      }))
      .filter(({ health }) => health.pace && !health.pace.onTrack);

    return { scheduled, upcoming, behind };
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
              <button
                key={course.id}
                type="button"
                onClick={() => onSelectCourse(course.id)}
                className="text-left"
              >
                <Card className="flex items-center gap-3 transition-colors hover:bg-fill">
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
                </Card>
              </button>
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-title3 font-semibold">Study plan</h3>
            <span className="text-callout text-secondary">{data.scheduled.length} topics</span>
          </div>
          {data.scheduled.length ? (
            <ul className="flex flex-col gap-1">
              {data.scheduled.map(({ course, topic, target }) => (
                <li key={topic.id}>
                  <button
                    type="button"
                    onClick={() => onSelectTopic(topic.id, course.id)}
                    className="flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-fill"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: course.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium">{topic.name}</span>
                      <span className="block truncate text-caption text-tertiary">
                        {course.name}
                      </span>
                    </span>
                    <span className="text-callout tabular-nums text-secondary">
                      {target === null ? "Scheduled" : `${target} ${topic.unit}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-body text-secondary">
              No study blocks are scheduled for today.
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h3 className="text-title3 font-semibold">Next exams</h3>
          {nextExam.length ? (
            <ul className="flex flex-col gap-2">
              {nextExam.map(({ course, exam }) => (
                <li key={exam.id}>
                  <button
                    type="button"
                    onClick={() => onSelectCourse(course.id)}
                    className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-fill"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium">{exam.name}</span>
                      <span className="block truncate text-caption text-tertiary">{course.name}</span>
                    </span>
                    <Badge variant={exam.status === "provisional" ? "outline" : "solid"}>
                      {daysUntil(exam.startDate, today)}d
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-secondary">No upcoming exams are recorded.</p>
          )}
        </Card>
      </div>
    </ViewFrame>
  );
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
