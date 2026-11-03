// Pure helpers for the Data section (M6): the CSV export of entries, the restore preview and the
// download file names.
import { toCsv } from './csv.js';
import { timeInput } from './entry-form.js';
import { projectPathName, subtreeIds } from './sidebar.js';
import { dayKey } from './time.js';

/**
 * @typedef {import('./types.js').Project} Project
 * @typedef {import('./types.js').Task} Task
 * @typedef {import('./types.js').Entry} Entry
 * @typedef {import('./types.js').Backup} Backup
 */

/** CSV columns, in order. The caller gives each a (localised) header. */
export const CSV_COLUMNS = /** @type {const} */ ([
  'date',
  'start',
  'end',
  'minutes',
  'project',
  'task',
  'note',
  'billable',
]);

/**
 * Stopped, live entries that start in `[from, to)` on tasks in the subtree of `projectId` (every
 * project for `null`), oldest first.
 * @param {{projects: Project[], tasks: Task[], entries: Entry[]}} data
 * @param {{from: number, to: number, projectId: string | null}} filter
 */
export function exportedEntries({ projects, tasks, entries }, { from, to, projectId }) {
  const inScope = projectId === null ? null : subtreeIds(projects, projectId);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return entries
    .filter((entry) => {
      if (entry.deletedAt !== null || entry.end === null) return false;
      if (entry.start < from || entry.start >= to) return false;
      const task = taskById.get(entry.taskId);
      return task !== undefined && (inScope === null || inScope.has(task.projectId));
    })
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * Entries as CSV (RFC 4180, UTF-8 with BOM, comma, CRLF): one header row, then per entry the local
 * date (`YYYY-MM-DD`) and start/end times (`HH:MM`, the end may be on the next day), whole minutes
 * (rounded), the project path, task, note and billable (`true`/`false`). The running entry and
 * deleted entries are left out; see `exportedEntries` for the filter.
 * @param {{projects: Project[], tasks: Task[], entries: Entry[]}} data
 * @param {{from: number, to: number, projectId: string | null,
 *          headers: Record<(typeof CSV_COLUMNS)[number], string>}} options
 */
export function entriesCsv(data, { from, to, projectId, headers }) {
  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  /** @type {Map<string, string>} */
  const paths = new Map();
  /** @param {string} id */
  const path = (id) => {
    let name = paths.get(id);
    if (name === undefined) {
      name = projectPathName(data.projects, id);
      paths.set(id, name);
    }
    return name;
  };
  const rows = exportedEntries(data, { from, to, projectId }).map((entry) => {
    const task = /** @type {Task} */ (taskById.get(entry.taskId));
    const end = /** @type {number} */ (entry.end);
    return [
      dayKey(entry.start),
      timeInput(entry.start),
      timeInput(end),
      Math.round((end - entry.start) / 60_000),
      path(task.projectId),
      task.name,
      entry.note,
      task.billable,
    ];
  });
  return toCsv([CSV_COLUMNS.map((column) => headers[column]), ...rows], { bom: true });
}

/**
 * What the restore preview shows: record counts (live entries only) and the time span of the
 * entries (`null` without entries).
 * @param {Backup} backup
 */
export function backupSummary(backup) {
  const entries = backup.entries.filter((entry) => entry.deletedAt === null);
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    from = Math.min(from, entry.start);
    to = Math.max(to, entry.end ?? entry.start);
  }
  return {
    projects: backup.projects.length,
    tasks: backup.tasks.length,
    entries: entries.length,
    exportedAt: backup.exportedAt,
    range: entries.length > 0 ? { from, to } : null,
  };
}

/**
 * Download name with the local date, e.g. `time-tracker-2026-10-20.json`.
 * @param {number} now
 * @param {'json' | 'csv'} extension
 */
export function exportFileName(now, extension) {
  return `time-tracker-${dayKey(now)}.${extension}`;
}
