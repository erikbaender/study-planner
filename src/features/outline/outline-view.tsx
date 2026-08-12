"use client";

/**
 * Outline — where the material lives.
 *
 * One card per course, holding its topics, its exam dates and the two actions
 * that fill a course with material. This is the view you are in when you are
 * *managing* topics: adding them, removing them, moving their progress, and
 * picking one out to change in the inspector. It is deliberately not the view
 * for arranging time — the timeline does that far better than a list of dates
 * ever could, and trying to do both here is what turned the old outline into a
 * spreadsheet.
 *
 * Two rules the layout follows, both learned the hard way:
 *
 * - **Density is the design.** A semester is seven courses of forty topics. A
 *   card with four-pixel-heavier padding costs three hundred pixels of screen
 *   across a term's worth of material, and the outline stops being something
 *   you can see and becomes something you scroll. Every measurement here is the
 *   smallest one that still reads.
 * - **A control does one thing.** The course header opens and closes the
 *   course. Topic rows select topics, while a course is selected by its
 *   context menu so opening a course never doubles as inspecting it.
 */

import { clsx } from "clsx";
import { useLayoutEffect, useMemo, useState } from "react";
import { CalendarPlus, ClipboardPaste, Plus, Trash2 } from "lucide-react";
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
  type Topic,
  type Unit,
} from "@/domain";
import {
  Badge,
  Button,
  Collapse,
  ContextMenu,
  CountdownBadge,
  EmptyState,
  IconButton,
  ProgressBar,
  SelectField,
  Sheet,
  TextArea,
  TextField,
  useListPresence,
} from "@/ui";
import { useDisclosure } from "@/ui/row-motion";
import { TopicList } from "./topic-list";
import { AutoPlanButton } from "@/features/planning/planning-actions";
import { clickHint, hintScope, hintTarget, useViewHints, type InputHint } from "@/features/workspace/hints";
import { topicsForQuery } from "@/features/workspace/scope";
import { requestRename, revealSelection, useWorkspace } from "@/features/workspace/store";

/** What the pointer does here, for the toolbar's hint bar. */
const OUTLINE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Select topic" },
  { button: "left", label: "Set progress", drag: true },
  { button: "right", label: "Actions" },
];

const courseKey = (course: Course) => course.id;

export function OutlineView({
  courses,
  health,
  today,
  query,
  snapshot,
  selectedId,
  onSelectTopic,
  onSelectExam,
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
  onSelectTopic: (course: Course, topic: Topic) => void;
  onSelectExam: (course: Course, exam: Exam) => void;
  onDeleteTopic: (course: Course, topic: Topic) => void;
  onDeleteCourse: (course: Course) => void;
  onNewCourse: () => void;
}) {
  useViewHints(OUTLINE_HINTS);
  // Courses filtered out by the sidebar or the search field leave the way rows
  // leave the chart — fading, then collapsing — rather than vanishing between
  // two frames. `useListPresence` keeps them mounted for exactly that long.
  const cards = useListPresence(courses, courseKey);

  return (
    <div className="h-full" {...hintScope}>
      {/* `min-h-full`, so the space below the last card is still the view and a
          click there clears the selection. */}
      <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-2 p-5">
        {cards.map(({ key, item, present, appear }) => (
          <Collapse key={key} present={present} appear={appear}>
            <CourseCard
              course={item}
              health={health.get(item.id)}
              today={today}
              query={query}
              snapshot={snapshot}
              selectedId={selectedId}
              onSelectTopic={(topic) => onSelectTopic(item, topic)}
              onSelectExam={(exam) => onSelectExam(item, exam)}
              onDeleteTopic={(topic) => onDeleteTopic(item, topic)}
              onDeleteCourse={() => onDeleteCourse(item)}
            />
          </Collapse>
        ))}

        <Collapse present={courses.length === 0}>
          <EmptyState
            title="No courses in focus"
            description="Add a course, or widen the focus in the sidebar to see the ones you have."
            action={
              <Button variant="accent" leadingIcon={<Plus />} onClick={onNewCourse}>
                New course
              </Button>
            }
          />
        </Collapse>
      </div>
    </div>
  );
}

function CourseCard({
  course,
  health,
  today,
  query,
  snapshot,
  selectedId,
  onSelectTopic,
  onSelectExam,
  onDeleteTopic,
  onDeleteCourse,
}: {
  course: Course;
  health: CourseHealth | undefined;
  today: string;
  query: string;
  snapshot: PlannerSnapshot;
  selectedId: string | null;
  onSelectTopic: (topic: Topic) => void;
  onSelectExam: (exam: Exam) => void;
  onDeleteTopic: (topic: Topic) => void;
  onDeleteCourse: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const [pasting, setPasting] = useState(false);
  const collapsed = useWorkspace((state) => state.collapsedCourseIds.includes(course.id));
  const toggleCollapsed = useWorkspace((state) => state.toggleCourseCollapsed);
  const progress = courseProgress(course);
  const selected = course.id === selectedId;
  const tint = courseColorValue(course.color);
  // Memoized because `TopicList` animates arrivals and departures, and that
  // merge is keyed on this array's identity — a fresh one per render would
  // never settle.
  const topics = useMemo(() => topicsForQuery(query, course), [query, course]);
  const disclosure = useDisclosure(!collapsed);
  const percent = progress.ratio === null ? null : Math.round(progress.ratio * 100);

  /**
   * Add a topic, select it, and put the caret in its name.
   *
   * A new row is never the thing you wanted — it is a placeholder for the thing
   * you were about to type. Creating it, opening the inspector on it and
   * selecting its name is one gesture from the student's side, so it is one
   * action here rather than three clicks in a row.
   */
  const addTopic = () =>
    run(
      repository
        .createTopic(course.id, {
          // Named for what it is rather than left blank: an untitled row in a
          // list of forty is indistinguishable from a rendering bug.
          name: "New topic",
          unit: course.topics.at(-1)?.unit ?? "slides",
          color: course.color,
        })
        .then((topicId) => {
          revealSelection({ kind: "topic", id: topicId });
          requestRename(topicId);
        }),
    );

  return (
    <ContextMenu
      items={[
        { label: "Add topic", icon: <Plus />, onSelect: addTopic },
        { label: "Paste outline", icon: <ClipboardPaste />, onSelect: () => setPasting(true) },
        { type: "separator" },
        { label: "Delete course", icon: <Trash2 />, danger: true, onSelect: onDeleteCourse },
      ]}
    >
      <section
        data-course-id={course.id}
        onContextMenu={() => revealSelection({ kind: "course", id: course.id })}
        className={clsx(
          "relative overflow-hidden rounded-card border bg-content",
          selected ? "border-accent" : "border-separator",
        )}
      >
        {/* The course's colour as a rail rather than a dot. A dot is a label; a
            rail down the whole card is what tells you, while you are reading a
            topic thirty rows down, which course you are still inside. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: tint, opacity: selected ? 1 : 0.65 }}
        />

        <div className="relative pl-[3px]" data-keeps-selection>
          <button
            type="button"
            onClick={() => toggleCollapsed(course.id)}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${course.name}`}
            // The header alone carries the selection tint, not the whole card:
            // a body of forty topic rows washed blue says "these rows are
            // selected", which is the one thing selecting a course does not
            // mean.
            className={clsx(
              "relative flex h-9 w-full items-center gap-2.5 pr-3 pl-2 text-left",
              "focus-visible:outline-2 focus-visible:-outline-offset-2",
              selected ? "bg-accent-soft" : "hover:bg-fill/50",
            )}
          >
            <h2 className="min-w-0 flex-1 truncate text-title3 font-semibold">{course.name}</h2>

            {course.code ? (
              <span className="hidden shrink-0 text-callout text-tertiary tabular-nums sm:inline">
                {course.code}
              </span>
            ) : null}

            <span className="hidden shrink-0 text-callout tabular-nums text-tertiary md:inline">
              {course.topics.length} topic{course.topics.length === 1 ? "" : "s"}
            </span>

            <span className="w-8 shrink-0 text-right text-callout tabular-nums text-secondary">
              {percent === null ? "—" : `${percent}%`}
            </span>

            <ProgressBar
              ratio={progress.ratio}
              label={`${course.name} progress`}
              tint={tint}
              size="sm"
              className="hidden w-20 shrink-0 sm:block"
            />

            {health?.exam && health.daysUntilExam !== null ? (
              <CountdownBadge
                days={health.daysUntilExam}
                provisional={health.exam.status === "provisional"}
                atRisk={Boolean(health.pace && !health.pace.onTrack)}
              />
            ) : null}
          </button>
        </div>

        {disclosure.mounted ? (
          <CardBody expanded={disclosure.expanded}>
            <div className="border-t border-separator pl-[3px]">
              <div className="px-2 py-1">
                {topics.length > 0 || course.topics.length === 0 ? (
                  <TopicList
                    course={course}
                    topics={topics}
                    today={today}
                    selectedId={selectedId}
                    onSelect={onSelectTopic}
                    onDelete={onDeleteTopic}
                    onAddRow={addTopic}
                  />
                ) : (
                  <p className="px-2 py-3 text-callout text-tertiary">
                    No topic matches “{query.trim()}”.
                  </p>
                )}
              </div>

              <div
                className="flex flex-wrap items-center gap-1.5 border-t border-separator px-2 py-1.5"
                data-keeps-selection
              >
                <ExamChips
                  course={course}
                  today={today}
                  selectedId={selectedId}
                  onSelect={onSelectExam}
                  onDelete={(exam) => run(repository.deleteExam(exam.id))}
                  onCreate={(input) => run(repository.createExam(course.id, input))}
                />

                <span className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" leadingIcon={<ClipboardPaste />} onClick={() => setPasting(true)}>
                    Paste outline
                  </Button>
                  <AutoPlanButton course={course} snapshot={snapshot} today={today} />
                </span>
              </div>
            </div>
          </CardBody>
        ) : null}

        <BulkEntrySheet
          open={pasting}
          onOpenChange={setPasting}
          course={course}
          onSubmit={(newTopics) => {
            run(repository.createTopics(course.id, newTopics, course.color));
            setPasting(false);
          }}
        />
      </section>
    </ContextMenu>
  );
}

/**
 * A course opening and closing.
 *
 * The height is measured rather than computed: the rows are a known height, but
 * the exam line wraps, the action bar does not, and a card that animates to a
 * height its contents disagree with either clips its last row or leaves a strip
 * of empty card under it. Measuring is one layout read per change of contents,
 * against a mistake that is visible on every single open.
 */
function CardBody({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  const [height, setHeight] = useState(0);
  const [content, setContent] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!content) return;
    const measure = () => setHeight(content.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Re-measured as the contents change, so a topic filtered out of an open
    // course shrinks the card by exactly as much as the row it removed.
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [content]);

  return (
    <div
      className="outline-disclosure"
      // `auto` until the contents have been measured, so a card that is simply
      // open on arrival is open — it does not grow into place. Committing a
      // height of zero first and correcting it afterwards is a transition, and
      // a view that plays one for every card the moment you switch to it is a
      // splash screen.
      style={{ height: expanded ? (height === 0 ? undefined : height) : 0 }}
    >
      <div ref={setContent}>{children}</div>
    </div>
  );
}

/* ─── Exams ─────────────────────────────────────────────────────────────── */

/**
 * Exams sit in the card's footer beside the actions rather than above the
 * topics. A course usually has one date, and a line of its own above forty
 * rows gave one number the visual weight of the whole course; the countdown in
 * the header is what answers "when" at a glance, and this is where you go to
 * change it.
 */
function ExamChips({
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
  const chips = useListPresence(course.exams, (exam) => exam.id);

  return (
    <>
      {chips.map(({ key, item: exam, present, appear }) => (
        <Collapse key={key} present={present} appear={appear} className="shrink-0">
          <span className="group flex items-center">
            <button
              type="button"
              onClick={() => onSelect(exam)}
              aria-pressed={exam.id === selectedId}
              className={clsx(
                "flex items-center gap-1.5 rounded-chip py-0.5 pr-1.5 pl-2 text-callout",
                exam.id === selectedId ? "bg-accent-soft" : "hover:bg-fill",
              )}
            >
              <span className="truncate">{exam.name}</span>
              <span className="tabular-nums text-tertiary">
                {exam.status === "provisional" && exam.endDate
                  ? `${exam.startDate} – ${exam.endDate}`
                  : exam.startDate}
              </span>
              {exam.status === "provisional" ? <Badge tone="warning">Provisional</Badge> : null}
            </button>
            <IconButton
              size="sm"
              label={`Delete ${exam.name}`}
              icon={<Trash2 />}
              onClick={() => onDelete(exam)}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            />
          </span>
        </Collapse>
      ))}

      <IconButton
        size="sm"
        label={`Add an exam to ${course.name}`}
        icon={<CalendarPlus />}
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
    </>
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
      description="One topic per line. Add “— 42 slides” to a line to record how big it is."
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
          placeholder={"Glycolysis — 42 slides\nCitric acid cycle — 38\nLipid metabolism — 61"}
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
