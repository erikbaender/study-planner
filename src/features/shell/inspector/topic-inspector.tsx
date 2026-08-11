"use client";

import { Trash2 } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  compareDates,
  courseColorValue,
  topicProgress,
  topicStatus,
  UNITS,
  UNIT_LABELS,
  type Course,
  type Topic,
  type Unit,
} from "@/domain";
import { Badge, Button, ProgressBar, ProgressSlider, SelectField, Separator } from "@/ui";
import { CompletionCheckbox, triggerCompletionAnimation } from "@/features/topics/progress-cell";
import type { Selection } from "@/features/workspace/store";
import { DraftNumber, DraftText, Header, ReferenceList, Row, Section } from "./shared";

/* ─── Topic ─────────────────────────────────────────────────────────────── */

export function TopicInspector({
  course,
  topic,
  today,
  onSelect,
  onDelete,
}: {
  course: Course;
  topic: Topic;
  today: string;
  onSelect: (selection: Selection) => void;
  onDelete: (selection: NonNullable<Selection>) => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const progress = topicProgress(topic);
  const unitLabel = UNIT_LABELS[topic.unit].plural;
  const status = topicStatus(topic);
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
      unit: Unit;
      totalUnits: number;
      notes: string;
      color: string;
    }>,
  ) =>
    run(
      repository.updateTopic(topic.id, {
        name: topic.name,
        unit: topic.unit,
        totalUnits: topic.totalUnits,
        completedUnits: topic.completedUnits,
        notes: topic.notes,
        color: topic.color,
        ...changes,
      }),
    );

  /**
   * A new block is one day, today, and manual.
   *
   * The smallest thing that can then be dragged wider — the same choice the
   * chart's lane menu makes, so a block added here and a block added there are
   * the same object rather than two conventions.
   */
  const addBlock = () =>
    run(
      repository.createStudyBlock({
        topicId: topic.id,
        startDate: today,
        endDate: today,
        source: "manual",
      }),
    );

  const blocks = [...topic.blocks].sort((left, right) =>
    compareDates(left.startDate, right.startDate),
  );

  return (
    <>
      <Header kind="Topic">
        <h2 className="truncate text-title3 font-semibold">{topic.name}</h2>
        <p className="truncate text-callout text-secondary">{course.name}</p>
      </Header>

      <Separator />

      <Section>
        <DraftText label="Name" value={topic.name} required onCommit={(name) => patch({ name })} />
      </Section>

      <Separator />

      <Section title="Size and progress">
        <div className="flex items-end gap-2">
          <DraftNumber
            label="Total"
            value={topic.totalUnits}
            onCommit={(totalUnits) => patch({ totalUnits })}
            fieldClassName="w-20"
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
            <Row label="Status">
              {/* Read off the progress rather than set beside it. Two controls
                  for one fact is how a topic ends up marked "planned" with
                  three quarters of it done. */}
              <Badge tone={status === "done" ? "positive" : "neutral"}>
                {status === "done" ? "Done" : status === "active" ? "In progress" : "Not started"}
              </Badge>
            </Row>
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

      <ReferenceList
        title="Blocks"
        items={blocks.map((block) => ({
          id: block.id,
          label: block.startDate === block.endDate
            ? block.startDate
            : `${block.startDate} – ${block.endDate}`,
          detail: block.plannedUnits ? `${block.plannedUnits} ${unitLabel}` : undefined,
        }))}
        empty="Not scheduled. Add a block, or plan the course from its exam date."
        addLabel={`Add a block to ${topic.name}`}
        onAdd={addBlock}
        onSelect={(id) => onSelect({ kind: "block", id })}
        // No confirmation, unlike a topic or a course: a block is two dates,
        // it is one click to make another, and the timeline has always deleted
        // them straight from its menu.
        onDelete={(id) => run(repository.deleteStudyBlock(id))}
        deleteLabel={(item) => `Delete the block on ${item.label}`}
      />

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
        <Button
          variant="plain"
          leadingIcon={<Trash2 />}
          className="text-negative"
          onClick={() => onDelete({ kind: "topic", id: topic.id })}
        >
          Delete topic
        </Button>
      </Section>
    </>
  );
}
