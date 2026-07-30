"use client";

/**
 * Interim shell.
 *
 * Phase 1 replaced the data layer; phase 2 replaced the look of it. This file is
 * still temporary — the three-column split view, the command palette and the
 * Today / Timeline / Outline views arrive in phases 3–5 and will replace it view
 * by view. What it does now is exercise every repository method through the real
 * design system, which is the only way to find out whether the primitives
 * actually compose before six features depend on them.
 *
 * It also keeps the audit's blocking defect closed: on a fresh install there is
 * a visible path to a semester, a course, and topics.
 */

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { MoreHorizontal, Plus, Settings2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  usePlannerErrors,
  usePlannerSnapshot,
  usePlannerState,
  useRepository,
} from "@/data/use-repository";
import {
  DEFAULT_PREFERENCES,
  EMPTY_SNAPSHOT,
  UNITS,
  UNIT_LABELS,
  assessCourse,
  courseProgress,
  daysUntil,
  formatOutline,
  generateSeedData,
  leastUsedColor,
  nextExam,
  parseOutline,
  toIsoDate,
  topicProgress,
  type Course,
  type Plan,
  type Topic,
  type Unit,
} from "@/domain";
import {
  EXPORT_VERSION,
  exportFilename,
  ImportError,
  parsePlannerJson,
  serializePlans,
} from "@/lib/import-export";
import {
  AccentPicker,
  AppearanceControl,
  Badge,
  Button,
  Card,
  ContextMenu,
  CountdownBadge,
  EmptyState,
  FileButton,
  IconButton,
  Popover,
  ProgressBar,
  ProgressSlider,
  Sidebar,
  SidebarItem,
  SidebarSection,
  Separator,
  Spinner,
  SelectField,
  TextArea,
  TextField,
  Toolbar,
  ToolbarSpacer,
  Tooltip,
} from "@/ui";

/** Read once per mount: the planner is day-granular, so a re-render mid-day is not worth it. */
function useToday() {
  return useState(() => toIsoDate(new Date()))[0];
}

/** `null` means nothing in scope has a tracked size, which is not the same as 0%. */
function formatRatio(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

export function StudyPlannerApp() {
  const repository = useRepository();
  const state = usePlannerState();
  const snapshot = state.status === "ready" ? state.snapshot : EMPTY_SNAPSHOT;
  const { error, run, clear } = usePlannerErrors();
  const { isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const today = useToday();

  const [planId, setPlanId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);

  const plan = snapshot.plans.find((candidate) => candidate.id === planId) ?? snapshot.plans[0];
  const course = plan?.courses.find((candidate) => candidate.id === courseId) ?? plan?.courses[0];

  const usedColors = useMemo(
    () => plan?.courses.map((candidate) => candidate.color) ?? [],
    [plan],
  );

  const loadSampleData = () => {
    const seed = generateSeedData({ today });
    run(
      repository.replaceAll(
        serializePlans(
          { plans: [seed.plan], studyLog: seed.studyLog, preferences: DEFAULT_PREFERENCES },
          today,
        ),
      ),
    );
  };

  const exportJson = () => {
    const document = serializePlans(snapshot, new Date().toISOString());
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }),
    );
    const anchor = Object.assign(window.document.createElement("a"), {
      href: url,
      download: exportFilename(today),
    });
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    run(
      file.text().then(async (contents) => {
        try {
          await repository.importPlans(parsePlannerJson(contents));
        } catch (cause) {
          throw cause instanceof ImportError ? cause : new Error(String(cause));
        }
      }),
    );
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Toolbar>
        <h1 className="text-body font-semibold">Study Planner</h1>
        <Badge tone={isAuthenticated ? "green" : "neutral"} variant="outline">
          {isAuthenticated ? "Synced" : "This device"}
        </Badge>

        <ToolbarSpacer />

        <Button size="sm" onClick={loadSampleData}>
          Load sample data
        </Button>
        <Button size="sm" onClick={exportJson} disabled={snapshot.plans.length === 0}>
          Export
        </Button>
        <FileButton size="sm" label="Import" accept="application/json" onFile={importJson} />

        <Separator orientation="vertical" className="mx-1 h-4" />

        <Popover
          side="bottom"
          align="end"
          trigger={
            <span>
              <Tooltip content="Appearance">
                <IconButton size="sm" label="Appearance" icon={<Settings2 />} />
              </Tooltip>
            </span>
          }
        >
          <div className="flex w-56 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-callout font-semibold text-secondary">Appearance</h2>
              <AppearanceControl />
            </div>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-callout font-semibold text-secondary">Accent colour</h2>
              <AccentPicker />
            </div>
          </div>
        </Popover>

        {isAuthenticated ? (
          <Button size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        ) : (
          <Button size="sm" variant="accent" onClick={() => void signIn("github")}>
            Sign in with GitHub
          </Button>
        )}
      </Toolbar>

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-3 border-b border-separator bg-red/10 px-4 py-2 text-body"
        >
          <span className="text-red">{error.message}</span>
          <Button size="sm" variant="plain" className="ml-auto" onClick={clear}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <Sidebar label="Semesters">
          <SidebarSection title="Semesters">
            {snapshot.plans.map((candidate) => (
              <SidebarItem
                key={candidate.id}
                label={candidate.name}
                selected={candidate.id === plan?.id}
                count={candidate.courses.length}
                onSelect={() => {
                  setPlanId(candidate.id);
                  setCourseId(null);
                }}
              />
            ))}
          </SidebarSection>

          <NameForm
            label="New semester"
            submit="Add"
            onSubmit={(name) => run(repository.createPlan({ name }).then(setPlanId))}
          />
        </Sidebar>

        <main className="min-w-0 flex-1 overflow-y-auto bg-content">
          {state.status === "loading" ? (
            // Not the empty state: "you have no semesters" is a claim, and until
            // the repository has answered it is one the app cannot make.
            <div className="flex h-full items-center justify-center">
              <Spinner label="Loading your plan" />
            </div>
          ) : plan ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
              <CourseList
                plan={plan}
                today={today}
                selectedCourseId={course?.id ?? null}
                onSelect={setCourseId}
                onCreate={(name) =>
                  run(
                    repository
                      .createCourse(plan.id, { name, color: leastUsedColor(usedColors) })
                      .then(setCourseId),
                  )
                }
                onDelete={(id) => run(repository.deleteCourse(id))}
              />
              {course ? <CourseDetail course={course} today={today} /> : null}
              <p className="text-footnote text-tertiary">Export format v{EXPORT_VERSION}</p>
            </div>
          ) : (
            <EmptyState
              title="No semesters yet"
              description="A semester holds your courses. Add one to get started, or load a full sample semester to see what the app looks like with real material in it."
              action={
                <Button variant="accent" leadingIcon={<Plus />} onClick={loadSampleData}>
                  Load sample data
                </Button>
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ courses */

function CourseList({
  plan,
  today,
  selectedCourseId,
  onSelect,
  onCreate,
  onDelete,
}: {
  plan: Plan;
  today: string;
  selectedCourseId: string | null;
  onSelect: (courseId: string) => void;
  onCreate: (name: string) => void;
  onDelete: (courseId: string) => void;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-title3 font-semibold">{plan.name}</h2>

      {plan.courses.length === 0 ? (
        <p className="text-body text-secondary">
          No courses yet. A course holds the topics you work through — add one below.
        </p>
      ) : (
        <ul className="flex flex-col">
          {plan.courses.map((course) => {
            const progress = courseProgress(course);
            const exam = nextExam(course, today);
            const selected = course.id === selectedCourseId;

            return (
              <li key={course.id}>
                {/* Right-click to delete, rather than a Delete button on every
                    row: destructive actions do not belong in the resting state
                    of a list. */}
                <ContextMenu
                  items={[
                    {
                      label: `Delete ${course.name}`,
                      icon: <Trash2 />,
                      danger: true,
                      onSelect: () => onDelete(course.id),
                    },
                  ]}
                >
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(course.id)}
                    className={`flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left ${
                      selected ? "bg-accent-soft" : "hover:bg-fill"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: course.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-body font-medium">
                      {course.name}
                    </span>
                    <ProgressBar
                      ratio={progress.ratio}
                      label={`${course.name} progress`}
                      tint={course.color}
                      className="w-28"
                    />
                    <span className="w-10 text-right text-callout tabular-nums text-secondary">
                      {formatRatio(progress.ratio)}
                    </span>
                    <span className="w-24 text-right">
                      {exam ? (
                        <CountdownBadge
                          days={daysUntil(exam.startDate, today)}
                          provisional={exam.status === "provisional"}
                        />
                      ) : (
                        <span className="text-callout text-tertiary">no exam</span>
                      )}
                    </span>
                  </button>
                </ContextMenu>
              </li>
            );
          })}
        </ul>
      )}

      <NameForm label="New course" submit="Add course" onSubmit={onCreate} />
    </Card>
  );
}

function CourseDetail({ course, today }: { course: Course; today: string }) {
  const repository = useRepository();
  const snapshot = usePlannerSnapshot();
  const { run } = usePlannerErrors();

  const health = useMemo(
    () =>
      assessCourse({
        course,
        today,
        calendar: snapshot.preferences,
        log: snapshot.studyLog,
        dailyCapacityUnits: snapshot.preferences.dailyCapacityUnits,
      }),
    [course, snapshot.studyLog, snapshot.preferences, today],
  );

  return (
    <>
      <Card className="flex flex-col gap-3">
        <h2 className="text-title3 font-semibold">Exams</h2>

        {course.exams.length === 0 ? (
          <p className="text-body text-secondary">
            No exam date yet. Add one — a provisional window is fine, and is shown as provisional
            everywhere.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {course.exams.map((exam) => (
              <li key={exam.id} className="flex items-center gap-3 text-body">
                <span className="flex-1 truncate">{exam.name}</span>
                <span className="text-secondary tabular-nums">
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
                  onClick={() => run(repository.deleteExam(exam.id))}
                />
              </li>
            ))}
          </ul>
        )}

        <ExamForm onSubmit={(input) => run(repository.createExam(course.id, input))} today={today} />
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-title3 font-semibold">Topics</h2>
          <span className="text-callout text-secondary tabular-nums">
            {health.progress.completedUnits} / {health.progress.totalUnits} units
          </span>
          {health.pace ? (
            <Badge tone={health.pace.onTrack ? "green" : "red"}>
              {health.pace.onTrack
                ? "On track"
                : // `daysLate` is 0 both when the finish date is unknowable (no
                  // velocity to extrapolate from) and when it is the capacity
                  // clamp rather than the date that fails. "0 days late" would
                  // read as a measurement in either case.
                  health.pace.daysLate > 0
                  ? `${health.pace.daysLate} days late`
                  : "Behind pace"}
            </Badge>
          ) : (
            <Badge tone="neutral">No exam set</Badge>
          )}
        </div>

        {course.topics.length > 0 ? (
          <ul className="flex flex-col">
            {course.topics.map((topic) => (
              <TopicRow key={topic.id} topic={topic} today={today} />
            ))}
          </ul>
        ) : null}

        <OutlineForm
          course={course}
          onSubmit={(topics) => run(repository.createTopics(course.id, topics, course.color))}
        />
      </Card>
    </>
  );
}

function TopicRow({ topic, today }: { topic: Topic; today: string }) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const progress = topicProgress(topic);
  const unit = UNIT_LABELS[topic.unit].plural;

  return (
    <li className="group flex items-center gap-3 rounded-control px-2 py-1 hover:bg-fill">
      <span className="min-w-0 flex-1 truncate text-body">
        {topic.section ? <span className="text-tertiary">{topic.section} · </span> : null}
        {topic.name}
      </span>

      {topic.totalUnits > 0 ? (
        <>
          <ProgressSlider
            value={topic.completedUnits}
            max={topic.totalUnits}
            label={`${topic.name} progress`}
            valueText={(value) => `${value} of ${topic.totalUnits} ${unit}`}
            tint={topic.color || undefined}
            className="w-48 shrink-0"
            // The slider says where the topic *is*; the log records what
            // changed today. Dragging backwards to correct an over-log is the
            // same operation with a negative delta, which the repository
            // already accepts.
            onCommit={(units) =>
              run(
                repository.logStudy({
                  topicId: topic.id,
                  date: today,
                  units: units - topic.completedUnits,
                }),
              )
            }
          />
          {/* Fixed width and no wrapping: "107 / 128 slides" breaking onto a
              second line would make one row taller than its neighbours, and a
              list of forty topics would comb. */}
          <span className="w-32 shrink-0 text-right text-callout tabular-nums whitespace-nowrap text-secondary">
            {topic.completedUnits} / {topic.totalUnits} {unit}
          </span>
        </>
      ) : (
        // Nothing to slide along: an unsized topic has no scale, and inventing
        // one would be the interface guessing.
        <>
          <ProgressBar ratio={progress.ratio} label={`${topic.name} progress`} size="sm" className="w-48 shrink-0" />
          <span className="w-32 shrink-0 text-right text-callout whitespace-nowrap text-tertiary">
            No size set
          </span>
        </>
      )}

      <ContextMenu
        items={[
          {
            label: `Delete ${topic.name}`,
            icon: <Trash2 />,
            danger: true,
            onSelect: () => run(repository.deleteTopic(topic.id)),
          },
        ]}
      >
        {/* Kept in the DOM at all times rather than mounted on hover, so it is
            reachable by keyboard; only its opacity is conditional. */}
        <IconButton
          size="sm"
          label={`Actions for ${topic.name}`}
          icon={<MoreHorizontal />}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      </ContextMenu>
    </li>
  );
}

/* -------------------------------------------------------------------- forms */

function NameForm({
  label,
  submit,
  onSubmit,
}: {
  label: string;
  submit: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        setName("");
      }}
    >
      <TextField
        label={label}
        fieldClassName="flex-1"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" variant="accent" leadingIcon={<Plus />}>
        {submit}
      </Button>
    </form>
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
        fieldClassName="flex-1 min-w-40"
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
      <Button type="submit" variant="accent">
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
  const parsed = useMemo(() => parseOutline(text, { defaultUnit: unit }), [text, unit]);

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
        rows={4}
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
        <ToolbarSpacer />
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
