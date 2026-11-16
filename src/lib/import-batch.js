// Source-neutral import core (S7): matches a batch of projects, tasks and entries read from
// another app's file against the stored data, and returns the records to add. Pure: the preview
// runs it on a read snapshot and db/import.js runs it again inside the write transaction, so both
// see the same rules. Existing records are never changed.
import { combine } from './entry-form.js';
import { LIMITS } from './limits.js';
import { dayStartOf, splitByDay, startOfDay } from './time.js';

/**
 * @typedef {import('./types.js').Project} Project
 * @typedef {import('./types.js').Task} Task
 * @typedef {import('./types.js').Entry} Entry
 *
 * @typedef {{key: string, id: string | null, parentKey: string | null, name: string,
 *            color: string, archived: boolean}} BatchProject
 *   `key` names the project inside the batch (`parentKey` and `projectKey` refer to it). `id` is
 *   the id to store it under, which finds it again on the next import; null for a fresh id.
 * @typedef {{key: string, id: string | null, projectKey: string, name: string,
 *            status: 'open' | 'done', doneAt: number | null, estimateMin: number | null,
 *            notes: string, tags: string[], billable: boolean}} BatchTask
 * @typedef {{id: string | null, taskKey: string, note: string, start: number,
 *            end: number}} TimedEntry
 *   An entry with its own times. Without an id, it is a duplicate of a live entry on the same
 *   task with the same start and end minute.
 * @typedef {{id: string | null, taskKey: string, note: string, day: string, ms: number,
 *            from: number}} DayTotal
 *   Time on a task for a local day (`YYYY-MM-DD`) without times of its own (Super Productivity).
 *   `from` is when work started that day, if known.
 * @typedef {TimedEntry | DayTotal} BatchEntry
 * @typedef {{projects: BatchProject[], tasks: BatchTask[], entries: BatchEntry[]}} ImportBatch
 *
 * @typedef {object} ImportPlan
 * @property {Project[]} projects to add, parents first
 * @property {Task[]} tasks to add
 * @property {Entry[]} entries to add (all stopped)
 * @property {{projects: number, tasks: number}} reused batch records that found a stored one
 * @property {number} skipped entries already stored (same id, or a duplicate)
 * @property {number} changed of those, day totals whose stored entry (live) is now shorter or
 *   longer than the batch says: kept as stored
 * @property {number} dropped batch records left out: blank name, bad times, unknown reference
 */

const MINUTE = 60_000;

/** Names match ignoring case, spacing and Unicode composition. @param {string} name */
const sameName = (name) => name.replace(/\s+/gu, ' ').trim().normalize('NFC').toLowerCase();

/** A storable name: one line, trimmed, at most `LIMITS.name`; '' when blank. @param {string} name */
const cleanName = (name) => name.replace(/\s+/gu, ' ').trim().slice(0, LIMITS.name).trim();

/** @param {string} taskId @param {number} start @param {number} end */
const minuteKey = (taskId, start, end) =>
  `${taskId}\n${Math.floor(start / MINUTE)}\n${Math.floor(end / MINUTE)}`;

/** @param {unknown} ms */
const isTime = (ms) =>
  Number.isSafeInteger(ms) &&
  /** @type {number} */ (ms) >= 0 &&
  /** @type {number} */ (ms) <= LIMITS.time;

/**
 * Matches `batch` against `stored` and returns what to add.
 * - Projects: the stored project with the batch project's `id`, wherever it is now; else a stored
 *   (or just created) child of the same parent with the same name, the first by order; else a new
 *   project at the end of its siblings.
 * - Tasks: the same, by `id`, then by name in the project (open tasks before done ones).
 * - Entries: one whose `id` is stored (deleted ones included) is skipped, as is a timed entry
 *   without an id that duplicates a live entry. Day totals are laid end to end per day, from
 *   when work started that day or after the day's latest stored entry, whichever is later, and
 *   moved earlier when they would run past midnight.
 * @param {ImportBatch} batch
 * @param {{projects: Project[], tasks: Task[], entries: Entry[]}} stored every stored record,
 *   soft-deleted entries included
 * @param {{now: number, newId: () => string}} options
 * @returns {ImportPlan}
 */
export function resolveBatch(batch, stored, { now, newId }) {
  /** @type {ImportPlan} */
  const plan = {
    projects: [],
    tasks: [],
    entries: [],
    reused: { projects: 0, tasks: 0 },
    skipped: 0,
    changed: 0,
    dropped: 0,
  };

  // ---- projects ----
  const projectById = new Map(stored.projects.map((p) => [p.id, p]));
  const storedProjects = new Set(projectById.keys());
  /** @param {Project} p */
  const parentOf = (p) => (p.parentId !== null && projectById.has(p.parentId) ? p.parentId : null);
  /** Per parent: children by name (the first by order wins) and the next free order. */
  /** @type {Map<string | null, {byName: Map<string, Project>, next: number}>} */
  const siblings = new Map();
  /** @param {string | null} parentId */
  const siblingsOf = (parentId) => {
    let entry = siblings.get(parentId);
    if (!entry) {
      entry = { byName: new Map(), next: 0 };
      siblings.set(parentId, entry);
    }
    return entry;
  };
  for (const project of [...stored.projects].sort((a, b) => a.order - b.order)) {
    const entry = siblingsOf(parentOf(project));
    if (!entry.byName.has(sameName(project.name)))
      entry.byName.set(sameName(project.name), project);
    entry.next = Math.max(entry.next, project.order + 1);
  }

  /** @type {Map<string, BatchProject>} */
  const batchProjects = new Map();
  for (const project of batch.projects) {
    if (!batchProjects.has(project.key)) batchProjects.set(project.key, project);
  }
  /** Batch key → stored id, or null when the project was dropped. */
  /** @type {Map<string, string | null>} */
  const projectIds = new Map();
  /** @type {Set<string>} */
  const walking = new Set();

  /**
   * @param {string} key
   * @returns {string | null} the stored id, or null for an unknown or dropped project
   */
  const resolveProject = (key) => {
    const known = projectIds.get(key);
    if (known !== undefined) return known;
    const item = batchProjects.get(key);
    if (!item || walking.has(key)) return null;
    walking.add(key);
    const parentId = item.parentKey === null ? null : resolveProject(item.parentKey);
    walking.delete(key);
    /** @type {string | null} */
    let id = null;
    const name = cleanName(item.name);
    if (item.id !== null && projectById.has(item.id)) {
      id = item.id;
      plan.reused.projects += 1;
    } else if (name === '') {
      plan.dropped += 1;
    } else {
      const family = siblingsOf(parentId);
      const match = family.byName.get(sameName(name));
      if (match) {
        id = match.id;
        if (storedProjects.has(match.id)) plan.reused.projects += 1;
      } else {
        /** @type {Project} */
        const project = {
          id: item.id ?? newId(),
          parentId,
          name,
          color: item.color,
          order: family.next,
          archived: item.archived,
          hourlyRate: null,
          createdAt: now,
          updatedAt: now,
        };
        family.next += 1;
        family.byName.set(sameName(name), project);
        projectById.set(project.id, project);
        plan.projects.push(project);
        id = project.id;
      }
    }
    projectIds.set(key, id);
    return id;
  };
  for (const project of batch.projects) resolveProject(project.key);

  // ---- tasks ----
  const taskById = new Map(stored.tasks.map((t) => [t.id, t]));
  const storedTasks = new Set(taskById.keys());
  /** Per project: tasks by name (open before done, then by order) and the next free order. */
  /** @type {Map<string, {byName: Map<string, Task>, next: number}>} */
  const tasksIn = new Map();
  /** @param {string} projectId */
  const tasksOf = (projectId) => {
    let entry = tasksIn.get(projectId);
    if (!entry) {
      entry = { byName: new Map(), next: 0 };
      tasksIn.set(projectId, entry);
    }
    return entry;
  };
  const rank = (/** @type {Task} */ t) => (t.status === 'open' ? 0 : 1);
  for (const task of [...stored.tasks].sort((a, b) => rank(a) - rank(b) || a.order - b.order)) {
    const entry = tasksOf(task.projectId);
    if (!entry.byName.has(sameName(task.name))) entry.byName.set(sameName(task.name), task);
    entry.next = Math.max(entry.next, task.order + 1);
  }

  /** Batch key → stored id, or null when the task was dropped. */
  /** @type {Map<string, string | null>} */
  const taskIds = new Map();
  for (const item of batch.tasks) {
    if (taskIds.has(item.key)) continue;
    const projectId = resolveProject(item.projectKey);
    const name = cleanName(item.name);
    /** @type {string | null} */
    let id = null;
    if (item.id !== null && taskById.has(item.id)) {
      id = item.id;
      plan.reused.tasks += 1;
    } else if (projectId === null || name === '') {
      plan.dropped += 1;
    } else {
      const family = tasksOf(projectId);
      const match = family.byName.get(sameName(name));
      if (match) {
        id = match.id;
        if (storedTasks.has(match.id)) plan.reused.tasks += 1;
      } else {
        const done = item.status === 'done';
        /** @type {Task} */
        const task = {
          id: item.id ?? newId(),
          projectId,
          name,
          status: done ? 'done' : 'open',
          starred: false,
          estimateMin: item.estimateMin,
          billable: item.billable,
          tags: item.tags,
          notes: item.notes,
          order: family.next,
          createdAt: now,
          updatedAt: now,
          doneAt: done ? item.doneAt : null,
        };
        family.next += 1;
        family.byName.set(sameName(name), task);
        taskById.set(task.id, task);
        plan.tasks.push(task);
        id = task.id;
      }
    }
    taskIds.set(item.key, id);
  }

  // ---- entries ----
  const storedEntries = new Map(stored.entries.map((e) => [e.id, e]));
  const usedIds = new Set(storedEntries.keys());
  const live = stored.entries.filter((e) => e.deletedAt === null);
  const liveKeys = new Set(
    live
      .filter((e) => e.end !== null)
      .map((e) => minuteKey(e.taskId, e.start, /** @type {number} */ (e.end))),
  );
  /** Latest end per local day of everything on that day (the running entry runs to `now`). */
  /** @type {Map<string, number>} */
  const dayEnds = new Map();
  /** @param {number} start @param {number | null} end */
  const noteDayEnd = (start, end) => {
    for (const part of splitByDay({ start, end }, { now })) {
      dayEnds.set(part.day, Math.max(dayEnds.get(part.day) ?? part.end, part.end));
    }
  };
  for (const entry of live) noteDayEnd(entry.start, entry.end);

  /** @param {string} id @param {string} taskId @param {number} start @param {number} end @param {string} note */
  const addEntry = (id, taskId, start, end, note) => {
    usedIds.add(id);
    plan.entries.push({
      id,
      taskId,
      start,
      end,
      note: note.slice(0, LIMITS.text),
      source: 'manual',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  };

  /** @type {Map<string, {id: string, taskId: string, ms: number, from: number, note: string}[]>} */
  const days = new Map();
  for (const item of batch.entries) {
    const taskId = taskIds.get(item.taskKey) ?? null;
    if (taskId === null) {
      plan.dropped += 1;
      continue;
    }
    if (item.id !== null && usedIds.has(item.id)) {
      plan.skipped += 1;
      const kept = storedEntries.get(item.id);
      if (
        'day' in item &&
        kept?.deletedAt === null &&
        kept.end !== null &&
        Math.abs(kept.end - kept.start - item.ms) >= 1000
      ) {
        plan.changed += 1;
      }
      continue;
    }
    if ('day' in item) {
      const ms = Math.round(item.ms);
      if (dayStartOf(item.day) === null || !(ms > 0)) {
        plan.dropped += 1;
        continue;
      }
      const id = item.id ?? newId();
      usedIds.add(id);
      const list = days.get(item.day) ?? [];
      list.push({ id, taskId, ms, from: item.from, note: item.note });
      days.set(item.day, list);
    } else if (!isTime(item.start) || !isTime(item.end) || item.start >= item.end) {
      plan.dropped += 1;
    } else if (item.id === null && liveKeys.has(minuteKey(taskId, item.start, item.end))) {
      plan.skipped += 1;
    } else {
      addEntry(item.id ?? newId(), taskId, item.start, item.end, item.note);
      noteDayEnd(item.start, item.end);
    }
  }

  for (const [day, list] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const dayStart = /** @type {number} */ (dayStartOf(day));
    const dayEnd = startOfDay(dayStart, 1);
    let total = 0;
    let started = Number.POSITIVE_INFINITY;
    for (const item of list) {
      total += item.ms;
      if (item.from < started) started = item.from;
    }
    const from =
      started >= dayStart && started < dayEnd
        ? started
        : /** @type {number} */ (combine(day, '09:00'));
    // Never past midnight, and today never past now.
    const limit = now > dayStart && now < dayEnd ? now : dayEnd;
    let cursor = Math.max(from, dayEnds.get(day) ?? from);
    if (cursor + total > limit) cursor = Math.max(dayStart, limit - total);
    for (const item of list) {
      addEntry(item.id, item.taskId, cursor, cursor + item.ms, item.note);
      cursor += item.ms;
    }
  }
  return plan;
}
