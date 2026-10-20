// Copies the Thunderbird SVG icons listed in src/ui/icons/ICONS.txt from
// .ref/comm-central/mail/themes/shared/mail/icons/new/ into src/ui/icons/ (MPL-2.0, see THIRD_PARTY.md).
//
// Thunderbird paints its icons with context properties (-moz-context-properties), which only work
// in privileged documents. The rewrite makes them work in our pages through <svg><use>:
//   fill="context-stroke"  -> fill="currentColor"                       (outline)
//   fill="context-fill"    -> fill="currentColor", fill-opacity 0.2     (tint, overridable through
//                             the inherited custom property --icon-fill-opacity)
//   fill-opacity="context-fill-opacity" on the root is dropped; the root gets id="i" for <use>.
// The MPL header is kept, and a provenance comment is added after it.
// Usage: npm run icons
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceDir = join(root, '.ref/comm-central/mail/themes/shared/mail/icons/new');
const outDir = join(root, 'src/ui/icons');
const TAG = 'THUNDERBIRD_157_0_RELEASE';

/**
 * Parses ICONS.txt: one path per line, `#` comments and blank lines ignored.
 * @param {string} text
 * @returns {string[]}
 */
export function parseIconList(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

/**
 * Rewrites one Thunderbird SVG so it paints with currentColor.
 * @param {string} svg source text
 * @param {string} sourcePath path relative to icons/new/, recorded in the provenance comment
 * @returns {string}
 */
export function rewriteSvg(svg, sourcePath) {
  const header = svg.match(/^\s*<!--[\s\S]*?-->/);
  if (!header || !header[0].includes('Mozilla Public')) {
    throw new Error(`${sourcePath}: missing MPL header`);
  }
  let body = svg
    .slice(header[0].length)
    .replace(/\s+fill-opacity="context-fill-opacity"/g, '')
    .replace(
      /fill="context-fill(?: transparent)?"/g,
      'fill="currentColor" style="fill-opacity: var(--icon-fill-opacity, 0.2)"',
    )
    .replace(/fill="context-stroke(?: transparent)?"/g, 'fill="currentColor"')
    .replace(/<!--[\s\S]*?-->\s*/g, '');
  if (/context-/.test(body)) throw new Error(`${sourcePath}: unhandled context paint`);
  if (!/<svg\b/.test(body)) throw new Error(`${sourcePath}: no <svg> element`);
  body = body.replace(/<svg\b/, '<svg id="i"');
  const provenance =
    `<!-- Thunderbird icon mail/themes/shared/mail/icons/new/${sourcePath} (${TAG}).\n` +
    '   - Modified by scripts/import-icons.mjs: context paint rewritten to currentColor. -->';
  return `${header[0].trim()}\n${provenance}\n${body.trim()}\n`;
}

async function main() {
  const list = parseIconList(await readFile(join(outDir, 'ICONS.txt'), 'utf8'));
  const names = new Set();
  for (const path of list) {
    const name = basename(path);
    if (names.has(name)) throw new Error(`duplicate icon name: ${name}`);
    names.add(name);
    const svg = await readFile(join(sourceDir, path), 'utf8').catch(() => {
      throw new Error(`${path} not found in .ref (run npm run ref)`);
    });
    await writeFile(join(outDir, name), rewriteSvg(svg, path));
  }
  console.log(`icons: ${list.length} written to src/ui/icons/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
