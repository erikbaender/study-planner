"use client";

import { Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  courseColorValue,
  courseProgress,
  topicProgress,
  type Course,
  type CourseHealth,
  type Topic,
} from "@/domain";
import { Badge, Button, ProgressBar, Separator } from "@/ui";
import {
  ColorPicker,
  DraftText,
  InlineText,
  InspectorHeader,
  Reference,
  ReferenceList,
  Row,
  Section,
} from "./shared";

/* ─── Course ────────────────────────────────────────────────────────────── */

export function CourseInspector({
  course,
  health,
  selectedId,
  onSelectTopic,
  onDelete,
}: {
  course: Course;
  health: CourseHealth | undefined;
  selectedId: string | null;
  onSelectTopic: (topic: Topic) => void;
  onDelete: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const progress = courseProgress(course);
  const tint = courseColorValue(course.color);

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
      <InspectorHeader
        kind="Course"
        entityId={course.id}
        name={course.name}
        accent={tint}
        onCommitName={(name) => name && patch({ name })}
      >
        {/* The code sits where a caption would, and is the field for it. */}
        <InlineText
          label="Course code"
          value={course.code ?? ""}
          placeholder="Add a course code"
          className="w-full text-callout"
          onCommit={(code) => patch({ code: code || undefined })}
        />
      </InspectorHeader>

      <Separator />

      <Section>
        <ProgressBar ratio={progress.ratio} label={`${course.name} progress`} tint={tint} />
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
            <span className="text-tertiary">No upcoming exam to measure against</span>
          </Row>
        )}
      </Section>

      <Separator />

      <Section title={`Topics · ${course.topics.length}`}>
        {/* The course's own material, as references rather than as a number.
            Clicking one takes the panel to it — the same move the outline makes,
            available from wherever you happen to be. */}
        <div className="-mx-2 max-h-64 overflow-y-auto">
          <ReferenceList
            label={`Topics in ${course.name}`}
            empty="No topics yet. Add them in the outline, or paste a lecture list."
          >
            {course.topics.map((topic) => (
              <Reference
                key={topic.id}
                title={topic.name}
                accent={courseColorValue(topic.color || course.color)}
                selected={topic.id === selectedId}
                meta={
                  // `null` means the topic has no stated size, and a percentage
                  // of an unknown total would be an invention.
                  topicProgress(topic).ratio === null
                    ? "no size"
                    : `${Math.round((topicProgress(topic).ratio ?? 0) * 100)}%`
                }
                onSelect={() => onSelectTopic(topic)}
              />
            ))}
          </ReferenceList>
        </div>
      </Section>

      <Separator />

      <Section title="Colour">
        <ColorPicker value={course.color} onChange={(color) => patch({ color })} />
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
