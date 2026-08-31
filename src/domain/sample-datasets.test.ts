import { describe, expect, it } from "vitest";
import { generateSampleDataset, SAMPLE_DATASETS } from "./sample-datasets";

const TODAY = "2026-08-20";

describe("sample datasets", () => {
  it("exposes only synthetic, deterministic fixtures", () => {
    expect(SAMPLE_DATASETS.map(({ id }) => id)).toEqual(["full", "compact"]);

    for (const { id } of SAMPLE_DATASETS) {
      expect(generateSampleDataset(id, TODAY)).toEqual(generateSampleDataset(id, TODAY));
    }
  });

  it("offers a smaller fixture for quick exploration", () => {
    const full = generateSampleDataset("full", TODAY);
    const compact = generateSampleDataset("compact", TODAY);

    expect(compact.plan.courses).toHaveLength(4);
    expect(compact.plan.courses.length).toBeLessThan(full.plan.courses.length);
    expect(compact.studyLog.length).toBeGreaterThan(0);
  });
});
