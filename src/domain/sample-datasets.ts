import { generateSeedData, type SeedData } from "./seed";
import type { IsoDate } from "./types";

export const SAMPLE_DATASETS = [
  {
    id: "full",
    name: "Full medical semester",
    description: "10 courses and 344 generated topics, with varied progress and upcoming exams.",
  },
  {
    id: "compact",
    name: "Compact medical semester",
    description: "4 courses with synthetic workloads, dependencies, study history and exams.",
  },
] as const;

export type SampleDatasetId = (typeof SAMPLE_DATASETS)[number]["id"];

export function generateSampleDataset(id: SampleDatasetId, today: IsoDate): SeedData {
  switch (id) {
    case "full":
      return generateSeedData({ today });
    case "compact":
      return generateSeedData({ today, seed: 20260820, courseLimit: 4 });
  }
}
