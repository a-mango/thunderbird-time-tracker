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
  // Detail pane dialogs over the running task.
  ['tracker-entry-dialog-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-entry-dialog-dark', '/ui/tracker.html', 'dark', TAB],
  ['tracker-split-dialog-light', '/ui/tracker.html', 'light', TAB],
  // Settings dialog and the restore preview over the tracker (M6).
  ['tracker-settings-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-settings-dark', '/ui/tracker.html', 'dark', TAB],
  ['tracker-export-light', '/ui/tracker.html', 'light', TAB],
  // M7: French (string lengths) and forced colours (system palette).
  ['tracker-fr-light', '/ui/tracker.html?locale=fr', 'light', TAB],
  ['tracker-settings-fr-light', '/ui/tracker.html?locale=fr', 'light', TAB],
  ['tracker-forced-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-forced-dark', '/ui/tracker.html', 'dark', TAB],
  ['tracker-error-light', '/ui/tracker.html?seed=42&fail=newer', 'light', TAB],
  // S2: the idle prompt above the list, in the popup, and its Assign to… dialog.
  ['tracker-away-light', '/ui/tracker.html?idle=23', 'light', TAB],
  ['tracker-away-dark', '/ui/tracker.html?idle=23', 'dark', TAB],
  ['tracker-away-compact-light', '/ui/tracker.html?idle=23&density=compact', 'light', TAB],
  ['tracker-away-relaxed-dark', '/ui/tracker.html?idle=23&density=relaxed', 'dark', TAB],
  ['tracker-away-fr-light', '/ui/tracker.html?idle=23&locale=fr', 'light', TAB],
  ['tracker-away-assign-light', '/ui/tracker.html?idle=23', 'light', TAB],
  ['tracker-away-forced-dark', '/ui/tracker.html?idle=23', 'dark', TAB],
  // S3: the Reports mode (timesheet + summary), a month, editing, rounding, French, print.
  ['tracker-report-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-report-dark', '/ui/tracker.html', 'dark', TAB],
  ['tracker-report-compact-light', '/ui/tracker.html?density=compact', 'light', TAB],
  ['tracker-report-relaxed-dark', '/ui/tracker.html?density=relaxed', 'dark', TAB],
  ['tracker-report-fr-light', '/ui/tracker.html?locale=fr', 'light', TAB],
  ['tracker-report-forced-dark', '/ui/tracker.html', 'dark', TAB],
  ['tracker-report-month-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-report-edit-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-report-replace-dark', '/ui/tracker.html', 'dark', TAB],
  ['tracker-report-rounded-light', '/ui/tracker.html', 'light', TAB],
  ['tracker-report-print-light', '/ui/tracker.html', 'light', TAB],
  ['popup-fr-light', '/ui/popup.html?locale=fr', 'light', { width: 360, height: 600 }],
  ['popup-light', '/ui/popup.html', 'light', { width: 360, height: 600 }],
  ['popup-dark', '/ui/popup.html', 'dark', { width: 360, height: 600 }],
  ['popup-search-light', '/ui/popup.html', 'light', { width: 360, height: 600 }],
  ['popup-idle-dark', '/ui/popup.html?fixtures=empty', 'dark', { width: 360, height: 600 }],
  ['popup-compact-light', '/ui/popup.html?density=compact', 'light', { width: 360, height: 600 }],
  ['popup-away-light', '/ui/popup.html?idle=23', 'light', { width: 360, height: 600 }],
  ['popup-away-dark', '/ui/popup.html?idle=23', 'dark', { width: 360, height: 600 }],
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
    const page = await browser.newPage({
      colorScheme,
      viewport,
      reducedMotion: 'reduce',
      // Windows High Contrast sets both; Firefox's emulation ignores the colour scheme there.
      forcedColors: name.includes('forced') ? 'active' : 'none',
      contrast: name.includes('forced') ? 'more' : 'no-preference',
    });
    await page.clock.setFixedTime(NOW);
    await page.goto(`http://localhost:${port}${path}`);
    await page.waitForLoadState('networkidle');
    const file = `${outDir}${name}.png`;
    // Popups size to their content in Thunderbird: clip to <body> instead of the viewport.
    if (path.includes('popup')) {
      await page.locator('html[data-ready]').waitFor();
      if (name.includes('search')) await page.getByRole('combobox').fill('form');
      await page.locator('body').screenshot({ path: file });
    } else if (path.includes('gallery')) {
      await page.locator('html[data-ready]').waitFor();
      await page.screenshot({ path: file, fullPage: true });
    } else if (name.startsWith('tracker-report')) {
      await page.locator('html[data-ready]').waitFor();
      await page.bringToFront();
      if (name.includes('rounded')) {
        await page.evaluate(async () => {
          const db = await import('/db/index.js');
          const conn = await db.openDB();
          await db.updateSettings(conn, { roundingMin: 15, roundingMode: 'entry' });
          conn.close();
        });
        await page.reload();
        await page.locator('html[data-ready]').waitFor();
      }
      const fr = path.includes('locale=fr');
      await page.getByRole('treeitem', { name: fr ? 'Feuille de temps' : 'Timesheet' }).click();
      const sheet = page.getByRole('grid');
      await sheet.waitFor();
      if (name.includes('month')) {
        await page.getByRole('combobox', { name: 'Range' }).selectOption('month');
        await page.getByRole('columnheader').nth(32).waitFor();
      }
      if (name.includes('edit') || name.includes('replace')) {
        await sheet.locator('tr[data-task] [data-col="1"]').first().dblclick();
        if (name.includes('replace')) {
          await page.keyboard.press('Control+A');
          await page.keyboard.type('30m');
          await page.keyboard.press('Enter');
          await page.getByRole('dialog').waitFor();
        }
      }
      if (name.includes('print')) {
        await page.getByRole('button', { name: 'Billable' }).click();
        await page.emulateMedia({ media: 'print' });
        await page.mouse.move(0, 0);
        await page.screenshot({ path: file, fullPage: true });
      } else {
        await page.mouse.move(0, 0);
        await page.screenshot({ path: file });
      }
    } else {
      await page.locator('html[data-ready]').waitFor();
      // Like the reference: Build selected and focused.
      const build = page.getByRole('treeitem', { name: /^Build( |$)/ });
      await page.bringToFront();
      if (await build.count()) await build.click();
      // The running task fills the details pane, like reference A.
      const running = page.getByRole('row', { name: /Checkout form validation/ });
      if (!name.startsWith('tracker-list') && (await running.count())) await running.click();
      if (name.startsWith('tracker-list')) {
        await page.getByRole('button', { name: 'Quick Filter' }).click();
        await page.getByRole('button', { name: 'Tags', exact: true }).click();
        await page.getByRole('row', { name: /Performance pass/ }).click();
      }
      if (name.includes('entry-dialog')) {
        await page.locator('#detail .entry-row').first().click();
      } else if (name.includes('away-assign')) {
        await page.getByRole('button', { name: 'Assign to…' }).click();
      } else if (name.includes('split-dialog')) {
        await page.getByRole('button', { name: 'Split…' }).click();
      } else if (name.includes('settings') || name.includes('export')) {
        const fr = path.includes('locale=fr');
        await page.getByRole('button', { name: fr ? 'Plus d’options' : 'More options' }).click();
        const item = name.includes('settings') ? 'Settings…' : 'Export CSV…';
        await page.getByRole('menuitem', { name: fr ? 'Paramètres…' : item }).click();
      }
      await page.mouse.move(0, 0);
      await page.screenshot({ path: file });
      if (
        !path.includes('fixtures=empty') &&
        !/tracker-(list|entry|split|settings|export|error|away)/.test(name)
      ) {
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
