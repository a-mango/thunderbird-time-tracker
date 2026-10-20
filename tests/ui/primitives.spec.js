import { expect, test } from '@playwright/test';
import { collectErrors, expectNoAxeViolations, openGallery } from './helpers.js';

test('the gallery renders without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await openGallery(page);
  await expect(page.getByRole('tree', { name: 'Views' }).getByRole('treeitem')).toHaveCount(3);
  await expect(page.getByRole('treegrid', { name: 'Tasks' }).locator('tbody tr')).toHaveCount(7);
  // Icons resolve: every <use> points at an imported file.
  const missing = await page.evaluate(async () => {
    const hrefs = new Set(
      [...document.querySelectorAll('use')].map((u) => u.getAttribute('href')?.split('#')[0]),
    );
    const results = await Promise.all(
      [...hrefs].map(async (href) => ((await fetch(String(href))).ok ? null : href)),
    );
    return results.filter(Boolean);
  });
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});

for (const scheme of /** @type {const} */ (['light', 'dark'])) {
  for (const density of ['compact', 'default', 'relaxed']) {
    test(`axe: no violations (${scheme}, ${density})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openGallery(page, density === 'default' ? '' : `?density=${density}`);
      await expectNoAxeViolations(page);
    });
  }
}

test('splitter resizes by keyboard, clamps to min/max and persists', async ({ page }) => {
  await openGallery(page);
  const splitter = page.getByRole('separator', { name: 'Resize the project pane' });
  const sidebar = page.locator('#gallery-sidebar');
  const start = Number(await splitter.getAttribute('aria-valuenow'));
  await splitter.focus();
  await page.keyboard.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(start + 10));
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(start - 40));
  await page.keyboard.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '480');
  expect(Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(480);
  await page.keyboard.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '150');
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  expect(Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(150);
});

test('splitter resizes by dragging', async ({ page }) => {
  await openGallery(page);
  const splitter = page.getByRole('separator', { name: 'Resize the project pane' });
  const box = /** @type {{x: number, y: number, width: number, height: number}} */ (
    await splitter.boundingBox()
  );
  const start = Number(await splitter.getAttribute('aria-valuenow'));
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 100, { steps: 4 });
  await page.mouse.up();
  const end = Number(await splitter.getAttribute('aria-valuenow'));
  expect(end).toBeGreaterThan(start + 50);
});

test('dialog: Escape cancels and focus returns; the primary button confirms', async ({ page }) => {
  await openGallery(page);
  const trigger = page.getByRole('button', { name: 'Delete task…' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Delete “Performance pass”?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete' })).toBeFocused();
  // Buttons are right-aligned with the primary last.
  await expect(dialog.getByRole('button')).toHaveText(['Cancel', 'Delete']);
  await expectNoAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText('Result: cancelled')).toBeVisible();
  await trigger.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Result: delete')).toBeVisible();
  await expect(page.locator('tt-dialog')).toHaveCount(0);
});

test('notification bars: roles, actions and close', async ({ page }) => {
  await openGallery(page);
  await expect(page.getByRole('alert')).toContainText('Could not save the entry.');
  const success = page.locator('tt-notification-bar[type="success"]');
  await expect(success).toHaveAttribute('role', 'status');
  await success.getByRole('button', { name: 'Close' }).click();
  await expect(success).toBeHidden();
  const info = page.locator('tt-notification-bar[type="info"]');
  await info.getByRole('button', { name: 'Keep' }).click();
  await expect(info).toBeHidden();
});
