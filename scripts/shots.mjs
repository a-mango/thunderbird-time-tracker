// Screenshots of the dev harness into artifacts/shots/ (compare with design/reference/).
// Starts its own dev server on a free port. Usage: node scripts/shots.mjs
import { mkdir } from 'node:fs/promises';
import { firefox } from '@playwright/test';
import { listen } from './serve.mjs';

const outDir = new URL('../artifacts/shots/', import.meta.url).pathname;

/** Tue 20 Oct 2026, 14:45 local, like reference A (fixtures are generated around "now"). */
const NOW = new Date(2026, 9, 20, 14, 45);
/** Our tab's content area in reference A (1440×900 window minus spaces bar, tabs, toolbar, status). */
const TAB = { width: 1394, height: 796 };

/** name, path, colour scheme, viewport */
const SHOTS = /** @type {const} */ ([
  ['tracker-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-dark', '/ui/tracker.html', 'dark', TAB],
  ['tracker-compact-light', '/ui/tracker.html?density=compact', 'light', TAB],
  ['tracker-compact-dark', '/ui/tracker.html?density=compact', 'dark', TAB],
  ['tracker-relaxed-light', '/ui/tracker.html?density=relaxed', 'light', TAB],
  ['tracker-empty-light', '/ui/tracker.html?fixtures=empty', 'light', TAB],
  // List states the default shots don't show: quick filter bar with tags, a focused selected row.
  ['tracker-list-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-list-dark', '/ui/tracker.html', 'dark', TAB],
  ['popup-light', '/ui/popup.html', 'light', { width: 320, height: 200 }],
  ['popup-dark', '/ui/popup.html', 'dark', { width: 320, height: 200 }],
  // Primitives gallery: light/dark × the three densities, full page.
  ...['light', 'dark'].flatMap((scheme) =>
    ['compact', 'default', 'relaxed'].map(
      (density) =>
        /** @type {const} */ ([
          `gallery-${scheme}-${density}`,
          `/dev/gallery.html${density === 'default' ? '' : `?density=${density}`}`,
          scheme,
          { width: 1280, height: 800 },
        ]),
    ),
  ),
]);

await mkdir(outDir, { recursive: true });
const server = await listen(0);
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const browser = await firefox.launch();
try {
  for (const [name, path, colorScheme, viewport] of SHOTS) {
    // A new page is a new context: its own IndexedDB, seeded by the mock.
    const page = await browser.newPage({ colorScheme, viewport, reducedMotion: 'reduce' });
    await page.clock.setFixedTime(NOW);
    await page.goto(`http://localhost:${port}${path}`);
    await page.waitForLoadState('networkidle');
    const file = `${outDir}${name}.png`;
    // Popups size to their content in Thunderbird: clip to <body> instead of the viewport.
    if (path.includes('popup')) await page.locator('body').screenshot({ path: file });
    else if (path.includes('gallery')) {
      await page.locator('html[data-ready]').waitFor();
      await page.screenshot({ path: file, fullPage: true });
    } else {
      await page.locator('html[data-ready]').waitFor();
      // Like the reference: Build selected and focused.
      const build = page.getByRole('treeitem', { name: /^Build( |$)/ });
      await page.bringToFront();
      if (await build.count()) await build.click();
      if (name.startsWith('tracker-list')) {
        await page.getByRole('button', { name: 'Quick Filter' }).click();
        await page.getByRole('button', { name: 'Tags', exact: true }).click();
        await page.getByRole('row', { name: /Performance pass/ }).click();
      }
      await page.mouse.move(0, 0);
      await page.screenshot({ path: file });
      if (!path.includes('fixtures=empty') && !name.startsWith('tracker-list')) {
        const clip = `${outDir}${name.replace('tracker', 'sidebar')}.png`;
        await page.locator('#sidebar').screenshot({ path: clip });
        console.log(clip);
      }
    }
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
