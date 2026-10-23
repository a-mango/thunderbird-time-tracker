// Native context menu on project rows (docs/DESIGN.md, Components; M1 spike): the background owns
// hidden items (background/menus.js). A right-click on a row overrides Thunderbird's menu, and
// onShown makes the items for that row visible. onShown/onClicked fire in every extension page,
// so each page acts only when the menu's target element is in its own document.
import { COLOR_ITEM_PREFIX, MENU } from '../background/menus.js';
import { PALETTE } from '../lib/palette.js';
import { commandsFor, projectPlace } from './project-commands.js';

/**
 * @typedef {import('./components/tt-tree.js').TtTree} TtTree
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('./project-commands.js').ProjectCommand} ProjectCommand
 */

/** @type {Record<string, ProjectCommand>} */
const COMMANDS = {
  [MENU.newSubproject]: 'new-sub',
  [MENU.rename]: 'edit',
  [MENU.color]: 'color',
  [MENU.moveTo]: 'move',
  [MENU.archive]: 'archive',
  [MENU.unarchive]: 'unarchive',
  [MENU.delete]: 'delete',
};

/**
 * @param {{
 *   tree: TtTree,
 *   data: TrackerData,
 *   run: (command: ProjectCommand, id: string, value?: string) => unknown,
 * }} options
 */
export function installContextMenu({ tree, data, run }) {
  const menus = messenger.menus;

  /**
   * The project row of a menu's target in this document; `undefined` when the target is in
   * another document (another tab, Thunderbird's own UI), `null` for a non-row in ours.
   * @param {{targetElementId?: number}} info
   */
  const targetOf = (info) => {
    if (info.targetElementId === undefined) return undefined;
    const element = menus.getTargetElement(info.targetElementId);
    if (!element || element.ownerDocument !== document) return undefined;
    const id = tree.itemIdAt(element);
    return id && data.project(id) ? id : null;
  };

  /**
   * Shows the items that apply to project `id` (none for null) and checks its colour.
   * @param {string | null} id
   */
  const sync = (id) => {
    const project = id ? data.project(id) : undefined;
    const commands = project ? commandsFor(projectPlace(data.projects, project.id)) : [];
    const color = project?.color.toLowerCase();
    return Promise.all([
      ...Object.entries(COMMANDS).map(([item, command]) =>
        menus.update(item, { visible: commands.includes(command) }),
      ),
      menus.update(MENU.separator, { visible: commands.length > 0 }),
      ...PALETTE.map((p) =>
        menus.update(`${COLOR_ITEM_PREFIX}${p.color}`, { checked: p.color === color }),
      ),
    ]);
  };

  tree.addEventListener('contextmenu', (event) => {
    const id = tree.itemIdAt(/** @type {Element} */ (event.target));
    if (!id || !data.project(id)) return;
    tree.focusItem(id);
    // Must run during the event; only the menu that opens next is affected.
    menus.overrideContext({ showDefaults: false });
    sync(id).catch(logMenuError);
  });

  menus.onShown.addListener((info) => {
    const id = targetOf(info);
    if (id === undefined) return undefined;
    return sync(id)
      .then(() => menus.refresh())
      .catch(logMenuError);
  });

  menus.onClicked.addListener((info) => {
    const id = targetOf(info);
    if (!id) return;
    const item = String(info.menuItemId);
    if (item.startsWith(COLOR_ITEM_PREFIX)) {
      run('color', id, item.slice(COLOR_ITEM_PREFIX.length));
      return;
    }
    const command = COMMANDS[item];
    if (command && command !== 'color') run(command, id);
  });
}

/** @param {unknown} error */
function logMenuError(error) {
  console.error('time tracker: context menu update failed', error);
}
