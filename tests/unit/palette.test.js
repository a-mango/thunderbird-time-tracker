import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_COLOR } from '../../src/db/projects.js';
import { PALETTE, colorValue, nearestPaletteColor, paletteColor } from '../../src/lib/palette.js';

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

describe('nearestPaletteColor', () => {
  it('maps colours from other apps to the closest palette colour', () => {
    for (const entry of PALETTE)
      expect(nearestPaletteColor(entry.color.toUpperCase())).toBe(entry.color);
    expect(nearestPaletteColor('rgb(30, 120, 60)')).toBe('#1d783b');
    expect(nearestPaletteColor('rgba(234,115,8,0.5)')).toBe('#ea7308');
    expect(nearestPaletteColor('#e4c')).toBe('#e247c4');
  });

  it('falls back to the default colour', () => {
    for (const value of [null, 42, '', 'red', '#12345', 'rgb(300, 0, 0)', 'url(x)']) {
      expect(nearestPaletteColor(value)).toBe(DEFAULT_PROJECT_COLOR);
    }
  });
});
