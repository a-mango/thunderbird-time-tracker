// Native context menu on project, task and entry rows (docs/DESIGN.md, Components; M1 spike):
// the background owns hidden items (background/menus.js). A right-click on a row overrides
// Thunderbird's menu, and onShown makes the items for that row visible. onShown/onClicked fire in
// every extension page, so each page acts only when the menu's target element is in its own
// document.
import {
  COLOR_ITEM_PREFIX,
  ENTRY_MENU,
  MENU,
  TASK_MENU,
  colorIconPath,
} from '../background/menus.js';
import { PALETTE } from '../lib/palette.js';
import { t } from './i18n.js';
import { commandsFor, projectPlace } from './project-commands.js';

/**
 * @typedef {import('./components/tt-tree.js').TtTree} TtTree
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('./project-commands.js').ProjectCommand} ProjectCommand
 * @typedef {import('./task-commands.js').TaskCommand} TaskCommand
 * @typedef {import('./entry-commands.js').EntryCommand} EntryCommand
 * @typedef {{kind: 'project' | 'task' | 'entry', id: string}} MenuTarget
 */

/** @type {Record<string, ProjectCommand>} */
const PROJECT_COMMANDS = {
  [MENU.newSubproject]: 'new-sub',
  [MENU.rename]: 'edit',
  [MENU.color]: 'color',
  [MENU.moveTo]: 'move',
  [MENU.archive]: 'archive',
  [MENU.unarchive]: 'unarchive',
  [MENU.delete]: 'delete',
};

/** @type {Record<string, TaskCommand>} */
const TASK_COMMANDS = {
  [TASK_MENU.start]: 'timer',
  [TASK_MENU.stop]: 'timer',
  [TASK_MENU.edit]: 'edit',
  [TASK_MENU.rename]: 'rename',
  [TASK_MENU.star]: 'star',
  [TASK_MENU.unstar]: 'star',
  [TASK_MENU.done]: 'done',
  [TASK_MENU.reopen]: 'done',
  [TASK_MENU.move]: 'move',
  [TASK_MENU.delete]: 'delete',
};

/** @type {Record<string, EntryCommand>} */
const ENTRY_COMMANDS = {
  [ENTRY_MENU.edit]: 'edit',
  [ENTRY_MENU.split]: 'split',
  [ENTRY_MENU.duplicate]: 'duplicate',
  [ENTRY_MENU.delete]: 'delete',
};

/**
 * @param {{
 *   tree: TtTree,
 *   table: HTMLElement,
 *   taskAt: (element: Element) => string | null,
 *   data: TrackerData,
 *   run: (command: ProjectCommand, id: string, value?: string) => unknown,
 *   runTask: (command: TaskCommand, id: string) => unknown,
 *   focusTask: (id: string) => void,
 *   entries: HTMLElement,
 *   entryAt: (element: Element) => string | null,
 *   runEntry: (command: EntryCommand, id: string) => unknown,
 *   focusEntry: (id: string) => void,
 * }} options
 */
export function installContextMenu({
  tree,
  table,
  taskAt,
  data,
  run,
  runTask,
  focusTask,
  entries,
  entryAt,
  runEntry,
  focusEntry,
}) {
  const menus = messenger.menus;

  /**
   * The row under `element` in this page, or null.
   * @param {Element} element
   * @returns {MenuTarget | null}
   */
  const rowOf = (element) => {
    const projectId = tree.contains(element) ? tree.itemIdAt(element) : null;
    if (projectId && data.project(projectId)) return { kind: 'project', id: projectId };
    const taskId = table.contains(element) ? taskAt(element) : null;
    if (taskId && data.tasks.has(taskId)) return { kind: 'task', id: taskId };
    const entryId = entries.contains(element) ? entryAt(element) : null;
    if (entryId) return { kind: 'entry', id: entryId };
    return null;
  };

  /**
   * The row of a menu's target in this document; `undefined` when the target is in another
   * document (another tab, Thunderbird's own UI), `null` for a non-row in ours.
   * @param {{targetElementId?: number}} info
   */
  const targetOf = (info) => {
    if (info.targetElementId === undefined) return undefined;
    const element = menus.getTargetElement(info.targetElementId);
    if (!element || element.ownerDocument !== document) return undefined;
    return rowOf(element);
  };

  /**
   * Shows the items that apply to `target` (none for null) and checks the project colour.
   * @param {MenuTarget | null} target
   */
  const sync = (target) => {
    const project = target?.kind === 'project' ? data.project(target.id) : undefined;
    const projectCommands = project ? commandsFor(projectPlace(data.projects, project.id)) : [];
    const color = project?.color.toLowerCase();
    const task = target?.kind === 'task' ? data.tasks.get(target.id) : undefined;
    const running = task !== undefined && data.running?.taskId === task.id;
    /** @type {Set<string>} */
    const taskItems = new Set(
      task
        ? [
            running ? TASK_MENU.stop : TASK_MENU.start,
            TASK_MENU.edit,
            TASK_MENU.rename,
            task.starred ? TASK_MENU.unstar : TASK_MENU.star,
            task.status === 'done' ? TASK_MENU.reopen : TASK_MENU.done,
            TASK_MENU.move,
            TASK_MENU.separator,
            TASK_MENU.delete,
          ]
        : [],
    );
    return Promise.all([
      ...Object.entries(PROJECT_COMMANDS).map(([item, command]) =>
        menus.update(item, { visible: projectCommands.includes(command) }),
      ),
      menus.update(MENU.separator, { visible: projectCommands.length > 0 }),
      ...Object.values(TASK_MENU).map((item) =>
        menus.update(item, { visible: taskItems.has(item) }),
      ),
      ...Object.values(ENTRY_MENU).map((item) =>
        menus.update(item, { visible: target?.kind === 'entry' }),
      ),
      ...PALETTE.map((p) => {
        const current = p.color === color;
        return menus.update(`${COLOR_ITEM_PREFIX}${p.color}`, {
          // The title says it too: screen readers don't see the icon.
          title: current ? t('menuColorCurrent', t(p.label)) : t(p.label),
          icons: { 16: colorIconPath(p.color, { current }) },
        });
      }),
    ]);
  };

  /** @param {MouseEvent} event */
  const onContextMenu = (event) => {
    const target = rowOf(/** @type {Element} */ (event.target));
    if (!target) return;
    if (target.kind === 'project') tree.focusItem(target.id);
    else if (target.kind === 'task') focusTask(target.id);
    else focusEntry(target.id);
    // Must run during the event; only the menu that opens next is affected.
    menus.overrideContext({ showDefaults: false });
    sync(target).catch(logMenuError);
  };
  tree.addEventListener('contextmenu', onContextMenu);
  table.addEventListener('contextmenu', onContextMenu);
  entries.addEventListener('contextmenu', onContextMenu);

  menus.onShown.addListener((info) => {
    const target = targetOf(info);
    if (target === undefined) return undefined;
    return sync(target)
      .then(() => menus.refresh())
      .catch(logMenuError);
  });

  menus.onClicked.addListener((info) => {
    const target = targetOf(info);
    if (!target) return;
    const item = String(info.menuItemId);
    if (target.kind === 'entry') {
      const command = ENTRY_COMMANDS[item];
      if (command) runEntry(command, target.id);
      return;
    }
    if (target.kind === 'task') {
      const command = TASK_COMMANDS[item];
      if (command) runTask(command, target.id);
      return;
    }
    if (item.startsWith(COLOR_ITEM_PREFIX)) {
      run('color', target.id, item.slice(COLOR_ITEM_PREFIX.length));
      return;
    }
    const command = PROJECT_COMMANDS[item];
    if (command && command !== 'color') run(command, target.id);
  });
}

/** @param {unknown} error */
function logMenuError(error) {
  console.error('time tracker: context menu update failed', error);
}
