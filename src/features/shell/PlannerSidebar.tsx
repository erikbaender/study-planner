"use client";

import { CalendarDays, Clock3, Plus, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import {
  assessCourse,
  courseProgress,
  daysUntil,
  nextExam,
  type Plan,
  type PlannerSnapshot,
} from "@/domain";
import {
  CountdownBadge,
  IconButton,
  Sidebar,
  SidebarItem,
  SidebarSection,
  Tooltip,
} from "@/ui";
import type { SmartView, WorkspaceView } from "./workspace-store";

export function PlannerSidebar({
  snapshot,
  plan,
  today,
  view,
  smartView,
  courseId,
  onSelectPlan,
  onSelectSmartView,
  onSelectCourse,
  onCreate,
}: {
  snapshot: PlannerSnapshot;
  plan: Plan;
  today: string;
  view: WorkspaceView;
  smartView: SmartView;
  courseId: string | null;
  onSelectPlan: (planId: string) => void;
  onSelectSmartView: (view: SmartView) => void;
  onSelectCourse: (courseId: string) => void;
  onCreate: () => void;
}) {
  const summary = useMemo(() => {
    const health = plan.courses.map((course) =>
      assessCourse({
        course,
        today,
        calendar: snapshot.preferences,
        log: snapshot.studyLog,
        dailyCapacityUnits: snapshot.preferences.dailyCapacityUnits,
      }),
    );
    const blocksToday = plan.courses.reduce(
      (count, course) =>
        count +
        course.topics.reduce(
          (topicCount, topic) =>
            topicCount +
            topic.blocks.filter((block) => block.startDate <= today && block.endDate >= today).length,
          0,
        ),
      0,
    );
    const upcomingExams = plan.courses.reduce(
      (count, course) =>
        count +
        course.exams.filter((exam) => {
          const days = daysUntil(exam.startDate, today);
          return days >= 0 && days <= 14;
        }).length,
      0,
    );

    return {
      health: new Map(health.map((courseHealth) => [courseHealth.courseId, courseHealth])),
      blocksToday,
      upcomingExams,
      behind: health.filter((courseHealth) => courseHealth.pace && !courseHealth.pace.onTrack).length,
    };
  }, [plan, snapshot.preferences, snapshot.studyLog, today]);

  return (
    <Sidebar label="Study Planner navigation" className="w-64">
      <div className="flex items-center gap-1 px-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Semester</span>
          <select
            value={plan.id}
            onChange={(event) => onSelectPlan(event.target.value)}
            className="h-control-lg w-full truncate rounded-control bg-control px-2 text-body font-semibold text-label shadow-raised outline-none inset-ring inset-ring-[var(--mac-control-border)] focus-visible:ring-3 focus-visible:ring-accent/40"
          >
            {snapshot.plans.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <Tooltip content="New item">
          <IconButton size="md" label="New item" icon={<Plus />} onClick={onCreate} />
        </Tooltip>
      </div>

      <SidebarSection>
        <SidebarItem
          label="Today"
          icon={<CalendarDays />}
          count={summary.blocksToday}
          selected={view === "today" && smartView === "today"}
          onSelect={() => onSelectSmartView("today")}
        />
        <SidebarItem
          label="Upcoming"
          icon={<Clock3 />}
          count={summary.upcomingExams}
          selected={view === "today" && smartView === "upcoming"}
          onSelect={() => onSelectSmartView("upcoming")}
        />
        <SidebarItem
          label="Behind"
          icon={<TriangleAlert />}
          count={summary.behind}
          selected={view === "today" && smartView === "behind"}
          onSelect={() => onSelectSmartView("behind")}
        />
      </SidebarSection>

      <SidebarSection
        title="Courses"
        action={
          <Tooltip content="New course">
            <IconButton size="sm" label="New course" icon={<Plus />} onClick={onCreate} />
          </Tooltip>
        }
      >
        {plan.courses.map((course) => {
          const progress = courseProgress(course);
          const exam = nextExam(course, today);
          return (
            <SidebarItem
              key={course.id}
              label={course.name}
              dotColor={course.color}
              progress={progress.ratio}
              badge={
                exam ? (
                  <CountdownBadge
                    days={daysUntil(exam.startDate, today)}
                    provisional={exam.status === "provisional"}
                  />
                ) : undefined
              }
              selected={view === "outline" && course.id === courseId}
              onSelect={() => onSelectCourse(course.id)}
            />
          );
        })}
      </SidebarSection>
    </Sidebar>
  );
}
