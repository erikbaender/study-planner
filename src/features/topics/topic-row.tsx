"use client";

/**
 * One topic, as a row.
 *
 * Shared by the outline and by Today's "continue" list, because it is the same
 * object in both places and behaving differently in each is how two lists of
 * the same thing drift apart.
 *
 * Name · draggable progress · count. The name is the click target that
 * selects the row into the inspector; the slider is a sibling rather than a
 * child of it, because a slider nested inside a `<button>` is invalid markup
 * and unreachable from the keyboard. The whole `<li>` is the context-menu
 * trigger, so right-clicking anywhere in the row works.
 */

import { clsx } from "clsx";
import { PanelRight, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { Topic } from "@/domain";
import { ContextMenu } from "@/ui";
import { TopicProgressCell } from "@/features/topics/progress-cell";

export function TopicRow({
  topic,
  today,
  selected,
  prefix,
  courseId,
  courseColor,
  onSelect,
  onDelete,
}: {
  topic: Topic;
  today: string;
  selected?: boolean;
  /** Optional context shown before the name. */
  prefix?: string;
  courseId: string;
  courseColor: string;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu
      items={[
        { label: "Show in inspector", icon: <PanelRight />, onSelect },
        { type: "separator" },
        { label: `Delete ${topic.name}`, icon: <Trash2 />, danger: true, onSelect: onDelete },
      ]}
    >
      <li
        data-course-id={courseId}
        className={clsx(
          "topic-completion-row group flex items-center gap-3 rounded-control px-2 py-1",
          selected ? "bg-accent-soft" : "hover:bg-fill",
        )}
        style={{ "--topic-completion-color": courseColor } as CSSProperties}
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

        <TopicProgressCell
          topic={topic}
          today={today}
          tint={courseColor}
          sliderClassName="w-48 shrink-0"
          readoutClassName="w-32 shrink-0 text-right text-callout tabular-nums whitespace-nowrap text-secondary"
        />
      </li>
    </ContextMenu>
  );
}
