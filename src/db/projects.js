// Projects repository: a folder-like tree via `parentId` (docs/SPEC.md, Data model).
import {
  CascadeRequiredError,
  InvariantError,
  NotFoundError,
  ValidationError,
} from '../lib/errors.js';
import { emit, req, tx } from './idb.js';
import { INDEXES, STORES } from './schema.js';
import { removeTasks } from './tasks.js';
import {
  checkBoolean,
  checkColor,
  checkFields,
  checkFinite,
  checkId,
  checkName,
  newId,
} from './validate.js';

/**
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {{now?: number}} WriteOptions
 * @typedef {{name?: string, color?: string, order?: number, parentId?: string|null,
 *            archived?: boolean}} ProjectPatch
 * @typedef {{project: Project, depth: number}} ProjectNode
 */

/** Colour of a new project unless one is given (the first tree colour of the reference design). */
/** @typedef {{projects: number, tasks: number, entries: number}} CascadeCounts */

export const DEFAULT_PROJECT_COLOR = '#2493ef';

/** @param {Project} a @param {Project} b */
const siblingOrder = (a, b) =>
  a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name);

/**
 * Depth-first tree order. Projects whose parent is missing are not reachable and left out.
 * @param {Project[]} projects
 * @returns {ProjectNode[]}
 */
export function projectTree(projects) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  /** @type {Map<string | null, Project[]>} */
  const children = new Map();
  for (const project of projects) {
    const parentId = effectiveParentId(project, byId);
    const siblings = children.get(parentId) ?? [];
    siblings.push(project);
    children.set(parentId, siblings);
  }
  /** @type {ProjectNode[]} */
  const nodes = [];
  /** @param {string | null} parentId @param {number} depth */
  const walk = (parentId, depth) => {
    for (const project of (children.get(parentId) ?? []).sort(siblingOrder)) {
      nodes.push({ project, depth });
      walk(project.id, depth + 1);
    }
  };
  walk(null, 0);
  return nodes;
}

/**
 * The parent a project behaves as having: its `parentId`, or `null` when that project doesn't
 * exist (an orphan from corrupt or hand-edited data counts as top level everywhere, #18).
 * @param {Project} project
 * @param {Map<string, Project>} byId
 * @returns {string | null}
 */
export function effectiveParentId(project, byId) {
  return project.parentId !== null && byId.has(project.parentId) ? project.parentId : null;
}

/**
 * Validates the patchable fields present in `fields`.
 * @param {Record<string, unknown>} fields
 * @returns {ProjectPatch}
 */
function checkPatch(fields) {
  /** @type {ProjectPatch} */
  const patch = {};
  if (fields.name !== undefined) patch.name = checkName(fields.name);
  if (fields.color !== undefined) patch.color = checkColor(fields.color);
  if (fields.order !== undefined) patch.order = checkFinite(fields.order, 'order');
  if (fields.archived !== undefined) patch.archived = checkBoolean(fields.archived, 'archived');
  if (fields.parentId !== undefined) {
    patch.parentId = fields.parentId === null ? null : checkId(fields.parentId, 'parentId');
  }
  return patch;
}

/**
 * @param {IDBObjectStore} projects
 * @param {string} id
 * @returns {Promise<Project>}
 */
async function requireProject(projects, id) {
  const project = await req(projects.get(id));
  if (!project) throw new NotFoundError('project', 'project not found', { id });
  return project;
}

/**
 * One more than the highest `order` among the children of `parentId` (root: `null`, which the
 * `parentId` index doesn't hold, hence the full scan; project counts are small).
 * @param {IDBObjectStore} projects
 * @param {string | null} parentId
 */
async function nextOrder(projects, parentId) {
  /** @type {Project[]} */
  const all = await req(projects.getAll());
  const byId = new Map(all.map((project) => [project.id, project]));
  return all
    .filter((project) => effectiveParentId(project, byId) === parentId)
    .reduce((max, project) => Math.max(max, project.order + 1), 0);
}

/**
 * Refuses `parentId` when it is `id` or one of its descendants. `parentId` must exist; above it,
 * a missing ancestor ends the walk (that project is an orphan and counts as top level).
 * @param {IDBObjectStore} projects
 * @param {string} id
 * @param {string | null} parentId
 * @throws {InvariantError} `cycle`
 * @throws {NotFoundError} `project`
 */
async function checkNoCycle(projects, id, parentId) {
  // `seen` stops the walk on a stored cycle (corrupt data) instead of looping forever.
  const seen = new Set();
  if (parentId !== null) await requireProject(projects, parentId);
  for (let cursor = parentId; cursor !== null;) {
    if (cursor === id || seen.has(cursor)) {
      throw new InvariantError('cycle', 'a project cannot move into its own subtree', { id });
    }
    seen.add(cursor);
    /** @type {Project | undefined} */
    const ancestor = await req(projects.get(cursor));
    cursor = ancestor ? ancestor.parentId : null;
  }
}

/**
 * Creates a project at the end of its siblings.
 * @param {IDBDatabase} db
 * @param {{name: string, parentId?: string|null, color?: string, order?: number}} input
 * @param {WriteOptions} [options]
 * @returns {Promise<Project>}
 * @throws {ValidationError}
 * @throws {NotFoundError} `project` (parent)
 */
export async function createProject(db, input, { now = Date.now() } = {}) {
  const fields = checkFields(input, ['name', 'parentId', 'color', 'order']);
  const patch = checkPatch({ ...fields, name: checkName(fields.name) });
  const parentId = patch.parentId ?? null;
  const project = await tx(db, STORES.projects, 'readwrite', async ({ projects }) => {
    if (parentId !== null) await requireProject(projects, parentId);
    /** @type {Project} */
    const created = {
      id: newId(),
      parentId,
      name: /** @type {string} */ (patch.name),
      color: patch.color ?? DEFAULT_PROJECT_COLOR,
      order: patch.order ?? (await nextOrder(projects, parentId)),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await req(projects.add(created));
    return created;
  });
  emit(db, { type: 'projects', ids: [project.id] });
  return project;
}

/**
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<Project | null>}
 */
export async function getProject(db, id) {
  return (
    (await tx(db, STORES.projects, 'readonly', ({ projects }) => req(projects.get(id)))) ?? null
  );
}

/**
 * Every project in tree order (depth-first, siblings by `order`), archived ones included.
 * Orphans (parent missing) are roots; projects in a stored cycle, unreachable from a root, come
 * last.
 * @param {IDBDatabase} db
 * @returns {Promise<Project[]>}
 */
export async function listProjects(db) {
  /** @type {Project[]} */
  const all = await tx(db, STORES.projects, 'readonly', ({ projects }) => req(projects.getAll()));
  const ordered = projectTree(all).map((node) => node.project);
  const reached = new Set(ordered);
  return [...ordered, ...all.filter((project) => !reached.has(project)).sort(siblingOrder)];
}

/**
 * Edits a project. Changing `parentId` reparents it (appended to the new siblings unless `order`
 * is given); a parent inside its own subtree is refused.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {ProjectPatch} patch
 * @param {WriteOptions} [options]
 * @returns {Promise<Project>}
 * @throws {ValidationError}
 * @throws {NotFoundError} `project`
 * @throws {InvariantError} `cycle`
 */
export async function updateProject(db, id, patch, { now = Date.now() } = {}) {
  const clean = checkPatch(checkFields(patch, ['name', 'parentId', 'color', 'order', 'archived']));
  const project = await tx(db, STORES.projects, 'readwrite', async ({ projects }) => {
    const current = await requireProject(projects, id);
    const next = { ...current, ...clean, updatedAt: now };
    if (clean.parentId !== undefined && clean.parentId !== current.parentId) {
      await checkNoCycle(projects, id, clean.parentId);
      if (clean.order === undefined) next.order = await nextOrder(projects, clean.parentId);
    }
    await req(projects.put(next));
    return next;
  });
  emit(db, { type: 'projects', ids: [id] });
  return project;
}

/**
 * Moves a project under `parentId` (root: `null`), just before its sibling `beforeId`, or last
 * when `beforeId` is null. The new siblings are renumbered 0, 1, 2… in the same transaction, so
 * drag-and-drop reorders never collide; the old siblings keep their (gapped) order.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {{parentId: string | null, beforeId?: string | null}} target
 * @param {WriteOptions} [options]
 * @returns {Promise<Project>} the moved project
 * @throws {ValidationError} `before` when `beforeId` is not a child of `parentId` (or is `id`)
 * @throws {NotFoundError} `project`
 * @throws {InvariantError} `cycle`
 */
export async function moveProject(db, id, target, { now = Date.now() } = {}) {
  const fields = checkFields(target, ['parentId', 'beforeId']);
  const parentId = fields.parentId === null ? null : checkId(fields.parentId, 'parentId');
  const beforeId =
    fields.beforeId === undefined || fields.beforeId === null
      ? null
      : checkId(fields.beforeId, 'beforeId');
  const changed = await tx(db, STORES.projects, 'readwrite', async ({ projects }) => {
    const current = await requireProject(projects, id);
    await checkNoCycle(projects, id, parentId);
    /** @type {Project[]} */
    const all = await req(projects.getAll());
    const byId = new Map(all.map((project) => [project.id, project]));
    // Orphans are top-level siblings (#18); renumbering stores their parent as `null`.
    const siblings = all
      .filter((project) => effectiveParentId(project, byId) === parentId && project.id !== id)
      .sort(siblingOrder);
    const index =
      beforeId === null ? siblings.length : siblings.findIndex((p) => p.id === beforeId);
    if (index < 0) {
      throw new ValidationError('before', 'beforeId must be a sibling at the target', { beforeId });
    }
    siblings.splice(index, 0, { ...current, parentId });
    /** @type {Project[]} */
    const updated = [];
    for (const [order, project] of siblings.entries()) {
      const moved = project.id === id;
      if (!moved && project.order === order && project.parentId === parentId) continue;
      const next = { ...project, parentId, order, updatedAt: moved ? now : project.updatedAt };
      await req(projects.put(next));
      updated.push(next);
    }
    return updated;
  });
  emit(db, { type: 'projects', ids: changed.map((project) => project.id) });
  return /** @type {Project} */ (changed.find((project) => project.id === id));
}

/**
 * Hides a project from views (its subtree too, in the UI); its time still counts in totals.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {WriteOptions} [options]
 */
export function archiveProject(db, id, options) {
  return updateProject(db, id, { archived: true }, options);
}

/**
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {WriteOptions} [options]
 */
export function unarchiveProject(db, id, options) {
  return updateProject(db, id, { archived: false }, options);
}

/**
 * Deletes a project. If it has subprojects or tasks, `{cascade: true}` is required and removes
 * the whole subtree (projects, tasks, entries, soft-deleted ones too) in one transaction; the
 * running pointer is cleared if its entry goes. `expected` (the counts the user confirmed) makes
 * the cascade refuse, in the same transaction, if the subtree changed meanwhile.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {{cascade?: boolean, expected?: CascadeCounts}} [options]
 * @returns {Promise<{projects: string[], tasks: string[], entries: string[]}>} removed ids
 * @throws {NotFoundError} `project`
 * @throws {CascadeRequiredError} `cascade`; `details` (CascadeCounts) counts subprojects, tasks
 *   and live entries. Also when `expected` no longer matches.
 */
export async function deleteProject(db, id, { cascade = false, expected } = {}) {
  const removed = await tx(
    db,
    [STORES.projects, STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async (stores) => {
      await requireProject(stores.projects, id);
      /** @type {string[]} */
      const projectIds = [id];
      for (let i = 0; i < projectIds.length; i += 1) {
        const children = await req(
          stores.projects.index(INDEXES.projectParent).getAllKeys(projectIds[i]),
        );
        // Skip ids already queued, so a stored cycle (corrupt data) can't grow the walk forever.
        projectIds.push(...children.map(String).filter((child) => !projectIds.includes(child)));
      }
      /** @type {string[]} */
      const taskIds = [];
      for (const projectId of projectIds) {
        const keys = await req(stores.tasks.index(INDEXES.taskProject).getAllKeys(projectId));
        taskIds.push(...keys.map(String));
      }
      const hasContent = projectIds.length > 1 || taskIds.length > 0;
      if ((hasContent && !cascade) || expected) {
        let entries = 0;
        for (const taskId of taskIds) {
          /** @type {import('../lib/types.js').Entry[]} */
          const rows = await req(stores.entries.index(INDEXES.entryTask).getAll(taskId));
          entries += rows.filter((entry) => entry.deletedAt === null).length;
        }
        /** @type {CascadeCounts} */
        const counts = { projects: projectIds.length - 1, tasks: taskIds.length, entries };
        const changed =
          expected &&
          (expected.projects !== counts.projects ||
            expected.tasks !== counts.tasks ||
            expected.entries !== counts.entries);
        if ((hasContent && !cascade) || changed) {
          throw new CascadeRequiredError(
            'cascade',
            changed ? 'the project changed since it was confirmed' : 'the project has content',
            counts,
          );
        }
      }
      const entries = await removeTasks(stores, taskIds);
      for (const projectId of projectIds) await req(stores.projects.delete(projectId));
      return { projects: projectIds, tasks: taskIds, entries };
    },
  );
  emit(
    db,
    { type: 'projects', ids: removed.projects },
    { type: 'tasks', ids: removed.tasks },
    { type: 'entries', ids: removed.entries },
  );
  return removed;
}
