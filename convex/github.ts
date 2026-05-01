import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type GitHubIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  body?: string | null;
  labels?: Array<{ name: string; color?: string }>;
  milestone?: { title: string; due_on?: string | null } | null;
  pull_request?: unknown;
  projectDateRange?: { start: string; end: string };
};

type ImportIssuesResult = {
  issueCount: number;
  skippedSubissueCount: number;
  planIds: Id<"plans">[];
};

type GitHubImportPreview = {
  issueCount: number;
  skippedSubissueCount: number;
  planName: string;
  repository: string;
  courses: Array<{ name: string; topicCount: number; milestoneCount: number; rangeCount: number }>;
};

const palette = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#30b0c7", "#32ade6", "#007aff", "#5856d6", "#af52de", "#ff2d55", "#a2845e", "#8e8e93"];

export const importIssues = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ImportIssuesResult> => {
    const token = getGitHubToken(args.token);
    const { issues, skippedSubissueCount } = await fetchIssues(args.owner, args.repo, token, getGitHubProjectToken(args.token, token));
    const planIds: Id<"plans">[] = await ctx.runMutation(api.planner.importPlanTrees, {
      plans: [mapIssuesToImportPlan(args.owner, args.repo, issues)],
    });

    return { issueCount: issues.length, skippedSubissueCount, planIds };
  },
});

export const previewIssues = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<GitHubImportPreview> => {
    const token = getGitHubToken(args.token);
    const { issues, skippedSubissueCount } = await fetchIssues(args.owner, args.repo, token, getGitHubProjectToken(args.token, token));
    return summarizeImportPlan(args.owner, args.repo, issues, skippedSubissueCount);
  },
});

function getGitHubToken(token?: string) {
  const configuredToken = token || process.env.GITHUB_IMPORT_TOKEN || process.env.GITHUB_TOKEN;
  if (!configuredToken) {
    throw new Error("GitHub import token is not configured");
  }

  return configuredToken;
}

function getGitHubProjectToken(token: string | undefined, issueToken: string) {
  return token?.trim() || process.env.GITHUB_PROJECTS_TOKEN || process.env.PROJECTS_ACCESS || issueToken;
}

async function fetchIssues(owner: string, repo: string, token: string, projectToken: string) {
  const issues: GitHubIssue[] = [];
  let skippedSubissueCount = 0;

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
    const importableIssues = pageIssues.filter((issue) => !isProgressSubissue(issue));
    skippedSubissueCount += pageIssues.length - importableIssues.length;
    issues.push(...importableIssues);

    if (pageIssues.length < 100) {
      break;
    }
  }

  const projectDateRanges = await fetchProjectDateRanges(owner, repo, projectToken);

  return {
    issues: issues.map((issue) => ({ ...issue, projectDateRange: projectDateRanges.get(issue.number) })),
    skippedSubissueCount,
  };
}

function mapIssuesToImportPlan(owner: string, repo: string, issues: GitHubIssue[]) {
  const courses = new Map<
    string,
    {
      name: string;
      notes: string;
      color: string;
      milestones: Array<{ name: string; notes: string; start: string; end?: string }>;
      topics: Array<{ name: string; notes: string; color: string; dependencies: string[]; ranges: Array<{ start: string; end: string }> }>;
    }
  >();

  for (const issue of issues) {
    const courseName = issue.milestone?.title ?? issue.labels?.[0]?.name ?? repo;
    const course = ensureCourse(courses, courseName);
    const dueDate = issue.milestone?.due_on ? new Date(issue.milestone.due_on).toISOString().slice(0, 10) : undefined;
    const parsedRange = issue.projectDateRange ?? extractDateRange(`${issue.title}\n${issue.body ?? ""}`);

    if (dueDate && !course.milestones.some((milestone) => milestone.name === courseName)) {
      course.milestones.push({ name: courseName, notes: "", start: dueDate });
    }

    course.topics.push({
      name: issue.title,
      notes: issue.body?.trim() ?? "",
      color: course.color,
      dependencies: [],
      ranges: parsedRange ? [{ start: parsedRange.start, end: parsedRange.end }] : [],
    });
  }

  return {
    name: `${repo} import`,
    notes: `${owner}/${repo}`,
    courses: [...courses.values()],
  };
}

function summarizeImportPlan(owner: string, repo: string, issues: GitHubIssue[], skippedSubissueCount: number): GitHubImportPreview {
  const plan = mapIssuesToImportPlan(owner, repo, issues);

  return {
    issueCount: issues.length,
    skippedSubissueCount,
    planName: plan.name,
    repository: `${owner}/${repo}`,
    courses: plan.courses.map((course) => ({
      name: course.name,
      topicCount: course.topics.length,
      milestoneCount: course.milestones.length,
      rangeCount: course.topics.reduce((total, topic) => total + topic.ranges.length, 0),
    })),
  };
}

function isProgressSubissue(issue: GitHubIssue) {
  return /^Teil\s+\d+(?:\b|[:.)-])/i.test(issue.title.trim()) && extractDateRange(`${issue.title}\n${issue.body ?? ""}`) === undefined;
}

async function fetchProjectDateRanges(owner: string, repo: string, token: string) {
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

function ensureCourse(
  courses: Map<
    string,
    {
      name: string;
      notes: string;
      color: string;
      milestones: Array<{ name: string; notes: string; start: string; end?: string }>;
      topics: Array<{ name: string; notes: string; color: string; dependencies: string[]; ranges: Array<{ start: string; end: string }> }>;
    }
  >,
  name: string,
) {
  const existing = courses.get(name);
  if (existing) {
    return existing;
  }

  const course = {
    name,
    notes: "",
    color: palette[courses.size % palette.length],
    milestones: [],
    topics: [],
  };
  courses.set(name, course);
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
