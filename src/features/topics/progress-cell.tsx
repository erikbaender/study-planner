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

import { useState } from "react";
import { usePlannerErrors, useRepository } from "@/data/use-repository";
import { UNIT_LABELS, topicProgress, type Topic } from "@/domain";
import { ProgressBar, ProgressSlider } from "@/ui";

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
  const { run } = usePlannerErrors();
  const [preview, setPreview] = useState<number | null>(null);
  const [settled, setSettled] = useState(topic.completedUnits);

  if (settled !== topic.completedUnits) {
    setSettled(topic.completedUnits);
    setPreview(null);
  }

  const unit = UNIT_LABELS[topic.unit].plural;
  const shown = preview ?? topic.completedUnits;

  if (topic.totalUnits <= 0) {
    // Nothing to slide along: an unsized topic has no scale, and inventing a
    // denominator would be the interface guessing.
    return (
      <>
        <ProgressBar
          ratio={topicProgress(topic).ratio}
          label={`${topic.name} progress`}
          size="sm"
          className={sliderClassName}
        />
        <span className={readoutClassName}>No size set</span>
      </>
    );
  }

  return (
    <>
      <ProgressSlider
        value={topic.completedUnits}
        max={topic.totalUnits}
        label={`${topic.name} progress`}
        valueText={(value) => `${value} of ${topic.totalUnits} ${unit}`}
        tint={tint}
        className={sliderClassName}
        onPreview={setPreview}
        // The slider says where the topic *is*; the log records what changed
        // today. Dragging backwards to correct an over-log is the same
        // operation with a negative delta, which the repository already accepts.
        onCommit={(units) =>
          run(
            repository.logStudy({
              topicId: topic.id,
              date: today,
              units: units - topic.completedUnits,
            }),
          )
        }
      />
      <span className={readoutClassName}>
        {/* Follows the drag. The delta is the thing being chosen, and it is
            unreadable if the number only catches up on release. */}
        {shown} / {topic.totalUnits} {unit}
      </span>
    </>
  );
}
