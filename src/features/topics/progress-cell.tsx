"use client";

/**
 * A topic's progress bar and its readout, as one thing.
 *
 * They were two things in two places, and that produced a real defect: the
 * count is rendered from the *stored* value, so it sat unchanged at "81 / 91"
 * through an entire drag and only jumped once the pointer was released. You
 * were adjusting a number you could not see. Keeping the bar and the number in
 * one component lets the number follow the drag, which is the whole point of
 * dragging rather than typing.
 *
 * `preview` holds the in-flight value and is dropped the moment the store
 * reports a different one — adjusted during render, so the readout is never
 * painted a frame behind the bar.
 */

import { useRef, useState, type RefObject } from "react";
import { Check } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import { UNIT_LABELS, topicProgress, type Topic } from "@/domain";
import { ProgressBar, ProgressSlider } from "@/ui";

const COMPLETION_ANIMATION_MS = 240;
const completionTimers = new Map<string, number>();

function completionMotionDuration(element: HTMLElement): number {
  const configured = Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--topic-motion-duration"),
  );
  return Number.isFinite(configured) ? configured : COMPLETION_ANIMATION_MS;
}

export function TopicProgressCell({
  topic,
  today,
  tint,
  sliderClassName,
  readoutClassName,
}: {
  topic: Topic;
  today: string;
  tint?: string;
  sliderClassName?: string;
  readoutClassName?: string;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const [preview, setPreview] = useState<number | null>(null);
  const [settled, setSettled] = useState(topic.completedUnits);
  const completionCheckboxRef = useRef<HTMLInputElement>(null);

  if (settled !== topic.completedUnits) {
    setSettled(topic.completedUnits);
    setPreview(null);
  }

  const unit = UNIT_LABELS[topic.unit].plural;
  const shown = preview ?? topic.completedUnits;

  const commit = (units: number, from = topic.completedUnits) => {
    setPreview(units);
    return run(
      repository.logStudy({
        topicId: topic.id,
        date: today,
        units: units - from,
      }),
    );
  };

  if (topic.totalUnits <= 0) {
    // Nothing to slide along: an unsized topic has no scale, and inventing a
    // denominator would be the interface guessing.
    return (
      <>
        <span className={readoutClassName}>No size set</span>
        <ProgressBar
          ratio={topicProgress(topic).ratio}
          label={`${topic.name} progress`}
          size="sm"
          className={sliderClassName}
        />
        <CompletionCheckbox topicId={topic.id} topicName={topic.name} checked={false} disabled />
      </>
    );
  }

  return (
    <>
      <span className={readoutClassName}>
        {/* Follows the drag. The delta is the thing being chosen, and it is
            unreadable if the number only catches up on release. */}
        {shown} / {topic.totalUnits} {unit}
      </span>
      <ProgressSlider
        value={topic.completedUnits}
        max={topic.totalUnits}
        label={`${topic.name} progress`}
        valueText={(value) => `${value} of ${topic.totalUnits} ${unit}`}
        tint={tint}
        className={sliderClassName}
        onPreview={(units) => {
          if (units !== null && units >= topic.totalUnits && shown < topic.totalUnits) {
            triggerCompletionAnimation(completionCheckboxRef.current, "slider");
          } else if (units !== null && units < topic.totalUnits && shown >= topic.totalUnits) {
            triggerCompletionAnimation(completionCheckboxRef.current, "slider", false);
          }
          setPreview(units);
        }}
        // The slider says where the topic *is*; the log records what changed
        // today. Dragging backwards to correct an over-log is the same
        // operation with a negative delta, which the repository already accepts.
        onCommit={(units) => commit(units)}
      />
      <CompletionCheckbox
        inputRef={completionCheckboxRef}
        topicId={topic.id}
        topicName={topic.name}
        checked={shown >= topic.totalUnits}
        onChange={(checked) => commit(checked ? topic.totalUnits : 0, shown)}
      />
    </>
  );
}

export function CompletionCheckbox({
  inputRef,
  topicId,
  topicName,
  checked,
  disabled = false,
  onChange,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  topicId: string;
  topicName: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    // `pointer-events-auto` because the outline lays its rows out under a
    // full-width selection button and turns pointer events off for everything
    // that is not a control.
    <label className="pointer-events-auto relative grid size-5 shrink-0 place-items-center">
      <input
        ref={inputRef}
        data-topic-id={topicId}
        type="checkbox"
        aria-label={`Mark ${topicName} as done`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          const row = event.currentTarget.closest<HTMLElement>(".topic-completion-row");
          if (row) {
            // Completion styling is persistent, but its entrance animation is
            // an interaction response. Tying animation directly to `:checked`
            // would replay it whenever a finished row mounts or remounts.
            triggerCompletionAnimation(
              event.currentTarget,
              "checkbox",
              event.currentTarget.checked,
            );
          }
          onChange?.(event.currentTarget.checked);
        }}
        className="topic-completion-checkbox peer relative z-10 size-5 appearance-none rounded-full border border-separator-strong bg-control focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-35"
      />
      <span
        aria-hidden="true"
        className="topic-completion-fill pointer-events-none absolute inset-0 z-20 rounded-full opacity-0 peer-checked:opacity-100"
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="topic-completion-checkmark pointer-events-none absolute z-30 size-3 scale-75 opacity-0 peer-checked:scale-100 peer-checked:opacity-100"
      />
    </label>
  );
}

/**
 * The same control, one level up: is this whole course finished?
 *
 * It has class names of its own rather than reusing the topic ones, because the
 * card it sits in *contains* topic rows — a `.topic-completion-*` selector
 * scoped to the card would animate every checkmark inside it whenever the
 * course pulsed. Its markup, sizes and motion are otherwise identical, which is
 * the point: the course header reads exactly like the rows beneath it.
 */
export function CourseCompletionCheckbox({
  courseId,
  courseName,
  checked,
  disabled = false,
  onChange,
}: {
  courseId: string;
  courseName: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="pointer-events-auto relative grid size-5 shrink-0 place-items-center">
      <input
        data-course-id={courseId}
        type="checkbox"
        aria-label={`Mark ${courseName} as done`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="course-completion-checkbox peer relative z-10 size-5 appearance-none rounded-full border border-separator-strong bg-control focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-35"
      />
      <span
        aria-hidden="true"
        className="course-completion-fill pointer-events-none absolute inset-0 z-20 rounded-full opacity-0 peer-checked:opacity-100"
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="course-completion-checkmark pointer-events-none absolute z-30 size-3 scale-75 opacity-0 peer-checked:scale-100 peer-checked:opacity-100"
      />
    </label>
  );
}

/**
 * The course-level pulse.
 *
 * A course flashes when the *course* is finished, never when one of its topics
 * is. Ticking the thirty-first of forty topics is progress, not completion, and
 * a card that lit up for it was reporting a state the course was nowhere near.
 * So this is driven by the card watching its own completeness rather than by
 * whichever row happened to be clicked.
 */
export function triggerCourseCompletionAnimation(courseId: string, animateCompletion = true) {
  const rows = () =>
    [...document.querySelectorAll<HTMLElement>(".course-completion-row")].filter(
      (candidate) => candidate.dataset.courseId === courseId,
    );
  for (const row of rows()) {
    delete row.dataset.completionAnimating;
    delete row.dataset.completionTrigger;
    delete row.dataset.completionDirection;
    void row.offsetWidth;
    if (animateCompletion) row.dataset.completionAnimating = "true";
    row.dataset.completionTrigger = "checkbox";
    row.dataset.completionDirection = animateCompletion ? "on" : "off";
  }
  const key = `course:${courseId}`;
  const previousTimer = completionTimers.get(key);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  const first = rows()[0];
  const duration = first ? completionMotionDuration(first) : COMPLETION_ANIMATION_MS;
  completionTimers.set(
    key,
    window.setTimeout(() => {
      for (const row of rows()) {
        delete row.dataset.completionAnimating;
        delete row.dataset.completionTrigger;
        delete row.dataset.completionDirection;
      }
      completionTimers.delete(key);
    }, duration + 50),
  );
}

export function triggerCompletionAnimation(
  control: HTMLInputElement | null,
  source: "checkbox" | "slider",
  animateCompletion = true,
) {
  const row = control?.closest<HTMLElement>(".topic-completion-row");
  const topicId = control?.dataset.topicId;
  if (!row || !topicId) return;
  const currentRows = () =>
    [...document.querySelectorAll<HTMLInputElement>(`.topic-completion-checkbox`)]
      .filter((checkbox) => checkbox.dataset.topicId === topicId)
      .map((checkbox) => checkbox.closest<HTMLElement>(".topic-completion-row"))
      .filter((candidate): candidate is HTMLElement => candidate !== null);
  // Only the topic's own rows. The card this row sits in has its own pulse,
  // fired when the course as a whole finishes — see
  // `triggerCourseCompletionAnimation`.
  for (const currentRow of currentRows()) {
    // Re-applying the same data attributes does not restart a CSS animation.
    // Clear the previous run and force one layout read before setting the new
    // direction, so repeated completions always produce a visible flash.
    delete currentRow.dataset.completionAnimating;
    delete currentRow.dataset.completionTrigger;
    delete currentRow.dataset.completionDirection;
    void currentRow.offsetWidth;
    if (animateCompletion) currentRow.dataset.completionAnimating = "true";
    currentRow.dataset.completionTrigger = source;
    currentRow.dataset.completionDirection = animateCompletion ? "on" : "off";
  }
  const previousTimer = completionTimers.get(topicId);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const currentRow of currentRows()) {
      delete currentRow.dataset.completionAnimating;
      delete currentRow.dataset.completionTrigger;
      delete currentRow.dataset.completionDirection;
    }
    completionTimers.delete(topicId);
  };
  // Every completion layer shares one timeline. The small buffer keeps the
  // data attributes alive through the final animation frame.
  const cleanupTimer = window.setTimeout(cleanup, completionMotionDuration(row) + 50);
  completionTimers.set(topicId, cleanupTimer);
}
