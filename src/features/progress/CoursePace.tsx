"use client";

import type { CourseHealth } from "@/domain";
import { Badge } from "@/ui";

const PACE_NUMBER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

export function CoursePaceBadge({ health }: { health: CourseHealth }) {
  if (!health.exam) return <Badge>No upcoming exam</Badge>;
  if (health.progress.ratio === null) return <Badge>Needs topic sizes</Badge>;
  if (!health.pace) return null;

  return (
    <Badge tone={health.pace.onTrack ? "green" : "red"}>
      {health.pace.onTrack
        ? "On track"
        : health.pace.daysLate > 0
          ? `${health.pace.daysLate} days late`
          : "Behind pace"}
    </Badge>
  );
}

export function CoursePaceDetails({ health }: { health: CourseHealth }) {
  if (!health.exam) {
    return (
      <p className="text-body text-tertiary">
        Add an exam or deadline before the planner can calculate a required pace.
      </p>
    );
  }

  if (health.progress.ratio === null) {
    return (
      <p className="text-body text-tertiary">
        Add sizes to this course&apos;s topics before the planner compares progress with the
        deadline.
      </p>
    );
  }

  const pace = health.pace;
  if (!pace) return null;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-callout">
      <PaceRow
        label="Observed pace"
        value={
          pace.actualVelocity > 0
            ? `${formatPace(pace.actualVelocity)} units / study day`
            : "No units in the last 7 days"
        }
      />
      <PaceRow
        label="Needed pace"
        value={
          Number.isFinite(pace.requiredPace)
            ? `${formatPace(pace.requiredPace)} units / study day`
            : "No study days remain"
        }
      />
      <PaceRow
        label="Projected finish"
        value={
          pace.remainingUnits === 0
            ? "Complete"
            : pace.projectedFinish ?? "Not predictable yet"
        }
      />
      <PaceRow label="Study days left" value={String(pace.studyDaysLeft)} />
    </dl>
  );
}

export function describeCoursePace(health: CourseHealth): string {
  if (!health.exam) return "No upcoming exam";
  if (health.progress.ratio === null) return "Add topic sizes to calculate pace";
  if (!health.pace) return "Pace unavailable";
  if (health.pace.remainingUnits === 0) return "Course complete";

  const observed =
    health.pace.actualVelocity > 0 ? `${formatPace(health.pace.actualVelocity)}/day` : "No recent pace";
  const required = Number.isFinite(health.pace.requiredPace)
    ? `${formatPace(health.pace.requiredPace)}/day needed`
    : "no study days remain";
  const projection = health.pace.projectedFinish
    ? `finish ${health.pace.projectedFinish}`
    : "finish not predictable";

  return `${observed} · ${required} · ${projection}`;
}

function PaceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-tertiary">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{value}</dd>
    </div>
  );
}

function formatPace(value: number): string {
  return PACE_NUMBER.format(value);
}
