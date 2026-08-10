"use client";

/**
 * Outline — the setup workhorse.
 *
 * One disclosure group per course, each holding its exams and an editable table
 * of its topics. Groups start collapsed unless the course is the only one in
 * focus or the one being inspected: with ten courses of forty topics, expanding
 * everything by default would render four hundred rows nobody asked for, and
 * scrolling past nine courses to reach the tenth is not navigation.
 *
 * Bulk paste lives in a sheet rather than in a box at the foot of every course.
 * It is the fastest way to enter a semester and it is used perhaps twice a
 * term, and a permanently-open text area that large made the outline look like
 * a form when it is meant to look like material.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, ClipboardPaste, PanelRight, Plus, Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  courseProgress,
  courseColorValue,
  formatOutline,
  parseOutline,
  UNITS,
  UNIT_LABELS,
  type Course,
  type CourseHealth,
  type PlannerSnapshot,
  type Exam,
  type StudyBlock,
  type Topic,
  type Unit,
} from "@/domain";
import {
  Badge,
  Button,
  Card,
  ContextMenu,
  CountdownBadge,
  EmptyState,
  IconButton,
  ProgressBar,
  SelectField,
  Sheet,
  TextArea,
  TextField,
  motionDuration,
  useDisclosure,
} from "@/ui";
import { TopicTable } from "./topic-table";
import { AutoPlanButton } from "@/features/planning/planning-actions";
import { clickHint, hintScope, hintTarget, useViewHints, type InputHint } from "@/features/workspace/hints";
import { topicsForQuery } from "@/features/workspace/scope";

/** What the pointer does here, for the toolbar's hint bar. */
const OUTLINE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Select or edit" },
  { button: "left", label: "Set progress", drag: true },
  { button: "right", label: "Actions" },
];

export function OutlineView({
  courses,
  health,
  today,
  query,
  snapshot,
  selectedId,
  onSelectCourse,
  onSelectTopic,
  onSelectExam,
  onSelectBlock,
  onDeleteTopic,
  onDeleteCourse,
  onNewCourse,
}: {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  today: string;
  snapshot: PlannerSnapshot;
  query: string;
  selectedId: string | null;
  onSelectCourse: (course: Course) => void;
  onSelectTopic: (course: Course, topic: Topic) => void;
  onSelectExam: (course: Course, exam: Exam) => void;
  onSelectBlock: (block: StudyBlock) => void;
  onDeleteTopic: (course: Course, topic: Topic) => void;
  onDeleteCourse: (course: Course) => void;
  onNewCourse: () => void;
}) {
  useViewHints(OUTLINE_HINTS);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Selecting a course in the sidebar should reveal its material rather than
  // leave you hunting for a triangle.
  const isDefaultOpen = (course: Course) => courses.length === 1 || course.id === selectedId;

  if (courses.length === 0) {
    return (
      <div className="h-full" {...hintScope}>
        <EmptyState
          title="No courses in focus"
          description="Add a course, or widen the focus in the sidebar to see the ones you have."
          action={
            <Button variant="accent" leadingIcon={<Plus />} onClick={onNewCourse}>
              New course
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6" {...hintScope}>
      {courses.map((course) => (
        <CourseSection
          key={course.id}
          course={course}
          health={health.get(course.id)}
          today={today}
          query={query}
          snapshot={snapshot}
          selectedId={selectedId}
          open={expanded[course.id] ?? isDefaultOpen(course)}
          onToggle={() =>
            setExpanded((current) => ({
              ...current,
              [course.id]: !(current[course.id] ?? isDefaultOpen(course)),
            }))
          }
          onSelectCourse={() => onSelectCourse(course)}
          onSelectTopic={(topic) => onSelectTopic(course, topic)}
          onSelectExam={(exam) => onSelectExam(course, exam)}
          onSelectBlock={onSelectBlock}
          onDeleteTopic={(topic) => onDeleteTopic(course, topic)}
          onDeleteCourse={() => onDeleteCourse(course)}
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
  snapshot,
  selectedId,
  open,
  onToggle,
  onSelectCourse,
  onSelectTopic,
  onSelectExam,
  onSelectBlock,
  onDeleteTopic,
  onDeleteCourse,
}: {
  course: Course;
  health: CourseHealth | undefined;
  today: string;
  query: string;
  snapshot: PlannerSnapshot;
  selectedId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelectCourse: () => void;
  onSelectTopic: (topic: Topic) => void;
  onSelectExam: (exam: Exam) => void;
  onSelectBlock: (block: StudyBlock) => void;
  onDeleteTopic: (topic: Topic) => void;
  onDeleteCourse: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const [pasting, setPasting] = useState(false);
  const progress = courseProgress(course);
  const topics = topicsForQuery(query, course);
  const disclosure = useDisclosure(open);
  const contentRef = useRef<HTMLDivElement>(null);
  // "auto" is what a course that starts open renders at, so the first paint
  // of the default-expanded course never runs the height animation at all.
  const [contentHeight, setContentHeight] = useState<number | "auto">(open ? "auto" : 0);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    if (disclosure.expanded) {
      // A height can only be transitioned to a number, so this measures the
      // content once to give the browser a target, then — once the transition
      // has had time to reach it — lets the height go back to "auto". Without
      // that settle step a course whose topic count changes while it is open
      // (add a row, paste an outline) would stay clipped to the height it had
      // when it was opened.
      setContentHeight(node.scrollHeight);
      const timer = window.setTimeout(() => setContentHeight("auto"), motionDuration(node) / 2);
      return () => window.clearTimeout(timer);
    }
    if (disclosure.mounted) {
      // Closing: "auto" cannot be transitioned from, so pin to the measured
      // height for one frame before collapsing it to zero.
      setContentHeight(node.scrollHeight);
      const frame = requestAnimationFrame(() => setContentHeight(0));
      return () => cancelAnimationFrame(frame);
    }
  }, [disclosure.expanded, disclosure.mounted]);

  const addRow = () =>
    run(
      repository.createTopic(course.id, {
        // Named for what it is rather than left blank: an untitled row in a
        // table of forty is indistinguishable from a rendering bug, and the
        // name field is focused for typing over anyway.
        name: "New topic",
        unit: course.topics.at(-1)?.unit ?? "slides",
        color: course.color,
      }),
    );

  return (
    <ContextMenu
      items={[
        { label: "Inspect course", icon: <PanelRight />, onSelect: onSelectCourse },
        { label: "Add topic", icon: <Plus />, onSelect: addRow },
        { type: "separator" },
        { label: "Delete course", icon: <Trash2 />, danger: true, onSelect: onDeleteCourse },
      ]}
    >
      <Card className="flex flex-col gap-3">
      <header className="flex items-center gap-3">
        {/* The heading is the disclosure control, both ways. It used to open the
            course and then do nothing on a second click, because the click was
            wired to selection instead — a triangle that only turns one way.
            Inspecting the course is available from the right-click menu. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-chip text-left"
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-3.5 shrink-0 text-secondary transition-transform duration-150 ease-mac ${open ? "rotate-90" : ""}`}
          />
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: courseColorValue(course.color) }}
          />
          <h2 className="min-w-0 truncate text-title3 font-semibold">{course.name}</h2>
        </button>
        <ProgressBar
          ratio={progress.ratio}
          label={`${course.name} progress`}
          tint={courseColorValue(course.color)}
          className="w-28 shrink-0"
        />
        <span className="w-28 shrink-0 text-right text-callout tabular-nums whitespace-nowrap text-secondary">
          {progress.totalUnits > 0
            ? `${progress.completedUnits} / ${progress.totalUnits}`
            : "No sizes"}
        </span>
        {health?.exam && health.daysUntilExam !== null ? (
          <CountdownBadge
            days={health.daysUntilExam}
            provisional={health.exam.status === "provisional"}
            atRisk={Boolean(health.pace && !health.pace.onTrack)}
          />
        ) : null}

      </header>

      <div className="disclosure" style={{ height: contentHeight }}>
        {disclosure.mounted ? (
          <div ref={contentRef} className="flex flex-col gap-3">
            <ExamRow
              course={course}
              today={today}
              selectedId={selectedId}
              onSelect={onSelectExam}
              onDelete={(exam) => run(repository.deleteExam(exam.id))}
              onCreate={(input) => run(repository.createExam(course.id, input))}
            />

            {topics.length > 0 ? (
              <TopicTable
                course={course}
                topics={topics}
                today={today}
                selectedId={selectedId}
                onSelect={onSelectTopic}
                onSelectBlock={onSelectBlock}
                onDelete={onDeleteTopic}
                onAddRow={addRow}
              />
            ) : course.topics.length > 0 ? (
              <p className="px-2 py-4 text-body text-secondary">
                No topic matches “{query.trim()}”.
              </p>
            ) : (
              <p className="px-2 py-4 text-body text-secondary">
                No topics yet. Paste your lecture list — it is far quicker than adding them one at a
                time.
              </p>
            )}

            <div className="flex items-center gap-2 border-t border-separator pt-3">
              <Button leadingIcon={<Plus />} onClick={addRow}>
                Add topic
              </Button>
              <Button
                variant="accent"
                leadingIcon={<ClipboardPaste />}
                onClick={() => setPasting(true)}
              >
                Paste outline
              </Button>
              <span className="ml-auto">
                <AutoPlanButton course={course} snapshot={snapshot} today={today} />
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Not inside the measured content: a Radix dialog portals to the body
          regardless of where it sits in the tree, and reading its markup as
          part of the course's own height would count a sheet that has never
          been open. */}
      <BulkEntrySheet
        open={pasting}
        onOpenChange={setPasting}
        course={course}
        onSubmit={(newTopics) => {
          run(repository.createTopics(course.id, newTopics, course.color));
          setPasting(false);
        }}
      />
      </Card>
    </ContextMenu>
  );
}

/* ─── Exams ─────────────────────────────────────────────────────────────── */

/**
 * Exams sit on one line above the table rather than in a card of their own.
 * A course usually has one, and giving one date its own panel above forty
 * topics gave it the visual weight of the whole course.
 */
function ExamRow({
  course,
  today,
  selectedId,
  onSelect,
  onDelete,
  onCreate,
}: {
  course: Course;
  today: string;
  selectedId: string | null;
  onSelect: (exam: Exam) => void;
  onDelete: (exam: Exam) => void;
  onCreate: (input: { name: string; startDate: string; endDate?: string }) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {course.exams.length === 0 ? (
        <p className="text-callout text-secondary">
          No exam date yet — a provisional window is enough to plan backwards from.
        </p>
      ) : (
        course.exams.map((exam) => (
          <span key={exam.id} className="group flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSelect(exam)}
              aria-current={exam.id === selectedId ? "true" : undefined}
              className="flex items-center gap-1.5 rounded-chip px-1 py-0.5 text-callout hover:bg-fill"
            >
              <span className="truncate">{exam.name}</span>
              <span className="tabular-nums text-secondary">
                {exam.status === "provisional" && exam.endDate
                  ? `${exam.startDate} – ${exam.endDate}`
                  : exam.startDate}
              </span>
              {exam.status === "provisional" ? (
                <Badge tone="warning">
                  Provisional
                </Badge>
              ) : null}
            </button>
            <IconButton
              size="sm"
              label={`Delete ${exam.name}`}
              icon={<Trash2 />}
              onClick={() => onDelete(exam)}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            />
          </span>
        ))
      )}

      <IconButton
        size="sm"
        label={`Add an exam to ${course.name}`}
        icon={<Plus />}
        onClick={() => setAdding(true)}
        {...hintTarget(clickHint("Add an exam date"))}
      />

      <ExamSheet
        open={adding}
        onOpenChange={setAdding}
        course={course}
        today={today}
        onSubmit={(input) => {
          onCreate(input);
          setAdding(false);
        }}
      />
    </div>
  );
}

function ExamSheet({
  open,
  onOpenChange,
  course,
  today,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  today: string;
  onSubmit: (input: { name: string; startDate: string; endDate?: string }) => void;
}) {
  const [name, setName] = useState(`${course.name} exam`);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setName(`${course.name} exam`);
    setStartDate(today);
    setEndDate("");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Exam for ${course.name}`}
      description="Everything the app says about pace is counted backwards from this date."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="accent"
            disabled={name.trim() === ""}
            // An end date is what makes an exam provisional; the repository
            // derives the status rather than asking for it twice.
            onClick={() => onSubmit({ name: name.trim(), startDate, endDate: endDate || undefined })}
          >
            Add exam
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <TextField
          label="Date"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <TextField
          label="Window ends"
          type="date"
          hint="Optional. Filling it in marks the date provisional, and planning then counts backwards from the start of the window rather than the end."
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </div>
    </Sheet>
  );
}

/* ─── Bulk entry ────────────────────────────────────────────────────────── */

/**
 * The paste path, and the reason the outline can hold a semester at all.
 *
 * Typing forty lecture titles one dialog at a time is the single worst thing
 * the old UI asked of anyone. The preview below the box is the important part:
 * it shows what will be created *before* it is created, so a mis-parsed line is
 * caught here rather than found later as forty topics named wrongly.
 */
function BulkEntrySheet({
  open,
  onOpenChange,
  course,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  onSubmit: (topics: Array<{ name: string; unit: Unit; totalUnits: number }>) => void;
}) {
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<Unit>(course.topics.at(-1)?.unit ?? "slides");
  const parsed = parseOutline(text, { defaultUnit: unit });

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setText("");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={`Paste an outline into ${course.name}`}
      description="One topic per line. Add “— 42 slides” to record size."
      footer={
        <>
          {course.topics.length > 0 ? (
            <Button className="mr-auto" onClick={() => setText(formatOutline(course.topics))}>
              Load existing topics
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="accent"
            disabled={parsed.topics.length === 0}
            onClick={() =>
              onSubmit(
                parsed.topics.map((topic) => ({
                  name: topic.name,
                  unit: topic.unit,
                  totalUnits: topic.totalUnits,
                })),
              )
            }
          >
            Add {parsed.topics.length || ""} topic{parsed.topics.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextArea
          label="Outline"
          hideLabel
          rows={10}
          autoFocus
          placeholder={"Cell biology — 120 slides\nMembrane transport — 85\nGlycolysis — 140 pages"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="font-mono"
        />

        <SelectField
          label="Unit for lines that do not name one"
          fieldClassName="max-w-64"
          value={unit}
          onValueChange={(value) => setUnit(value as Unit)}
          options={UNITS.map((candidate) => ({ value: candidate, label: UNIT_LABELS[candidate].plural }))}
        />

        {parsed.issues.length > 0 ? (
          <ul role="alert" className="flex flex-col gap-0.5 text-footnote text-negative">
            {parsed.issues.map((issue) => (
              <li key={`${issue.line}-${issue.message}`}>
                Line {issue.line}: {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        {parsed.topics.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-caption font-semibold tracking-wide text-tertiary uppercase">
              Preview
            </h3>
            <ul className="flex max-h-56 flex-col overflow-y-auto rounded-control bg-content-alt p-2">
              {parsed.topics.map((topic, index) => (
                <li
                  key={`${topic.name}-${index}`}
                  className="flex items-baseline gap-2 px-1 py-0.5 text-body"
                >
                  <span className="min-w-0 flex-1 truncate">{topic.name}</span>
                  <span className="shrink-0 text-callout tabular-nums text-secondary">
                    {topic.totalUnits > 0
                      ? `${topic.totalUnits} ${UNIT_LABELS[topic.unit].plural}`
                      : // A size nobody stated stays unstated; the row still
                        // gets created, it just is not counted in any pace.
                        "no size"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
