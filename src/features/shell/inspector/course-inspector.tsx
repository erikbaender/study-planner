"use client";

/**
 * The course inspector.
 *
 * A course is opened to be worked in, and opening it is what selects it — so
 * the panel describes the card you just unfolded. What it offers is exactly
 * what the New course sheet asks for and nothing more: a name, a code, a colour
 * and notes. The topics and exams are *in* the card, listed there with their
 * own progress and their own actions, and repeating them here as a second,
 * poorer list was the thing that made the old course panel a duplicate of the
 * view beside it.
 */

import { clsx } from "clsx";
import { Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import { coursePalette, resolveCourseColorId, type Course } from "@/domain";
import { Button, Separator } from "@/ui";
import { DraftText, NameSection, Section } from "./shared";

export function CourseInspector({ course, onDelete }: { course: Course; onDelete: () => void }) {
  const repository = useRepository();
  const run = usePlannerRun();

  /** `updateCourse` takes a whole course, so every edit resends the other three fields. */
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
      <NameSection
        kind="Course"
        entityId={course.id}
        name={course.name}
        onCommit={(name) => name && patch({ name })}
      />

      <Separator />

      <Section title="Code">
        <DraftText
          label="Course code"
          hideLabel
          value={course.code ?? ""}
          placeholder="Optional, e.g. BIO-201"
          onCommit={(code) => patch({ code: code || undefined })}
        />
      </Section>

      <Separator />

      <Section title="Colour">
        <ColorPicker value={course.color} onChange={(color) => patch({ color })} />
      </Section>

      <Separator />

      <Section title="Notes">
        <DraftText
          label="Notes"
          hideLabel
          value={course.notes}
          multiline
          placeholder="Anything you need to remember about this course"
          onCommit={(notes) => patch({ notes })}
        />
      </Section>

      <Separator />

      <Section>
        <Button variant="danger" leadingIcon={<Trash2 />} className="self-start" onClick={onDelete}>
          Delete
        </Button>
      </Section>
    </>
  );
}

/**
 * The palette, five and five.
 *
 * A grid rather than a wrap: ten colours in two rows read as a palette, while
 * a wrap breaks wherever the panel's width happens to fall and looks like an
 * accident. The padding is for the selected swatch, which grows past its box.
 */
function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selectedColorId = resolveCourseColorId(value);

  return (
    <div
      role="radiogroup"
      aria-label="Course colour"
      className="grid grid-cols-5 justify-items-start gap-1.5 p-1"
    >
      {coursePalette.map((color) => (
        <button
          key={color.id}
          type="button"
          role="radio"
          aria-checked={color.id === selectedColorId}
          aria-label={color.name}
          onClick={() => onChange(color.id)}
          className={clsx(
            "size-5 rounded-full transition-transform duration-150 ease-mac",
            color.id === selectedColorId
              ? "scale-110 inset-ring-2 inset-ring-[var(--mac-label)]"
              : "hover:scale-110",
          )}
          style={{ background: color.value }}
        />
      ))}
    </div>
  );
}
