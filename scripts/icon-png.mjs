// Renders the extension icon SVGs to PNG with Playwright's Firefox (no extra dependencies):
// design/icon/time-tracker-{64,128}.png for the ATN listing, and a preview sheet with every
// icon at 1× and 2× on light and dark backgrounds in artifacts/icon-preview.png.
// Usage: node scripts/icon-png.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { firefox } from '@playwright/test';

const root = new URL('../', import.meta.url);
/** @param {string} path */
const svg = async (path) =>
  `data:image/svg+xml;base64,${(await readFile(new URL(path, root))).toString('base64')}`;

const main = await svg('src/icons/time-tracker.svg');
const small = await svg('src/icons/time-tracker-16.svg');
const dark = await svg('src/icons/toolbar-dark.svg');
const light = await svg('src/icons/toolbar-light.svg');

await mkdir(new URL('design/icon/', root), { recursive: true });
await mkdir(new URL('artifacts/', root), { recursive: true });
const browser = await firefox.launch();
try {
  for (const size of [64, 128]) {
    // A canvas keeps the transparency (Firefox screenshots can't omit the background).
    const page = await browser.newPage();
    const dataUrl = await page.evaluate(async ([src, px]) => {
      const img = new Image(px, px);
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      canvas.getContext('2d')?.drawImage(img, 0, 0, px, px);
      return canvas.toDataURL('image/png');
    }, /** @type {const} */ ([main, size]));
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    await writeFile(new URL(`design/icon/time-tracker-${size}.png`, root), png);
    await page.close();
  }
  const page = await browser.newPage({
    viewport: { width: 520, height: 180 },
    deviceScaleFactor: 2,
  });
  const cell = (/** @type {string} */ src, /** @type {number} */ size, /** @type {string} */ bg) =>
    `<span style="display:inline-grid;place-items:center;vertical-align:top;width:72px;height:72px;background:${bg}">` +
    `<img src="${src}" width="${size}" height="${size}"></span>`;
  await page.setContent(
    `<body style="margin:8px;font:12px sans-serif">` +
      `<div>${cell(small, 16, '#fff')}${cell(main, 32, '#fff')}${cell(main, 64, '#fff')}` +
      `${cell(dark, 16, '#f0f0f4')}${cell(dark, 32, '#f0f0f4')}</div>` +
      `<div>${cell(small, 16, '#1c1b22')}${cell(main, 32, '#1c1b22')}${cell(main, 64, '#1c1b22')}` +
      `${cell(light, 16, '#2b2a33')}${cell(light, 32, '#2b2a33')}</div></body>`,
  );
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: new URL('artifacts/icon-preview.png', root).pathname });
  console.log('design/icon/time-tracker-64.png, design/icon/time-tracker-128.png');
  console.log('artifacts/icon-preview.png');
} finally {
  await browser.close();
}
