import { maxDate, minDate, type IsoDate, type Topic } from "@/domain";

/** Where a topic's work begins: the earliest block it has, or nothing if it has none. */
export function firstBlockStart(topic: Topic): IsoDate | null {
  if (topic.blocks.length === 0) return null;
  return minDate(...topic.blocks.map((block) => block.startDate));
}

/** The span a collapsed lane draws: everything the course has scheduled. */
export function rollUpSpan(topics: readonly Topic[]): { start: IsoDate; end: IsoDate } | null {
  const blocks = topics.flatMap((topic) => topic.blocks);
  if (blocks.length === 0) return null;
  return {
    start: minDate(...blocks.map((block) => block.startDate)),
    end: maxDate(...blocks.map((block) => block.endDate)),
  };
}
