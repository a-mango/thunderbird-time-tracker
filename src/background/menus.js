// Native context menu items for the project tree, the task table and the entry list (docs/DESIGN.md, Components). The background
// owns the items; the tracker page shows them with menus.overrideContext() on a right-click on a
// project row and handles onShown/onClicked itself (ui/context-menu.js).
import { PALETTE } from '../lib/palette.js';
import { TRACKER_PATH } from './space.js';

/** Item ids; the page maps them to project commands. */
export const MENU = Object.freeze({
  newSubproject: 'tt-project-new-subproject',
  rename: 'tt-project-rename',
  color: 'tt-project-color',
  moveTo: 'tt-project-move',
  separator: 'tt-project-separator',
  archive: 'tt-project-archive',
  unarchive: 'tt-project-unarchive',
  delete: 'tt-project-delete',
});

/** Task row items (task table in the tracker). */
export const TASK_MENU = Object.freeze({
  start: 'tt-task-start',
  stop: 'tt-task-stop',
  edit: 'tt-task-edit',
  rename: 'tt-task-rename',
  star: 'tt-task-star',
  unstar: 'tt-task-unstar',
  done: 'tt-task-done',
  reopen: 'tt-task-reopen',
  move: 'tt-task-move',
  separator: 'tt-task-separator',
  delete: 'tt-task-delete',
});

/** Time entry rows (detail pane). */
export const ENTRY_MENU = Object.freeze({
  edit: 'tt-entry-edit',
  split: 'tt-entry-split',
  duplicate: 'tt-entry-duplicate',
  separator: 'tt-entry-separator',
  delete: 'tt-entry-delete',
});

/** Prefix of the colour radio items: `tt-project-color:#rrggbb`. */
export const COLOR_ITEM_PREFIX = `${MENU.color}:`;

/**
 * Swatch icon of a palette colour: `src/icons/colors/rrggbb.svg`, or `rrggbb-current.svg` (with
 * a check mark) for the project's current colour.
 * @param {string} color `#rrggbb`
 * @param {{current?: boolean}} [options]
 */
export const colorIconPath = (color, { current = false } = {}) =>
  `icons/colors/${color.slice(1)}${current ? '-current' : ''}.svg`;

/**
 * Recreates the items. They start hidden: the page makes the right ones visible in onShown, so a
 * right-click anywhere else in the page (default menu) never shows them.
 * @param {typeof messenger} [api]
 */
export async function registerMenus(api = messenger) {
  const t = (/** @type {string} */ name) => api.i18n.getMessage(name);
  await api.menus.removeAll();
  /** @type {messenger.menus.CreateProperties} */
  const common = {
    contexts: ['all'],
    documentUrlPatterns: [`${api.runtime.getURL(TRACKER_PATH)}*`],
    viewTypes: ['tab'],
    visible: false,
  };
  /** @type {[string, string, Partial<messenger.menus.CreateProperties>?][]} */
  const items = [
    [MENU.newSubproject, 'menuNewSubproject'],
    [MENU.rename, 'menuRename'],
    [MENU.color, 'menuColor'],
    [MENU.moveTo, 'menuMoveTo'],
    [MENU.separator, '', { type: 'separator' }],
    [MENU.archive, 'menuArchive'],
    [MENU.unarchive, 'menuUnarchive'],
    [MENU.delete, 'menuDelete'],
    [TASK_MENU.start, 'menuTaskStart'],
    [TASK_MENU.stop, 'menuTaskStop'],
    [TASK_MENU.edit, 'menuTaskEdit'],
    [TASK_MENU.rename, 'menuTaskRename'],
    [TASK_MENU.star, 'menuTaskStar'],
    [TASK_MENU.unstar, 'menuTaskUnstar'],
    [TASK_MENU.done, 'menuTaskDone'],
    [TASK_MENU.reopen, 'menuTaskReopen'],
    [TASK_MENU.move, 'menuTaskMove'],
    [TASK_MENU.separator, '', { type: 'separator' }],
    [TASK_MENU.delete, 'menuTaskDelete'],
    [ENTRY_MENU.edit, 'menuEntryEdit'],
    [ENTRY_MENU.split, 'menuEntrySplit'],
    [ENTRY_MENU.duplicate, 'menuEntryDuplicate'],
    [ENTRY_MENU.separator, '', { type: 'separator' }],
    [ENTRY_MENU.delete, 'menuEntryDelete'],
  ];
  for (const [id, title, extra] of items) {
    api.menus.create({ ...common, id, ...(title ? { title: t(title) } : {}), ...extra });
  }
  for (const { color, label } of PALETTE) {
    api.menus.create({
      ...common,
      id: `${COLOR_ITEM_PREFIX}${color}`,
      parentId: MENU.color,
      // Normal items: Thunderbird draws a radio item's check in place of its icon, so the
      // current colour is a swatch with a check mark instead (set by the page in onShown).
      title: t(label),
      icons: { 16: colorIconPath(color) },
      visible: true,
    });
  }
}
