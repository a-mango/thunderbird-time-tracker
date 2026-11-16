# Spec

A Thunderbird extension that tracks time against tasks grouped in nested projects. It runs in its own space tab, laid out like the mail tab (see `DESIGN.md`).

## Scope

**MVP (M0–M7)**
1. Project tree: nestable projects, colour, rename/move/reorder/archive, time badges rolled up from descendants. Views: Today, This Week, Starred.
2. Tasks in a project: name, status open/done, starred, optional estimate, billable flag, tags, notes. Done tasks are hidden by default.
3. One running timer. Start/stop/switch from a row, the detail pane, the action popup, or a keyboard command. Split the running entry. Survives restarts.
4. Time entries: created by the timer, or added manually; edit, split, delete with undo, optional note.
5. Totals: per task, per project (rolled up), today, and this week. Configurable week start.
6. Data: local only (IndexedDB). JSON backup/restore, CSV export of entries, import from Super Productivity (S7).
7. Native feel: light/dark, accent, density, keyboard, a11y, EN strings via `_locales` (FR in M7).

**Stretch, in order**
- S1 Mail linking: message-list context menu items "New task from message" and "Track time to…"; linked messages in the detail pane; open a message from there.
- S2 Idle detection: `idle` API with the prompt "You were away 23 min: keep / discard / split to another task".
- S3 Timesheet and reports: week grid (tasks × days), billable totals, rounding at report time only, CSV/PDF.
- S4 Day timeline + Cards view (design B): a calendar-style day view, drag to create/resize entries, gap filling.
- S5 Integrations (pick later): Kimai / Clockify / Toggl / Jira worklog push, or a WebDAV JSON sync file.
- S6 System tray (#33): the timer status as a tray icon (Linux first) through a native helper; click opens the tracker, the menu stops or starts the timer.
- S7 Import from Super Productivity: its JSON backup becomes folders, projects, tasks and one entry per task and day; importing a newer backup adds only what's new.
- S8 CSV import (next): our own CSV export and other trackers' (Toggl, Clockify, Kimai) through a column mapping, on the S7 import core.

**Out of scope**: multi-user, server, telemetry, any remote code.

## Platform

- Thunderbird WebExtension, **Manifest V3**. `strict_min_version: "157.0"`. Develop and test on Thunderbird 157 Release (decided in M0; the next ESR line will be the first ESR that can install it).
- Background is an **event page** (`background.scripts` + `"type": "module"`), not a service worker. It can be suspended, so it keeps no state in memory.
- Copy-only build: `src/` ships as-is, so ATN review needs no source submission (`.ref/webext-docs/guides/sourceCodeSubmission.rst`, `vendoring.rst`). JavaScript ES modules with JSDoc types, checked by `tsc --noEmit`.
- **Zero runtime dependencies.** Any future library is vendored at an exact version and declared in `VENDOR.md`.
- Use the `messenger.*` namespace. Check every API against `.ref/webext-docs` (branch `release-mv3`); don't rely on memory.

## Permissions

| Permission | Why | When |
|---|---|---|
| (none for IndexedDB) | data store | M2 |
| `storage` | small settings and state mirror (`storage.local`) | Deferred from M2: settings live in IndexedDB `meta`; add it with the first feature that needs a `storage.local` mirror |
| `alarms` | 1-minute tick while running (action label refresh) | M5 (added) |
| `menus`, `menus.overrideContext` | native context menus on project and task rows in our tab (items limited to `ui/tracker.html` by `documentUrlPatterns`) | M3 (added; the M1 spike succeeded); task rows in M4 |
| `notifications` | `Alt+Shift+K` with no task tracked yet: says how to start one (the command has no other UI) | M5 (added) |
| `idle` | idle prompt: while a timer runs, detect when the user leaves and comes back (no install warning) | S2 (added) |
| `nativeMessaging` (**optional**) | system tray icon: talk to the separately installed tray helper (`native/tray/`). Asked for only when the user ticks Settings › Show the timer in the system tray; removed when they untick it | S6 (added) |
| `messagesRead` | read headers for linking | S1 |
| `accountsRead` | folder → project mapping | S1+ |

No host permissions. Keep the default MV3 CSP, no `eval`, no `innerHTML` (follow `.ref/webext-docs/guides/innerHTML.rst`). Imports are untrusted input: validate them against the schema.

## Architecture

```
src/
  manifest.json
  background/      event page: space + action setup, timer side-effects (alarm, action label),
                   commands, menus, runtime message router
  lib/             pure, DOM-free: time math, rollups, formatting, CSV, import validation,
                   imports from other apps (import-batch.js core, sp-import.js)
  db/              IndexedDB wrapper, repositories, migrations, change notifications
  ui/              tracker.html (space tab), popup.html, components/ (tt-* custom elements),
                   styles/ (tokens.css, base.css), icons/
  _locales/en/messages.json
dev/               mock `messenger` + fixtures + dev server injection (never shipped)
tests/unit         Vitest + fake-indexeddb
tests/ui           Playwright (Firefox engine) against the dev harness
```

- **Single source of truth**: IndexedDB in the extension origin. The tab, popup, and background all use `db/`.
- **Change propagation**: after a write, `db/` posts `{type, ids}` on a `BroadcastChannel('tt')` (for open pages) and calls `messenger.runtime.sendMessage({type:'tt:changed'})` (this wakes the event page for label and alarm updates).
- **Timer** = the entry with `end === null`. Elapsed time is computed from `start`; nothing ticks in storage. While a timer runs, the 1-minute alarm refreshes the action label (`h:mm · task`). No action or space badge: the label already shows the time (decided in the M5 Thunderbird check). Pages tick locally every 1s with `requestAnimationFrame`/`setInterval` only while visible.
- **Startup**: on `runtime.onStartup`/`onInstalled`, ensure the space exists (`spaces.query({isSelfOwned:true})` → create if missing), restore the action label, and re-arm the alarm when a timer is running.
- **UI**: vanilla custom elements, a small render helper (DOM + `<template>`), and keyed list updates. No framework.

## Data model (schema v2)

```js
/** @typedef {{id:string, parentId:string|null, name:string, color:string, order:number,
 *             archived:boolean, hourlyRate:number|null, createdAt:number,
 *             updatedAt:number}} Project  (hourlyRate: S3, v2; null = the parent's rate) */
/** @typedef {{id:string, projectId:string, name:string, status:'open'|'done', starred:boolean,
 *             estimateMin:number|null, billable:boolean, tags:string[], notes:string,
 *             order:number, createdAt:number, updatedAt:number, doneAt:number|null}} Task */
/** @typedef {{id:string, taskId:string, start:number, end:number|null, note:string,
 *             source:'timer'|'manual'|'split'|'idle', createdAt:number, updatedAt:number,
 *             deletedAt:number|null}} Entry */
/** @typedef {{id:string, taskId:string, headerMessageId:string, subject:string,
 *             date:number}} MessageLink  (S1) */
```
- Stores: `projects` (index `parentId`), `tasks` (index `projectId`), `entries` (indexes `taskId`, `start`, `end`, `deletedAt`), `links` (S1), `meta` (`schemaVersion`, `settings`, `running`, `aggregates`).
- IndexedDB can't index `null`, so the running entry never appears in the `end` index. `meta.running` points at it and is read and written in the same transaction as every write that starts, stops or removes the running entry.
- Deleting an entry is a soft delete (`deletedAt` set; a running entry is stopped first). It stays restorable (undo) until the next Thunderbird start: `runtime.onStartup` purges soft-deleted entries.
- Times are epoch ms (UTC). Day and week boundaries are computed in local time at read time. An entry that crosses midnight counts toward each day it overlaps.
- **Invariants**, enforced in `db/` and tested:
  - At most one entry has `end === null`, and `start < end`.
  - Starting a task stops the running one at the same instant.
  - A done task can't be started; starting it asks to reopen.
  - Deleting a project that has tasks or subprojects, or a task that has entries, requires an explicit cascade.
  - A project can't be moved under itself or one of its descendants.
- `meta.aggregates` caches per-task `{count, ms, last}` (M7). Every write that touches entries updates the touched tasks in the same transaction; readers rebuild it when its counts don't add up to the number of stored entries. Pages read it plus the entries of the last 7 days instead of every entry.
- Migrations live in `db/migrations.js`, are versioned, and each has a test. v2 (S3) sets `hourlyRate: null` on every project; backups without the field import as `null`.
- Timesheet edits (S3) go through `db/timesheet.js` `setDayTotal` in one transaction: more time extends the task's last manual entry of the day or adds one (from 09:00, after the day's entries); less time only shortens that manual entry. Anything else (removing or trimming entries, 0) throws `replace-needed` until the page has asked and passes `replace`. A day the running entry touches can't be edited. `undoDayTotal` puts every touched entry back.

## Settings

Density, accent, week start (default Monday), daily target (8h), duration format, show done tasks, confirm before deleting, idle threshold (S2), rounding for reports (S3: `roundingMin` 0/5/6/15, `roundingMode` per entry or per task and day; durations round up, only in the Reports pane and its CSV, never stored).

They're edited in the Settings dialog (M6) and apply live in every open page. Backup, restore (merge by id or replace), Import from Super Productivity (S7) and CSV export are in its Data section; backups and CSV files are saved through `<a download>`, so no `downloads` permission is needed. **Delete All Data** removes every record and the settings.

## Imports from other apps (S7)

- **Core** (`lib/import-batch.js`, `db/import.js`): a source-neutral batch of projects, tasks and entries. `resolveBatch` matches it against the stored data: by the batch record's id first (wherever that record is now), then by name (a child of the same parent, a task in the same project, open before done, ignoring case and spacing), else it creates the record at the end of its siblings. Entries whose id is stored, soft-deleted ones included, are skipped. Day totals (time per task and day without times of their own) are laid end to end from when work started that day, after the latest end of everything on that day (the running entry counts up to now), and moved earlier rather than past midnight or, today, past now. A stored day total whose time differs from the batch is kept and counted (`changed`). `previewBatch` runs this on a read snapshot; `importBatch` runs it again in one readwrite transaction, re-checks every record like the repositories, updates the aggregates and emits `reset`. Existing records are never changed, and no running entry is written.
- **Super Productivity** (`lib/sp-import.js`): reads its JSON backup (`{timestamp, crossModelVersion, data}` or bare `data`, up to 50 MB). Menu folders become parent projects. Projects keep their archive state and the nearest palette colour. Tasks without a known project go to the Inbox (created when the backup has none). Subtasks become `Parent › Subtask` tasks, and a parent is a task of its own only with time beyond its subtasks'. Archived tasks come in as done, and tag titles become task tags. Each task-day (`timeSpentOnDay`) becomes one day total starting at that day's work start (`timeTracking`, else 09:00). Ids derive from Super Productivity's (`sp-f-`, `sp-p-`, `sp-t-`, `sp-e-<task>-<day>`), so a later import adds only new task-days. Bad values are counted and left out. The file is refused only when it isn't such a backup.
- The preview (Settings › Data) shows a table of what is added and what is already here (projects, tasks, time entries), the entries' date range, the days that changed since they were imported and the unreadable values. A write the repositories refuse changes nothing and says so.

## Keyboard

Mirror Thunderbird where an equivalent exists. Before claiming a global shortcut, check that Thunderbird doesn't already use it.

| Key | Action |
|---|---|
| `Alt+Shift+K` (manifest `commands`) | start the last task / stop the running timer. Not `Alt+Shift+T`: on Linux the menu bar takes Alt+letter as an access key even with Shift (T = Tools) |
| `Alt+Shift+O` (`_execute_action`) | open the popup |
| `Ctrl+N` / `Ctrl+Shift+N` (in tab) | new task / new project |
| `Space` on a task row | start/stop |
| `Enter` / `F2` | open the edit dialog / rename |
| `Delete` | delete (with undo) |
| `Ctrl+Shift+K` | focus the quick filter |
| `Ctrl+E` | add a time entry |
| Arrows, Home/End, type-ahead | tree and table navigation |
| Timesheet: arrows, Home/End, Ctrl+Home/End | move between cells |
| Timesheet: Enter/F2, typing a number, Delete | edit a day (Enter saves, Esc cancels) |

## Privacy

- Data stays in the profile. There's no network access at all in the MVP.
- Linking (S1) stores `headerMessageId` and a subject snapshot only. It never stores bodies or addresses.
- System tray (S6, opt-in): the running task's name and time leave Thunderbird for the tray helper and are readable on the user's D-Bus session bus (the tray icon's tooltip). Any process of the same user can also click the icon or its menu (open the tracker, stop or start the timer); the helper accepts nothing else, and the add-on only acts on `stop`, `start`, `tracker` and `activate`.
- **Sample data, fixtures, screenshots, and docs use fictional names only.** Never use real people, organisations, or anything from the maintainer's own life or past conversations.
