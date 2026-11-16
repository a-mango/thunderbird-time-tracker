// Imports from other apps (S7): writes an ImportBatch (lib/import-batch.js) in one transaction.
// The batch is matched against the data read in that same transaction, so the preview, which runs
// the same matching on a read snapshot, can't go stale in a way that breaks the write. Only adds
// records: existing ones are never changed, and nothing runs afterwards.
import { InvariantError, ValidationError } from '../lib/errors.js';
import { resolveBatch } from '../lib/import-batch.js';
import { touchTasks } from './aggregates.js';
import { emit, req, tx } from './idb.js';
import { STORES } from './schema.js';
import {
  checkBoolean,
  checkColor,
  checkFinite,
  checkId,
  checkInteger,
  checkName,
  checkString,
  checkTags,
  checkTime,
  LIMITS,
  newId,
} from './validate.js';

/**
 * @typedef {import('../lib/import-batch.js').ImportBatch} ImportBatch
 * @typedef {import('../lib/import-batch.js').ImportPlan} ImportPlan
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {import('../lib/types.js').Entry} Entry
 */

const READ = [STORES.projects, STORES.tasks, STORES.entries];

/**
 * Every stored project, task and entry (soft-deleted entries too: their ids are taken).
 * @param {{projects: IDBObjectStore, tasks: IDBObjectStore, entries: IDBObjectStore}} stores
 */
async function snapshot({ projects, tasks, entries }) {
  const [p, t, e] = await Promise.all([
    req(projects.getAll()),
    req(tasks.getAll()),
    req(entries.getAll()),
  ]);
  return { projects: p, tasks: t, entries: e };
}

/** @param {string} value */
const checkTrimmedName = (value) => {
  if (checkName(value) !== value) throw new ValidationError('name', 'name must be trimmed');
  return value;
};

/** @param {number | null} value @param {string} code */
const nullableTime = (value, code) => (value === null ? null : checkTime(value, code));

/**
 * The repositories' checks on a record the import is about to add (defence in depth: the core
 * builds them, but a bad one must abort the transaction, not reach the store).
 * @param {Project} project
 */
function checkProject(project) {
  checkId(project.id, 'id');
  if (project.parentId !== null) checkId(project.parentId, 'parentId');
  checkTrimmedName(project.name);
  checkColor(project.color);
  checkFinite(project.order, 'order');
  checkBoolean(project.archived, 'archived');
  if (project.hourlyRate !== null) throw new ValidationError('hourlyRate', 'not imported');
  checkTime(project.createdAt, 'createdAt');
  checkTime(project.updatedAt, 'updatedAt');
}

/** @param {Task} task */
function checkTask(task) {
  checkId(task.id, 'id');
  checkId(task.projectId, 'projectId');
  checkTrimmedName(task.name);
  if (task.status !== 'open' && task.status !== 'done') {
    throw new ValidationError('status', 'status must be open or done');
  }
  checkBoolean(task.starred, 'starred');
  checkBoolean(task.billable, 'billable');
  if (task.estimateMin !== null) {
    checkInteger(task.estimateMin, 'estimateMin', 1, LIMITS.estimateMin);
  }
  checkTags(task.tags);
  checkString(task.notes, 'notes');
  checkFinite(task.order, 'order');
  checkTime(task.createdAt, 'createdAt');
  checkTime(task.updatedAt, 'updatedAt');
  nullableTime(task.doneAt, 'doneAt');
}

/** @param {Entry} entry */
function checkEntry(entry) {
  checkId(entry.id, 'id');
  checkId(entry.taskId, 'taskId');
  const start = checkTime(entry.start, 'start');
  const end = checkTime(entry.end, 'end');
  if (!(start < end)) throw new InvariantError('start-end', 'start must be before end');
  checkString(entry.note, 'note');
  if (entry.source !== 'manual') throw new ValidationError('source', 'imports are manual');
  checkTime(entry.createdAt, 'createdAt');
  checkTime(entry.updatedAt, 'updatedAt');
  if (entry.deletedAt !== null) throw new ValidationError('deletedAt', 'imports are live');
}

/**
 * What `importBatch` would add right now, for the preview. Runs the same matching on a read
 * snapshot; fresh ids differ from the write's.
 * @param {IDBDatabase} db
 * @param {ImportBatch} batch
 * @param {{now?: number}} [options]
 * @returns {Promise<ImportPlan>}
 */
export function previewBatch(db, batch, { now = Date.now() } = {}) {
  return tx(db, READ, 'readonly', async (stores) =>
    resolveBatch(batch, await snapshot(stores), { now, newId }),
  );
}

/**
 * Adds the batch's new projects, tasks and entries in one transaction (all or nothing), updates
 * the touched tasks' aggregates, then tells open pages to reload (`reset`, like a restore).
 * Never writes a running entry, so the running pointer stays as it is.
 * @param {IDBDatabase} db
 * @param {ImportBatch} batch
 * @param {{now?: number}} [options]
 * @returns {Promise<ImportPlan>} what was added (and reused, skipped, dropped)
 * @throws {ValidationError | InvariantError} a record fails the repositories' checks; nothing
 *   is written
 */
export async function importBatch(db, batch, { now = Date.now() } = {}) {
  const plan = await tx(db, [...READ, STORES.meta], 'readwrite', async (stores) => {
    const result = resolveBatch(batch, await snapshot(stores), { now, newId });
    result.projects.forEach(checkProject);
    result.tasks.forEach(checkTask);
    result.entries.forEach(checkEntry);
    for (const project of result.projects) stores.projects.add(project);
    for (const task of result.tasks) stores.tasks.add(task);
    for (const entry of result.entries) stores.entries.add(entry);
    await touchTasks(stores, new Set(result.entries.map((entry) => entry.taskId)));
    return result;
  });
  if (plan.projects.length + plan.tasks.length + plan.entries.length > 0) {
    emit(db, { type: 'reset', ids: ['*'] });
  }
  return plan;
}
