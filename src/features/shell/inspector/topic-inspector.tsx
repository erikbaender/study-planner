"use client";

import { clsx } from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  addDays,
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
import {
  Button,
  Checkbox,
  ProgressBar,
  ProgressSlider,
  SegmentedControl,
  Select,
  Separator,
  Stepper,
  TextField,
} from "@/ui";
import { CompletionCheckbox, triggerCompletionAnimation } from "@/features/topics/progress-cell";
import { clampToLimits, limitsFor } from "@/features/timeline/blocks";
import { shortDate } from "@/features/timeline/geometry";
import { DraftText, InspectorHeader, NameSection, ReferenceList, Section } from "./shared";
import { motionDuration } from "@/ui/motion";
import { useDisclosure } from "@/ui/row-motion";

/* ─── Topic ─────────────────────────────────────────────────────────────── */

export function TopicInspector({
  course,
  courses,
  topic,
  today,
  onRevealBlock,
  onDelete,
}: {
  course: Course;
  courses: readonly Course[];
  topic: Topic;
  today: string;
  onRevealBlock: (block: StudyBlock) => void;
  onDelete: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const unitLabel = UNIT_LABELS[topic.unit].plural;
  const dependencyCandidates = course.topics.filter((candidate) => candidate.id !== topic.id);
  const [preview, setPreview] = useState<number | null>(null);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
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
      <InspectorHeader kind="Topic" />

      <NameSection
        kind="Topic"
        entityId={topic.id}
        name={topic.name}
        onCommit={(name) => name && patch({ name })}
      />

      <Section title="Course">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: tint }}
          />
          <Select
            aria-label={`Course for ${topic.name}`}
            value={course.id}
            onValueChange={(courseId) => {
              if (courseId !== course.id) run(repository.moveTopic(topic.id, courseId));
            }}
            className="min-w-0 flex-1 text-body"
            options={courses.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          />
        </div>
      </Section>

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

        <div className="flex min-w-0 items-center justify-between gap-2 px-2 text-body">
          <span className="min-w-0 truncate tabular-nums text-secondary">
            {shown} / {topic.totalUnits} {unitLabel}
          </span>
        </div>

        <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 px-2">
          <span className="text-callout text-secondary">Total</span>
          <div className="flex min-w-0 items-center gap-2">
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
              className="min-w-0 flex-1 text-callout text-secondary"
              options={UNITS.map((candidate) => ({
                value: candidate,
                label: UNIT_LABELS[candidate].plural,
              }))}
            />
          </div>
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
        {/* A block is still a timeline object, but date and unit nudges are
            common enough to deserve a small editor beside the topic. The
            explicit reveal action keeps the chart available for arranging work
            without making a navigation click unexpectedly leave the panel. */}
        <ReferenceList label={`Study blocks for ${topic.name}`} empty="Not scheduled yet">
          {[...topic.blocks]
            .sort(
              (left, right) =>
                left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id),
            )
            .map((block) => (
              <StudyBlockRow
                key={block.id}
                block={block}
                accent={tint}
                expanded={expandedBlockId === block.id}
                unitLabel={unitLabel}
                topic={topic}
                onToggle={() => setExpandedBlockId((current) => (current === block.id ? null : block.id))}
                onReveal={() => onRevealBlock(block)}
                onUpdate={(next) => run(repository.updateStudyBlock(block.id, next))}
                onRemove={() => {
                  setExpandedBlockId(null);
                  run(repository.deleteStudyBlock(block.id));
                }}
              />
            ))}
        </ReferenceList>
        <Button
          size="sm"
          variant="plain"
          leadingIcon={<Plus aria-hidden="true" />}
          onClick={() => {
            const lastBlock = [...topic.blocks]
              .sort((left, right) => left.endDate.localeCompare(right.endDate))
              .at(-1);
            const startDate = lastBlock ? addDays(lastBlock.endDate, 1) : today;
            run(
              repository
                .createStudyBlock({
                  topicId: topic.id,
                  startDate,
                  endDate: startDate,
                  source: "manual",
                })
                .then((blockId) => setExpandedBlockId(blockId)),
            );
          }}
          className="self-start text-tertiary"
        >
          Add block
        </Button>
      </Section>

      <Separator />

      <Section title="Planning">
        <div className="flex min-w-0 flex-col items-stretch gap-1.5">
          <span className="text-body text-secondary">Priority</span>
          <SegmentedControl
            size="sm"
            label={`Priority of ${topic.name}`}
            className="w-full min-w-0 [&>button]:flex-1"
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
            <div className="flex max-h-32 min-w-0 flex-col gap-1 overflow-y-auto rounded-control bg-fill p-2">
              {dependencyCandidates.map((candidate) => {
                const checked = topic.dependencyIds.includes(candidate.id);
                return (
                  <Checkbox
                    key={candidate.id}
                    className="min-w-0"
                    label={<span className="min-w-0 break-words">{candidate.name}</span>}
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
          hideLabel
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

type BlockPatch = {
  startDate: string;
  endDate: string;
  plannedUnits?: number;
};

function StudyBlockRow({
  block,
  topic,
  unitLabel,
  accent,
  expanded,
  onToggle,
  onReveal,
  onUpdate,
  onRemove,
}: {
  block: StudyBlock;
  topic: Topic;
  unitLabel: string;
  accent: string;
  expanded: boolean;
  onToggle: () => void;
  onReveal: () => void;
  onUpdate: (patch: BlockPatch) => void;
  onRemove: () => void;
}) {
  const editorId = `study-block-editor-${block.id}`;
  const disclosure = useRef<HTMLDivElement>(null);
  const disclosureContent = useRef<HTMLDivElement>(null);
  const disclosureState = useDisclosure(expanded);

  useLayoutEffect(() => {
    const element = disclosure.current;
    if (!element || !disclosureState.mounted) return;
    if (!element.dataset.ready) {
      element.dataset.ready = "true";
      element.style.height = disclosureState.expanded ? "auto" : "0px";
      return;
    }

    const fullHeight = disclosureContent.current?.offsetHeight ?? 0;
    element.style.height = disclosureState.expanded ? "0px" : `${fullHeight}px`;
    void element.offsetHeight;
    element.style.height = disclosureState.expanded ? `${fullHeight}px` : "0px";
    if (!disclosureState.expanded) return;
    const timer = window.setTimeout(() => {
      element.style.height = "auto";
    }, motionDuration(document.documentElement) / 2);
    return () => window.clearTimeout(timer);
  }, [disclosureState.expanded, disclosureState.mounted]);

  const moveStart = (startDate: string) => {
    if (!startDate) return;
    const delta = differenceInDays(block.startDate, startDate);
    const next = clampToLimits(
      {
        startDate,
        endDate: addDays(block.endDate, delta),
      },
      "move",
      limitsFor(block, topic),
    );
    onUpdate({ ...next, plannedUnits: block.plannedUnits });
  };
  const resizeEnd = (endDate: string) => {
    if (!endDate) return;
    const next = clampToLimits(
      {
        startDate: block.startDate,
        // Date fields can briefly report an earlier day while being edited;
        // clamping here keeps the repository's ordered-date invariant intact.
        endDate: endDate < block.startDate ? block.startDate : endDate,
      },
      "end",
      limitsFor(block, topic),
    );
    onUpdate({ ...next, plannedUnits: block.plannedUnits });
  };
  const updateUnits = (plannedUnits: number | undefined) =>
    onUpdate({
      startDate: block.startDate,
      endDate: block.endDate,
      plannedUnits,
    });

  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={editorId}
        aria-label={`Edit study block ${block.startDate} to ${block.endDate}`}
        onClick={onToggle}
        className={clsx(
          "flex w-full min-w-0 items-center gap-2 rounded-control px-2 py-1 text-left",
          "transition-colors duration-150 ease-mac",
          expanded ? "bg-accent-soft" : "hover:bg-fill",
        )}
      >
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: accent }} />
        <span className="min-w-0 flex-1 truncate text-body">
          {block.startDate === block.endDate
            ? shortDate(block.startDate)
            : `${shortDate(block.startDate)} – ${shortDate(block.endDate)}`}
        </span>
        <span className="shrink-0 text-callout tabular-nums text-secondary">
          {blockMeta(block, unitLabel)}
        </span>
      </button>

      {disclosureState.mounted ? (
        <div ref={disclosure} className="outline-disclosure">
          <div ref={disclosureContent} id={editorId} className="mt-1 ml-2 flex min-w-0 flex-col gap-2 border-l border-separator pl-2">
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <TextField
                label="Starts"
                type="date"
                value={block.startDate}
                fieldClassName="min-w-0"
                className="min-w-0 px-1 text-callout"
                onChange={(event) => moveStart(event.target.value)}
              />
              <TextField
                label="Ends"
                type="date"
                value={block.endDate}
                fieldClassName="min-w-0"
                className="min-w-0 px-1 text-callout"
                onChange={(event) => resizeEnd(event.target.value)}
              />
            </div>

            {block.plannedUnits === undefined ? (
              <div className="flex min-w-0 items-center justify-between gap-2 text-callout">
                <span className="min-w-0 text-secondary">Planned units: not specified</span>
                <Button size="sm" variant="plain" onClick={() => updateUnits(1)}>
                  Set units
                </Button>
              </div>
            ) : (
              <div className="flex min-w-0 items-center justify-between gap-2">
                <Stepper
                  label={`Planned units for ${block.startDate}`}
                  value={block.plannedUnits}
                  min={0}
                  onValueChange={updateUnits}
                />
                <Button size="sm" variant="plain" onClick={() => updateUnits(undefined)}>
                  Clear units
                </Button>
              </div>
            )}

            <div className="flex min-w-0 flex-wrap justify-between gap-1">
              <Button size="sm" variant="plain" onClick={onReveal}>
                Show on timeline
              </Button>
              <Button size="sm" variant="plain" leadingIcon={<Trash2 />} className="text-negative" onClick={onRemove}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
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
