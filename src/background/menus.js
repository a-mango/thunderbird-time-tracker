// Native context menu items for the project tree (docs/DESIGN.md, Components). The background
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

/** Prefix of the colour radio items: `tt-project-color:#rrggbb`. */
export const COLOR_ITEM_PREFIX = `${MENU.color}:`;

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
  ];
  for (const [id, title, extra] of items) {
    api.menus.create({ ...common, id, ...(title ? { title: t(title) } : {}), ...extra });
  }
  for (const { color, label } of PALETTE) {
    api.menus.create({
      ...common,
      id: `${COLOR_ITEM_PREFIX}${color}`,
      parentId: MENU.color,
      type: 'radio',
      title: t(label),
      visible: true,
    });
  }
}
