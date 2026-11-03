# Release

## Steps

1. On `main`, with everything merged: bump `version` in `src/manifest.json` and `package.json`,
   add the `## X.Y.Z — YYYY-MM-DD` section to `CHANGELOG.md`, and open a PR for it.
2. `npm run check`, `PORT=5199 npm run test:ui`, `npm run build`.
3. Release-candidate check: the checklists below on fresh profiles, on Thunderbird 157 and on the
   current Release (`npm run tb:rc`, then `TB_BIN=<release>/thunderbird npm run tb:rc`; the
   tarball from thunderbird.net runs without installing). Record the results in the PR.
4. After merging: `git tag vX.Y.Z && git push origin vX.Y.Z`. `.github/workflows/release.yml`
   checks that the tag matches the manifest, runs the checks and UI tests, builds, and publishes a
   GitHub Release with `time-tracker-X.Y.Z.xpi` and the CHANGELOG section.
5. ATN: upload the same XPI (checklist below).

## ATN submission checklist

Submit at <https://addons.thunderbird.net/developers/>, "Submit a New Add-on", "On this site".

- [ ] **Add-on id** `time-tracker@a-mango.github.io` (in the manifest; it can never change once
      listed).
- [ ] **File**: `dist/time-tracker-1.0.0.xpi` from the release (the one GitHub published).
- [ ] **Compatibility**: Thunderbird 157.0 and later (`strict_min_version`). No maximum.
- [ ] **Source code**: answer *No*. The build is copy-only: `npm run build` zips `src/` as written
      (no bundler, minifier or transpiler), which is the case
      `.ref/webext-docs/guides/sourceCodeSubmission.rst` says needs no source submission. There
      are no vendored libraries (`.ref/webext-docs/guides/vendoring.rst`); the only files left out
      of the XPI are type declarations (`src/types/`).
- [ ] **Name**: Time Tracker
- [ ] **Summary** (≤ 250 characters): Track time on projects and tasks in a Thunderbird tab of
      their own, laid out like the mail tab. Timer in the toolbar, keyboard shortcuts, backups and
      CSV export. Your data stays in your profile.
- [ ] **Description**:

      Time Tracker adds a tab to Thunderbird's spaces toolbar for tracking time against tasks in
      nested projects. It looks and works like the mail tab: a project tree, a task list and a
      details pane.

      • Nested projects with colours and time badges rolled up from subprojects; Today, This Week
        and Starred views.
      • Tasks with estimates, tags, notes and a billable flag.
      • One running timer: start, stop, switch or split it from the list, the details pane, the
        toolbar popup or Alt+Shift+K. It keeps running across restarts.
      • Add, edit, split and delete time entries, with undo.
      • JSON backup and restore, CSV export.
      • Light and dark themes, three densities, full keyboard and screen reader support.
      • English and French.

      Everything is stored locally in your Thunderbird profile. The add-on makes no network
      requests and collects no data.
- [ ] **Categories**: Tasks / Productivity (whatever ATN offers closest).
- [ ] **Tags**: time tracking, timer, timesheet, projects, tasks.
- [ ] **Homepage**: <https://github.com/a-mango/thunderbird-time-tracker>
- [ ] **Support site**: <https://github.com/a-mango/thunderbird-time-tracker/issues>
- [ ] **Licence**: choose one (the repository has no `LICENSE` file yet; Thunderbird's icons are
      MPL 2.0, so MPL 2.0 is the natural fit).
- [ ] **Privacy policy**: paste `PRIVACY.md`.
- [ ] **Icon**: `design/icon/time-tracker-128.png` (ATN also reads the manifest icons).
- [ ] **Screenshots** (fictional data only, from `npm run shots`, in `docs/screenshots/`):
      1. `tracker-light.png`: the tab with a running timer
      2. `tracker-dark.png`: dark theme
      3. `tracker-list-light.png`: quick filter and tags
      4. `popup-light.png`: the toolbar popup
      5. `tracker-settings-light.png`: settings, backup and export
      6. `tracker-fr-light.png`: in French
- [ ] **Notes for reviewers**:

      Copy-only build: the XPI is the source (ES modules, no build step). To rebuild:
      Node 22.23.1, `npm ci && npm run build` (README.md, "Build from source").
      No network access, no remote code, no eval/innerHTML. Data in IndexedDB.
      Permissions: see the table below.

### Permissions justification

| Permission | Why it's needed | Without it |
|---|---|---|
| `alarms` | A once-a-minute alarm refreshes the running time on the toolbar button (`h:mm · task`). The event page can't keep a timer itself. | The label only updates on changes |
| `menus` | Native context menus on project, task and entry rows. Items are limited to the add-on's own tab by `documentUrlPatterns`. | Only the ⋮ buttons and keyboard paths remain |
| `menus.overrideContext` | Shows only our items (not the page's default ones) on those rows. | Default page items mixed in |
| `notifications` | `Alt+Shift+K` has no other UI: when no task was ever tracked, a notification says how to start one. | The shortcut silently does nothing |

No host permissions; `data_collection_permissions: none`. The background degrades gracefully if
any of these APIs is unavailable (`tests/unit/background-main.test.js`).

## Release-candidate checklists

Run on a **fresh profile** with the **built XPI installed** (`npm run tb:rc`), once on
Thunderbird 157 and once on the current Release. Use fictional data.

### Install (both versions)

1. The add-on appears in Add-ons and Themes as "Time Tracker 1.0.0", enabled, with the stopwatch
   icon.
2. A stopwatch button is in the spaces toolbar, readable in the light and the dark theme
   (Settings → General → Appearance).
3. Clicking it opens the Time Tracker tab with the empty state ("No projects yet.").

### Projects (M3)

1. Ctrl+Shift+N: create "Client work"; inside it "Harbor Coffee"; inside that "Build" (3 levels).
2. Right-click "Build": the native menu shows New Subproject…, Rename Project…, Color, Move To…,
   Archive, Delete Project. Rename it, change its colour.
3. Drag "Build" to the top level, then Move To… back under "Harbor Coffee".
4. Quit Thunderbird, start it again with `npm run tb:rc -- --keep`: the tree is unchanged.

### Timer (M5)

1. Add a task in "Build" (Ctrl+N), select it, press Space: the timer starts, the toolbar button
   label shows `0:00 · <task>`.
2. Wait one minute: the label turns to `0:01`.
3. Quit Thunderbird, wait 2 minutes, start it again (`--keep`): the timer is still running and the
   elapsed time includes the time Thunderbird was closed.
4. `Alt+Shift+K` stops the timer; pressing it again starts the same task.
5. Close the tab: the label keeps updating; reopen the tab: the timer is still running.

### Popup, settings, data (M6)

1. `Alt+Shift+O` opens the popup: Stop, Split Now, and "Switch to…" with recent tasks.
2. Settings (⋯ → Settings…): change density and accent; the tab follows at once.
3. Back Up… saves a JSON file; Delete All Data… (type DELETE) empties everything; Restore… →
   Replace All brings everything back.
4. Export CSV… opens in LibreOffice Calc (UTF-8, comma separated) with one row per entry.

### French

1. With Thunderbird in French (`intl.locale.requested` = `fr` and the French language pack, or a
   French build), the tab, menus, dialogs and popup are in French, with nothing cut off.

### Screen reader (Orca)

Not done yet (Orca isn't installed on the maintainer's machine). Before or after 1.0, with Orca on
(`sudo dnf install orca`, toggle with `Super+Alt+S`):

1. Tab into the project tree: Orca reads "Projects, tree", then each row as name, time and
   level, and "expanded"/"collapsed".
2. Arrow through the task list: each row reads task name, week, total, estimate and last tracked,
   and "Running" on the running task; column headers are announced when moving across cells.
3. Space on a task: Orca says "Timer started: <task>"; Space again: "Timer stopped: <task>".
   Starting from the popup or Alt+Shift+K is announced in an open tab too.
4. Enter opens the Task Properties dialog: its title is read, every field has its label, Esc
   closes it and focus returns to the row.
5. Delete a task: the "Deleted …" bar with Undo is announced.
6. Shift+F10 (or the Menu key) on a row opens the native context menu, and Orca reads its items.
7. The popup: the running timer and each task in "Switch to…" are read; Enter starts one.
8. An error bar (e.g. from a full disk) is read at once (role alert).

### Record

| Check | Thunderbird 157 | Current Release (version: …) |
|---|---|---|
| Install | | |
| Projects (M3) | | |
| Timer (M5) | | |
| Popup, settings, data (M6) | | |
| French | | |
| Orca | | |
