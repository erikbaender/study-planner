"use client";

import { CalendarRange, Plus } from "lucide-react";
import { useMemo } from "react";
import { type Course, type Plan, type Topic } from "@/domain";
import { Badge, Button, Card, EmptyState } from "@/ui";

type AgendaBlock = {
  id: string;
  course: Course;
  topic: Topic;
  startDate: string;
  endDate: string;
  plannedUnits?: number;
  source: "auto" | "manual";
};

export function TimelineView({
  plan,
  onCreate,
  onSelectTopic,
}: {
  plan: Plan;
  onCreate: () => void;
  onSelectTopic: (topicId: string, courseId: string) => void;
}) {
  const blocks = useMemo(
    () =>
      plan.courses
        .flatMap((course) =>
          course.topics.flatMap((topic) =>
            topic.blocks.map(
              (block): AgendaBlock => ({
                ...block,
                course,
                topic,
              }),
            ),
          ),
        )
        .sort(
          (a, b) =>
            a.startDate.localeCompare(b.startDate) ||
            a.course.order - b.course.order ||
            a.topic.order - b.topic.order,
        ),
    [plan],
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 flex size-8 items-center justify-center rounded-control bg-fill text-secondary"
        >
          <CalendarRange className="size-4" />
        </span>
        <div>
          <p className="text-callout text-secondary">Schedule</p>
          <h2 className="text-title1 font-semibold">Timeline</h2>
          <p className="mt-1 text-body text-secondary">
            A chronological agenda of generated and hand-placed study blocks.
          </p>
        </div>
      </header>

      {blocks.length ? (
        <Card className="overflow-hidden p-0">
          <div
            role="grid"
            aria-label={`${plan.name} timeline`}
            className="divide-y divide-separator"
          >
            <div role="row" className="grid grid-cols-[10rem_minmax(12rem,1fr)_8rem_6rem] gap-3 bg-fill px-3 py-2 text-caption font-semibold tracking-wide text-tertiary uppercase">
              <span role="columnheader">Dates</span>
              <span role="columnheader">Topic</span>
              <span role="columnheader">Target</span>
              <span role="columnheader">Source</span>
            </div>
            {blocks.map((block) => (
              <button
                key={block.id}
                type="button"
                role="row"
                onClick={() => onSelectTopic(block.topic.id, block.course.id)}
                className="grid w-full grid-cols-[10rem_minmax(12rem,1fr)_8rem_6rem] items-center gap-3 px-3 py-2 text-left hover:bg-fill"
              >
                <span role="gridcell" className="text-callout tabular-nums text-secondary">
                  {block.startDate === block.endDate
                    ? block.startDate
                    : `${block.startDate} – ${block.endDate}`}
                </span>
                <span role="gridcell" className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: block.course.color }}
                    />
                    <span className="truncate text-body font-medium">{block.topic.name}</span>
                  </span>
                  <span className="block truncate pl-3.5 text-caption text-tertiary">
                    {block.course.name}
                  </span>
                </span>
                <span role="gridcell" className="text-callout text-secondary">
                  {block.plannedUnits === undefined
                    ? "Not set"
                    : `${block.plannedUnits} ${block.topic.unit}`}
                </span>
                <span role="gridcell">
                  <Badge variant={block.source === "manual" ? "outline" : "solid"}>
                    {block.source}
                  </Badge>
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No study blocks yet"
          description="Add topics now; scheduled blocks will appear here when planning is available."
          action={
            <Button variant="accent" leadingIcon={<Plus />} onClick={onCreate}>
              Add material
            </Button>
          }
        />
      )}
    </div>
  );
}
