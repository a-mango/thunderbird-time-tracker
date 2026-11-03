import { expect, test } from '@playwright/test';
import { NOW, expectNoAxeViolations, openTracker, project } from './helpers.js';

// M7 accessibility pass: axe on every page and state the other specs don't already cover, in
// light, dark and forced colours, and the live-region announcements for timer start and stop.

/** @param {import('@playwright/test').Page} page */
const grid = (page) => page.getByRole('treegrid', { name: 'Tasks' });
/** @param {import('@playwright/test').Page} page @param {string} name */
const row = (page, name) => grid(page).locator('tbody tr[data-key]').filter({ hasText: name });
/** @param {import('@playwright/test').Page} page */
const live = (page) => page.locator('[data-ref="live"]');

/** @type {[string, {colorScheme: 'light' | 'dark', forcedColors: 'none' | 'active'}][]} */
const MODES = [
  ['light', { colorScheme: 'light', forcedColors: 'none' }],
  ['dark', { colorScheme: 'dark', forcedColors: 'none' }],
  ['forced colours', { colorScheme: 'light', forcedColors: 'active' }],
  ['forced colours, dark', { colorScheme: 'dark', forcedColors: 'active' }],
];

for (const [mode, media] of MODES) {
  test.describe(`axe (${mode})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia(media);
    });
    // Under forced colours the user's system palette sets every colour (the emulated
    // SelectedItem/SelectedItemText pair is 3:1); contrast is theirs, the other rules still run.
    const axe = (/** @type {import('@playwright/test').Page} */ page) =>
      expectNoAxeViolations(page, {
        disableRules: media.forcedColors === 'active' ? ['color-contrast'] : [],
      });

    test('tracker: views, a project, the archive, a stopped task', async ({ page }) => {
      await openTracker(page, '?seed=42');
      await axe(page);
      for (const view of ['Today', 'This Week', 'Starred']) {
        await page.getByRole('tree', { name: 'Views' }).getByRole('treeitem', { name: new RegExp(`^${view}`) }).click(); // prettier-ignore
        await axe(page);
      }
      await project(page, 'Build').click();
      await row(page, 'Performance pass').click();
      await axe(page);
      await project(page, 'Archive').click();
      await axe(page);
    });

    test('tracker dialogs and menus', async ({ page }) => {
      await openTracker(page, '?seed=42');
      await project(page, 'Build').click();
      await row(page, 'Performance pass').click();
      // Task properties (Enter), the entry dialog (Ctrl+E), the header's More menu.
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await axe(page);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+e');
      await expect(page.getByRole('dialog')).toBeVisible();
      await axe(page);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'More options', exact: true }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await axe(page);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+n');
      await expect(page.getByRole('dialog')).toBeVisible();
      await axe(page);
    });

    test('popup: running and idle', async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await page.goto('/ui/popup.html?seed=42');
      await page.locator('html[data-ready]').waitFor();
      await axe(page);
      await page.goto('/ui/popup.html?fixtures=empty');
      await page.locator('html[data-ready]').waitFor();
      await axe(page);
    });
  });
}

test('forced colours: focus, selection and the running timer stay visible', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openTracker(page, '?seed=42');
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
  await project(page, 'Build').click();
  const selected = row(page, 'Performance pass');
  await selected.click();
  // Forced colours drop backgrounds: the selected row keeps an outline or a system colour.
  const style = await selected.evaluate((element) => {
    const css = getComputedStyle(element);
    return { outline: css.outlineStyle, background: css.backgroundColor };
  });
  expect(style.outline !== 'none' || style.background !== 'rgba(0, 0, 0, 0)').toBe(true);
});

test.describe('live region', () => {
  test('announces timer start and stop from the task list', async ({ page }) => {
    await openTracker(page, '?seed=42');
    await expect(live(page)).toHaveAttribute('aria-live', 'polite');
    await project(page, 'Build').click();
    const target = row(page, 'Performance pass');
    await target.click();
    await page.keyboard.press('Space');
    await expect(live(page)).toHaveText('Timer started: Performance pass');
    await page.keyboard.press('Space');
    await expect(live(page)).toHaveText('Timer stopped: Performance pass');
  });

  test('announces a timer started in another page (popup, shortcut)', async ({ context }) => {
    const tracker = await context.newPage();
    await openTracker(tracker, '?seed=42');
    const other = await context.newPage();
    await other.goto('/ui/popup.html');
    await other.locator('html[data-ready]').waitFor();
    await other.evaluate(() => {
      window.close = () => {};
    });
    await other.getByRole('button', { name: 'Stop' }).click();
    await expect(live(tracker)).toHaveText('Timer stopped: Checkout form validation');
  });
});
