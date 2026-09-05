import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "prune expired MCP operational data",
  { hourUTC: 3, minuteUTC: 17 },
  internal.maintenance.pruneExpiredMcpData,
);

export default crons;
