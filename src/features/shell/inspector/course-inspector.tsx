"use client";

import { Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  courseColorValue,
  courseProgress,
  type Course,
  type CourseHealth,
} from "@/domain";
import { Badge, Button, ProgressBar, Separator } from "@/ui";
import { ColorPicker, DraftText, Header, Row, Section } from "./shared";

/* ─── Course ────────────────────────────────────────────────────────────── */

export function CourseInspector({
  course,
  health,
  onDelete,
}: {
  course: Course;
  health: CourseHealth | undefined;
  onDelete: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const progress = courseProgress(course);

  const patch = (changes: Partial<{ name: string; code?: string; color: string; notes: string }>) =>
    run(
      repository.updateCourse(course.id, {
        name: course.name,
        code: course.code,
        color: course.color,
        notes: course.notes,
        ...changes,
      }),
    );

  return (
    <>
      <Header kind="Course">
        <h2 className="flex items-center gap-2 text-title3 font-semibold">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: courseColorValue(course.color) }}
          />
          <span className="min-w-0 truncate">{course.name}</span>
        </h2>
      </Header>

      <Separator />

      <Section>
        <DraftText label="Name" value={course.name} onCommit={(name) => patch({ name })} />
        <DraftText
          label="Code"
          value={course.code ?? ""}
          placeholder="e.g. BIO-201"
          onCommit={(code) => patch({ code: code || undefined })}
        />
        <ColorPicker value={course.color} onChange={(color) => patch({ color })} />
      </Section>

      <Separator />

      <Section title="Progress">
        <ProgressBar
          ratio={progress.ratio}
          label={`${course.name} progress`}
          tint={courseColorValue(course.color)}
        />
        <Row label="Done">
          {progress.totalUnits > 0
            ? `${progress.completedUnits} / ${progress.totalUnits} units`
            : // Not "0 / 0": the course has topics whose size nobody has stated,
              // and reporting that as complete would be a fabrication.
              "No sizes recorded yet"}
        </Row>
        <Row label="Topics">{course.topics.length}</Row>
        {health?.pace ? (
          <>
            <Row label="Pace">
              <Badge tone={health.pace.onTrack ? "positive" : "warning"}>
                {health.pace.onTrack
                  ? "On track"
                  : health.pace.daysLate > 0
                    ? `${health.pace.daysLate} days late`
                    : "Behind pace"}
              </Badge>
            </Row>
            <Row label="Needed">
              {Number.isFinite(health.pace.requiredPace)
                ? `${Math.ceil(health.pace.requiredPace)} units / study day`
                : "No study days left"}
            </Row>
            <Row label="Current">{`${health.pace.actualVelocity.toFixed(1)} units / study day`}</Row>
            <Row label="Finish">
              {/* `null` means there is no forward progress to extrapolate from.
                  A date here would be an invention. */}
              {health.pace.projectedFinish ?? "Not predictable yet"}
            </Row>
          </>
        ) : (
          <Row label="Pace">
            <span className="text-secondary">No upcoming exam to measure against</span>
          </Row>
        )}
      </Section>

      <Separator />

      <Section title="Notes">
        <DraftText
          label="Notes"
          value={course.notes}
          multiline
          placeholder="Anything you need to remember about this course"
          onCommit={(notes) => patch({ notes })}
        />
      </Section>

      <Separator />

      <Section>
        <Button variant="plain" leadingIcon={<Trash2 />} className="text-negative" onClick={onDelete}>
          Delete course
        </Button>
      </Section>
    </>
  );
}
