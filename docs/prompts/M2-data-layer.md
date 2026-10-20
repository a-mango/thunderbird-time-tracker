# M2 — Data layer

Goal: a correct, tested model of projects, tasks, and entries, independent of any UI.

Read: `docs/SPEC.md` (Architecture, Data model, Settings, Privacy).

Work test-first: write the failing tests for each invariant and edge case, show me the list of test names, then implement.

## Deliver
1. `src/db/idb.js`: a small promise wrapper over IndexedDB (open/upgrade, tx helpers). No library.
2. `src/db/schema.js` + `src/db/migrations.js`: schema v1 and a migration runner that handles `onblocked`/`versionchange`.
3. Repositories in `src/db/`: `projects`, `tasks`, `entries`, `settings`.
   - Invariants from SPEC enforced inside transactions.
   - Cascade delete is explicit.
   - Soft-delete + undo window for entries.
4. `src/db/changes.js`: after a commit, post on `BroadcastChannel('tt')` and send a `runtime.sendMessage({type:'tt:changed'})` ping. Swallow the "no receiver" error.
5. `src/lib/`:
   - `time.js`: local day/week boundaries, week-start setting, splitting an entry across midnights
   - `rollup.js`: per task/project totals with descendants; Today/Week/Total; incremental update API
   - `format.js`: durations and relative dates per `DESIGN.md`, using `Intl`
   - `csv.js`: RFC 4180, optional UTF-8 BOM
   - `importer.js`: strict schema validation, size limits, rejects unknown fields; no `eval`, no prototype pollution
6. `src/lib/timer.js`: start / stop / switch / split / discard / adjustStart, built on the repositories.

## Must-have tests
- DST: an entry spanning 2026-03-29 02:00 and 2026-10-25 03:00 in `Europe/Zurich` (set `TZ` in the vitest config).
- Midnight-crossing entries count toward both days; week start Monday vs Sunday.
- Rollups four levels deep; archived projects excluded from views but kept in totals.
- Two "contexts" (two DB connections) starting timers at the same time still leave exactly one running.
- Starting a done task fails with a typed error.
- Importer: malformed JSON, wrong types, `__proto__` keys, 10 MB payload, duplicate ids.
- Migration: open a v1 fixture database and upgrade it.

## Verify
`npm run check` and `npm test -- --coverage`: ≥90% lines in `src/lib` and `src/db`. Paste the coverage summary in the PR.

## Done when
PR "M2: data layer" is open, CI is green, and the `spec-reviewer` subagent reports no requirement gaps.
