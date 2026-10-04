import type { Topic, Unit, StudyLogEntry } from "./types";

/** Starting estimates, always disclosed in previews and editable per topic. */
export const DEFAULT_MINUTES_PER_UNIT: Record<Unit, number> = {
  slides: 3, pages: 5, cards: 1, videos: 10, hours: 60, items: 5,
};
export const DEFAULT_DAILY_CAPACITY_MINUTES = 120;
export function minutesPerUnit(topic: Pick<Topic, "unit" | "minutesPerUnit">): number {
  return topic.minutesPerUnit ?? DEFAULT_MINUTES_PER_UNIT[topic.unit];
}
export function effortLog(log: readonly StudyLogEntry[], topics: readonly Topic[]): StudyLogEntry[] {
  const byId = new Map(topics.map(topic => [topic.id, topic]));
  return log.filter(entry => byId.has(entry.topicId)).map(entry => ({
    ...entry, units: entry.units * minutesPerUnit(byId.get(entry.topicId)!),
  }));
}
