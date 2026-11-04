# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-11-04

First release, published as a beta (`v0.1.0-beta.1`). Requires Thunderbird 157 or later.

### Added
- Time Tracker tab in the spaces toolbar, laid out like the mail tab: project tree, task list,
  task details.
- Nested projects: create, rename, colour, move (drag and drop or Move To…), reorder, archive,
  delete with everything in them. Time badges roll up from every subproject. Today, This Week and
  Starred views.
- Tasks: estimate, billable, tags, notes, star, done. Sortable columns, a column picker, a quick
  filter with pills and text.
- One running timer: start, stop, switch, split, discard, adjust the start. It survives restarts.
  The toolbar button shows `h:mm · task` while it runs. `Alt+Shift+K` stops it or starts the last
  task; `Alt+Shift+O` opens the popup.
- Toolbar popup: the running timer, Stop, Split, and a search to switch to another task.
- Time entries: added by hand, edited (with an overlap warning), split, duplicated, deleted with
  undo until the next Thunderbird start.
- Settings: density, accent colour, week start, daily target, duration format, done tasks,
  confirmations.
- JSON backup and restore (merge or replace), CSV export of time entries, delete all data.
- English and French.
- Accessibility: full keyboard use, screen reader names and announcements for timer start and
  stop, light, dark and forced-colour themes.
- Large databases stay fast: per-task totals are cached, so 50,000 entries open in about 100 ms.
- Clear messages with a way out when storage fails: another window blocks an update, data from a
  newer version, a full disk.
