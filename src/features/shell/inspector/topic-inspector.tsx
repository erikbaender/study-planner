"use client";

import { Trash2 } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  courseColorValue,
  topicProgress,
  UNITS,
  UNIT_LABELS,
  TOPIC_STATUSES,
  PRIORITIES,
  type Course,
  type Topic,
  type TopicStatus,
  type Priority,
  type Unit,
} from "@/domain";
import { Button, Checkbox, ProgressBar, ProgressSlider, SelectField, Separator, TextField } from "@/ui";
import { CompletionCheckbox, triggerCompletionAnimation } from "@/features/topics/progress-cell";
import { DraftText, Header, Row, Section } from "./shared";

/* ─── Topic ─────────────────────────────────────────────────────────────── */

export function TopicInspector({
  course,
  topic,
  today,
  onDelete,
}: {
  course: Course;
  topic: Topic;
  today: string;
  onDelete: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const progress = topicProgress(topic);
  const unitLabel = UNIT_LABELS[topic.unit].plural;
  const dependencyCandidates = course.topics.filter((candidate) => candidate.id !== topic.id);
  const [preview, setPreview] = useState<number | null>(null);
  const completionCheckboxRef = useRef<HTMLInputElement>(null);
  const shown = preview ?? topic.completedUnits;

  /**
   * Every edit sends the whole topic back, because `updateTopic` takes a
   * complete patch. `completedUnits` is therefore passed through *unchanged* on
   * purpose and is never in `changes` — progress moves through `logStudy` and
   * nowhere else, so that velocity always has a record behind it.
   */
  const patch = (
    changes: Partial<{
      name: string;
      section?: string;
      unit: Unit;
      totalUnits: number;
      status: TopicStatus;
      priority: Priority;
      notes: string;
      color: string;
    }>,
  ) =>
    run(
      repository.updateTopic(topic.id, {
        name: topic.name,
        section: topic.section,
        unit: topic.unit,
        totalUnits: topic.totalUnits,
        completedUnits: topic.completedUnits,
        status: topic.status,
        priority: topic.priority,
        notes: topic.notes,
        color: topic.color,
        ...changes,
      }),
    );

  return (
    <>
      <Header kind="Topic">
        <h2 className="truncate text-title3 font-semibold">{topic.name}</h2>
        <p className="truncate text-callout text-secondary">
          {course.name}
          {topic.section ? ` · ${topic.section}` : ""}
        </p>
      </Header>

      <Separator />

      <Section>
        <DraftText label="Name" value={topic.name} onCommit={(name) => patch({ name })} />
        <DraftText
          label="Section"
          value={topic.section ?? ""}
          placeholder="e.g. Block 1"
          hint="Groups topics under a heading in the outline"
          onCommit={(section) => patch({ section: section || undefined })}
        />
      </Section>

      <Separator />

      <Section title="Size and progress">
        <div className="flex items-end gap-2">
          <TextField
            label="Total"
            type="number"
            min={0}
            fieldClassName="w-20"
            value={String(topic.totalUnits)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 0) patch({ totalUnits: next });
            }}
          />
          <SelectField
            label="Unit"
            fieldClassName="flex-1"
            value={topic.unit}
            onValueChange={(value) => patch({ unit: value as Unit })}
            options={UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit].plural }))}
          />
        </div>

        {topic.totalUnits > 0 ? (
          <>
            <div
              className="topic-completion-row group flex items-center gap-3 rounded-control px-2 py-1"
              data-course-id={course.id}
              style={{
                "--topic-completion-color": courseColorValue(course.color),
              } as CSSProperties}
            >
            <ProgressSlider
              className="min-w-0 flex-1"
              value={topic.completedUnits}
              max={topic.totalUnits}
              label={`${topic.name} progress`}
              valueText={(units) => `${units} of ${topic.totalUnits} ${unitLabel}`}
              tint={courseColorValue(course.color)}
              onPreview={(units) => {
                if (units !== null && units >= topic.totalUnits && shown < topic.totalUnits) {
                  triggerCompletionAnimation(completionCheckboxRef.current, "slider");
                } else if (units !== null && units < topic.totalUnits && shown >= topic.totalUnits) {
                  triggerCompletionAnimation(completionCheckboxRef.current, "slider", false);
                }
                setPreview(units);
              }}
              onCommit={(units) => {
                setPreview(units);
                run(
                  repository.logStudy({
                    topicId: topic.id,
                    date: today,
                    units: units - topic.completedUnits,
                  }),
                );
              }}
            />
            <CompletionCheckbox
              inputRef={completionCheckboxRef}
              topicId={topic.id}
              topicName={topic.name}
              checked={shown >= topic.totalUnits}
              onChange={(checked) => {
                const units = checked ? topic.totalUnits : 0;
                setPreview(units);
                run(
                  repository.logStudy({
                    topicId: topic.id,
                    date: today,
                    units: units - shown,
                  }),
                );
              }}
            />
            </div>
            <span className="block text-right text-callout tabular-nums text-secondary">
              {shown} / {topic.totalUnits} {unitLabel}
            </span>
          </>
        ) : (
          <>
            <div
              className="topic-completion-row group flex items-center gap-3 rounded-control px-2 py-1"
              data-course-id={course.id}
              style={{
                "--topic-completion-color": courseColorValue(course.color),
              } as CSSProperties}
            >
              <ProgressBar
                className="min-w-0 flex-1"
                ratio={progress.ratio}
                label={`${topic.name} progress`}
              />
              <CompletionCheckbox
                topicId={topic.id}
                topicName={topic.name}
                checked={false}
                disabled
              />
            </div>
            <span className="block text-right text-callout text-tertiary">No size set</span>
            <p className="text-callout text-tertiary">
              Give this topic a size and the bar becomes draggable — that is also what lets the app
              work out whether the course will be finished in time.
            </p>
          </>
        )}
      </Section>

      <Separator />

      <Section title="Planning">
        <SelectField
          label="Status"
          value={topic.status}
          onValueChange={(value) => patch({ status: value as TopicStatus })}
          options={TOPIC_STATUSES.map((status) => ({
            value: status,
            label: status[0].toUpperCase() + status.slice(1),
          }))}
        />
        <SelectField
          label="Priority"
          value={topic.priority}
          onValueChange={(value) => patch({ priority: value as Priority })}
          options={PRIORITIES.map((priority) => ({
            value: priority,
            label: priority[0].toUpperCase() + priority.slice(1),
          }))}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-callout font-medium text-secondary">Depends on</legend>
          {dependencyCandidates.length === 0 ? (
            <span className="text-body text-secondary">No other topics in this course</span>
          ) : (
            <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-control bg-fill p-2">
              {dependencyCandidates.map((candidate) => {
                const checked = topic.dependencyIds.includes(candidate.id);
                return (
                  <Checkbox
                    key={candidate.id}
                    label={candidate.name}
                    checked={checked}
                    onCheckedChange={() =>
                      run(
                        repository.setTopicDependencies(
                          topic.id,
                          checked
                            ? topic.dependencyIds.filter((id) => id !== candidate.id)
                            : [...topic.dependencyIds, candidate.id],
                        ),
                      )
                    }
                  />
                );
              })}
            </div>
          )}
        </fieldset>
        <Row label="Blocks">
          {topic.blocks.length === 0
            ? "Not scheduled"
            : `${topic.blocks.length} block${topic.blocks.length === 1 ? "" : "s"}`}
        </Row>
      </Section>

      <Separator />

      <Section title="Notes">
        <DraftText
          label="Notes"
          value={topic.notes}
          multiline
          placeholder="Lecture numbers, which book, what to skip"
          onCommit={(notes) => patch({ notes })}
        />
      </Section>

      <Separator />

      <Section>
        <Button variant="plain" leadingIcon={<Trash2 />} className="text-negative" onClick={onDelete}>
          Delete topic
        </Button>
      </Section>
    </>
  );
}
