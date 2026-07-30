"use client";

import { BookOpen, GraduationCap, X } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import {
  UNIT_LABELS,
  assessCourse,
  courseProgress,
  type Course,
  type Plan,
  type PlannerSnapshot,
  type Topic,
} from "@/domain";
import type { StudyLogInput } from "@/data/repository";
import { CoursePaceBadge, CoursePaceDetails } from "@/features/progress/CoursePace";
import { StudyHistory } from "@/features/progress/StudyHistory";
import {
  IconButton,
  ProgressBar,
  ProgressSlider,
  Separator,
  Tooltip,
} from "@/ui";
import type { WorkspaceSelection } from "@/features/shell/workspace-store";

export function InspectorPane({
  plan,
  snapshot,
  selection,
  today,
  onClose,
  onLogStudy,
}: {
  plan: Plan;
  snapshot: PlannerSnapshot;
  selection: WorkspaceSelection;
  today: string;
  onClose: () => void;
  onLogStudy: (input: StudyLogInput) => void;
}) {
  const resolved = useMemo(() => resolveSelection(plan, selection), [plan, selection]);

  return (
    <aside
      aria-label="Inspector"
      className="material-sidebar flex w-72 shrink-0 flex-col border-l border-separator"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-separator px-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold">Inspector</h2>
          <p className="truncate text-caption text-tertiary">
            {resolved?.kind === "topic"
              ? "Topic"
              : resolved?.kind === "course"
                ? "Course"
                : "Nothing selected"}
          </p>
        </div>
        <Tooltip content="Hide inspector">
          <IconButton size="sm" label="Hide inspector" icon={<X />} onClick={onClose} />
        </Tooltip>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {resolved?.kind === "topic" ? (
          <TopicInspector
            topic={resolved.topic}
            course={resolved.course}
            snapshot={snapshot}
            today={today}
            onLogStudy={onLogStudy}
          />
        ) : resolved?.kind === "course" ? (
          <CourseInspector
            course={resolved.course}
            snapshot={snapshot}
            today={today}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <BookOpen aria-hidden="true" className="size-7 text-tertiary" />
            <p className="text-body font-medium">Select a course or topic</p>
            <p className="text-callout text-secondary">
              Its progress, exam, dependencies, and notes will appear here.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function TopicInspector({
  topic,
  course,
  snapshot,
  today,
  onLogStudy,
}: {
  topic: Topic;
  course: Course;
  snapshot: PlannerSnapshot;
  today: string;
  onLogStudy: (input: StudyLogInput) => void;
}) {
  const unit = UNIT_LABELS[topic.unit];

  return (
    <div className="flex flex-col gap-4">
      <InspectorTitle icon={<BookOpen />} eyebrow={course.name} title={topic.name} />

      <section className="flex flex-col gap-2" aria-labelledby="topic-progress-title">
        <div className="flex items-center gap-2">
          <h3 id="topic-progress-title" className="text-callout font-semibold text-secondary">
            Progress
          </h3>
          <span className="ml-auto text-callout tabular-nums text-secondary">
            {topic.totalUnits > 0
              ? `${topic.completedUnits} / ${topic.totalUnits} ${unit.plural}`
              : "No size set"}
          </span>
        </div>
        {topic.totalUnits > 0 ? (
          <ProgressSlider
            value={topic.completedUnits}
            max={topic.totalUnits}
            label={`${topic.name} progress`}
            valueText={(value) => `${value} of ${topic.totalUnits} ${unit.plural}`}
            tint={topic.color}
            onCommit={(value) =>
              onLogStudy({
                topicId: topic.id,
                date: today,
                units: value - topic.completedUnits,
              })
            }
          />
        ) : (
          <ProgressBar ratio={null} label={`${topic.name} progress`} />
        )}
      </section>

      <Separator />

      <StudyHistory
        topic={topic}
        entries={snapshot.studyLog}
        today={today}
        onLogStudy={onLogStudy}
      />

      <Separator />

      <DefinitionList
        rows={[
          ["Section", topic.section || "None"],
          ["Status", sentenceCase(topic.status)],
          ["Priority", sentenceCase(topic.priority)],
          ["Unit", unit.plural],
          ["Study blocks", String(topic.blocks.length)],
        ]}
      />

      <Separator />

      <section className="flex flex-col gap-1.5">
        <h3 className="text-callout font-semibold text-secondary">Dependencies</h3>
        {topic.dependencyIds.length ? (
          <p className="text-body">{topic.dependencyIds.length} linked topic(s)</p>
        ) : (
          <p className="text-body text-tertiary">No dependencies</p>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-callout font-semibold text-secondary">Notes</h3>
        <p className={topic.notes ? "text-body whitespace-pre-wrap" : "text-body text-tertiary"}>
          {topic.notes || "No notes"}
        </p>
      </section>
    </div>
  );
}

function CourseInspector({
  course,
  snapshot,
  today,
}: {
  course: Course;
  snapshot: PlannerSnapshot;
  today: string;
}) {
  const health = assessCourse({
    course,
    today,
    calendar: snapshot.preferences,
    log: snapshot.studyLog,
    dailyCapacityUnits: snapshot.preferences.dailyCapacityUnits,
  });
  const progress = courseProgress(course);

  return (
    <div className="flex flex-col gap-4">
      <InspectorTitle icon={<GraduationCap />} eyebrow="Course" title={course.name} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-callout font-semibold text-secondary">Progress</h3>
          <span className="ml-auto text-callout tabular-nums text-secondary">
            {progress.ratio === null ? "No measured topics" : `${Math.round(progress.ratio * 100)}%`}
          </span>
        </div>
        <ProgressBar ratio={progress.ratio} label={`${course.name} progress`} tint={course.color} />
      </section>

      <CoursePaceBadge health={health} />

      <section className="flex flex-col gap-2" aria-labelledby="course-pace-title">
        <h3 id="course-pace-title" className="text-callout font-semibold text-secondary">
          Pace and projection
        </h3>
        <CoursePaceDetails health={health} />
      </section>

      <Separator />

      <DefinitionList
        rows={[
          ["Topics", String(course.topics.length)],
          ["Exams", String(course.exams.length)],
          [
            "Measured work",
            progress.totalUnits > 0
              ? `${progress.completedUnits} / ${progress.totalUnits} units`
              : "Not known",
          ],
          [
            "Next exam",
            health.exam
              ? health.exam.status === "provisional" && health.exam.endDate
                ? `${health.exam.startDate} – ${health.exam.endDate} (provisional)`
                : `${health.exam.startDate} (${health.exam.status})`
              : "Not set",
          ],
        ]}
      />

      <Separator />

      <section className="flex flex-col gap-1.5">
        <h3 className="text-callout font-semibold text-secondary">Notes</h3>
        <p className={course.notes ? "text-body whitespace-pre-wrap" : "text-body text-tertiary"}>
          {course.notes || "No notes"}
        </p>
      </section>
    </div>
  );
}

function InspectorTitle({
  icon,
  eyebrow,
  title,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control bg-fill text-secondary [&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-caption text-tertiary">{eyebrow}</p>
        <h3 className="text-title3 font-semibold break-words">{title}</h3>
      </div>
    </div>
  );
}

function DefinitionList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-callout">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-tertiary">{label}</dt>
          <dd className="min-w-0 text-right font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function resolveSelection(plan: Plan, selection: WorkspaceSelection) {
  if (!selection) return null;
  if (selection.kind === "course") {
    const course = plan.courses.find((candidate) => candidate.id === selection.id);
    return course ? ({ kind: "course", course } as const) : null;
  }

  for (const course of plan.courses) {
    const topic = course.topics.find((candidate) => candidate.id === selection.id);
    if (topic) return { kind: "topic", topic, course } as const;
  }
  return null;
}

function sentenceCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
