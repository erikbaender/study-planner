import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const tables = ["plans", "courses", "exams", "topics", "studyBlocks", "preferences"] as const;
type Table = (typeof tables)[number];
type Row = Doc<Table>;
type Reader = QueryCtx["db"];

/** The small storage interface used by the command evaluator, in both modes. */
export type CommandStore = Pick<MutationCtx["db"], "get" | "insert" | "patch" | "delete" | "normalizeId"> & {
  list<T extends Table>(table: T, field: keyof Doc<T> & string, value: string, limit: number): Promise<Doc<T>[]>;
};

const indexes: Record<string, string> = {
  ownerId: "by_owner", planId: "by_plan", courseId: "by_course", topicId: "by_topic",
};

function readerStore(db: Reader) {
  return {
    get: db.get.bind(db),
    normalizeId: db.normalizeId.bind(db),
    async list<T extends Table>(table: T, field: keyof Doc<T> & string, value: string, limit: number): Promise<Doc<T>[]> {
      const index = indexes[field];
      if (!index) throw new Error(`Unsupported planner relationship: ${field}`);
      return await db.query(table).withIndex(index as never, q => q.eq(field as never, value as never)).take(limit);
    },
  };
}

export function commandStore(db: MutationCtx["db"]): CommandStore {
  return {
    ...readerStore(db),
    insert: db.insert.bind(db),
    patch: db.patch.bind(db),
    delete: db.delete.bind(db),
  };
}

/**
 * Copy-on-write preview storage. It receives only a database READER, so no
 * preview can commit a write. The real command evaluator does all validation,
 * reference resolution, and scheduling; this adapter supplies temporary IDs
 * and makes its preceding writes visible to subsequent commands.
 */
export function previewStore(db: Reader): CommandStore {
  const source = readerStore(db);
  const changes = new Map<string, { table: Table; row: Row | null }>();
  let sequence = 0;
  const tableFor = (id: string): Table => {
    const existing = changes.get(id);
    if (existing) return existing.table;
    const table = tables.find(table => db.normalizeId(table, id) !== null);
    if (!table) throw new Error("Invalid planner entity ID");
    return table;
  };
  const get = async (id: string) => changes.has(id) ? changes.get(id)!.row : await source.get(id as Id<Table>);
  return {
    get: get as CommandStore["get"],
    normalizeId: ((table: string, id: string) => {
      const local = changes.get(id);
      return local ? local.table === table ? id : null : db.normalizeId(table as Table, id);
    }) as CommandStore["normalizeId"],
    insert: (async (table: Table, value: Omit<Row, "_id" | "_creationTime">) => {
      const id = `preview:${table}:${++sequence}`;
      changes.set(id, { table, row: { ...value, _id: id, _creationTime: Date.now() + sequence / 1000 } as Row });
      return id;
    }) as CommandStore["insert"],
    patch: (async (id: string, patch: Record<string, unknown>) => {
      const before = await get(id);
      if (!before) throw new Error("Planner entity not found");
      const next = { ...before, ...patch };
      for (const key of Object.keys(patch)) if (patch[key] === undefined) delete next[key as keyof typeof next];
      changes.set(id, { table: tableFor(id), row: next as Row });
    }) as unknown as CommandStore["patch"],
    delete: (async (id: string) => { changes.set(id, { table: tableFor(id), row: null }); }) as CommandStore["delete"],
    async list<T extends Table>(table: T, field: keyof Doc<T> & string, value: string, limit: number) {
      // A temporary parent cannot have stored children.
      const stored = value.startsWith("preview:") ? [] : await source.list(table, field, value, limit + changes.size);
      const rows = new Map<string, Row>(stored.map(row => [row._id, row as unknown as Row]));
      for (const [id, change] of changes) {
        if (change.table !== table) continue;
        rows.delete(id);
        if (change.row && (change.row as Record<string, unknown>)[field] === value) rows.set(id, change.row);
      }
      return [...rows.values()].sort((a, b) => a._creationTime - b._creationTime || a._id.localeCompare(b._id)).slice(0, limit) as unknown as Doc<T>[];
    },
  };
}
