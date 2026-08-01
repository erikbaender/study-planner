"use client";

/**
 * One topic, as a row.
 *
 * Shared by the outline and by Today's "continue" list, because it is the same
 * object in both places and behaving differently in each is how two lists of
 * the same thing drift apart.
 *
 * Name · draggable progress · count · ⋯. The name is the click target that
 * selects the row into the inspector; the slider is a sibling rather than a
 * child of it, because a slider nested inside a `<button>` is invalid markup
 * and unreachable from the keyboard. The whole `<li>` is the context-menu
 * trigger, so right-clicking anywhere in the row works.
 */

import { clsx } from "clsx";
import { MoreHorizontal } from "lucide-react";
import { usePlannerErrors, useRepository } from "@/data/use-repository";
import { UNIT_LABELS, topicProgress, type Topic } from "@/domain";
import { ContextMenu, IconButton, ProgressBar, ProgressSlider } from "@/ui";

export function TopicRow({
  topic,
  today,
  selected,
  prefix,
  onSelect,
  onDelete,
}: {
  topic: Topic;
  today: string;
  selected?: boolean;
  /** Shown before the name — the section in the outline, the course in Today. */
  prefix?: string;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const progress = topicProgress(topic);
  const unit = UNIT_LABELS[topic.unit].plural;

  return (
    <ContextMenu
      items={[
        { label: "Show in inspector", onSelect },
        { type: "separator" },
        { label: `Delete ${topic.name}`, danger: true, onSelect: onDelete },
      ]}
    >
      <li
        className={clsx(
          "group flex items-center gap-3 rounded-control px-2 py-1",
          selected ? "bg-accent-soft" : "hover:bg-fill",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="min-w-0 flex-1 truncate rounded-chip text-left text-body"
        >
          {prefix ? <span className="text-tertiary">{prefix} · </span> : null}
          {topic.name}
        </button>

        {topic.totalUnits > 0 ? (
          <>
            <ProgressSlider
              value={topic.completedUnits}
              max={topic.totalUnits}
              label={`${topic.name} progress`}
              valueText={(value) => `${value} of ${topic.totalUnits} ${unit}`}
              tint={topic.color || undefined}
              className="w-48 shrink-0"
              // The slider says where the topic *is*; the log records what
              // changed today. Dragging backwards to correct an over-log is the
              // same operation with a negative delta, which the repository
              // already accepts.
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
            {/* Fixed width and no wrapping: "107 / 128 slides" breaking onto a
                second line would make one row taller than its neighbours, and a
                list of forty topics would comb. */}
            <span className="w-32 shrink-0 text-right text-callout tabular-nums whitespace-nowrap text-secondary">
              {topic.completedUnits} / {topic.totalUnits} {unit}
            </span>
          </>
        ) : (
          // Nothing to slide along: an unsized topic has no scale, and inventing
          // one would be the interface guessing.
          <>
            <ProgressBar
              ratio={progress.ratio}
              label={`${topic.name} progress`}
              size="sm"
              className="w-48 shrink-0"
            />
            <span className="w-32 shrink-0 text-right text-callout whitespace-nowrap text-tertiary">
              No size set
            </span>
          </>
        )}

        {/* Kept in the DOM at all times rather than mounted on hover, so it is
            reachable by keyboard; only its opacity is conditional. */}
        <IconButton
          size="sm"
          label={`Show ${topic.name} in the inspector`}
          icon={<MoreHorizontal />}
          onClick={onSelect}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      </li>
    </ContextMenu>
  );
}
