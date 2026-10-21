import { countEntries, listProjects, listTasks, openDB, projectTree } from '../db/index.js';

/** @typedef {{projects: {id: string, name: string, depth: number}[], taskCount: number, entryCount: number}} Summary */

/**
 * Summary for the tracker page: every project in tree order with its depth (archived ones
 * included, orphans left out), the number of tasks and of live (not soft-deleted) entries.
 * @param {IDBDatabase} db
 * @returns {Promise<Summary>}
 */
export async function summarize(db) {
  const [projects, tasks, entryCount] = await Promise.all([
    listProjects(db),
    listTasks(db),
    countEntries(db),
  ]);
  return {
    projects: projectTree(projects).map(({ project, depth }) => ({
      id: project.id,
      name: project.name,
      depth,
    })),
    taskCount: tasks.length,
    entryCount,
  };
}

/**
 * Answers `tt:summary` from a fresh connection that is closed afterwards (the event page keeps no
 * state, and an idle connection would only block schema upgrades).
 * @param {() => Promise<IDBDatabase>} openDb
 * @returns {Promise<Summary>}
 */
async function answerSummary(openDb) {
  const db = await openDb();
  try {
    return await summarize(db);
  } finally {
    db.close();
  }
}

/**
 * Handles runtime messages from extension pages. Returns `undefined` for messages it doesn't
 * answer (including `tt:changed` pings) so other listeners can.
 * @param {any} message
 * @param {{openDb?: () => Promise<IDBDatabase>}} [options]
 * @returns {Promise<Summary> | undefined}
 */
export function handleMessage(message, { openDb = () => openDB() } = {}) {
  if (message?.type === 'tt:summary') return answerSummary(openDb);
  return undefined;
}
