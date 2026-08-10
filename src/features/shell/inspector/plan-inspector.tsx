"use client";

/**
 * The semester.
 *
 * The top of the ladder, and the panel that makes the inspector navigable
 * rather than merely editable: its course list is the same kind of row as a
 * course's topic list and a topic's block list, so one gesture — click a row —
 * walks the whole plan from semester down to a single day's work.
 */

import { Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import { courseColorValue, courseProgress, type Plan } from "@/domain";
import { useWorkspace, type Selection } from "@/features/workspace/store";
import { sortCoursesAlphabetically } from "@/features/workspace/scope";
import { Button, Separator } from "@/ui";
import { DraftText, Header, ReferenceList, Row, Section } from "./shared";

export function PlanInspector({
  plan,
  onSelect,
  onDelete,
}: {
  plan: Plan;
  onSelect: (selection: Selection) => void;
  onDelete: (selection: NonNullable<Selection>) => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const setCreating = useWorkspace((state) => state.setCreating);
  const selectedId = useWorkspace((state) => state.selection?.id ?? null);

  const patch = (changes: Partial<{ name: string; notes: string }>) =>
    run(repository.updatePlan(plan.id, { name: plan.name, notes: plan.notes, ...changes }));

  const topics = plan.courses.reduce((total, course) => total + course.topics.length, 0);
  const blocks = plan.courses.reduce(
    (total, course) =>
      total + course.topics.reduce((count, topic) => count + topic.blocks.length, 0),
    0,
  );

  return (
    <>
      <Header kind="Semester">
        <h2 className="truncate text-title3 font-semibold">{plan.name}</h2>
      </Header>

      <Separator />

      <Section>
        <DraftText label="Name" value={plan.name} onCommit={(name) => name && patch({ name })} />
      </Section>

      <Separator />

      <Section title="Contents">
        <Row label="Courses">{plan.courses.length}</Row>
        <Row label="Topics">{topics}</Row>
        <Row label="Blocks">{blocks}</Row>
      </Section>

      <Separator />

      <ReferenceList
        title="Courses"
        items={sortCoursesAlphabetically(plan.courses).map((course) => {
          const progress = courseProgress(course);
          return {
            id: course.id,
            label: course.name,
            tint: courseColorValue(course.color),
            selected: course.id === selectedId,
            // A ratio, not a sum of the raw counts: sizes are per-topic units,
            // and adding slides to pages produces a number of nothing.
            detail:
              progress.ratio === null
                ? `${course.topics.length} topics`
                : `${Math.round(progress.ratio * 100)}%`,
          };
        })}
        empty="No courses yet. A course is a subject with an exam and a pile of material."
        addLabel="New course"
        onAdd={() => setCreating("course")}
        onSelect={(id) => onSelect({ kind: "course", id })}
        onDelete={(id) => onDelete({ kind: "course", id })}
        deleteLabel={(item) => `Delete ${item.label}`}
      />

      <Separator />

      <Section title="Notes">
        <DraftText
          label="Notes"
          value={plan.notes}
          multiline
          placeholder="Anything that applies to the whole semester"
          onCommit={(notes) => patch({ notes })}
        />
      </Section>

      <Separator />

      <Section>
        <Button
          variant="plain"
          leadingIcon={<Trash2 />}
          className="text-negative"
          onClick={() => onDelete({ kind: "plan", id: plan.id })}
        >
          Delete semester
        </Button>
      </Section>
    </>
  );
}
