// The project pane (docs/DESIGN.md, Layout A: Sidebar): header buttons, the Views and Projects
// trees with live time badges, one selection across both trees, drag and drop and shortcuts.
import { formatDuration } from '../lib/format.js';
import { colorValue } from '../lib/palette.js';
import {
  ARCHIVE_ID,
  ancestorPath,
  badgeStyle,
  buildProjectTree,
  canDrop,
  dropTarget,
  showsTotal,
  viewTotals,
} from '../lib/sidebar.js';
import { t } from './i18n.js';
import { getLayout, setLayout } from './layout-store.js';
import { showMenu } from './menu.js';
import { commandsFor, projectPlace } from './project-commands.js';
import { el, icon } from './render.js';
import { TASK_DRAG_TYPE } from './task-list.js';

/**
 * @typedef {import('./components/tt-tree.js').TtTree} TtTree
 * @typedef {import('./components/tt-tree.js').TreeNode} TreeNode
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('./project-commands.js').ProjectCommand} ProjectCommand
 * @typedef {{tree: 'views' | 'projects', id: string}} Selection
 */

const SELECTION_KEY = 'tracker.selection';
/** @type {Selection} */
const DEFAULT_SELECTION = { tree: 'views', id: 'today' };

const VIEWS = /** @type {const} */ ([
  { id: 'today', label: 'viewToday', icon: 'calendar-today' },
  { id: 'week', label: 'viewThisWeek', icon: 'calendar' },
  { id: 'starred', label: 'viewStarred', icon: 'star' },
]);

/** Menu labels of the project commands (Projects menu). */
/** @type {Partial<Record<ProjectCommand, string>>} */
const COMMAND_LABELS = {
  'new-sub': 'menuNewSubproject',
  edit: 'menuRename',
  move: 'menuMoveTo',
  archive: 'menuArchive',
  unarchive: 'menuUnarchive',
  delete: 'menuDelete',
};

/** @param {unknown} value @returns {value is Selection} */
const isSelection = (value) =>
  typeof value === 'object' &&
  value !== null &&
  ['views', 'projects'].includes(/** @type {any} */ (value).tree) &&
  typeof (/** @type {any} */ (value).id) === 'string';

/**
 * @param {{
 *   data: TrackerData,
 *   run: (command: ProjectCommand, id: string | null, value?: string) => unknown,
 *   drop: (id: string, target: {parentId: string | null, beforeId: string | null}) => unknown,
 *   taskDrag: {draggingId: () => string | null, drop: (taskId: string, projectId: string) => unknown},
 *   onSelect: (selection: Selection) => void,
 *   openSettings: () => unknown,
 *   exportCsv: () => unknown,
 * }} options
 */
export function createSidebar({ data, run, drop, taskDrag, onSelect, openSettings, exportCsv }) {
  /** @param {string} name */
  const ref = (name) => /** @type {HTMLElement} */ (document.querySelector(`[data-ref="${name}"]`));
  const viewsTree = /** @type {TtTree} */ (document.getElementById('views-tree'));
  const projectsTree = /** @type {TtTree} */ (document.getElementById('projects-tree'));
  const stored = getLayout(SELECTION_KEY);
  /** @type {Selection} */
  let selection = isSelection(stored) ? stored : DEFAULT_SELECTION;
  /** Parent of the selected project: selected instead if the project disappears. */
  /** @type {string | null} */
  let selectedParent = null;
  let initialized = false;

  // ---- Header ----
  ref('new-task').prepend(icon('add'));
  ref('add-entry').append(icon('clock'));
  ref('more').append(icon('more'));
  const projectsMore = ref('projects-more');
  projectsMore.append(icon('kebab'));
  const projectsMoreLabel = t('modeOptions', t('modeProjects'));
  projectsMore.setAttribute('aria-label', projectsMoreLabel);
  projectsMore.title = projectsMoreLabel;

  ref('more').addEventListener('click', async () => {
    const value = await showMenu(ref('more'), [
      { label: t('menuNewProject'), value: 'new' },
      'separator',
      { label: t('menuExport'), value: 'export' },
      { label: t('menuSettings'), value: 'settings' },
    ]);
    if (value === 'new') run('new', null);
    else if (value === 'settings') openSettings();
    else if (value === 'export') exportCsv();
  });

  projectsMore.addEventListener('click', async () => {
    const id = selection.tree === 'projects' && data.project(selection.id) ? selection.id : null;
    const commands = id ? commandsFor(projectPlace(data.projects, id)) : [];
    const items = commands.flatMap((command) => {
      const label = COMMAND_LABELS[command];
      return label ? [{ label: t(label), value: command }] : [];
    });
    const value = await showMenu(projectsMore, [
      { label: t('menuNewProject'), value: 'new' },
      ...(items.length ? /** @type {const} */ (['separator']) : []),
      ...items,
    ]);
    if (value === 'new') run('new', null);
    else if (value && id) run(/** @type {ProjectCommand} */ (value), id);
  });

  // ---- Views ----
  /** @type {{today: number, week: number, starred: number}} */
  let totals = { today: 0, week: 0, starred: 0 };
  viewsTree.renderRow = (node, content) => {
    const view = /** @type {(typeof VIEWS)[number]} */ (VIEWS.find((v) => v.id === node.id));
    const value =
      view.id === 'starred' ? totals.starred : view.id === 'today' ? totals.today : totals.week;
    content.append(
      icon(view.icon, { class: `view-icon ${view.id}` }),
      el('span', { class: 'name', text: node.label }),
    );
    if (value > 0) {
      content.append(
        el('span', {
          class: 'count-badge num',
          text: view.id === 'starred' ? String(value) : duration(value),
        }),
      );
    }
  };

  // ---- Projects ----
  /** Ids shown inside the Archive root. */
  let inArchive = new Set();
  /** @type {string[]} */
  let runningPath = [];
  projectsTree.renderRow = (node, content) => {
    const li = /** @type {HTMLElement} */ (content.closest('li'));
    const project = data.project(node.id);
    const archived = node.id === ARCHIVE_ID || inArchive.has(node.id);
    li.classList.toggle('muted', archived);
    li.classList.toggle('root', Boolean(project) && !archived && project?.parentId === null);
    li.classList.toggle('running', runningPath[0] === node.id);
    const folder = icon('folder');
    if (project && !archived) folder.style.setProperty('--icon-color', colorValue(project.color));
    content.append(folder, el('span', { class: 'name', text: node.label }));
    if (!project) return;
    const total = data.rollup.project(node.id).total;
    const expanded = projectsTree.isExpanded(node.id);
    const shown = showsTotal({
      root: !archived && project.parentId === null,
      expanded,
      hasChildren: (node.children?.length ?? 0) > 0,
      running: runningPath[0] === node.id,
    });
    if (total <= 0 || !shown) return;
    const badge = el('span', { class: 'count-badge num', text: duration(total) });
    const style = badgeStyle(node.id, { runningPath, expanded });
    if (style) badge.classList.add(style);
    content.append(badge);
  };
  projectsTree.canDrag = (id) => id !== ARCHIVE_ID && !inArchive.has(id);
  projectsTree.canDrop = (id, targetId, position) =>
    targetId !== ARCHIVE_ID && canDrop(data.projects, id, targetId, position);
  projectsTree.addEventListener('tt-drop', (event) => {
    const { id, targetId, position } = /** @type {CustomEvent} */ (event).detail;
    drop(id, dropTarget(data.projects, id, targetId, position));
  });
  // A task row dropped on a project moves the task there; its own project and archived ones refuse.
  projectsTree.externalType = TASK_DRAG_TYPE;
  projectsTree.canDropExternal = (targetId) => {
    const task = data.tasks.get(taskDrag.draggingId() ?? '');
    return Boolean(
      task && data.project(targetId) && !inArchive.has(targetId) && task.projectId !== targetId,
    );
  };
  projectsTree.addEventListener('tt-drop-external', (event) => {
    const taskId = taskDrag.draggingId();
    const { targetId } = /** @type {CustomEvent} */ (event).detail;
    if (taskId) taskDrag.drop(taskId, targetId);
  });
  projectsTree.addEventListener('tt-activate', (event) => {
    const { id } = /** @type {CustomEvent} */ (event).detail;
    if (data.project(id)) run('edit', id);
  });
  projectsTree.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (/** @type {Element} */ (event.target).getAttribute('role') !== 'treeitem') return;
    const id = projectsTree.selectedId;
    if (!id || !data.project(id)) return;
    if (event.key === 'F2') run('edit', id);
    else if (event.key === 'Delete') run('delete', id);
    else return;
    event.preventDefault();
  });

  // ---- Selection: one across both trees ----
  /** @param {Selection} next */
  const select = (next) => {
    selection = next;
    selectedParent = next.tree === 'projects' ? (data.project(next.id)?.parentId ?? null) : null;
    setLayout(SELECTION_KEY, next);
    if (next.tree === 'views') projectsTree.selectedId = null;
    else viewsTree.selectedId = null;
    onSelect(next);
  };
  viewsTree.addEventListener('tt-select', (event) => {
    select({ tree: 'views', id: /** @type {CustomEvent} */ (event).detail.id });
  });
  projectsTree.addEventListener('tt-select', (event) => {
    select({ tree: 'projects', id: /** @type {CustomEvent} */ (event).detail.id });
  });

  /** @param {number} ms */
  function duration(ms) {
    return formatDuration(ms, { format: data.settings.durationFormat });
  }

  /** Re-renders both trees from `data`, keeping selection, focus and scroll. */
  function render() {
    totals = viewTotals([...data.tasks.values()], (id) => data.rollup.task(id));
    viewsTree.setItems(VIEWS.map((view) => ({ id: view.id, label: t(view.label) })));

    const { nodes, archived } = buildProjectTree(data.projects);
    inArchive = new Set();
    /** @param {TreeNode[]} list */
    const collect = (list) => {
      for (const node of list) {
        inArchive.add(node.id);
        collect(node.children ?? []);
      }
    };
    collect(archived);
    runningPath = ancestorPath(data.projects, data.runningProjectId);
    /** @param {TreeNode[]} list @returns {TreeNode[]} */
    const expandAll = (list) =>
      list.map((node) => ({ ...node, expanded: true, children: expandAll(node.children ?? []) }));
    const items = expandAll(nodes);
    if (archived.length > 0) {
      items.push({
        id: ARCHIVE_ID,
        label: t('projectArchive'),
        expanded: false,
        children: archived,
      });
    }
    projectsTree.setItems(items);
    projectsTree.hidden = items.length === 0;
    ref('projects-empty').hidden = items.length > 0;

    if (initialized && selection.tree === 'projects') {
      if (projectsTree.selectedId === null) selectFallback();
      else selectedParent = data.project(selection.id)?.parentId ?? null;
    }
  }

  /** The selected project is gone (deleted, maybe in another tab): its parent, else Today. */
  function selectFallback() {
    // The removed row had focus (a keyboard delete): the fallback takes it, not <body>.
    const focusLost = !document.activeElement || document.activeElement === document.body;
    const parent = selectedParent;
    if (parent && data.project(parent)) {
      if (focusLost) projectsTree.focusItem(parent);
      else projectsTree.selectedId = parent;
      select({ tree: 'projects', id: parent });
      return;
    }
    if (focusLost) viewsTree.focusItem(DEFAULT_SELECTION.id);
    else viewsTree.selectedId = DEFAULT_SELECTION.id;
    select(DEFAULT_SELECTION);
  }

  /** Selects and focuses a project row (after it was created or moved). @param {string} id */
  function reveal(id) {
    projectsTree.focusItem(id);
  }

  render();
  const tree = selection.tree === 'views' ? viewsTree : projectsTree;
  tree.selectedId = selection.id;
  if (tree.selectedId === null) {
    viewsTree.selectedId = DEFAULT_SELECTION.id;
    select(DEFAULT_SELECTION);
  } else {
    select(selection);
  }
  initialized = true;

  return {
    render,
    reveal,
    projectsTree,
    get selection() {
      return selection;
    },
  };
}
