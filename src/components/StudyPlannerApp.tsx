"use client";

/**
 * Interim shell.
 *
 * Phase 1 replaced the data layer; the macOS-derived UI arrives in phase 2 and
 * will replace this file wholesale. What is here exists to exercise the
 * repository boundary end to end and to close the audit's blocking defect —
 * on a fresh plan there was no way to create a course, so the app could not be
 * used at all. Everything below goes through `useRepository()`; there is no
 * second code path for local versus signed-in any more.
 */

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMemo, useState } from "react";
import {
  usePlannerSnapshot,
  usePlannerErrors,
  useRepository,
} from "@/data/use-repository";
import {
  DEFAULT_PREFERENCES,
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
import { Button, FileButton, Panel, SelectField, TextArea, TextField } from "@/components/ui";

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
  const snapshot = usePlannerSnapshot();
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
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-lg font-semibold">Study Planner</h1>
        <span className="text-xs text-[var(--fg-muted)]">
          {isAuthenticated ? "Synced" : "On this device only"}
        </span>
        <Button onClick={loadSampleData}>Load sample data</Button>
        <Button onClick={exportJson} disabled={snapshot.plans.length === 0}>
          Export
        </Button>
        <FileButton label="Import" accept="application/json" onFile={importJson} />
        {isAuthenticated ? (
          <Button onClick={() => void signOut()}>Sign out</Button>
        ) : (
          <Button variant="primary" onClick={() => void signIn("github")}>
            Sign in with GitHub
          </Button>
        )}
      </header>

      {error ? (
        <div role="alert" className="ui-panel border-[var(--danger-fg)] p-3 text-sm">
          <span className="mr-3">{error.message}</span>
          <Button variant="invisible" onClick={clear}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Panel className="flex flex-col gap-3 p-3">
          <h2 className="text-sm font-semibold">Semesters</h2>
          <ul className="flex flex-col gap-1">
            {snapshot.plans.map((candidate) => (
              <li key={candidate.id}>
                <Button
                  variant={candidate.id === plan?.id ? "primary" : "invisible"}
                  className="w-full justify-start"
                  onClick={() => {
                    setPlanId(candidate.id);
                    setCourseId(null);
                  }}
                >
                  {candidate.name}
                </Button>
              </li>
            ))}
          </ul>
          <NameForm
            label="New semester"
            submit="Add semester"
            onSubmit={(name) => run(repository.createPlan({ name }).then(setPlanId))}
          />
        </Panel>

        {plan ? (
          <div className="flex flex-col gap-4">
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
          </div>
        ) : (
          <Panel className="p-6 text-sm text-[var(--fg-muted)]">
            Add a semester to get started, or load the sample data to see a full one.
          </Panel>
        )}
      </div>

      <footer className="text-xs text-[var(--fg-muted)]">Export format v{EXPORT_VERSION}</footer>
    </main>
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
    <Panel className="flex flex-col gap-3 p-3">
      <h2 className="text-sm font-semibold">Courses in {plan.name}</h2>
      {plan.courses.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)]">
          No courses yet. Add one below — a course holds the topics you work through.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {plan.courses.map((course) => {
            const progress = courseProgress(course);
            const exam = nextExam(course, today);
            return (
              <li key={course.id} className="flex items-center gap-3">
                <Button
                  variant={course.id === selectedCourseId ? "primary" : "invisible"}
                  className="flex-1 justify-start"
                  onClick={() => onSelect(course.id)}
                >
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block h-2 w-2 rounded-full"
                    style={{ background: course.color }}
                  />
                  {course.name}
                </Button>
                <span className="w-16 text-right text-xs tabular-nums text-[var(--fg-muted)]">
                  {formatRatio(progress.ratio)}
                </span>
                <span className="w-28 text-right text-xs text-[var(--fg-muted)]">
                  {exam ? `${exam.name} in ${daysUntil(exam.startDate, today)}d` : "no exam set"}
                </span>
                <Button variant="danger" onClick={() => onDelete(course.id)}>
                  Delete
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <NameForm label="New course" submit="Add course" onSubmit={onCreate} />
    </Panel>
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
      <Panel className="flex flex-col gap-3 p-3">
        <h2 className="text-sm font-semibold">Exams</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {course.exams.map((exam) => (
            <li key={exam.id} className="flex items-center gap-3">
              <span className="flex-1">{exam.name}</span>
              <span className="text-[var(--fg-muted)]">
                {exam.status === "provisional" && exam.endDate
                  ? `${exam.startDate} – ${exam.endDate} (provisional)`
                  : exam.startDate}
              </span>
              <Button variant="danger" onClick={() => run(repository.deleteExam(exam.id))}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
        <ExamForm
          onSubmit={(input) => run(repository.createExam(course.id, input))}
          today={today}
        />
      </Panel>

      <Panel className="flex flex-col gap-3 p-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold">Topics</h2>
          <span className="text-xs text-[var(--fg-muted)]">
            {health.progress.completedUnits} / {health.progress.totalUnits} units ·{" "}
            {health.pace
              ? health.pace.onTrack
                ? "on track"
                : `${health.pace.daysLate} days late at this pace`
              : "no exam set"}
          </span>
        </div>

        <ul className="flex flex-col gap-1 text-sm">
          {course.topics.map((topic) => (
            <TopicRow key={topic.id} topic={topic} today={today} />
          ))}
        </ul>

        <OutlineForm
          course={course}
          onSubmit={(topics) =>
            run(repository.createTopics(course.id, topics, course.color))
          }
        />
      </Panel>
    </>
  );
}

function TopicRow({ topic, today }: { topic: Topic; today: string }) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const progress = topicProgress(topic);
  const [units, setUnits] = useState("");

  return (
    <li className="flex items-center gap-3">
      <span className="flex-1">
        {topic.section ? (
          <span className="mr-2 text-[var(--fg-muted)]">{topic.section} ·</span>
        ) : null}
        {topic.name}
      </span>
      <span className="w-32 text-right tabular-nums text-[var(--fg-muted)]">
        {topic.completedUnits} / {topic.totalUnits} {UNIT_LABELS[topic.unit].plural}
      </span>
      <span className="w-12 text-right tabular-nums text-[var(--fg-muted)]">
        {formatRatio(progress.ratio)}
      </span>
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const amount = Number(units);
          if (!Number.isFinite(amount) || amount === 0) return;
          run(repository.logStudy({ topicId: topic.id, date: today, units: amount }));
          setUnits("");
        }}
      >
        <input
          className="ui-input w-20"
          inputMode="decimal"
          placeholder="+ units"
          aria-label={`Units studied for ${topic.name}`}
          value={units}
          onChange={(event) => setUnits(event.target.value)}
        />
        <Button type="submit">Log</Button>
      </form>
      <Button variant="danger" onClick={() => run(repository.deleteTopic(topic.id))}>
        Delete
      </Button>
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
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" variant="primary">
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
      <TextField label="Exam" value={name} onChange={(event) => setName(event.target.value)} />
      <TextField
        label="Date"
        type="date"
        value={startDate}
        onChange={(event) => setStartDate(event.target.value)}
      />
      <TextField
        label="Window ends"
        type="date"
        hint="Optional — marks the date as provisional"
        value={endDate}
        onChange={(event) => setEndDate(event.target.value)}
      />
      <Button type="submit" variant="primary">
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
  onSubmit: (topics: Array<{ name: string; section?: string; unit: Unit; totalUnits: number }>) => void;
}) {
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<Unit>(course.topics[0]?.unit ?? "slides");
  const parsed = useMemo(() => parseOutline(text, { defaultUnit: unit }), [text, unit]);

  return (
    <form
      className="flex flex-col gap-2"
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
        <span className="text-xs text-[var(--fg-muted)]">
          {parsed.topics.length} topic{parsed.topics.length === 1 ? "" : "s"}
          {parsed.issues.length > 0 ? ` · ${parsed.issues.length} to check` : ""}
        </span>
        <Button type="submit" variant="primary" disabled={parsed.topics.length === 0}>
          Add topics
        </Button>
        {course.topics.length > 0 ? (
          <Button onClick={() => setText(formatOutline(course.topics))}>
            Copy existing as outline
          </Button>
        ) : null}
      </div>
      {parsed.issues.length > 0 ? (
        <ul className="text-xs text-[var(--danger-fg)]">
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
