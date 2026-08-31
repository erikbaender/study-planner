import { generateMhhSampleData, generateMhhShowcaseData } from "./mhh-sample";
import type { SeedData } from "./seed";
import type { IsoDate } from "./types";

export const SAMPLE_DATASETS = [
  {
    id: "mhh-lernplan",
    name: "Lernplan (MHH)",
    description: "7 courses and 89 real topics from the 2026 GitHub Project schedule.",
  },
  {
    id: "mhh-showcase",
    name: "Lernplan feature showcase",
    description:
      "The MHH courses with realistic workloads, progress, overdue work, planning and study history.",
  },
] as const;

export type SampleDatasetId = (typeof SAMPLE_DATASETS)[number]["id"];

export function generateSampleDataset(id: SampleDatasetId, today: IsoDate): SeedData {
  switch (id) {
    case "mhh-lernplan":
      return generateMhhSampleData(today);
    case "mhh-showcase":
      return generateMhhShowcaseData(today);
  }
}
