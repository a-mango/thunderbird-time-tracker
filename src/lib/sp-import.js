// Super Productivity backups (S7): reads the JSON backup Super Productivity exports (Settings ›
// Sync & Backup › Export data) into an ImportBatch for lib/import-batch.js. Super Productivity
// keeps time per task and day (`timeSpentOnDay`), not start/end entries, so each task-day becomes
// a day total that the core places from when work started that day.
//
// The file is untrusted: only own properties are read, every value is checked, records are built
// fresh, and bad values are counted and left out instead of failing the whole file.
import { combine } from './entry-form.js';
import { ImportError } from './errors.js';
import { BACKUP_FORMAT, exceedsBytes } from './importer.js';
import { LIMITS } from './limits.js';
import { nearestPaletteColor, PALETTE } from './palette.js';
import { dayKey, dayStartOf } from './time.js';

/**
 * @typedef {import('./import-batch.js').ImportBatch} ImportBatch
 * @typedef {import('./import-batch.js').BatchProject} BatchProject
 * @typedef {import('./import-batch.js').BatchTask} BatchTask
 * @typedef {import('./import-batch.js').DayTotal} DayTotal
 * @typedef {Record<string, unknown>} Obj
 *
 * @typedef {object} SpSummary what the backup holds
 * @property {number | null} exportedAt
 * @property {number} folders
 * @property {number} projects
 * @property {number} tasks
 * @property {number} entries task-days with time
 * @property {{from: number, to: number} | null} range start of the first and the last such day
 */

/** Largest Super Productivity backup accepted, in UTF-8 bytes (its archives can be large). */
export const MAX_SP_BYTES = 50 * 1024 * 1024;

/** Longest Super Productivity id kept: derived ids (`sp-e-<id>-YYYY-MM-DD`) stay in LIMITS.id. */
const MAX_SP_ID = 80;
const DAY_MS = 86_400_000;
const INBOX_ID = 'INBOX_PROJECT';
/** Virtual tag every task worked on today carries; not a real tag. */
const TODAY_TAG = 'TODAY';
const SUBTASK_SEPARATOR = ' › ';
/** A parent's own time below this, once its subtasks' time is taken off, is left out. */
const MIN_OWN_MS = 60_000;
/** Day totals below a second (a start and an immediate stop) are left out. */
const MIN_DAY_MS = 1000;

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  throw new ImportError(code, message, { path: '' });
}

/** @param {unknown} value @returns {value is Obj} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} obj @param {string} key */
const own = (obj, key) => (isObject(obj) && Object.hasOwn(obj, key) ? obj[key] : undefined);

/** @param {unknown} value */
const spId = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_SP_ID ? value : null;

/** @param {unknown} value @returns {number | null} */
const timeOf = (value) =>
  Number.isSafeInteger(value) &&
  /** @type {number} */ (value) >= 0 &&
  /** @type {number} */ (value) <= LIMITS.time
    ? /** @type {number} */ (value)
    : null;

/** @param {unknown} value @returns {unknown[]} */
const list = (value) => (Array.isArray(value) ? value : []);

/** One line, trimmed, cut to `max`. @param {unknown} value @param {number} max */
const line = (value, max) =>
  typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, max).trim() : '';

/**
 * Records of an ngrx entity state `{ids, entities}`: in `ids` order, then the other entities, each
 * with its id (the record's own `id`, else its key). Records without a usable id are counted.
 * @param {unknown} state
 * @param {{skipped: number}} counter
 * @returns {{id: string, record: Obj}[]}
 */
function records(state, counter) {
  const table = own(state, 'entities');
  if (!isObject(table)) return [];
  const keys = [
    ...list(own(state, 'ids')).filter((key) => typeof key === 'string'),
    ...Object.keys(table),
  ];
  /** @type {Set<unknown>} */
  const seen = new Set();
  /** @type {{id: string, record: Obj}[]} */
  const out = [];
  for (const key of /** @type {string[]} */ (keys)) {
    if (seen.has(key) || !Object.hasOwn(table, key)) continue;
    seen.add(key);
    const record = table[key];
    if (!isObject(record)) continue;
    const id = spId(own(record, 'id')) ?? spId(key);
    if (id === null) counter.skipped += 1;
    else out.push({ id, record });
  }
  return out;
}

/**
 * Parses a Super Productivity backup (the `{timestamp, crossModelVersion, data}` file, or bare
 * `data`) into an import batch.
 * - Menu tree folders become parent projects; projects keep their folder, archive state and the
 *   nearest palette colour. Tasks without a known project go to the Inbox.
 * - Subtasks become `Parent › Subtask` tasks; a parent becomes a task of its own only when it has
 *   time beyond its subtasks' (Super Productivity adds subtask time to the parent).
 * - Archived tasks are imported as done. Tag titles become task tags (not the virtual Today tag).
 * - Each task-day with time becomes a day total starting when work started that day (the Today
 *   tag's work start, else the earliest project's, else 09:00).
 * - Ids derive from Super Productivity's (`sp-f-`, `sp-p-`, `sp-t-`, `sp-e-<task>-<day>`), so a
 *   later import of a newer backup finds what an earlier one added.
 * @param {string} text
 * @param {{untitled: string, inbox: string, maxBytes?: number}} options `untitled` names records
 *   with a blank title; `inbox` names the Inbox when the backup has none
 * @returns {{batch: ImportBatch, summary: SpSummary, skipped: number}} `skipped` counts values
 *   left out because they couldn't be read
 * @throws {ImportError} `too-large`, `json`, `time-tracker-backup` (our own format: restore it
 *   instead) or `format` (not a Super Productivity backup)
 */
export function parseSuperProductivity(text, { untitled, inbox, maxBytes = MAX_SP_BYTES }) {
  if (typeof text !== 'string') fail('format', 'not text');
  if (exceedsBytes(text, maxBytes)) fail('too-large', 'backup too large');
  /** @type {unknown} */
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    fail('json', 'malformed JSON');
  }
  if (!isObject(root)) fail('format', 'not a Super Productivity backup');
  if (own(root, 'format') === BACKUP_FORMAT) fail('time-tracker-backup', 'a Time Tracker backup');
  const wrapped = Object.hasOwn(root, 'crossModelVersion') && isObject(own(root, 'data'));
  const data = wrapped ? own(root, 'data') : root;
  const taskState = own(data, 'task');
  const projectState = own(data, 'project');
  if (!isObject(own(taskState, 'entities')) || !isObject(own(projectState, 'entities'))) {
    fail('format', 'not a Super Productivity backup');
  }

  const counter = { skipped: 0 };
  /** @param {unknown} value */
  const nameOf = (value) => line(value, LIMITS.name) || untitled;

  // ---- projects and folders ----
  /** @type {Map<string, Obj>} */
  const spProjects = new Map();
  for (const { id, record } of records(projectState, counter)) {
    if (!spProjects.has(id)) spProjects.set(id, record);
  }
  /** @type {BatchProject[]} */
  const projects = [];
  /** Super Productivity project id → key of its folder (null: top level), in menu order. */
  /** @type {Map<string, string | null>} */
  const folderOf = new Map();
  let folders = 0;
  /** @type {Set<string>} */
  const folderKeys = new Set();
  /** @param {unknown} nodes @param {string | null} parentKey @param {number} depth */
  const walk = (nodes, parentKey, depth) => {
    if (depth > 32) return;
    for (const node of list(nodes)) {
      const id = spId(own(node, 'id'));
      if (id === null) continue;
      const kind = own(node, 'k');
      if (kind === 'f') {
        const key = `sp-f-${id}`;
        if (folderKeys.has(key)) continue;
        folderKeys.add(key);
        projects.push({
          key,
          id: key,
          parentKey,
          name: nameOf(own(node, 'name')),
          color: PALETTE[0].color,
          archived: false,
        });
        folders += 1;
        walk(own(node, 'children'), key, depth + 1);
      } else if (kind === 'p' && spProjects.has(id) && !folderOf.has(id)) {
        folderOf.set(id, parentKey);
      }
    }
  };
  walk(own(own(data, 'menuTree'), 'projectTree'), null, 0);
  for (const id of spProjects.keys()) if (!folderOf.has(id)) folderOf.set(id, null);
  for (const [id, parentKey] of folderOf) {
    const project = /** @type {Obj} */ (spProjects.get(id));
    projects.push({
      key: `sp-p-${id}`,
      id: `sp-p-${id}`,
      parentKey,
      name: nameOf(own(project, 'title')),
      color: nearestPaletteColor(own(own(project, 'theme'), 'primary')),
      archived: own(project, 'isArchived') === true,
    });
  }

  // ---- tags and work starts ----
  /** @type {Map<string, string>} */
  const tagTitles = new Map();
  for (const { id, record } of records(own(data, 'tag'), counter)) {
    const title = line(own(record, 'title'), LIMITS.tag);
    if (id !== TODAY_TAG && title !== '') tagTitles.set(id, title);
  }
  /** Work start per day: from the Today tag, else the earliest project's. */
  /** @type {Map<string, number>} */
  const todayStarts = new Map();
  /** @type {Map<string, number>} */
  const projectStarts = new Map();
  /** @param {unknown} days @param {Map<string, number>} into */
  const scanStarts = (days, into) => {
    if (!isObject(days)) return;
    for (const [day, value] of Object.entries(days)) {
      const start = timeOf(own(value, 's'));
      if (start !== null && dayKey(start) === day)
        into.set(day, Math.min(into.get(day) ?? start, start));
    }
  };
  const archives = [own(data, 'archiveYoung'), own(data, 'archiveOld')];
  for (const tracking of [
    own(data, 'timeTracking'),
    ...archives.map((a) => own(a, 'timeTracking')),
  ]) {
    scanStarts(own(own(tracking, 'tag'), TODAY_TAG), todayStarts);
    const byProject = own(tracking, 'project');
    if (isObject(byProject))
      for (const days of Object.values(byProject)) scanStarts(days, projectStarts);
  }
  /** @param {string} day */
  const workStart = (day) =>
    todayStarts.get(day) ?? projectStarts.get(day) ?? /** @type {number} */ (combine(day, '09:00'));

  // ---- tasks ----
  /** @type {Map<string, {record: Obj, archived: boolean}>} */
  const spTasks = new Map();
  const taskStates = [[taskState, false], ...archives.map((a) => [own(a, 'task'), true])];
  for (const [state, archived] of taskStates) {
    for (const { id, record } of records(state, counter)) {
      if (!spTasks.has(id)) spTasks.set(id, { record, archived: archived === true });
    }
  }
  /** The task's parent when that task exists (and isn't itself). @param {string} id */
  const rawParent = (id) => {
    const parentId = spId(own(spTasks.get(id)?.record, 'parentId'));
    return parentId !== null && parentId !== id && spTasks.has(parentId) ? parentId : null;
  };
  /**
   * One level, like Super Productivity: a parent that has a parent of its own doesn't count (a
   * dangling grandparent id doesn't make the parent a subtask, so its time isn't counted twice).
   * @param {string} id
   */
  const parentOf = (id) => {
    const parentId = rawParent(id);
    return parentId !== null && rawParent(parentId) === null ? parentId : null;
  };
  /** Position in the project's task lists, for the order of tasks. */
  /** @type {Map<string, number>} */
  const listed = new Map();
  for (const project of spProjects.values()) {
    const ids = [...list(own(project, 'taskIds')), ...list(own(project, 'backlogTaskIds'))];
    ids.forEach((id, index) => {
      if (typeof id === 'string' && !listed.has(id)) listed.set(id, index);
    });
  }
  /** @param {string} id */
  const created = (id) => timeOf(own(spTasks.get(id)?.record, 'created')) ?? 0;
  /** @type {Map<string, string[]>} */
  const children = new Map();
  /** Top-level tasks per project key. */
  /** @type {Map<string, string[]>} */
  const topLevel = new Map();
  let needInbox = false;
  for (const [id, { record }] of spTasks) {
    const parentId = parentOf(id);
    if (parentId !== null) {
      const siblings = children.get(parentId);
      if (siblings) siblings.push(id);
      else children.set(parentId, [id]);
      continue;
    }
    const projectId = spId(own(record, 'projectId'));
    const known = projectId !== null && spProjects.has(projectId);
    if (!known) needInbox = true;
    const key = `sp-p-${known ? projectId : INBOX_ID}`;
    const tasksOfProject = topLevel.get(key);
    if (tasksOfProject) tasksOfProject.push(id);
    else topLevel.set(key, [id]);
  }
  if (needInbox && !spProjects.has(INBOX_ID)) {
    projects.push({
      key: `sp-p-${INBOX_ID}`,
      id: `sp-p-${INBOX_ID}`,
      parentKey: null,
      name: nameOf(inbox),
      color: PALETTE[0].color,
      archived: false,
    });
  }

  /**
   * Valid day totals of a task (zero days are skipped quietly, bad ones counted).
   * @param {Obj} record
   * @returns {Map<string, number>}
   */
  const daysOf = (record) => {
    /** @type {Map<string, number>} */
    const days = new Map();
    const spent = own(record, 'timeSpentOnDay');
    if (!isObject(spent)) return days;
    for (const [day, ms] of Object.entries(spent)) {
      if (ms === 0) continue;
      if (dayStartOf(day) === null || typeof ms !== 'number' || !(ms > 0 && ms <= DAY_MS)) {
        counter.skipped += 1;
      } else {
        days.set(day, Math.round(ms));
      }
    }
    return days;
  };

  /** @type {BatchTask[]} */
  const tasks = [];
  /** @type {DayTotal[]} */
  const entries = [];
  /**
   * @param {string} id Super Productivity task id
   * @param {string} projectKey
   * @param {string} name
   * @param {Map<string, number>} days
   */
  const addTask = (id, projectKey, name, days) => {
    const { record, archived } = /** @type {{record: Obj, archived: boolean}} */ (spTasks.get(id));
    const done = own(record, 'isDone') === true || archived;
    const estimate = own(record, 'timeEstimate');
    /** @type {string[]} */
    const tags = [];
    for (const tagId of list(own(record, 'tagIds'))) {
      const title = typeof tagId === 'string' ? tagTitles.get(tagId) : undefined;
      if (title !== undefined && !tags.includes(title) && tags.length < LIMITS.tags)
        tags.push(title);
    }
    const notes = own(record, 'notes');
    const key = `sp-t-${id}`;
    tasks.push({
      key,
      id: key,
      projectKey,
      name: name.slice(0, LIMITS.name).trim(),
      status: done ? 'done' : 'open',
      doneAt: done ? timeOf(own(record, 'doneOn')) : null,
      estimateMin:
        typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0
          ? Math.min(LIMITS.estimateMin, Math.round(estimate / 60_000)) || null
          : null,
      notes: typeof notes === 'string' ? notes.slice(0, LIMITS.text) : '',
      tags,
      billable: false,
    });
    for (const [day, ms] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      if (ms < MIN_DAY_MS) continue;
      entries.push({
        id: `sp-e-${id}-${day}`,
        taskKey: key,
        note: '',
        day,
        ms,
        from: workStart(day),
      });
    }
  };

  /** @param {string} id */
  const archivedRank = (id) => (spTasks.get(id)?.archived ? 1 : 0);
  /** @param {string} a @param {string} b */
  const byPosition = (a, b) =>
    (listed.get(a) ?? Infinity) - (listed.get(b) ?? Infinity) ||
    archivedRank(a) - archivedRank(b) ||
    created(a) - created(b) ||
    a.localeCompare(b);
  for (const project of projects) {
    for (const id of (topLevel.get(project.key) ?? []).sort(byPosition)) {
      const record = /** @type {Obj} */ (spTasks.get(id)?.record);
      const name = nameOf(own(record, 'title'));
      const days = daysOf(record);
      const subtaskOrder = list(own(record, 'subTaskIds'));
      /** @param {string} sub */
      const subRank = (sub) => {
        const index = subtaskOrder.indexOf(sub);
        return index === -1 ? Infinity : index;
      };
      const subs = (children.get(id) ?? []).sort(
        (a, b) => subRank(a) - subRank(b) || created(a) - created(b) || a.localeCompare(b),
      );
      if (subs.length === 0) {
        addTask(id, project.key, name, days);
        continue;
      }
      const subDays = subs.map((sub) => daysOf(/** @type {Obj} */ (spTasks.get(sub)?.record)));
      /** @type {Map<string, number>} */
      const ownDays = new Map();
      for (const [day, ms] of days) {
        const rest = ms - subDays.reduce((sum, d) => sum + (d.get(day) ?? 0), 0);
        if (rest >= MIN_OWN_MS) ownDays.set(day, rest);
      }
      if (ownDays.size > 0) addTask(id, project.key, name, ownDays);
      subs.forEach((sub, i) => {
        const subName = nameOf(own(spTasks.get(sub)?.record, 'title'));
        // A long parent title is cut first, so its subtasks keep distinct names.
        const room = Math.max(0, LIMITS.name - SUBTASK_SEPARATOR.length - subName.length);
        const prefix = name.length > room ? name.slice(0, room).trim() : name;
        addTask(sub, project.key, `${prefix}${SUBTASK_SEPARATOR}${subName}`, subDays[i]);
      });
    }
  }

  // Day keys sort like dates; no spread of a possibly huge array into Math.min.
  const sortedDays = entries.map((entry) => entry.day).sort();
  return {
    batch: { projects, tasks, entries },
    summary: {
      exportedAt: wrapped ? timeOf(own(root, 'timestamp')) : null,
      folders,
      projects: projects.length - folders,
      tasks: tasks.length,
      entries: entries.length,
      range:
        sortedDays.length > 0
          ? {
              from: /** @type {number} */ (dayStartOf(sortedDays[0])),
              to: /** @type {number} */ (dayStartOf(sortedDays[sortedDays.length - 1])),
            }
          : null,
    },
    skipped: counter.skipped,
  };
}
