# Planner JSON transfer format

Study Planner exports a versioned JSON document for backup and transfer between
the local and synced repositories. It is a portability format, not the browser
storage schema, the Convex database schema, or a synchronization protocol.

The current writer emits version 3. The reader accepts version 3 and can safely
migrate unambiguous version 2 files. Internal database IDs, authentication data,
and planner preferences are deliberately absent.

> [!WARNING]
> An export is unencrypted plain text. It can contain plan, course, topic, and
> exam names; free-form notes; study dates and workload; and study-log notes and
> durations. Treat it as personal data. Review the file before sharing it, and
> do not commit real exports to the repository.

## Version 3 document

A representative v3 document looks like this:

```json
{
  "version": 3,
  "exportedAt": "2026-08-20T12:00:00.000Z",
  "plans": [
    {
      "name": "Autumn term",
      "notes": "",
      "courses": [
        {
          "name": "Biochemistry",
          "code": "BIO-201",
          "color": "violet",
          "notes": "",
          "exams": [
            {
              "name": "Final",
              "kind": "exam",
              "startDate": "2026-12-10",
              "status": "confirmed",
              "notes": ""
            }
          ],
          "topics": [
            {
              "key": "topic_0",
              "name": "Glycolysis",
              "unit": "pages",
              "totalUnits": 120,
              "completedUnits": 30,
              "status": "active",
              "priority": "normal",
              "color": "violet",
              "notes": "",
              "dependencies": [],
              "blocks": [
                {
                  "startDate": "2026-10-01",
                  "endDate": "2026-10-03",
                  "plannedUnits": 40,
                  "source": "manual"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "studyLog": [
    {
      "topicKey": "topic_0",
      "date": "2026-09-20",
      "units": 30,
      "minutes": 60,
      "note": "Chapter review"
    }
  ]
}
```

`version`, `plans`, and `studyLog` are required at the document root.
`exportedAt` is optional metadata; the built-in exporter supplies an ISO
timestamp, but importing does not use it to order or merge data.

The nested records have these fields:

| Record | Required fields | Optional fields |
| --- | --- | --- |
| Plan | `name`, `notes`, `courses` | — |
| Course | `name`, `color`, `notes`, `exams`, `topics` | `code` |
| Exam | `name`, `kind`, `startDate`, `status`, `notes` | `endDate` |
| Topic | `key`, `name`, `unit`, `totalUnits`, `completedUnits`, `status`, `priority`, `color`, `notes`, `dependencies`, `blocks` | — |
| Study block | `startDate`, `endDate`, `source` | `plannedUnits` |
| Study-log entry | `topicKey`, `date`, `units` | `minutes`, `note` |

Array position preserves course, exam, and topic ordering when records receive
fresh repository IDs during import.

Dates are real calendar dates in `YYYY-MM-DD` form. The accepted enum values
are:

- topic units: `slides`, `pages`, `cards`, `videos`, `hours`, `items`
- topic status: `planned`, `active`, `done`
- priority: `low`, `normal`, `high`
- exam kind: `exam`, `deadline`, `presentation`, `other`
- exam status: `confirmed`, `provisional`
- block source: `auto`, `manual`
- color: `coral`, `tangerine`, `gold`, `lime`, `chartreuse`, `jade`,
  `turquoise`, `violet`, `orchid`, `rose`

## Document-local topic keys

`Topic.key` is an opaque reference that is unique within one transfer document.
It is not a database ID or a topic name, and consumers must not depend on the
current generated spelling. A key contains 1–128 ASCII letters, numbers,
underscores, or hyphens. Fresh repository IDs are created on every import.

Two fields use these keys:

- `Topic.dependencies` lists the prerequisite topics for that topic. Every key
  must identify a topic in the same course.
- `StudyLogEntry.topicKey` identifies the topic associated with the log row. It
  may refer to a topic anywhere in the document.

Keys must be globally unique so a log reference has exactly one target.
Dependencies must also be distinct and acyclic. Missing references,
cross-course dependencies, duplicate keys, duplicate dependency entries, and
dependency cycles make the whole document invalid.

The exporter intentionally omits an orphaned study-log row when its topic has
already been deleted, because there is no portable target for that row. An
imported v3 log row, by contrast, must resolve to a topic in the same document.

## Study-log behavior

Study-log entries are transferred with the plans and receive fresh IDs. Positive
or negative `units` values are allowed so corrections remain representable;
`minutes`, when present, must be non-negative.

The log is restored as history. Import does not replay log rows to calculate
topic progress: `Topic.completedUnits` is imported directly. Producers should
therefore keep the aggregate progress and its history consistent.

## Import and replace semantics

The repository exposes two different operations:

- `importPlans` is additive. It creates fresh IDs, appends the document's plans
  and study-log entries to the current data, and leaves preferences unchanged.
  The file picker in the application uses this operation. It does not merge,
  deduplicate, or overwrite same-named records.
- `replaceAll` replaces the current plans and study log with the document after
  validation. It is destructive for those records, although it preserves
  preferences. The synced implementation scopes deletion to the authenticated
  owner.

Both operations restore key-based dependency and study-log references to the
new topic IDs. Callers must not treat a topic key as stable after import. Back up
current data before invoking replacement with user data.

Each operation is atomic at its repository boundary. Local mode materializes
one next snapshot and publishes it only after the IndexedDB transaction
completes. Synced mode validates first and performs the import or replacement
inside one Convex mutation transaction. A validation or storage failure must
not expose a partially imported planner tree.

## Validation and resource limits

Files are parsed as untrusted input before repository writes. V3 object shapes
are strict, so unknown properties are rejected rather than silently ignored.
Canonical cross-references and resource budgets are validated before records
are materialized; the synced repository repeats semantic validation at its
server boundary before writing.

Current limits are defined in
[`src/lib/planner-transfer.ts`](../src/lib/planner-transfer.ts) and mirrored by
the server guard:

| Limit | Maximum |
| --- | ---: |
| UTF-8 encoded file size | 5 MiB |
| Plans | 50 |
| Records in total | 2,000 |
| References in total | 5,000 |
| Text across the document | 1,000,000 characters |
| Dependencies on one topic | 500 |
| Name | 200 characters |
| Course code | 64 characters |
| Plan, course, exam, or topic notes | 20,000 characters |
| Study-log note | 4,000 characters |
| Topic key | 128 characters |
| Unit value magnitude | 1,000,000,000 |
| Study-log minutes | 10,080 |

The aggregate record budget counts plans, courses, exams, topics, blocks, and
study-log entries. The reference budget counts dependency references and log
references. Per-array bounds apply in addition to these aggregate budgets.

Validation also requires:

- finite numeric values; non-negative topic totals, progress, and planned
  units; and progress no greater than a positive total
- ordered exam and block ranges, with real start and end dates
- non-empty, trimmed names and course codes without control characters and
  within their field limits
- known enum and palette values
- valid, unambiguous topic references as described above

The parser rejects a partly invalid document as a whole rather than attempting
partial recovery. A producer should run the canonical integrity check before
offering a file for download.

## Version 2 migration

Version 2 is a read-only compatibility format: this build can import it, but all
new exports use version 3. The parser validates a v2 file, converts it to the
canonical v3 model in memory, and then applies the same v3 integrity checks.
Importing does not modify the source file; exporting the resulting data later
produces v3.

V2 represented references with display text:

- a dependency named a topic within its course
- a study-log row named a `courseName` and `topicName` pair

The migrator assigns document-local topic keys and replaces those text
references. It refuses to guess. A missing dependency name is rejected, as is a
dependency name shared by multiple topics in the course. A missing study-log
path is rejected, and a path is ambiguous when the same course-name/topic-name
pair identifies more than one topic anywhere in the document. Legacy path text
containing a NUL character is also rejected.

The retired optional topic `section` is accepted and discarded. Defaults that
were part of v2 and legacy color references are normalized during migration.
Version 1 and unknown future versions are not accepted.

## Compatibility policy

The numeric `version` field is required. Contributors changing this format
should follow these rules:

1. Keep the writer on the newest canonical version and keep its output accepted
   by the current reader and server guard.
2. Do not silently change a field's meaning. A breaking shape or semantic
   change requires a new version and an explicit, lossless migration path.
3. Reject an older document when migration would require guessing, dropping
   referenced data, or inventing domain values.
4. Update the portable types, serializer, parser, local materializer, server
   validators, tests, and this document together. Because v3 parsing is strict,
   even a new optional property is not accepted until the parser and relevant
   server boundary understand it.
5. Keep transfer keys portable and free of storage- or account-specific IDs.

The canonical types, serializer, integrity validation, and materializer live in
[`src/lib/planner-transfer.ts`](../src/lib/planner-transfer.ts). Untrusted JSON
parsing and v2 migration live in
[`src/lib/import-export.ts`](../src/lib/import-export.ts). Repository-level
operation semantics are defined by
[`src/data/repository.ts`](../src/data/repository.ts).
