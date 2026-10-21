// IndexedDB names for schema v1 (docs/SPEC.md, Data model). Only migrations create stores and
// indexes; everything else refers to them through these constants.

export const DB_NAME = 'time-tracker';

export const STORES = Object.freeze({
  projects: 'projects',
  tasks: 'tasks',
  entries: 'entries',
  meta: 'meta',
  links: 'links',
});

export const INDEXES = Object.freeze({
  /** projects.parentId (root projects have `null` and are not in the index). */
  projectParent: 'parentId',
  /** tasks.projectId */
  taskProject: 'projectId',
  /** entries.taskId */
  entryTask: 'taskId',
  /** entries.start */
  entryStart: 'start',
  /** entries.end: the running entry (`end === null`) is not in it. */
  entryEnd: 'end',
  /** entries.deletedAt: only soft-deleted entries are in it. */
  entryDeleted: 'deletedAt',
  /** links.taskId (S1) */
  linkTask: 'taskId',
});

/** Out-of-line keys of the `meta` store. */
export const META = Object.freeze({
  schemaVersion: 'schemaVersion',
  settings: 'settings',
  /** Id of the running entry or `null`. Written in the same transaction as the entry. */
  running: 'running',
});
