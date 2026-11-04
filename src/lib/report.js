// Timesheet and summary of the Reports mode (S3): pure, DOM-free aggregation of entries into
// task × day cells, per-project totals with billable time and amounts, and the report's CSV.
import { toCsv } from './csv.js';
import { NO_ROUNDING, roundDay } from './rounding.js';
import { projectPathName, subtreeIds } from './sidebar.js';
import { addDays, dayKey, splitByDay, startOfDay, weekRange } from './time.js';

/**
 * @typedef {import('./types.js').Project} Project
 * @typedef {import('./types.js').Task} Task
 * @typedef {import('./types.js').Entry} Entry
 * @typedef {import('./time.js').Range} Range
 * @typedef {import('./time.js').WeekStart} WeekStart
 * @typedef {import('./rounding.js').Rounding} Rounding
 * @typedef {'week' | 'last-week' | 'month' | 'last-month' | 'custom'} RangePreset
 * @typedef {{projectId: string | null, billableOnly: boolean, tags: string[]}} ReportFilters
 *   `projectId`: that project and its subprojects (`null` = all). `tags`: tasks with at least
 *   one of them (case-insensitive; empty = no tag filter), like the quick filter's Tags pill.
 * @typedef {object} ReportRow one task
 * @property {string} taskId
 * @property {string} name
 * @property {boolean} billable
 * @property {number[]} cells rounded ms per day
 * @property {number[]} raw exact ms per day (what a cell edit compares against)
 * @property {boolean[]} running the running entry touches that day (the cell is read-only)
 * @property {number} total rounded
 * @typedef {object} ReportGroup the tasks of one project
 * @property {string} projectId
 * @property {string} name project path, e.g. `Client work / Harbor Coffee — website / Build`
 * @property {ReportRow[]} rows
 * @typedef {object} SummaryRow one project, its subprojects rolled up
 * @property {string} projectId
 * @property {string} name
 * @property {number} depth 0 for the top projects of the report
 * @property {number} total
 * @property {number} billable
 * @property {number} nonBillable
 * @property {number | null} rate the project's own rate, else its nearest ancestor's
 * @property {number | null} amount billable time × rate; `null` when none of it has a rate
 * @typedef {object} Report
 * @property {number[]} days local midnight of each day in the range
 * @property {ReportGroup[]} groups in project tree order, tasks in list order
 * @property {number[]} dayTotals
 * @property {number} total
 * @property {SummaryRow[]} summary
 * @property {{total: number, billable: number, nonBillable: number, amount: number | null}} totals
 */

/** Longest range the timesheet shows (one column per day). */
export const MAX_RANGE_DAYS = 31;

const HOUR = 3_600_000;

/**
 * The range of a preset around `now`.
 * @param {Exclude<RangePreset, 'custom'>} preset
 * @param {{now: number, weekStart: WeekStart}} options
 * @returns {Range}
 */
export function presetRange(preset, { now, weekStart }) {
  if (preset === 'week') return weekRange(now, weekStart);
  if (preset === 'last-week') return weekRange(addDays(startOfDay(now), -7), weekStart);
  const date = new Date(now);
  const month = preset === 'month' ? date.getMonth() : date.getMonth() - 1;
  return {
    start: new Date(date.getFullYear(), month, 1).getTime(),
    end: new Date(date.getFullYear(), month + 1, 1).getTime(),
  };
}

/**
 * The previous (`-1`) or next (`1`) range of the same kind: a week, a calendar month, or a
 * custom range of the same number of days.
 * @param {Range} range
 * @param {RangePreset} preset
 * @param {-1 | 1} direction
 * @returns {Range}
 */
export function shiftRange(range, preset, direction) {
  if (preset === 'month' || preset === 'last-month') {
    const date = new Date(range.start);
    return {
      start: new Date(date.getFullYear(), date.getMonth() + direction, 1).getTime(),
      end: new Date(date.getFullYear(), date.getMonth() + direction + 1, 1).getTime(),
    };
  }
  const days = rangeDays(range).length;
  return {
    start: startOfDay(range.start, direction * days),
    end: startOfDay(range.end, direction * days),
  };
}

/**
 * A custom range from two local dates (both included), or `null` when the end is before the
 * start or the range is longer than `MAX_RANGE_DAYS`.
 * @param {number} first any time on the first day
 * @param {number} last any time on the last day
 * @returns {Range | null}
 */
export function customRange(first, last) {
  const range = { start: startOfDay(first), end: startOfDay(last, 1) };
  if (range.end <= range.start) return null;
  return rangeDays(range).length <= MAX_RANGE_DAYS ? range : null;
}

/**
 * Local midnight of every day in the range (DST days included once).
 * @param {Range} range
 */
export function rangeDays({ start, end }) {
  const days = [];
  for (let day = startOfDay(start); day < end; day = startOfDay(day, 1)) days.push(day);
  return days;
}

/** @param {{order: number, createdAt: number, name: string}} a @param {typeof a} b */
const siblingOrder = (a, b) =>
  a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name);

/**
 * Projects in depth-first tree order with their depth; orphans count as roots, a stored cycle is
 * cut where it closes. Archived projects are included: their time is still time.
 * @param {Project[]} projects
 * @returns {{project: Project, depth: number}[]}
 */
function treeOrder(projects) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  /** @type {Map<string | null, Project[]>} */
  const children = new Map();
  for (const project of projects) {
    const parent =
      project.parentId !== null && byId.has(project.parentId) ? project.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), project]);
  }
  /** @type {{project: Project, depth: number}[]} */
  const ordered = [];
  const seen = new Set();
  /** @param {string | null} parentId @param {number} depth */
  const walk = (parentId, depth) => {
    for (const project of (children.get(parentId) ?? []).sort(siblingOrder)) {
      if (seen.has(project.id)) continue;
      seen.add(project.id);
      ordered.push({ project, depth });
      walk(project.id, depth + 1);
    }
  };
  walk(null, 0);
  // Members of a parent cycle are nobody's root: list them at the top level.
  for (const project of projects) if (!seen.has(project.id)) walk(project.parentId, 0);
  return ordered;
}

/**
 * The rate that applies in a project: its own, else the nearest ancestor's.
 * @param {Map<string, Project>} byId
 * @param {string} projectId
 */
function effectiveRate(byId, projectId) {
  const seen = new Set();
  for (let id = /** @type {string | null} */ (projectId); id !== null && !seen.has(id);) {
    seen.add(id);
    const project = byId.get(id);
    if (!project) return null;
    if (project.hourlyRate !== null && project.hourlyRate !== undefined) return project.hourlyRate;
    id = project.parentId;
  }
  return null;
}

/**
 * Tasks the filters keep.
 * @param {{projects: Project[], tasks: Task[]}} data
 * @param {ReportFilters} filters
 */
export function filterTasks({ projects, tasks }, { projectId, billableOnly, tags }) {
  const scope = projectId === null ? null : subtreeIds(projects, projectId);
  const wanted = tags.map((tag) => tag.toLocaleLowerCase());
  return tasks.filter((task) => {
    if (scope !== null && !scope.has(task.projectId)) return false;
    if (billableOnly && !task.billable) return false;
    if (wanted.length === 0) return true;
    return task.tags.some((tag) => wanted.includes(tag.toLocaleLowerCase()));
  });
}

/**
 * Builds the timesheet and summary of `range`.
 * @param {{projects: Project[], tasks: Task[], entries: Entry[]}} data `entries` may hold more
 *   than the range; deleted ones are left out, the running one counts up to `now`
 * @param {{range: Range, now: number, filters: ReportFilters, rounding?: Rounding,
 *          extraTaskIds?: Iterable<string>}} options `extraTaskIds`: tasks to show even without
 *   time in the range (rows the user added to fill in)
 * @returns {Report}
 */
export function buildReport(
  data,
  { range, now, filters, rounding = NO_ROUNDING, extraTaskIds = [] },
) {
  const days = rangeDays(range);
  const dayIndex = new Map(days.map((day, index) => [dayKey(day), index]));
  const tasks = filterTasks(data, filters);
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  /** Per task: the entry parts of each day, and the days the running entry touches. */
  /** @type {Map<string, {parts: number[][], running: boolean[]}>} */
  const perTask = new Map();
  const slot = (/** @type {string} */ taskId) => {
    let value = perTask.get(taskId);
    if (!value) {
      value = { parts: days.map(() => []), running: days.map(() => false) };
      perTask.set(taskId, value);
    }
    return value;
  };
  for (const entry of data.entries) {
    if (entry.deletedAt !== null || !taskById.has(entry.taskId)) continue;
    if (entry.start >= range.end || (entry.end !== null && entry.end <= range.start)) continue;
    for (const part of splitByDay(entry, { now })) {
      const index = dayIndex.get(part.day);
      if (index === undefined) continue;
      const value = slot(entry.taskId);
      value.parts[index].push(part.ms);
      if (entry.end === null) value.running[index] = true;
    }
  }
  for (const id of extraTaskIds) if (taskById.has(id)) slot(id);

  /** @type {Map<string, ReportRow[]>} */
  const rowsByProject = new Map();
  for (const [taskId, { parts, running }] of perTask) {
    const task = /** @type {Task} */ (taskById.get(taskId));
    const cells = parts.map((list) => roundDay(list, rounding));
    /** @type {ReportRow} */
    const row = {
      taskId,
      name: task.name,
      billable: task.billable,
      cells,
      raw: parts.map((list) => list.reduce((sum, ms) => sum + ms, 0)),
      running,
      total: cells.reduce((sum, ms) => sum + ms, 0),
    };
    rowsByProject.set(task.projectId, [...(rowsByProject.get(task.projectId) ?? []), row]);
  }

  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const ordered = treeOrder(data.projects);
  /** @type {ReportGroup[]} */
  const groups = [];
  for (const { project } of ordered) {
    const rows = rowsByProject.get(project.id);
    if (!rows) continue;
    rows.sort((a, b) =>
      siblingOrder(
        /** @type {Task} */ (taskById.get(a.taskId)),
        /** @type {Task} */ (taskById.get(b.taskId)),
      ),
    );
    groups.push({ projectId: project.id, name: projectPathName(data.projects, project.id), rows });
  }

  const dayTotals = days.map((_, index) =>
    groups.reduce((sum, group) => sum + group.rows.reduce((s, row) => s + row.cells[index], 0), 0),
  );

  // Summary: each task's time goes to its project and every ancestor.
  /** @type {Map<string, {total: number, billable: number, amount: number | null}>} */
  const sums = new Map();
  for (const group of groups) {
    const rate = effectiveRate(projectById, group.projectId);
    for (const row of group.rows) {
      if (row.total === 0) continue;
      const billable = row.billable ? row.total : 0;
      const amount = row.billable && rate !== null ? (billable / HOUR) * rate : null;
      const seen = new Set();
      for (let id = /** @type {string | null} */ (group.projectId); id !== null && !seen.has(id);) {
        seen.add(id);
        const project = projectById.get(id);
        if (!project) break;
        const sum = sums.get(id) ?? { total: 0, billable: 0, amount: null };
        sum.total += row.total;
        sum.billable += billable;
        if (amount !== null) sum.amount = (sum.amount ?? 0) + amount;
        sums.set(id, sum);
        id = project.parentId;
      }
    }
  }
  // The top of the summary: the filtered project, or the roots.
  const scope = filters.projectId === null ? null : subtreeIds(data.projects, filters.projectId);
  const baseDepth =
    filters.projectId === null
      ? 0
      : (ordered.find((node) => node.project.id === filters.projectId)?.depth ?? 0);
  /** @type {SummaryRow[]} */
  const summary = [];
  for (const { project, depth } of ordered) {
    const sum = sums.get(project.id);
    if (!sum || (scope !== null && !scope.has(project.id))) continue;
    summary.push({
      projectId: project.id,
      name: project.name,
      depth: depth - baseDepth,
      total: sum.total,
      billable: sum.billable,
      nonBillable: sum.total - sum.billable,
      rate: effectiveRate(projectById, project.id),
      amount: sum.amount,
    });
  }

  let total = 0;
  let billable = 0;
  /** @type {number | null} */
  let amount = null;
  for (const group of groups) {
    const rate = effectiveRate(projectById, group.projectId);
    for (const row of group.rows) {
      total += row.total;
      if (!row.billable || row.total === 0) continue;
      billable += row.total;
      if (rate !== null) amount = (amount ?? 0) + (row.total / HOUR) * rate;
    }
  }
  return {
    days,
    groups,
    dayTotals,
    total,
    summary,
    totals: { total, billable, nonBillable: total - billable, amount },
  };
}

/** CSV columns of the report, in order. The caller gives each a (localised) header. */
export const REPORT_CSV_COLUMNS = /** @type {const} */ ([
  'date',
  'project',
  'task',
  'billable',
  'tags',
  'minutes',
  'hours',
  'rate',
  'amount',
]);

/**
 * The timesheet as CSV (RFC 4180, UTF-8 with BOM): one row per task and day with time, with the
 * rounded minutes, decimal hours, the rate that applies and the amount (billable rows with a
 * rate only).
 * @param {Report} report
 * @param {{projects: Project[], tasks: Task[],
 *          headers: Record<(typeof REPORT_CSV_COLUMNS)[number], string>}} options
 */
export function reportCsv(report, { projects, tasks, headers }) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  /** @type {(string | number | boolean | null)[][]} */
  const rows = [];
  report.days.forEach((day, index) => {
    for (const group of report.groups) {
      const rate = effectiveRate(byId, group.projectId);
      for (const row of group.rows) {
        const ms = row.cells[index];
        if (ms === 0) continue;
        const hours = ms / HOUR;
        rows.push([
          dayKey(day),
          group.name,
          row.name,
          row.billable,
          (taskById.get(row.taskId)?.tags ?? []).join('; '),
          Math.round(ms / 60_000),
          hours.toFixed(2),
          rate === null ? null : rate.toFixed(2),
          row.billable && rate !== null ? (hours * rate).toFixed(2) : null,
        ]);
      }
    }
  });
  return toCsv([REPORT_CSV_COLUMNS.map((column) => headers[column]), ...rows], { bom: true });
}
