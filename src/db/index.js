// Public data layer for pages and the background. Repositories take the IDBDatabase from
// `openDB` as first argument; writes notify open pages after commit (see changes.js).
export { DB_NAME } from './schema.js';
export { LATEST_VERSION, openDB } from './idb.js';
export { CHANNEL_NAME, notifyChanged } from './changes.js';
export {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  projectTree,
  unarchiveProject,
  updateProject,
} from './projects.js';
export {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  listTasksByProject,
  markTaskDone,
  moveTask,
  reopenTask,
  updateTask,
} from './tasks.js';
export {
  addEntry,
  countEntries,
  getEntry,
  getRunning,
  listEntriesByTask,
  listEntriesInRange,
  purgeDeleted,
  restoreEntry,
  softDeleteEntry,
  updateEntry,
} from './entries.js';
export { getSettings, updateSettings } from './settings.js';
