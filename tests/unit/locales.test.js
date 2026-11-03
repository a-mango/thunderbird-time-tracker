import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// M7: every locale has exactly the English keys, the same placeholders, and uses each of them.
const dir = new URL('../../src/_locales/', import.meta.url);
/** @param {string} locale @returns {Record<string, {message: string, placeholders?: object}>} */
const load = (locale) => JSON.parse(readFileSync(new URL(`${locale}/messages.json`, dir), 'utf8'));
const en = load('en');
const locales = readdirSync(dir).filter((name) => name !== 'en');
/** @param {string} message */
const used = (message) => [...message.matchAll(/\$([A-Z_]+)\$/g)].map((m) => m[1]).sort();

describe('locales', () => {
  it('includes French', () => {
    expect(locales).toContain('fr');
  });

  describe.each(locales)('%s', (locale) => {
    const messages = load(locale);
    it('has the English keys, no more, no less', () => {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    });
    it('keeps every placeholder and uses the same ones', () => {
      for (const [key, value] of Object.entries(en)) {
        expect(messages[key].placeholders, key).toEqual(value.placeholders);
        expect(used(messages[key].message), key).toEqual(used(value.message));
      }
    });
    it('has no empty messages', () => {
      for (const [key, value] of Object.entries(messages)) {
        expect(value.message.trim(), key).not.toBe('');
      }
    });
  });

  it('French keeps product and shortcut names', () => {
    const fr = load('fr');
    expect(fr.extensionName.message).toBe('Time Tracker');
    expect(fr.filterShortcut.message).toBe('Ctrl+Maj+K');
  });
});
