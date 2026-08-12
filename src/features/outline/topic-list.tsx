"use client";

/**
 * The outline's topic list.
 *
 * This used to be a spreadsheet: every row carried a name field, a size field
 * and a unit menu, four hundred inputs to a semester. It read as a form to be
 * filled in, and it made the one thing the list is actually for — picking a
 * topic out and working on it — the only thing you could not do, because every
 * click landed in a text field.
 *
 * So a row is a *selection*, not a form. Clicking one selects the topic and the
 * inspector describes it; clicking it again lets it go. The two things a
 * student does to a topic without stopping to think — moving its progress and
 * ticking it off — stay on the row itself, because those are gestures rather
 * than edits. Everything else (its name, its size, what it depends on, when it
 * is scheduled) is an edit, and edits belong in the inspector where there is
 * room to see what you are changing.
 *
 * Rows are a fixed height so that arriving and leaving can be animated as a
 * height without measuring anything — see `@/ui/row-motion`.
 */

import { clsx } from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { courseColorValue, type Course, type Topic } from "@/domain";
import { ContextMenu, useStableCallback } from "@/ui";
import { useRowTransitions } from "@/ui/row-motion";
import { TopicProgressCell } from "@/features/topics/progress-cell";

/**
 * The visible row is inset inside this fixed slot, so its completion outline
 * has room to draw without clipping while arrivals and departures animate.
 */
export const TOPIC_ROW_HEIGHT = 34;
export const LIST_ROW_CONTENT_HEIGHT = 28;

/**
 * Name · readout · progress · done.
 *
 * No colour dot: the card header identifies the course, and repeating it on
 * every one of forty rows would turn a list of topics into a list of dots.
 *
 * The readout is dropped on a narrow window rather than shrunk, and the grid
 * loses its column with it: a phone has room for a name and a bar you can
 * actually drag, instead of squeezing the bar into a control too small to hit
 * and too small to read.
 */
const COLUMNS = [
  "grid items-center gap-2",
  "grid-cols-[minmax(4rem,1fr)_minmax(4.5rem,8rem)_1.25rem]",
  "sm:gap-3 sm:grid-cols-[minmax(6rem,1fr)_7rem_minmax(5rem,9rem)_1.25rem]",
].join(" ");

const topicKey = (topic: Topic) => topic.id;

export function TopicList({
  course,
  topics,
  today,
  selectedId,
  onSelect,
  onDelete,
  onAddRow,
}: {
  course: Course;
  /** Must be memoized: the row transitions below are keyed on its identity. */
  topics: readonly Topic[];
  today: string;
  selectedId: string | null;
  onSelect: (topic: Topic) => void;
  onDelete: (topic: Topic) => void;
  onAddRow: () => void;
}) {
  const rows = useRowTransitions(topics, topicKey, TOPIC_ROW_HEIGHT);
  // The rows below are memoized, and a handler rebuilt by the card on every
  // render would make that memo a no-op: selecting one topic would reconcile
  // all ninety. See `useStableCallback`.
  const select = useStableCallback(onSelect);
  const remove = useStableCallback(onDelete);

  return (
    <ul className="flex flex-col" data-keeps-selection>
      {rows.map(({ key, item, motion }) => (
        <li
          key={key}
          aria-hidden={motion.visible ? undefined : "true"}
          inert={motion.visible ? undefined : true}
          className="row-motion shrink-0 p-[3px]"
          style={{ height: motion.height, opacity: motion.visible ? 1 : 0 }}
        >
          <MemoTopicRow
            course={course}
            topic={item}
            today={today}
            selected={item.id === selectedId}
            onSelect={select}
            onDelete={remove}
          />
        </li>
      ))}

      <li className="shrink-0 p-[3px]">
        <AddTopicRow onClick={onAddRow} />
      </li>
    </ul>
  );
}

function TopicRow({
  course,
  topic,
  today,
  selected,
  onSelect,
  onDelete,
}: {
  course: Course;
  topic: Topic;
  today: string;
  selected: boolean;
  onSelect: (topic: Topic) => void;
  onDelete: (topic: Topic) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // A topic can be selected from somewhere that is not this list — the command
  // palette, the timeline's gutter, a reference in the course inspector — and a
  // row nobody can see is not a selection anybody can act on.
  useEffect(() => {
    if (!selected) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <ContextMenu
      items={[
        {
          label: "Delete",
          icon: <Trash2 />,
          danger: true,
          onSelect: () => onDelete(topic),
        },
      ]}
    >
      <div
        ref={rowRef}
        data-course-id={course.id}
        data-keeps-selection
        onContextMenu={(event) => {
          // The course card is another context-menu trigger around this row;
          // stop the event there so a topic action cannot open the course menu.
          event.stopPropagation();
        }}
        className={clsx(
          "topic-completion-row relative h-full rounded-control px-2",
          selected ? "bg-accent-soft" : "hover:bg-fill data-[state=open]:bg-fill",
        )}
        style={
          {
            height: LIST_ROW_CONTENT_HEIGHT,
            "--topic-completion-color": courseColorValue(course.color),
          } as CSSProperties
        }
      >
        {/* The row's whole surface is the selection control, laid under the
            contents rather than around them: a `<button>` cannot contain a
            slider, and a name that is only clickable across its own text is a
            target that moves as the text changes. */}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Select ${topic.name}`}
          onClick={() => onSelect(topic)}
          className="absolute inset-0 rounded-control focus-visible:outline-2 focus-visible:-outline-offset-2"
        />

        <div className={clsx(COLUMNS, "pointer-events-none relative h-full")}>
          <span className="min-w-0 truncate text-body">{topic.name}</span>

          <TopicProgressCell
            topic={topic}
            today={today}
            tint={courseColorValue(course.color)}
            sliderClassName="pointer-events-auto w-full min-w-0"
            readoutClassName="hidden text-right text-callout tabular-nums whitespace-nowrap text-secondary sm:block"
          />
        </div>
      </div>
    </ContextMenu>
  );
}

/**
 * The last row of every course, and the fastest way to add one topic.
 *
 * A button in a toolbar somewhere is a button you have to go and find. A row
 * shaped like the rows above it, at the end of the list, is where the next
 * topic is going to be — so that is where the affordance for making one lives.
 */
function AddTopicRow({ onClick }: { onClick: () => void }) {
  return <AddListRow label="Add topic" onClick={onClick} />;
}

/** A list-shaped creation affordance keeps adjacent topic and exam lists aligned. */
export function AddListRow({
  label,
  icon = <Plus aria-hidden="true" className="size-3.5 shrink-0" />,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ height: LIST_ROW_CONTENT_HEIGHT }}
      className={clsx(
        "flex w-full items-center gap-2 rounded-control px-2 text-left",
        "text-callout text-tertiary hover:bg-fill hover:text-secondary",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Progress on one row is a drag, and a drag re-renders the course on every
 * frame. Without this, forty rows reconcile to move one bar.
 */
const MemoTopicRow = memo(TopicRow);
