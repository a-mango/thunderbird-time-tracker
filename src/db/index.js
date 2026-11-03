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
  moveProject,
  projectTree,
  unarchiveProject,
  updateProject,
} from './projects.js';
export {
  createTask,
  deleteTask,
  editTask,
  getTask,
  listTasks,
  listTasksByProject,
  markTaskDone,
  moveTask,
  reopenTask,
  restoreTask,
  updateTask,
} from './tasks.js';
export {
  addEntry,
  countEntries,
  getEntry,
  getRunning,
  lastTrackedTask,
  listEntries,
  listEntriesByTask,
  listEntriesInRange,
  purgeDeleted,
  restoreEntry,
  softDeleteEntry,
  splitEntry,
  updateEntry,
} from './entries.js';
export { getSettings, updateSettings } from './settings.js';
