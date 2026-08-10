"use client";

import { Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  courseColorValue,
  courseProgress,
  topicProgress,
  UNIT_LABELS,
  type Course,
  type CourseHealth,
  type IsoDate,
} from "@/domain";
import type { Selection } from "@/features/workspace/store";
import { Badge, Button, ProgressBar, Separator } from "@/ui";
import { ColorPicker, DraftText, Header, ReferenceList, Row, Section } from "./shared";

/* ─── Course ────────────────────────────────────────────────────────────── */

export function CourseInspector({
  course,
  health,
  today,
  onSelect,
  onDelete,
}: {
  course: Course;
  health: CourseHealth | undefined;
  today: IsoDate;
  onSelect: (selection: Selection) => void;
  onDelete: (selection: NonNullable<Selection>) => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const progress = courseProgress(course);

  /**
   * A new topic is named rather than blank.
   *
   * An untitled row in a list of forty is indistinguishable from a rendering
   * bug, and the panel puts the new topic straight into the inspector, where
   * the name field is the first thing under the cursor anyway.
   */
  const addTopic = () =>
    run(
      repository
        .createTopic(course.id, {
          name: "New topic",
          unit: course.topics.at(-1)?.unit ?? "slides",
          color: course.color,
        })
        .then((id) => onSelect({ kind: "topic", id })),
    );

  const addExam = () =>
    run(
      repository
        .createExam(course.id, { name: `${course.name} exam`, startDate: today })
        .then((id) => onSelect({ kind: "exam", id })),
    );

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

      <ReferenceList
        title="Exams"
        items={course.exams.map((exam) => ({
          id: exam.id,
          label: exam.name,
          detail:
            exam.status === "provisional" && exam.endDate
              ? `${exam.startDate} – ${exam.endDate}`
              : exam.startDate,
        }))}
        empty="No exam date yet — a provisional window is enough to plan backwards from."
        addLabel={`Add an exam to ${course.name}`}
        onAdd={addExam}
        onSelect={(id) => onSelect({ kind: "exam", id })}
        onDelete={(id) => onDelete({ kind: "exam", id })}
      />

      <Separator />

      <ReferenceList
        title="Topics"
        items={course.topics.map((topic) => {
          const ratio = topicProgress(topic).ratio;
          return {
            id: topic.id,
            label: topic.name,
            // "No size" rather than 0%: a topic nobody has measured is not a
            // topic nobody has started.
            detail:
              ratio === null
                ? "no size"
                : `${topic.completedUnits}/${topic.totalUnits} ${UNIT_LABELS[topic.unit].plural}`,
          };
        })}
        empty="No topics yet. Paste your lecture list in the outline — it is far quicker than adding them one at a time."
        addLabel={`Add a topic to ${course.name}`}
        onAdd={addTopic}
        onSelect={(id) => onSelect({ kind: "topic", id })}
        onDelete={(id) => onDelete({ kind: "topic", id })}
      />

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
        <Button
          variant="plain"
          leadingIcon={<Trash2 />}
          className="text-negative"
          onClick={() => onDelete({ kind: "course", id: course.id })}
        >
          Delete course
        </Button>
      </Section>
    </>
  );
}
