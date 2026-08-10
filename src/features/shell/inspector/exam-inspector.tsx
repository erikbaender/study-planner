"use client";

import { Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import { type Course, type Exam } from "@/domain";
import { Badge, Button, Separator, TextField } from "@/ui";
import { DraftText, Header, Row, Section } from "./shared";

/* ─── Exam ──────────────────────────────────────────────────────────────── */

export function ExamInspector({
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
