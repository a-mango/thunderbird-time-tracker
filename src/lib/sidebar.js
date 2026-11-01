// Pure model of the project pane (docs/DESIGN.md, Layout A: Sidebar): the project tree and its
// Archive root, running-project badges, move targets, drag-and-drop rules and view totals.

/**
 * @typedef {import('./types.js').Project} Project
 * @typedef {import('./types.js').Task} Task
 * @typedef {import('./rollup.js').Totals} Totals
 * @typedef {{id: string, label: string, children: SidebarNode[]}} SidebarNode
 *   Same shape as the tt-tree TreeNode.
 * @typedef {'before' | 'after' | 'inside'} DropPosition
 * @typedef {{parentId: string | null, beforeId: string | null}} MoveTarget for db moveProject
 */

/** Id of the Archive root row. Project ids are UUIDs, so it never collides. */
export const ARCHIVE_ID = 'tt-archive';

/** @param {Project} a @param {Project} b */
const siblingOrder = (a, b) =>
  a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name);

/**
 * Index of the tree: children by parent (sorted), and the effective parent of every project
 * (`null` for roots and orphans whose parent is missing).
 * @param {Project[]} projects
 */
function indexTree(projects) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  /** @type {Map<string | null, Project[]>} */
  const children = new Map();
  for (const project of projects) {
    const parent =
      project.parentId !== null && byId.has(project.parentId) ? project.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(project);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort(siblingOrder);
  return { byId, children };
}

/**
 * Builds the visible tree and the Archive. The tree holds projects that are not archived and
 * have no archived ancestor. The Archive holds each archived project whose ancestors are not
 * archived, with its whole subtree. Orphans count as roots; a stored cycle is cut where it closes.
 * @param {Project[]} projects
 * @returns {{nodes: SidebarNode[], archived: SidebarNode[]}}
 */
export function buildProjectTree(projects) {
  const { children } = indexTree(projects);
  const seen = new Set();
  /**
   * @param {string | null} parentId
   * @param {(project: Project) => boolean} include
   * @returns {SidebarNode[]}
   */
  const walk = (parentId, include) => {
    /** @type {SidebarNode[]} */
    const nodes = [];
    for (const project of children.get(parentId) ?? []) {
      if (!include(project) || seen.has(project.id)) continue;
      seen.add(project.id);
      nodes.push({ id: project.id, label: project.name, children: walk(project.id, include) });
    }
    return nodes;
  };
  const nodes = walk(null, (project) => !project.archived);

  /** @type {SidebarNode[]} */
  const archived = [];
  /** Archived projects reachable through visible parents, in tree order. */
  const findArchived = (/** @type {string | null} */ parentId) => {
    for (const project of children.get(parentId) ?? []) {
      if (project.archived) {
        if (seen.has(project.id)) continue;
        seen.add(project.id);
        archived.push({
          id: project.id,
          label: project.name,
          children: walk(project.id, () => true),
        });
      } else {
        findArchived(project.id);
      }
    }
  };
  findArchived(null);
  return { nodes, archived };
}

/**
 * Ids of every project in the subtree of `id`, itself included.
 * @param {Project[]} projects
 * @param {string} id
 */
export function subtreeIds(projects, id) {
  const { children } = indexTree(projects);
  const ids = new Set([id]);
  for (const current of ids) {
    for (const child of children.get(current) ?? []) ids.add(child.id);
  }
  return ids;
}

/**
 * The project and its known ancestors, from the project up (stops at a missing parent or a cycle).
 * @param {Project[]} projects
 * @param {string | null} id
 * @returns {string[]}
 */
export function ancestorPath(projects, id) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  /** @type {string[]} */
  const path = [];
  for (let cursor = id; cursor !== null && byId.has(cursor) && !path.includes(cursor);) {
    path.push(cursor);
    cursor = /** @type {Project} */ (byId.get(cursor)).parentId;
  }
  return path;
}

/**
 * Badge style of a project row, like Thunderbird's new-mail folders: `new` on the running
 * project, `outlined` on a collapsed ancestor of it, none otherwise.
 * @param {string} id
 * @param {{runningPath: string[], expanded: boolean}} state `runningPath` from `ancestorPath`
 * @returns {'new' | 'outlined' | null}
 */
export function badgeStyle(id, { runningPath, expanded }) {
  if (runningPath[0] === id) return 'new';
  if (!expanded && runningPath.includes(id)) return 'outlined';
  return null;
}

/**
 * Whether a project row shows its total. Like Thunderbird's account rows, an expanded top-level
 * project with subprojects shows none (its children carry the numbers); collapsed it shows the
 * rolled-up total. The running project always keeps its badge.
 * @param {{root: boolean, expanded: boolean, hasChildren: boolean, running: boolean}} row
 */
export function showsTotal({ root, expanded, hasChildren, running }) {
  return running || !(root && expanded && hasChildren);
}

/**
 * Projects `id` can move under, in tree order with their depth: visible projects outside its own
 * subtree. The UI adds the top level (`null`) itself.
 * @param {Project[]} projects
 * @param {string | null} id null when creating a project (every visible project qualifies)
 * @returns {{id: string, label: string, depth: number}[]}
 */
export function moveTargets(projects, id) {
  const excluded = id === null ? new Set() : subtreeIds(projects, id);
  /** @type {{id: string, label: string, depth: number}[]} */
  const targets = [];
  /** @param {SidebarNode[]} nodes @param {number} depth */
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      if (excluded.has(node.id)) continue;
      targets.push({ id: node.id, label: node.label, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(buildProjectTree(projects).nodes, 0);
  return targets;
}

/**
 * Whether dropping `dragId` at `position` of `targetId` is allowed. Both must be visible (not in
 * the Archive); the target can't be the dragged project or inside its subtree; dropping onto the
 * current parent is refused like in Thunderbird (nothing would change).
 * @param {Project[]} projects
 * @param {string} dragId
 * @param {string} targetId
 * @param {DropPosition} position
 */
export function canDrop(projects, dragId, targetId, position) {
  const visible = new Set(moveTargets(projects, null).map((target) => target.id));
  if (!visible.has(dragId) || !visible.has(targetId)) return false;
  if (subtreeIds(projects, dragId).has(targetId)) return false;
  const drag = projects.find((p) => p.id === dragId);
  return !(position === 'inside' && drag?.parentId === targetId);
}

/**
 * The `moveProject` target for a drop. `after` resolves to "before the next sibling" (siblings
 * in stored order, the dragged project left out), or last.
 * @param {Project[]} projects
 * @param {string} dragId
 * @param {string} targetId
 * @param {DropPosition} position
 * @returns {MoveTarget}
 */
export function dropTarget(projects, dragId, targetId, position) {
  if (position === 'inside') return { parentId: targetId, beforeId: null };
  const { byId, children } = indexTree(projects);
  const target = /** @type {Project} */ (byId.get(targetId));
  const parentId = target.parentId !== null && byId.has(target.parentId) ? target.parentId : null;
  if (position === 'before') return { parentId, beforeId: targetId };
  const siblings = (children.get(parentId) ?? []).filter((p) => p.id !== dragId);
  const next = siblings[siblings.findIndex((p) => p.id === targetId) + 1];
  return { parentId, beforeId: next?.id ?? null };
}

/**
 * Badge values of the Views: time today and this week over every task, and open starred tasks.
 * @param {Task[]} tasks
 * @param {(taskId: string) => Totals} totalsOf
 */
export function viewTotals(tasks, totalsOf) {
  let today = 0;
  let week = 0;
  let starred = 0;
  for (const task of tasks) {
    const totals = totalsOf(task.id);
    today += totals.today;
    week += totals.week;
    if (task.starred && task.status === 'open') starred += 1;
  }
  return { today, week, starred };
}
