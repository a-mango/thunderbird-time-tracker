// Screenshots of the dev harness into artifacts/shots/ (compare with design/reference/).
// Starts its own dev server on a free port. Usage: node scripts/shots.mjs
import { mkdir } from 'node:fs/promises';
import { firefox } from '@playwright/test';
import { listen } from './serve.mjs';

const outDir = new URL('../artifacts/shots/', import.meta.url).pathname;

/** name, path, colour scheme, viewport */
const SHOTS = /** @type {const} */ ([
  ['tracker-light', '/ui/tracker.html', 'light', { width: 1280, height: 800 }],
  ['tracker-dark', '/ui/tracker.html', 'dark', { width: 1280, height: 800 }],
  ['tracker-empty-light', '/ui/tracker.html?fixtures=empty', 'light', { width: 1280, height: 800 }],
  ['popup-light', '/ui/popup.html', 'light', { width: 320, height: 200 }],
  ['popup-dark', '/ui/popup.html', 'dark', { width: 320, height: 200 }],
]);

await mkdir(outDir, { recursive: true });
const server = await listen(0);
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const browser = await firefox.launch();
try {
  for (const [name, path, colorScheme, viewport] of SHOTS) {
    const page = await browser.newPage({ colorScheme, viewport });
    await page.goto(`http://localhost:${port}${path}`);
    await page.waitForLoadState('networkidle');
    const file = `${outDir}${name}.png`;
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
