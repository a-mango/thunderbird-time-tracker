# M4 — Task list

Goal: the middle pane works like Thunderbird's message list in table view, for tasks.

Read: `docs/DESIGN.md` (List pane, Components), `docs/SPEC.md` (Data model: Task, Keyboard), and look at `design/reference/three-pane-light.png`.

## Deliver
1. List header: project name, "N open tasks · total", Quick Filter toggle, display options (column picker; Cards view comes later in S4).
2. Quick filter bar: Open (default on), Starred, Billable, Tags pills; text filter with `Ctrl+Shift+K`. Filters combine with AND. Filter state is per project and persisted.
3. `tt-table` columns: ★, timer, Task, Week, Total, Estimate (bar + label, over-estimate state), Last tracked.
   - Sort by any column; sort and visible columns persisted.
   - Views (Today/Week/Starred) show tasks across projects and add a Project column.
4. Row actions:
   - star toggle
   - start/stop button (wired to `lib/timer.js`)
   - `Space` = start/stop; `Enter` = edit; `F2` = rename inline; `Delete` = delete with undo
5. New Task: `Ctrl+N` or the sidebar button creates a task in the selected project and focuses inline rename.
6. Task dialog: name, project (picker using the tree), estimate (accepts `90m`, `1.5h`, `1h30`), billable, tags (free text with suggestions), notes.
7. Done tasks: hidden by default with a "N done tasks hidden · Show" footer. Mark done/undone.
8. Empty states: no project selected, empty project, filter with no results. Use Thunderbird's wording style: short and neutral.

## Verify
- Playwright:
  - create, edit, star, filter combinations, sorting, column picker persistence
  - start a task, then start another and confirm only one runs
  - done/undone, delete + undo
  - axe check
- Performance: a fixture project with 2,000 tasks. First render and a filter change each take under 100 ms (measure in the test with `performance.now()`, and paste the numbers).
- `npm run shots` and the `ui-reviewer` subagent against the list pane of the reference.

## Done when
PR "M4: task list" is open with the perf numbers and shots, and CI is green.
