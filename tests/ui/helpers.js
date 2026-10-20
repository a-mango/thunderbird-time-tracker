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
