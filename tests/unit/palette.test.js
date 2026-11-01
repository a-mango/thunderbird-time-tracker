import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_COLOR } from '../../src/db/projects.js';
import { PALETTE, colorValue, paletteColor } from '../../src/lib/palette.js';

const tokens = readFileSync(new URL('../../src/ui/styles/tokens.css', import.meta.url), 'utf8');
const messages = JSON.parse(
  readFileSync(new URL('../../src/_locales/en/messages.json', import.meta.url), 'utf8'),
);

/** Light value of a token: `--x: #abc` or `--x: light-dark(#abc, …)`. @param {string} token */
function lightValue(token) {
  const match = tokens.match(new RegExp(`${token}:\\s*(?:light-dark\\()?(#[0-9a-f]{6})`, 'i'));
  return match?.[1].toLowerCase();
}

describe('palette', () => {
  it('uses the light value of each token', () => {
    for (const { color, token } of PALETTE)
      expect([token, lightValue(token)]).toEqual([token, color]);
  });

  it('has unique colours, a localized name each, and holds the default colour', () => {
    expect(new Set(PALETTE.map((p) => p.color)).size).toBe(PALETTE.length);
    for (const { label } of PALETTE) expect(messages[label]?.message).toBeTruthy();
    expect(paletteColor(DEFAULT_PROJECT_COLOR)).toBeDefined();
  });

  it('paints palette colours through their token and others as stored', () => {
    expect(colorValue('#AE55F7')).toBe('var(--folder-color-draft)');
    expect(colorValue('#123456')).toBe('#123456');
    expect(paletteColor('#123456')).toBeUndefined();
  });
});
