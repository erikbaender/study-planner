export function plannerError(cause: unknown) {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const clean = raw.replace(/^\[CONVEX[^\]]*\]\s*/, "").replace(/^\[Request ID:[^\]]*\]\s*/, "")
    .replace(/^Server Error\s*/, "").replace(/^Uncaught (?:Error|ConvexError):\s*/, "").split(/\n\s*at |\n\s*Called by client/)[0].trim();
  const conflict = clean.match(/Revision conflict: expected (\d+), current (\d+)/);
  if (conflict) return {
    code: "REVISION_CONFLICT", message: "This semester changed elsewhere. Your edit was not saved. Review the latest version, then retry or cancel your draft.",
    expectedRevision: Number(conflict[1]), currentRevision: Number(conflict[2]),
    changes: clean.match(/Changes since: (.*?) Reload planner.get/)?.[1] ?? "",
  };
  return { code: "VALIDATION_ERROR", message: clean || "The change could not be saved. Please try again." };
}
