"use client";

import { clsx } from "clsx";
import { Trash2 } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  courseColorValue,
  differenceInDays,
  UNITS,
  UNIT_LABELS,
  PRIORITIES,
  type Course,
  type StudyBlock,
  type Topic,
  type Priority,
  type Unit,
} from "@/domain";
import { Button, Checkbox, ProgressBar, ProgressSlider, SegmentedControl, Select, Separator, Stepper } from "@/ui";
import { CompletionCheckbox, triggerCompletionAnimation } from "@/features/topics/progress-cell";
import { shortDate } from "@/features/timeline/geometry";
import { DraftText, InspectorHeader, Reference, ReferenceList, Section } from "./shared";

/* ─── Topic ─────────────────────────────────────────────────────────────── */

export function TopicInspector({
  course,
  topic,
  today,
  onSelectCourse,
  onRevealBlock,
  onDelete,
}: {
  course: Course;
  topic: Topic;
  today: string;
  onSelectCourse: () => void;
  onRevealBlock: (block: StudyBlock) => void;
  onDelete: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const unitLabel = UNIT_LABELS[topic.unit].plural;
  const dependencyCandidates = course.topics.filter((candidate) => candidate.id !== topic.id);
  const [preview, setPreview] = useState<number | null>(null);
  const completionCheckboxRef = useRef<HTMLInputElement>(null);
  const shown = preview ?? topic.completedUnits;
  const tint = courseColorValue(course.color);

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
      priority: Priority;
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
        status: topic.status,
        priority: topic.priority,
        notes: topic.notes,
        color: topic.color,
        ...changes,
      }),
    );

  const logTo = (units: number, from = topic.completedUnits) => {
    setPreview(units);
    run(repository.logStudy({ topicId: topic.id, date: today, units: units - from }));
  };

  return (
    <>
      <InspectorHeader
        kind="Topic"
        entityId={topic.id}
        name={topic.name}
        accent={tint}
        onCommitName={(name) => name && patch({ name })}
      >
        {/* The course is a reference, not a caption: the panel can describe it
            next, and getting there should not mean going back to the sidebar. */}
        <button
          type="button"
          onClick={onSelectCourse}
          className="-mx-1 truncate rounded-chip px-1 transition-colors duration-150 ease-mac hover:bg-fill hover:text-label"
        >
          {course.name}
        </button>
      </InspectorHeader>

      <Separator />

      <Section title="Progress">
        <div
          className="topic-completion-row group flex items-center gap-3 rounded-control px-2 py-1"
          data-course-id={course.id}
          style={{ "--topic-completion-color": tint } as CSSProperties}
        >
          {topic.totalUnits > 0 ? (
            <ProgressSlider
              className="min-w-0 flex-1"
              value={topic.completedUnits}
              max={topic.totalUnits}
              label={`${topic.name} progress`}
              valueText={(units) => `${units} of ${topic.totalUnits} ${unitLabel}`}
              tint={tint}
              onPreview={(units) => {
                if (units !== null && units >= topic.totalUnits && shown < topic.totalUnits) {
                  triggerCompletionAnimation(completionCheckboxRef.current, "slider");
                } else if (units !== null && units < topic.totalUnits && shown >= topic.totalUnits) {
                  triggerCompletionAnimation(completionCheckboxRef.current, "slider", false);
                }
                setPreview(units);
              }}
              onCommit={(units) => logTo(units)}
            />
          ) : (
            <ProgressBar className="min-w-0 flex-1" ratio={0} label={`${topic.name} progress`} />
          )}
          <CompletionCheckbox
            inputRef={completionCheckboxRef}
            topicId={topic.id}
            topicName={topic.name}
            checked={topic.totalUnits > 0 && shown >= topic.totalUnits}
            disabled={topic.totalUnits === 0}
            onChange={(checked) => logTo(checked ? topic.totalUnits : 0, shown)}
          />
        </div>

        {/* One line, read as a sentence: how much is done, of how much, of what.
            The old panel asked the same three things as three labelled fields
            stacked above a bar that repeated the answer. */}
        <div className="flex items-center gap-2 px-2 text-body">
          <span className="w-10 shrink-0 text-right tabular-nums text-secondary">{shown}</span>
          <span className="shrink-0 text-tertiary">of</span>
          <Stepper
            label={`Total ${unitLabel} in ${topic.name}`}
            min={0}
            value={topic.totalUnits}
            onValueChange={(totalUnits) => patch({ totalUnits })}
          />
          <Select
            aria-label={`Unit for ${topic.name}`}
            value={topic.unit}
            onValueChange={(unit) => patch({ unit: unit as Unit })}
            className="h-7 min-w-0 flex-1 rounded-chip bg-transparent px-1 text-callout text-secondary hover:bg-fill focus:bg-content focus:text-label"
            options={UNITS.map((candidate) => ({
              value: candidate,
              label: UNIT_LABELS[candidate].plural,
            }))}
          />
        </div>

        {topic.totalUnits === 0 ? (
          <p className="text-callout text-tertiary">
            Give this topic a size and the bar becomes draggable — that is also what lets the app
            work out whether the course will be finished in time.
          </p>
        ) : null}
      </Section>

      <Separator />

      <Section title="Scheduled">
        {/* The blocks themselves, not a count of them. Each one is a real object
            on the timeline, and this is the way back to it. */}
        <ReferenceList label={`Study blocks for ${topic.name}`} empty="Not scheduled yet">
          {[...topic.blocks]
            .sort((left, right) => left.startDate.localeCompare(right.startDate))
            .map((block) => (
              <Reference
                key={block.id}
                title={
                  block.startDate === block.endDate
                    ? shortDate(block.startDate)
                    : `${shortDate(block.startDate)} – ${shortDate(block.endDate)}`
                }
                accent={tint}
                meta={blockMeta(block, unitLabel)}
                onSelect={() => onRevealBlock(block)}
              />
            ))}
        </ReferenceList>
      </Section>

      <Separator />

      <Section title="Planning">
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-body text-secondary">Priority</span>
          <SegmentedControl
            size="sm"
            label={`Priority of ${topic.name}`}
            className="flex-1"
            value={topic.priority}
            onValueChange={(priority) => patch({ priority })}
            segments={PRIORITIES.map((priority) => ({
              value: priority,
              label: priority[0].toUpperCase() + priority.slice(1),
            }))}
          />
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-callout font-medium text-secondary">Depends on</legend>
          {dependencyCandidates.length === 0 ? (
            <span className="text-body text-tertiary">No other topics in this course</span>
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
        <Button
          variant="plain"
          leadingIcon={<Trash2 />}
          className={clsx("text-negative")}
          onClick={onDelete}
        >
          Delete topic
        </Button>
      </Section>
    </>
  );
}

/** How long a block is, and how much of the topic it was meant to cover. */
function blockMeta(block: StudyBlock, unitLabel: string): string {
  const days = differenceInDays(block.startDate, block.endDate) + 1;
  const span = `${days} day${days === 1 ? "" : "s"}`;
  return block.plannedUnits === undefined
    ? span
    : `${span} · ${block.plannedUnits} ${unitLabel}`;
}
