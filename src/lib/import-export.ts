import { formatISO, parseISO } from "date-fns";
import { z } from "zod";
import { applePalette, createId, type Course, type Milestone, type Plan, type Topic } from "./planner-data";

const dateRangeSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

const topicSchema = z.object({
  name: z.string().min(1),
  notes: z.string().optional().default(""),
  color: z.string().optional(),
  dependencies: z.array(z.string()).optional().default([]),
  ranges: z.array(dateRangeSchema).optional().default([]),
});

const milestoneSchema = z.object({
  name: z.string().min(1),
  notes: z.string().optional().default(""),
  start: z.string().min(1),
  end: z.string().optional(),
});

const courseSchema = z.object({
  name: z.string().min(1),
  notes: z.string().optional().default(""),
  color: z.string().optional(),
  milestones: z.array(milestoneSchema).optional().default([]),
  topics: z.array(topicSchema).optional().default([]),
});

export const plannerExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  plans: z.array(
    z.object({
      name: z.string().min(1),
      notes: z.string().optional().default(""),
      courses: z.array(courseSchema).optional().default([]),
    }),
  ),
});

export type PlannerExport = z.infer<typeof plannerExportSchema>;

export function serializePlans(plans: Plan[]): PlannerExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    plans: plans.map((plan) => ({
      name: plan.name,
      notes: plan.notes,
      courses: plan.courses.map((course) => ({
        name: course.name,
        notes: course.notes,
        color: course.color,
        milestones: course.milestones.map((milestone) => ({
          name: milestone.name,
          notes: milestone.notes,
          start: milestone.start,
          end: milestone.end,
        })),
        topics: course.topics.map((topic) => ({
          name: topic.name,
          notes: topic.notes,
          color: topic.color,
          dependencies: topic.dependencies,
          ranges: topic.ranges.map((range) => ({ start: range.start, end: range.end })),
        })),
      })),
    })),
  };
}

export function parsePlannerJson(contents: string): Plan[] {
  const parsed = plannerExportSchema.parse(JSON.parse(contents));

  return parsed.plans.map((planInput) => {
    const planId = createId("plan");
    const courses: Course[] = planInput.courses.map((courseInput, courseIndex) => {
      const courseId = createId("course");
      const topicNameToId = new Map<string, string>();
      const color = courseInput.color ?? applePalette[courseIndex % applePalette.length].value;

      const topics: Topic[] = courseInput.topics.map((topicInput, topicIndex) => {
        const topicId = createId("topic");
        topicNameToId.set(topicInput.name, topicId);
        return {
          id: topicId,
          courseId,
          name: topicInput.name,
          notes: topicInput.notes,
          color: topicInput.color ?? applePalette[(courseIndex + topicIndex) % applePalette.length].value,
          dependencies: [],
          ranges: topicInput.ranges.map((range) => ({ id: createId("range"), start: range.start, end: range.end })),
        };
      });

      for (let index = 0; index < topics.length; index += 1) {
        const sourceDependencies = courseInput.topics[index]?.dependencies ?? [];
        topics[index].dependencies = sourceDependencies
          .map((dependency) => topicNameToId.get(dependency) ?? dependency)
          .filter((dependency) => topics.some((topic) => topic.id === dependency));
      }

      const milestones: Milestone[] = courseInput.milestones.map((milestoneInput) => ({
        id: createId("milestone"),
        courseId,
        name: milestoneInput.name,
        notes: milestoneInput.notes,
        start: milestoneInput.start,
        end: milestoneInput.end,
      }));

      return {
        id: courseId,
        planId,
        name: courseInput.name,
        notes: courseInput.notes,
        color,
        milestones,
        topics,
      };
    });

    return {
      id: planId,
      name: planInput.name,
      notes: planInput.notes,
      courses,
    };
  });
}

export type GitHubIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  body?: string | null;
  labels?: Array<{ name: string; color?: string }>;
  milestone?: { title: string; due_on?: string | null } | null;
  pull_request?: unknown;
  projectDateRange?: { start: string; end: string };
};

export async function fetchGitHubIssues(owner: string, repo: string, token: string) {
  const issues: GitHubIssue[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    const pageIssues = ((await response.json()) as GitHubIssue[]).filter((issue) => !issue.pull_request);
    issues.push(...pageIssues);

    if (pageIssues.length < 100) {
      break;
    }
  }

  const projectDateRanges = await fetchGitHubProjectDateRanges(owner, repo, token);
  return issues.map((issue) => ({ ...issue, projectDateRange: projectDateRanges.get(issue.number) }));
}

export function filterImportableGitHubIssues(issues: GitHubIssue[]) {
  const importableIssues = issues.filter((issue) => !isProgressSubissue(issue));

  return {
    issues: importableIssues,
    skippedSubissueCount: issues.length - importableIssues.length,
  };
}

export function mapGitHubIssuesToPlan(owner: string, repo: string, issues: GitHubIssue[]): Plan {
  const planId = createId("plan");
  const courseMap = new Map<string, Course>();

  for (const issue of issues) {
    const courseName = issue.milestone?.title ?? issue.labels?.[0]?.name ?? "Imported topics";
    const course = ensureCourse(courseMap, planId, courseName);
    const dueDate = issue.milestone?.due_on ? formatISO(parseISO(issue.milestone.due_on), { representation: "date" }) : undefined;
    const parsedRange = issue.projectDateRange ?? extractDateRange(`${issue.title}\n${issue.body ?? ""}`);

    if (dueDate && !course.milestones.some((milestone) => milestone.name === courseName)) {
      course.milestones.push({
        id: createId("milestone"),
        courseId: course.id,
        name: courseName,
        notes: "",
        start: dueDate,
      });
    }

    course.topics.push({
      id: createId("topic"),
      courseId: course.id,
      name: issue.title,
      notes: issue.body?.trim() ?? "",
      color: course.color,
      dependencies: [],
      ranges: parsedRange ? [{ id: createId("range"), start: parsedRange.start, end: parsedRange.end }] : [],
    });
  }

  return {
    id: planId,
    name: `${repo} import`,
    notes: `${owner}/${repo}`,
    courses: [...courseMap.values()],
  };
}

async function fetchGitHubProjectDateRanges(owner: string, repo: string, token: string) {
  const ranges = new Map<number, { start: string; end: string }>();
  let cursor: string | null = null;

  do {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query ProjectDates($owner: String!, $repo: String!, $cursor: String) {
            repository(owner: $owner, name: $repo) {
              projectsV2(first: 10) {
                nodes {
                  title
                  closed
                  items(first: 100, after: $cursor) {
                    pageInfo { hasNextPage endCursor }
                    nodes {
                      content { ... on Issue { number } }
                      fieldValues(first: 30) {
                        nodes {
                          ... on ProjectV2ItemFieldDateValue {
                            date
                            field { ... on ProjectV2FieldCommon { name } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        variables: { owner, repo, cursor },
      }),
    });

    if (!response.ok) {
      return ranges;
    }

    const payload = (await response.json()) as ProjectDatesResponse;
    const project = payload.data?.repository?.projectsV2.nodes.find((candidate) => candidate && !candidate.closed);
    const items = project?.items;
    if (!items) {
      return ranges;
    }

    for (const item of items.nodes) {
      const issueNumber = item.content?.number;
      if (!issueNumber) continue;

      let start: string | undefined;
      let end: string | undefined;
      for (const value of item.fieldValues.nodes) {
        if (value.field?.name === "Start date") start = value.date;
        if (value.field?.name === "Target date") end = value.date;
      }

      if (start) {
        ranges.set(issueNumber, { start, end: end ?? start });
      }
    }

    cursor = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null;
  } while (cursor);

  return ranges;
}

type ProjectDatesResponse = {
  data?: {
    repository?: {
      projectsV2: {
        nodes: Array<{
          title: string;
          closed: boolean;
          items: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<{
              content?: { number: number } | null;
              fieldValues: {
                nodes: Array<{
                  date: string;
                  field?: { name: string };
                }>;
              };
            }>;
          };
        } | null>;
      };
    };
  };
};

function isProgressSubissue(issue: GitHubIssue) {
  return /^Teil\s+\d+(?:\b|[:.)-])/i.test(issue.title.trim()) && extractDateRange(`${issue.title}\n${issue.body ?? ""}`) === undefined;
}

function ensureCourse(courseMap: Map<string, Course>, planId: string, courseName: string) {
  const existing = courseMap.get(courseName);
  if (existing) {
    return existing;
  }

  const courseId = createId("course");
  const color = applePalette[courseMap.size % applePalette.length].value;
  const course: Course = {
    id: courseId,
    planId,
    name: courseName,
    notes: "",
    color,
    milestones: [],
    topics: [],
  };
  courseMap.set(courseName, course);
  return course;
}

function extractDateRange(input: string) {
  const matches = input.match(/\d{4}-\d{2}-\d{2}/g);
  if (!matches?.length) {
    return undefined;
  }

  return {
    start: matches[0],
    end: matches[1] ?? matches[0],
  };
}