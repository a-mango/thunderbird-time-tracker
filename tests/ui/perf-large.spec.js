import { expect, test } from '@playwright/test';

// Real clock: a fixed clock would freeze performance.now().
// M7: 50,000 entries over 3 years on 300 tasks (`?fixtures=large`).
// - Cold open: the tab's own script start (`tt-start`) to the first full render (`tt-ready`),
//   on a database that already exists (the harness doesn't re-seed), under 300 ms.
// - Badges: an older entry changes in another connection (like the popup or the background);
//   the tree's badges show the new total under 50 ms after the change notification arrives.
//   Also logged: tt-ready from navigation start (includes loading and parsing the modules).
// Local measurements: hard budgets on shared CI runners would block releases on noise.
test.skip(!!process.env.CI, 'performance budgets are measured locally (docs/PLAN.md, M7 outcomes)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

/** @param {import('@playwright/test').Page} page */
async function openLarge(page) {
  await page.goto('/ui/tracker.html?fixtures=large');
  await page.locator('html[data-ready]').waitFor({ timeout: 90_000 });
}

test('50k entries: tab cold-open under 300 ms', async ({ page }) => {
  await openLarge(page);
  /** @type {number[]} */
  const runs = [];
  /** @type {number[]} */
  const fromNavigation = [];
  for (let n = 0; n < 3; n += 1) {
    await page.goto('/ui/tracker.html');
    await page.locator('html[data-ready]').waitFor();
    const [open, ready] = await page.evaluate(() => [
      performance.measure('open', 'tt-start', 'tt-ready').duration,
      performance.getEntriesByName('tt-ready')[0].startTime,
    ]);
    runs.push(open);
    fromNavigation.push(ready);
  }
  const best = Math.min(...runs);
  const ms = (/** @type {number[]} */ list) => list.map((v) => v.toFixed(0)).join(' / ');
  console.log(
    `perf: cold open ${ms(runs)} ms; from navigation start ${ms(fromNavigation)} ms (50k entries)`,
  );
  expect(best).toBeLessThan(300);
});

test('50k entries: badges recompute under 50 ms after a change', async ({ page }) => {
  await openLarge(page);
  await page.goto('/ui/tracker.html');
  await page.locator('html[data-ready]').waitFor();
  const timings = await page.evaluate(async () => {
    const db = await import('/db/index.js');
    const conn = await db.openDB({ notify: db.notifyChanged });
    const tree = /** @type {HTMLElement} */ (document.querySelector('#projects-tree'));
    /** @type {{write: number, render: number}[]} */
    const runs = [];
    for (const id of ['e100', 'e20000', 'e40000']) {
      const entry = /** @type {any} */ (await db.getEntry(conn, id));
      const changed = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve(performance.now());
        });
        observer.observe(tree, { subtree: true, characterData: true, childList: true });
      });
      const before = performance.now();
      await db.updateEntry(conn, id, { end: entry.end + 60 * 60_000 });
      const written = performance.now();
      const rendered = /** @type {number} */ (await changed);
      runs.push({ write: written - before, render: rendered - written });
    }
    conn.close();
    return runs;
  });
  console.log(
    `perf: badge update after a change ${timings
      .map((t) => `${t.render.toFixed(1)} ms (write ${t.write.toFixed(1)} ms)`)
      .join(', ')}`,
  );
  for (const { render } of timings) expect(render).toBeLessThan(50);
});
