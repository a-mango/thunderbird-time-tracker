import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
export async function expectNoAxeViolations(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    ),
  ).toEqual([]);
}

/** @param {import('@playwright/test').Page} page */
export function collectErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/**
 * Opens the gallery and waits until it has rendered.
 * @param {import('@playwright/test').Page} page
 * @param {string} [query]
 */
export async function openGallery(page, query = '') {
  await page.goto(`/dev/gallery.html${query}`);
  await page.locator('html[data-ready]').waitFor();
}

/**
 * Records the `detail` of every `type` event that bubbles to the document.
 * @param {import('@playwright/test').Page} page
 * @param {string} type
 */
export async function recordEvents(page, type) {
  await page.evaluate((eventType) => {
    const store = /** @type {any} */ (window);
    store.__events ??= {};
    store.__events[eventType] = [];
    document.addEventListener(eventType, (event) =>
      store.__events[eventType].push(/** @type {CustomEvent} */ (event).detail),
    );
  }, type);
  return () => page.evaluate((eventType) => /** @type {any} */ (window).__events[eventType], type);
}

/** Tue 20 Oct 2026, 14:45 local, like reference A (fixtures are generated around "now"). */
export const NOW = new Date(2026, 9, 20, 14, 45);

/**
 * Opens the tracker on a fixed clock and waits until the sidebar has rendered.
 * @param {import('@playwright/test').Page} page
 * @param {string} [query]
 */
export async function openTracker(page, query = '') {
  await page.clock.setFixedTime(NOW);
  await page.goto(`/ui/tracker.html${query}`);
  await page.locator('html[data-ready]').waitFor();
}

/** Accessible names of tree rows are "<name> <badge>", e.g. "Build 56h 31m". */
export const named = (/** @type {string} */ name) =>
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\d|$)`);

/** @param {import('@playwright/test').Page} page */
export const projectTree = (page) => page.getByRole('tree', { name: 'Projects' });

/** @param {import('@playwright/test').Page} page @param {string} name */
export const project = (page, name) =>
  projectTree(page).getByRole('treeitem', { name: named(name) });

/**
 * Right-clicks `row` and plays Thunderbird's part through the mock: onShown (the page shows the
 * items for that row), then onClicked on `itemId` if given. Returns whether the page overrode the
 * context, the visible top-level items and the checked colour item.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} row
 * @param {string} [itemId]
 */
export async function contextMenu(page, row, itemId) {
  await row.click({ button: 'right' });
  return page.evaluate(async (id) => {
    const menus = /** @type {any} */ (globalThis).messenger.menus;
    const { lastTarget, overridden } = menus._state();
    const info = { targetElementId: lastTarget, viewType: 'tab', modifiers: [] };
    await Promise.all(menus.onShown.dispatch({ ...info, menuIds: [], contexts: ['all'] }, {}));
    const items = menus._items();
    const result = {
      overridden,
      visible: items
        .filter((/** @type {any} */ i) => !i.parentId && i.visible && i.type !== 'separator')
        .map((/** @type {any} */ i) => i.id),
      checked: items.find((/** @type {any} */ i) => i.checked)?.id ?? null,
    };
    if (id) await Promise.all(menus.onClicked.dispatch({ ...info, menuItemId: id }, {}));
    return result;
  }, itemId);
}

/**
 * Opens a button menu (More, Projects) and activates an item by name with the keyboard.
 * @param {import('@playwright/test').Page} page
 * @param {string} button accessible name of the menu button
 * @param {string} item accessible name of the menu item
 */
export async function chooseFromMenu(page, button, item) {
  await page.getByRole('button', { name: button }).click();
  await page.getByRole('menuitem', { name: item }).click();
}
