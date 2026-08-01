"use client";

/**
 * Outline — where the material gets entered and worked through.
 *
 * One disclosure group per course in focus, each holding its exams and its
 * topics grouped by section. Groups start collapsed when several courses are in
 * focus and expanded when one is: with ten courses of forty topics, expanding
 * everything by default would render four hundred sliders nobody asked for, and
 * scrolling past nine courses to reach the tenth is not navigation.
 *
 * Phase 4 replaces the topic list here with the editable table §7.3 describes —
 * Tab to the next cell, ⌘⏎ for a new row, drag to reorder. The paste box at the
 * bottom of each course is already the permanent bulk-entry route and stays.
 */

import { useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { usePlannerErrors, useRepository } from "@/data/use-repository";
import {
  courseProgress,
  formatOutline,
  parseOutline,
  UNITS,
  UNIT_LABELS,
  type Course,
  type Topic,
  type Unit,
} from "@/domain";
import {
  Badge,
  Button,
  Card,
  CountdownBadge,
  EmptyState,
  IconButton,
  ProgressBar,
  SelectField,
  TextArea,
  TextField,
} from "@/ui";
import { TopicRow } from "@/features/topics/topic-row";
import { matchesQuery } from "@/features/workspace/scope";
import type { CourseHealth, Exam } from "@/domain";

export function OutlineView({
  courses,
  health,
  today,
  query,
  selectedId,
  onSelectCourse,
  onSelectTopic,
  onSelectExam,
  onDeleteTopic,
  onNewCourse,
}: {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  today: string;
  query: string;
  selectedId: string | null;
  onSelectCourse: (course: Course) => void;
  onSelectTopic: (course: Course, topic: Topic) => void;
  onSelectExam: (course: Course, exam: Exam) => void;
  onDeleteTopic: (course: Course, topic: Topic) => void;
  onNewCourse: () => void;
}) {
  // Overrides only. The default comes from how many courses are in focus, so
  // narrowing to one course opens it without anyone having to click a triangle.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const defaultOpen = courses.length === 1;

  if (courses.length === 0) {
    return (
      <EmptyState
        title="No courses in focus"
        description="Add a course, or widen the focus in the sidebar to see the ones you have."
        action={
          <Button variant="accent" leadingIcon={<Plus />} onClick={onNewCourse}>
            New course
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      {courses.map((course) => (
        <CourseSection
          key={course.id}
          course={course}
          health={health.get(course.id)}
          today={today}
          query={query}
          selectedId={selectedId}
          open={expanded[course.id] ?? defaultOpen}
          onToggle={() =>
            setExpanded((current) => ({
              ...current,
              [course.id]: !(current[course.id] ?? defaultOpen),
            }))
          }
          onSelectCourse={() => onSelectCourse(course)}
          onSelectTopic={(topic) => onSelectTopic(course, topic)}
          onSelectExam={(exam) => onSelectExam(course, exam)}
          onDeleteTopic={(topic) => onDeleteTopic(course, topic)}
        />
      ))}
    </div>
  );
}

function CourseSection({
  course,
  health,
  today,
  query,
  selectedId,
  open,
  onToggle,
  onSelectCourse,
  onSelectTopic,
  onSelectExam,
  onDeleteTopic,
}: {
  course: Course;
  health: CourseHealth | undefined;
  today: string;
  query: string;
  selectedId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelectCourse: () => void;
  onSelectTopic: (topic: Topic) => void;
  onSelectExam: (exam: Exam) => void;
  onDeleteTopic: (topic: Topic) => void;
}) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const progress = courseProgress(course);
  const topics = course.topics.filter((topic) => matchesQuery(query, topic.name, topic.section));

  return (
    <Card className="flex flex-col gap-3">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${course.name}`}
          className="flex size-5 shrink-0 items-center justify-center rounded-chip text-secondary hover:bg-fill"
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-3.5 transition-transform duration-150 ease-mac ${open ? "rotate-90" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={onSelectCourse}
          aria-current={course.id === selectedId ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-chip text-left"
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: course.color }}
          />
          <h2 className="min-w-0 truncate text-title3 font-semibold">{course.name}</h2>
        </button>
        <ProgressBar
          ratio={progress.ratio}
          label={`${course.name} progress`}
          tint={course.color}
          className="w-28 shrink-0"
        />
        <span className="w-32 shrink-0 text-right text-callout tabular-nums whitespace-nowrap text-secondary">
          {progress.totalUnits > 0
            ? `${progress.completedUnits} / ${progress.totalUnits}`
            : "No sizes"}
        </span>
        {health?.exam && health.daysUntilExam !== null ? (
          <CountdownBadge
            days={health.daysUntilExam}
            provisional={health.exam.status === "provisional"}
          />
        ) : null}
      </header>

      {open ? (
        <>
          <ExamList
            course={course}
            selectedId={selectedId}
            onSelect={onSelectExam}
            onDelete={(exam) => run(repository.deleteExam(exam.id))}
          />
          <ExamForm
            today={today}
            onSubmit={(input) => run(repository.createExam(course.id, input))}
          />

          {topics.length > 0 ? (
            <ul className="flex flex-col">
              {topics.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  today={today}
                  prefix={topic.section}
                  selected={topic.id === selectedId}
                  onSelect={() => onSelectTopic(topic)}
                  onDelete={() => onDeleteTopic(topic)}
                />
              ))}
            </ul>
          ) : course.topics.length > 0 ? (
            <p className="px-2 text-body text-secondary">No topic matches “{query.trim()}”.</p>
          ) : null}

          <OutlineForm
            course={course}
            onSubmit={(newTopics) =>
              run(repository.createTopics(course.id, newTopics, course.color))
            }
          />
        </>
      ) : null}
    </Card>
  );
}

function ExamList({
  course,
  selectedId,
  onSelect,
  onDelete,
}: {
  course: Course;
  selectedId: string | null;
  onSelect: (exam: Exam) => void;
  onDelete: (exam: Exam) => void;
}) {
  if (course.exams.length === 0) {
    return (
      <p className="text-body text-secondary">
        No exam date yet. A provisional window is fine — it is shown as provisional everywhere.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {course.exams.map((exam) => (
        <li key={exam.id} className="group flex items-center gap-3 text-body">
          <button
            type="button"
            onClick={() => onSelect(exam)}
            aria-current={exam.id === selectedId ? "true" : undefined}
            className="min-w-0 flex-1 truncate rounded-chip text-left"
          >
            {exam.name}
          </button>
          <span className="shrink-0 tabular-nums text-secondary">
            {exam.status === "provisional" && exam.endDate
              ? `${exam.startDate} – ${exam.endDate}`
              : exam.startDate}
          </span>
          {exam.status === "provisional" ? (
            <Badge tone="orange" variant="outline">
              Provisional
            </Badge>
          ) : null}
          <IconButton
            size="sm"
            label={`Delete ${exam.name}`}
            icon={<Trash2 />}
            onClick={() => onDelete(exam)}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          />
        </li>
      ))}
    </ul>
  );
}

function ExamForm({
  today,
  onSubmit,
}: {
  today: string;
  onSubmit: (input: { name: string; startDate: string; endDate?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        // An end date is what makes an exam provisional; the repository derives
        // the status rather than asking for it twice.
        onSubmit({ name: trimmed, startDate, endDate: endDate || undefined });
        setName("");
        setEndDate("");
      }}
    >
      <TextField
        label="Exam"
        fieldClassName="min-w-40 flex-1"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label="Date"
        type="date"
        value={startDate}
        onChange={(event) => setStartDate(event.target.value)}
      />
      <TextField
        label="Window ends"
        type="date"
        hint="Optional — marks the date provisional"
        value={endDate}
        onChange={(event) => setEndDate(event.target.value)}
      />
      <Button type="submit" variant="accent" disabled={name.trim() === ""}>
        Add exam
      </Button>
    </form>
  );
}

/**
 * The bulk entry path. Typing 40 lecture titles one dialog at a time is the
 * single worst thing the old UI asked of anyone, so paste is the primary route
 * in and single-topic creation is just a one-line paste.
 */
function OutlineForm({
  course,
  onSubmit,
}: {
  course: Course;
  onSubmit: (
    topics: Array<{ name: string; section?: string; unit: Unit; totalUnits: number }>,
  ) => void;
}) {
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<Unit>(course.topics[0]?.unit ?? "slides");
  const parsed = parseOutline(text, { defaultUnit: unit });

  return (
    <form
      className="flex flex-col gap-2 border-t border-separator pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.topics.length === 0) return;
        onSubmit(
          parsed.topics.map((topic) => ({
            name: topic.name,
            section: topic.section,
            unit: topic.unit,
            totalUnits: topic.totalUnits,
          })),
        );
        setText("");
      }}
    >
      <TextArea
        label="Add topics"
        rows={3}
        placeholder={"Block 1\n  Glycolysis — 42 slides\n  Citric acid cycle — 38"}
        hint="One topic per line. Indent under a heading to group them; add “— 42 slides” to record size."
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="font-mono"
      />
      <div className="flex flex-wrap items-end gap-2">
        <SelectField
          label="Default unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value as Unit)}
        >
          {UNITS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {UNIT_LABELS[candidate].plural}
            </option>
          ))}
        </SelectField>
        <span className="pb-1.5 text-callout text-secondary">
          {parsed.topics.length} topic{parsed.topics.length === 1 ? "" : "s"}
          {parsed.issues.length > 0 ? ` · ${parsed.issues.length} to check` : ""}
        </span>
        <span className="flex-1" />
        {course.topics.length > 0 ? (
          <Button onClick={() => setText(formatOutline(course.topics))}>
            Copy existing as outline
          </Button>
        ) : null}
        <Button type="submit" variant="accent" disabled={parsed.topics.length === 0}>
          Add topics
        </Button>
      </div>
      {parsed.issues.length > 0 ? (
        <ul className="text-footnote text-red">
          {parsed.issues.map((issue) => (
            <li key={`${issue.line}-${issue.message}`}>
              Line {issue.line}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
