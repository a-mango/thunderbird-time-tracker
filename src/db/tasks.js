// Tasks repository (docs/SPEC.md, Data model). Status changes go through markTaskDone/reopenTask
// and project changes through moveTask, so updateTask only edits plain fields.
import { CascadeRequiredError, NotFoundError } from '../lib/errors.js';
import { readRunning, removeEntriesOfTasks, stopRunningIn } from './entries.js';
import { emit, req, tx } from './idb.js';
import { INDEXES, STORES } from './schema.js';
import {
  LIMITS,
  checkBoolean,
  checkFields,
  checkFinite,
  checkId,
  checkInteger,
  checkName,
  checkString,
  checkTags,
  newId,
} from './validate.js';

/**
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {import('./entries.js').TimerStop} TimerStop
 * @typedef {{now?: number}} WriteOptions
 * @typedef {{name?: string, starred?: boolean, estimateMin?: number|null, billable?: boolean,
 *            tags?: string[], notes?: string, order?: number}} TaskPatch
 */

const EDITABLE = ['name', 'starred', 'estimateMin', 'billable', 'tags', 'notes', 'order'];

/**
 * Validates the editable fields present in `fields`.
 * @param {Record<string, unknown>} fields
 * @returns {TaskPatch}
 */
function checkPatch(fields) {
  /** @type {TaskPatch} */
  const patch = {};
  if (fields.name !== undefined) patch.name = checkName(fields.name);
  if (fields.starred !== undefined) patch.starred = checkBoolean(fields.starred, 'starred');
  if (fields.billable !== undefined) patch.billable = checkBoolean(fields.billable, 'billable');
  if (fields.notes !== undefined) patch.notes = checkString(fields.notes, 'notes');
  if (fields.order !== undefined) patch.order = checkFinite(fields.order, 'order');
  if (fields.estimateMin !== undefined) {
    patch.estimateMin =
      fields.estimateMin === null
        ? null
        : checkInteger(fields.estimateMin, 'estimateMin', 0, LIMITS.estimateMin);
  }
  if (fields.tags !== undefined) patch.tags = checkTags(fields.tags);
  return patch;
}

/**
 * One more than the highest `order` among the tasks of a project.
 * @param {IDBObjectStore} tasks
 * @param {string} projectId
 */
async function nextOrder(tasks, projectId) {
  /** @type {Task[]} */
  const siblings = await req(tasks.index(INDEXES.taskProject).getAll(projectId));
  return siblings.reduce((max, task) => Math.max(max, task.order + 1), 0);
}

/**
 * @param {IDBObjectStore} projects
 * @param {string} projectId
 */
async function requireProject(projects, projectId) {
  const project = await req(projects.get(projectId));
  if (!project) throw new NotFoundError('project', 'project not found', { id: projectId });
  return project;
}

/**
 * @param {IDBObjectStore} tasks
 * @param {string} id
 * @returns {Promise<Task>}
 */
async function requireTask(tasks, id) {
  const task = await req(tasks.get(id));
  if (!task) throw new NotFoundError('task', 'task not found', { id });
  return task;
}

/** @param {Task[]} tasks */
const byOrder = (tasks) => tasks.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

/**
 * Creates an open task at the end of its project.
 * @param {IDBDatabase} db
 * @param {TaskPatch & {projectId: string, name: string}} input
 * @param {WriteOptions} [options]
 * @returns {Promise<Task>}
 * @throws {ValidationError}
 * @throws {NotFoundError} `project`
 */
export async function createTask(db, input, { now = Date.now() } = {}) {
  const fields = checkFields(input, ['projectId', ...EDITABLE]);
  const projectId = checkId(fields.projectId, 'projectId');
  const patch = checkPatch({ ...fields, name: checkName(fields.name) });
  const task = await tx(
    db,
    [STORES.projects, STORES.tasks],
    'readwrite',
    async ({ projects, tasks }) => {
      await requireProject(projects, projectId);
      /** @type {Task} */
      const created = {
        id: newId(),
        projectId,
        name: /** @type {string} */ (patch.name),
        status: 'open',
        starred: patch.starred ?? false,
        estimateMin: patch.estimateMin ?? null,
        billable: patch.billable ?? false,
        tags: patch.tags ?? [],
        notes: patch.notes ?? '',
        order: patch.order ?? (await nextOrder(tasks, projectId)),
        createdAt: now,
        updatedAt: now,
        doneAt: null,
      };
      await req(tasks.add(created));
      return created;
    },
  );
  emit(db, { type: 'tasks', ids: [task.id] });
  return task;
}

/**
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<Task | null>}
 */
export async function getTask(db, id) {
  return (await tx(db, STORES.tasks, 'readonly', ({ tasks }) => req(tasks.get(id)))) ?? null;
}

/**
 * Every task, by `order`.
 * @param {IDBDatabase} db
 * @returns {Promise<Task[]>}
 */
export async function listTasks(db) {
  return byOrder(await tx(db, STORES.tasks, 'readonly', ({ tasks }) => req(tasks.getAll())));
}

/**
 * Tasks of one project (not its subprojects), by `order`.
 * @param {IDBDatabase} db
 * @param {string} projectId
 * @returns {Promise<Task[]>}
 */
export async function listTasksByProject(db, projectId) {
  return byOrder(
    await tx(db, STORES.tasks, 'readonly', ({ tasks }) =>
      req(tasks.index(INDEXES.taskProject).getAll(projectId)),
    ),
  );
}

/**
 * Applies `change` to a stored task in one readwrite transaction.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {(task: Task, tasks: IDBObjectStore) => Promise<Task> | Task} change
 */
async function modify(db, id, change) {
  const task = await tx(db, [STORES.projects, STORES.tasks], 'readwrite', async (stores) => {
    const next = await change(await requireTask(stores.tasks, id), stores.tasks);
    await req(stores.tasks.put(next));
    return next;
  });
  emit(db, { type: 'tasks', ids: [id] });
  return task;
}

/**
 * Edits name, star, estimate, billable, tags, notes or order.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {TaskPatch} patch
 * @param {WriteOptions} [options]
 * @returns {Promise<Task>}
 * @throws {ValidationError}
 * @throws {NotFoundError} `task`
 */
export async function updateTask(db, id, patch, { now = Date.now() } = {}) {
  const clean = checkPatch(checkFields(patch, EDITABLE));
  return modify(db, id, (task) => ({ ...task, ...clean, updatedAt: now }));
}

/**
 * Marks a task done; its running timer (if any) stops at `now` in the same transaction.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {WriteOptions} [options]
 * @returns {Promise<{task: Task, stopped: TimerStop | null}>}
 * @throws {NotFoundError} `task`
 */
export async function markTaskDone(db, id, { now = Date.now() } = {}) {
  const result = await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async ({ tasks, entries, meta }) => {
      const task = await requireTask(tasks, id);
      const running = await readRunning({ entries, meta });
      const stopped =
        running?.taskId === id ? await stopRunningIn({ entries, meta }, running, now) : null;
      /** @type {Task} */
      const done = { ...task, status: 'done', doneAt: task.doneAt ?? now, updatedAt: now };
      await req(tasks.put(done));
      return { task: done, stopped };
    },
  );
  emit(
    db,
    { type: 'tasks', ids: [id] },
    { type: 'entries', ids: result.stopped ? [result.stopped.entry.id] : [] },
  );
  return result;
}

/**
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {WriteOptions} [options]
 * @returns {Promise<Task>}
 * @throws {NotFoundError} `task`
 */
export async function reopenTask(db, id, { now = Date.now() } = {}) {
  return modify(db, id, (task) => ({ ...task, status: 'open', doneAt: null, updatedAt: now }));
}

/**
 * Moves a task to another project, at the end of its tasks.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {string} projectId
 * @param {WriteOptions} [options]
 * @returns {Promise<Task>}
 * @throws {NotFoundError} `task`, `project`
 */
export async function moveTask(db, id, projectId, { now = Date.now() } = {}) {
  checkId(projectId, 'projectId');
  return tx(db, [STORES.projects, STORES.tasks], 'readwrite', async ({ projects, tasks }) => {
    const task = await requireTask(tasks, id);
    await requireProject(projects, projectId);
    if (task.projectId === projectId) return task;
    const moved = { ...task, projectId, order: await nextOrder(tasks, projectId), updatedAt: now };
    await req(tasks.put(moved));
    return moved;
  }).then((task) => {
    emit(db, { type: 'tasks', ids: [id] });
    return task;
  });
}

/**
 * Removes tasks and all their entries inside the caller's transaction (cascade helper).
 * @param {{tasks: IDBObjectStore, entries: IDBObjectStore, meta: IDBObjectStore}} stores
 * @param {string[]} taskIds
 * @returns {Promise<string[]>} removed entry ids
 */
export async function removeTasks(stores, taskIds) {
  const entries = await removeEntriesOfTasks(stores, taskIds);
  for (const id of taskIds) await req(stores.tasks.delete(id));
  return entries;
}

/**
 * Deletes a task. A task with live entries needs `{cascade: true}`, which removes them in the same
 * transaction (and stops tracking if one was running). Soft-deleted entries go with the task.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {{cascade?: boolean}} [options]
 * @returns {Promise<{tasks: string[], entries: string[]}>} removed ids
 * @throws {NotFoundError} `task`
 * @throws {CascadeRequiredError} `cascade`, `details.entries` = live entry count
 */
export async function deleteTask(db, id, { cascade = false } = {}) {
  const removed = await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async (stores) => {
      await requireTask(stores.tasks, id);
      /** @type {import('../lib/types.js').Entry[]} */
      const entries = await req(stores.entries.index(INDEXES.entryTask).getAll(id));
      const live = entries.filter((entry) => entry.deletedAt === null).length;
      if (live > 0 && !cascade) {
        throw new CascadeRequiredError('cascade', 'the task has time entries', { entries: live });
      }
      return { tasks: [id], entries: await removeTasks(stores, [id]) };
    },
  );
  emit(db, { type: 'tasks', ids: removed.tasks }, { type: 'entries', ids: removed.entries });
  return removed;
}
