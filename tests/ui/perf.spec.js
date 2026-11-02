import { expect, test } from '@playwright/test';
import { openTracker, project } from './helpers.js';

// M4 ✅: the list renders 2,000 tasks in under 100 ms (first render and a filter change).
// Timed in the page with performance.now(), synchronous render plus a forced layout.
test('2,000 tasks: first render and a filter change each take under 100 ms', async ({ page }) => {
  await openTracker(page, '?fixtures=bulk');
  const support = project(page, 'Support retainer');
  await expect(support).toBeVisible();

  const timings = await page.evaluate(async () => {
    /** @param {() => void} action */
    const time = (action) => {
      const start = performance.now();
      action();
      // Forces style and layout of the new rows.
      void document.querySelector('[data-ref="task-table"] table')?.getBoundingClientRect().height;
      return performance.now() - start;
    };
    const row = /** @type {HTMLElement} */ (
      [...document.querySelectorAll('#projects-tree [role="treeitem"]')].find((item) =>
        item.textContent?.startsWith('Support retainer'),
      )
    );
    const first = time(() => row.click());
    /** Rows in the list (the table renders only the visible ones). */
    const count = () =>
      Number(
        document.querySelector('[data-ref="task-table"] table')?.getAttribute('aria-rowcount'),
      ) - 1;
    const rows = count();
    document.querySelector('[data-ref="quick-filter"]')?.dispatchEvent(new MouseEvent('click'));
    const input = /** @type {HTMLInputElement} */ (
      document.querySelector('[data-ref="filter-text"]')
    );
    const filter = time(() => {
      input.value = 'checkout';
      input.dispatchEvent(new Event('input'));
    });
    const filtered = count();
    const clear = time(() => {
      input.value = '';
      input.dispatchEvent(new Event('input'));
    });
    return { first, filter, clear, rows, filtered };
  });
  console.log(
    `perf: first render ${timings.first.toFixed(1)} ms (${timings.rows} rows), ` +
      `filter ${timings.filter.toFixed(1)} ms (${timings.filtered} rows), ` +
      `clear ${timings.clear.toFixed(1)} ms`,
  );
  expect(timings.rows).toBeGreaterThan(1700);
  expect(timings.filtered).toBeGreaterThan(0);
  expect(timings.first).toBeLessThan(100);
  expect(timings.filter).toBeLessThan(100);
  expect(timings.clear).toBeLessThan(100);
});
