"use client";

import { Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import { courseColorValue, type Course, type Exam } from "@/domain";
import { Badge, Button, Separator, TextField } from "@/ui";
import { InspectorHeader, NameSection, Row, Section } from "./shared";

/* ─── Exam ──────────────────────────────────────────────────────────────── */

export function ExamInspector({
  course,
  exam,
  onSelectCourse,
  onDelete,
}: {
  course: Course;
  exam: Exam;
  onSelectCourse: () => void;
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
      <InspectorHeader
        kind="Exam"
      />

      <NameSection
        kind="Exam"
        entityId={exam.id}
        name={exam.name}
        onCommit={(name) => name && patch({ name })}
      />

      <Section title="Course">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: courseColorValue(course.color) }}
          />
        <button
          type="button"
          onClick={onSelectCourse}
          className="min-w-0 truncate rounded-chip px-1 text-body text-secondary transition-colors duration-150 ease-mac hover:bg-fill hover:text-label"
        >
          {course.name}
        </button>
        </div>
      </Section>

      <Separator />

      <Section>
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
            <Badge tone="warning">Provisional</Badge>
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
