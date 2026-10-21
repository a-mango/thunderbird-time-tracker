# Spec

A Thunderbird extension that tracks time against tasks grouped in nested projects. It runs in its own space tab, laid out like the mail tab (see `DESIGN.md`).

## Scope

**MVP (M0–M7)**
1. Project tree: nestable projects, colour, rename/move/reorder/archive, time badges rolled up from descendants. Views: Today, This Week, Starred.
2. Tasks in a project: name, status open/done, starred, optional estimate, billable flag, tags, notes. Done tasks are hidden by default.
3. One running timer. Start/stop/switch from a row, the detail pane, the action popup, or a keyboard command. Split the running entry. Survives restarts.
4. Time entries: created by the timer, or added manually; edit, split, delete with undo, optional note.
5. Totals: per task, per project (rolled up), today, and this week. Configurable week start.
6. Data: local only (IndexedDB). JSON backup/restore and CSV export of entries.
7. Native feel: light/dark, accent, density, keyboard, a11y, EN strings via `_locales` (FR in M7).

**Stretch (S1–S5), in order**
- S1 Mail linking: message-list context menu items "New task from message" and "Track time to…"; linked messages in the detail pane; open a message from there.
- S2 Idle detection: `idle` API with the prompt "You were away 23 min: keep / discard / split to another task".
- S3 Timesheet and reports: week grid (tasks × days), billable totals, rounding at report time only, CSV/PDF.
- S4 Day timeline + Cards view (design B): a calendar-style day view, drag to create/resize entries, gap filling.
- S5 Integrations (pick later): Kimai / Clockify / Toggl / Jira worklog push, or a WebDAV JSON sync file.

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
| `alarms` | 1-minute tick while running (badge and label refresh) | M5 |
| `menus`, `menus.overrideContext` | native context menus in our page | M3 (if the spike succeeds) |
| `idle`, `notifications` | idle prompt | S2 |
| `messagesRead` | read headers for linking | S1 |
| `accountsRead` | folder → project mapping | S1+ |

No host permissions. Keep the default MV3 CSP, no `eval`, no `innerHTML` (follow `.ref/webext-docs/guides/innerHTML.rst`). Imports are untrusted input: validate them against the schema.

## Architecture

```
src/
  manifest.json
  background/      event page: space + action setup, timer side-effects (alarms, badge, label),
                   commands, menus, runtime message router
  lib/             pure, DOM-free: time math, rollups, formatting, CSV, import validation
  db/              IndexedDB wrapper, repositories, migrations, change notifications
  ui/              tracker.html (space tab), popup.html, components/ (tt-* custom elements),
                   styles/ (tokens.css, base.css), icons/
  _locales/en/messages.json
dev/               mock `messenger` + fixtures + dev server injection (never shipped)
tests/unit         Vitest + fake-indexeddb
tests/ui           Playwright (Firefox engine) against the dev harness
```

- **Single source of truth**: IndexedDB in the extension origin. The tab, popup, and background all use `db/`.
- **Change propagation**: after a write, `db/` posts `{type, ids}` on a `BroadcastChannel('tt')` (for open pages) and calls `messenger.runtime.sendMessage({type:'tt:changed'})` (this wakes the event page for badge, label, and alarm updates).
- **Timer** = the entry with `end === null`. Elapsed time is computed from `start`; nothing ticks in storage. While a timer runs, the 1-minute alarm refreshes the action label, the action badge, and the space badge. Pages tick locally every 1s with `requestAnimationFrame`/`setInterval` only while visible.
- **Startup**: on `runtime.onStartup`/`onInstalled`, ensure the space exists (`spaces.query({isSelfOwned:true})` → create if missing), restore the action label, and re-arm the alarm when a timer is running.
- **UI**: vanilla custom elements, a small render helper (DOM + `<template>`), and keyed list updates. No framework.

## Data model (schema v1)

```js
/** @typedef {{id:string, parentId:string|null, name:string, color:string, order:number,
 *             archived:boolean, createdAt:number, updatedAt:number}} Project */
/** @typedef {{id:string, projectId:string, name:string, status:'open'|'done', starred:boolean,
 *             estimateMin:number|null, billable:boolean, tags:string[], notes:string,
 *             order:number, createdAt:number, updatedAt:number, doneAt:number|null}} Task */
/** @typedef {{id:string, taskId:string, start:number, end:number|null, note:string,
 *             source:'timer'|'manual'|'split'|'idle', createdAt:number, updatedAt:number,
 *             deletedAt:number|null}} Entry */
/** @typedef {{id:string, taskId:string, headerMessageId:string, subject:string,
 *             date:number}} MessageLink  (S1) */
```
- Stores: `projects` (index `parentId`), `tasks` (index `projectId`), `entries` (indexes `taskId`, `start`, `end`, `deletedAt`), `links` (S1), `meta` (`schemaVersion`, `settings`, `running`).
- IndexedDB can't index `null`, so the running entry never appears in the `end` index. `meta.running` points at it and is read and written in the same transaction as every entry write.
- Deleting an entry is a soft delete (`deletedAt` set; a running entry is stopped first). It stays restorable (undo) until the next Thunderbird start: `runtime.onStartup` purges soft-deleted entries.
- Times are epoch ms (UTC). Day and week boundaries are computed in local time at read time. An entry that crosses midnight counts toward each day it overlaps.
- **Invariants**, enforced in `db/` and tested:
  - At most one entry has `end === null`, and `start < end`.
  - Starting a task stops the running one at the same instant.
  - A done task can't be started; starting it asks to reopen.
  - Deleting a project that has tasks or subprojects, or a task that has entries, requires an explicit cascade.
  - A project can't be moved under itself or one of its descendants.
- Migrations live in `db/migrations.js`, are versioned, and each has a test.

## Settings

Density, accent, week start (default Monday), daily target (8h), duration format, show done tasks, confirm before deleting, idle threshold (S2), rounding for reports (S3).

## Keyboard

Mirror Thunderbird where an equivalent exists. Before claiming a global shortcut, check that Thunderbird doesn't already use it.

| Key | Action |
|---|---|
| `Alt+Shift+T` (manifest `commands`) | start the last task / stop the running timer |
| `Alt+Shift+O` (`_execute_action`) | open the popup |
| `Ctrl+N` / `Ctrl+Shift+N` (in tab) | new task / new project |
| `Space` on a task row | start/stop |
| `Enter` / `F2` | open the edit dialog / rename |
| `Delete` | delete (with undo) |
| `Ctrl+Shift+K` | focus the quick filter |
| `Ctrl+E` | add a time entry |
| Arrows, Home/End, type-ahead | tree and table navigation |

## Privacy

- Data stays in the profile. There's no network access at all in the MVP.
- Linking (S1) stores `headerMessageId` and a subject snapshot only. It never stores bodies or addresses.
- **Sample data, fixtures, screenshots, and docs use fictional names only.** Never use real people, organisations, or anything from the maintainer's own life or past conversations.
