"use client";

/**
 * The inspector.
 *
 * This panel is what replaces the modal-per-click pattern the audit found: the
 * old app opened a full-screen dialog for every detail, including for clicks
 * that were meant to be drags. An inspector shows the same fields without
 * taking the document away, so you can edit a topic while still seeing where it
 * sits among the others.
 *
 * Two rules it holds to:
 *
 * - **Progress is never written here directly.** Dragging the progress bar
 *   files a study-log entry for the difference, exactly as the outline row
 *   does. Setting `completedUnits` through `updateTopic` would move the number
 *   while leaving velocity and the pace projection with nothing to measure —
 *   the app would then report a pace derived from work it has no record of.
 * - **A selection that no longer resolves shows nothing.** The panel is handed
 *   an already-resolved selection, so a deleted topic empties it rather than
 *   describing whatever now occupies that position.
 */

import { clsx } from "clsx";
import { Trash2 } from "lucide-react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  coursePalette,
  courseColorValue,
  courseProgress,
  resolveCourseColorId,
  topicProgress,
  UNITS,
  UNIT_LABELS,
  TOPIC_STATUSES,
  PRIORITIES,
  type Course,
  type CourseHealth,
  type Exam,
  type Topic,
  type TopicStatus,
  type Priority,
  type Unit,
} from "@/domain";
import {
  Badge,
  Button,
  Checkbox,
  ProgressBar,
  ProgressSlider,
  SelectField,
  Separator,
  TextArea,
  TextField,
} from "@/ui";
import type { ResolvedSelection } from "@/features/workspace/scope";
import {
  CompletionCheckbox,
  triggerCompletionAnimation,
} from "@/features/topics/progress-cell";

export function Inspector({
  selection,
  health,
  today,
  onDelete,
}: {
  selection: ResolvedSelection;
  health: Map<string, CourseHealth>;
  today: string;
  onDelete: (selection: NonNullable<ResolvedSelection>) => void;
}) {
  return (
    <aside
      aria-label="Inspector"
      className={clsx(
        "material-sidebar flex w-72 shrink-0 flex-col overflow-y-auto",
        "border-l border-separator",
      )}
    >
      {selection === null ? (
        <p className="px-4 py-6 text-body text-secondary">
          Nothing selected. Choose Show in inspector from a course’s actions menu, or select a
          topic or exam in the outline.
        </p>
      ) : selection.kind === "course" ? (
        <CourseInspector
          course={selection.course}
          health={health.get(selection.course.id)}
          onDelete={() => onDelete(selection)}
        />
      ) : selection.kind === "topic" ? (
        <TopicInspector
          course={selection.course}
          topic={selection.topic}
          today={today}
          onDelete={() => onDelete(selection)}
        />
      ) : (
        <ExamInspector
          course={selection.course}
          exam={selection.exam}
          onDelete={() => onDelete(selection)}
        />
      )}
    </aside>
  );
}

/* ─── Shared furniture ──────────────────────────────────────────────────── */

function Header({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <header className="flex flex-col gap-0.5 px-4 pt-3 pb-2">
      <p className="text-caption font-semibold tracking-wide text-tertiary uppercase">{kind}</p>
      {children}
    </header>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 px-4 py-3">
      {title ? (
        <h3 className="text-caption font-semibold tracking-wide text-tertiary uppercase">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

/** A label/value line. The label column is fixed so a stack of them aligns. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-body">
      <span className="w-24 shrink-0 text-secondary">{label}</span>
      <span className="min-w-0 flex-1 tabular-nums">{children}</span>
    </div>
  );
}

/**
 * A text input that commits on blur or Enter and reverts on Escape.
 *
 * Committing on every keystroke would write a repository mutation per character
 * — and on the Convex backend, a round trip per character. Committing only on
 * an explicit Save would mean a field that looks edited but is not, which is
 * the classic inspector bug. Blur-to-commit is what macOS inspectors do.
 */
function DraftText({
  label,
  value,
  onCommit,
  multiline,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [settled, setSettled] = useState(value);
  // Adjusted during render rather than in an effect, so a value arriving from
  // elsewhere is never painted a frame late. Same pattern as `ProgressSlider`.
  if (settled !== value) {
    setSettled(value);
    setDraft(value);
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === value) return;
    onCommit(trimmed);
  };

  const props = {
    label,
    value: draft,
    placeholder,
    hint,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        // Reverts in place and keeps focus, which is what AppKit does. Blurring
        // here would fire `onBlur` — and `commit` would still be holding this
        // render's draft, so Escape would save the very edit it was discarding.
        setDraft(value);
      } else if (event.key === "Enter" && !multiline) {
        event.preventDefault();
        commit();
      }
    },
  };

  return multiline ? <TextArea rows={3} {...props} /> : <TextField {...props} />;
}

/* ─── Course ────────────────────────────────────────────────────────────── */

function CourseInspector({
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
              <Badge tone={health.pace.onTrack ? "positive" : "negative"}>
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

function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selectedColorId = resolveCourseColorId(value);
  return (
    <div className="flex flex-col gap-1">
      {/* Not a `Field`: that wires a `<label for>` to a single control, and
          this is a radiogroup of thirteen. The group's own `aria-label` is what
          names it. */}
      <span className="text-callout font-medium text-secondary">Colour</span>
      <div role="radiogroup" aria-label="Course colour" className="flex flex-wrap gap-1.5 pt-0.5">
        {coursePalette.map((color) => (
          <button
            key={color.id}
            type="button"
            role="radio"
            aria-checked={color.id === selectedColorId}
            aria-label={color.name}
            onClick={() => onChange(color.id)}
            className={clsx(
              "size-5 rounded-full transition-transform duration-100 ease-mac",
              color.id === selectedColorId
                ? "scale-110 inset-ring-2 inset-ring-[var(--mac-label)]"
                : "hover:scale-110",
            )}
            style={{ background: color.value }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Topic ─────────────────────────────────────────────────────────────── */

function TopicInspector({
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

/* ─── Exam ──────────────────────────────────────────────────────────────── */

function ExamInspector({
  course,
  exam,
  onDelete,
}: {
  course: Course;
  exam: Exam;
  onDelete: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();

  /**
   * The window's end is what makes an exam provisional, so it is the only
   * control offered: a separate "provisional" switch could be set to disagree
   * with the dates, and then the app would be holding two answers to one
   * question.
   */
  const patch = (changes: Partial<{ name: string; startDate: string; endDate?: string }>) =>
    run(
      repository.updateExam(exam.id, {
        name: exam.name,
        kind: exam.kind,
        startDate: exam.startDate,
        endDate: exam.endDate,
        status: exam.status,
        notes: exam.notes,
        ...changes,
      }),
    );

  return (
    <>
      <Header kind="Exam">
        <h2 className="truncate text-title3 font-semibold">{exam.name}</h2>
        <p className="truncate text-callout text-secondary">{course.name}</p>
      </Header>

      <Separator />

      <Section>
        <DraftText label="Name" value={exam.name} onCommit={(name) => name && patch({ name })} />
        <TextField
          label="Date"
          type="date"
          value={exam.startDate}
          onChange={(event) => event.target.value && patch({ startDate: event.target.value })}
        />
        <TextField
          label="Window ends"
          type="date"
          hint="Leave empty for a confirmed date. Filling it in marks the exam provisional."
          value={exam.endDate ?? ""}
          onChange={(event) => patch({ endDate: event.target.value || undefined })}
        />
        <Row label="Certainty">
          {exam.status === "provisional" ? (
            <Badge tone="warning">
              Provisional
            </Badge>
          ) : (
            <Badge tone="positive">Confirmed</Badge>
          )}
        </Row>
        {exam.status === "provisional" ? (
          <p className="text-callout text-secondary">
            Planning counts backwards from the <em>start</em> of the window. Preparing for the far
            end is how an announced window turns into a missed exam.
          </p>
        ) : null}
      </Section>

      <Separator />

      <Section>
        <Button variant="plain" leadingIcon={<Trash2 />} className="text-negative" onClick={onDelete}>
          Delete exam
        </Button>
      </Section>
    </>
  );
}
