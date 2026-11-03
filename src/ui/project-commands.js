// Project commands, shared by the native context menu, the Projects menu, keyboard shortcuts and
// drag and drop. Writes go through db/; the sidebar updates from the change notifications.
import {
  archiveProject,
  createProject,
  deleteProject,
  effectiveParentId,
  moveProject,
  unarchiveProject,
  updateProject,
} from '../db/index.js';
import { CascadeRequiredError } from '../lib/errors.js';
import { ancestorPath, subtreeIds } from '../lib/sidebar.js';
import { confirmDelete, moveDialog, projectDialog } from './project-dialogs.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {'new' | 'new-sub' | 'edit' | 'color' | 'move' | 'archive' | 'unarchive' | 'delete'}
 *   ProjectCommand
 * @typedef {'active' | 'archived-root' | 'archived'} ProjectPlace
 *   Where a project shows: the tree, the top of the Archive, or deeper inside the Archive.
 */

/**
 * @param {Project[]} projects
 * @param {string} id
 * @returns {ProjectPlace}
 */
export function projectPlace(projects, id) {
  const [, ...ancestors] = ancestorPath(projects, id);
  const byId = new Map(projects.map((p) => [p.id, p]));
  if (ancestors.some((ancestor) => byId.get(ancestor)?.archived)) return 'archived';
  return byId.get(id)?.archived ? 'archived-root' : 'active';
}

/**
 * Commands that apply to a project in its place, in menu order.
 * @param {ProjectPlace} place
 * @returns {ProjectCommand[]}
 */
export function commandsFor(place) {
  if (place === 'active') return ['new-sub', 'edit', 'color', 'move', 'archive', 'delete'];
  if (place === 'archived-root') return ['edit', 'color', 'unarchive', 'delete'];
  return ['edit', 'color', 'delete'];
}

/**
 * @param {{
 *   data: TrackerData,
 *   reveal: (id: string) => void,
 *   onError: (error: unknown) => void,
 * }} options `reveal` selects and focuses a project row once the sidebar shows it
 */
export function createProjectCommands({ data, reveal, onError }) {
  /** The parent the tree shows: `null` for an orphan whose parent is missing. @param {Project} project */
  const parentOf = (project) =>
    effectiveParentId(project, new Map(data.projects.map((p) => [p.id, p])));
  /** @param {string} id */
  const projectOf = (id) => data.project(id);

  /**
   * @param {ProjectCommand} command
   * @param {string | null} id the project (null for `new`)
   * @param {string} [value] the colour for `color`
   */
  async function run(command, id, value) {
    try {
      const project = id ? projectOf(id) : undefined;
      if (command === 'new' || command === 'new-sub') {
        const input = await projectDialog(data.projects, {
          parentId: command === 'new-sub' ? (project?.id ?? null) : null,
        });
        if (!input) return;
        const created = await createProject(data.db, input);
        await shown(created.id);
        return;
      }
      if (!project) return;
      const place = projectPlace(data.projects, project.id);
      if (!commandsFor(place).includes(command)) return;
      switch (command) {
        case 'edit': {
          const input = await projectDialog(data.projects, {
            project,
            archived: place !== 'active',
          });
          if (!input) return;
          const { parentId, ...patch } = input;
          // The move can fail (another tab deleted the parent): then nothing is saved. An
          // orphan shows as top level, so keeping "top level" is no move (#18).
          if (parentId !== parentOf(project)) {
            await moveProject(data.db, project.id, { parentId });
          }
          await updateProject(data.db, project.id, patch);
          await shown(project.id);
          return;
        }
        case 'color':
          if (value) await updateProject(data.db, project.id, { color: value });
          return;
        case 'move': {
          const target = await moveDialog(data.projects, project);
          if (!target || target.parentId === parentOf(project)) return;
          await moveProject(data.db, project.id, target);
          await shown(project.id);
          return;
        }
        case 'archive':
          await archiveProject(data.db, project.id);
          return;
        case 'unarchive':
          await unarchiveProject(data.db, project.id);
          await shown(project.id);
          return;
        case 'delete':
          await remove(project);
          return;
      }
    } catch (error) {
      onError(error);
    }
  }

  /** @param {string} id */
  async function shown(id) {
    await data.settled();
    reveal(id);
  }

  /**
   * Plain confirmation (if the setting asks for it) for an empty project; the cascade dialog,
   * with counts from db/, as soon as anything would go with it. The cascade only deletes what
   * the user confirmed: if another page changed the subtree meanwhile, db/ refuses and the
   * dialog asks again with the new counts.
   * @param {Project} project
   */
  async function remove(project) {
    const hasContent =
      subtreeIds(data.projects, project.id).size > 1 ||
      [...data.tasks.values()].some((task) => task.projectId === project.id);
    /** @type {import('../db/projects.js').CascadeCounts | undefined} */
    let expected;
    if (!hasContent) {
      if (data.settings.confirmDelete && !(await confirmDelete(project, null))) return;
      expected = { projects: 0, tasks: 0, entries: 0 };
    }
    for (;;) {
      try {
        // Without `expected`, nothing is deleted when there is content; the error has the counts.
        await deleteProject(data.db, project.id, expected ? { cascade: true, expected } : {});
        return;
      } catch (error) {
        if (!(error instanceof CascadeRequiredError)) throw error;
        const counts = /** @type {import('../db/projects.js').CascadeCounts} */ (error.details);
        if (!(await confirmDelete(project, counts))) return;
        expected = counts;
      }
    }
  }

  /**
   * Drag and drop: moves `id` to the db target computed by lib/sidebar.js.
   * @param {string} id
   * @param {{parentId: string | null, beforeId: string | null}} target
   */
  async function drop(id, target) {
    try {
      await moveProject(data.db, id, target);
      await shown(id);
    } catch (error) {
      onError(error);
    }
  }

  return { run, drop };
}
