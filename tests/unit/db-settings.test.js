import { describe, expect, it } from 'vitest';
import { getSettings, updateSettings } from '../../src/db/settings.js';
import { openDB, req, tx } from '../../src/db/idb.js';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.js';
import { ValidationError } from '../../src/lib/errors.js';
import { freshDB } from './db-helpers.js';

describe('db settings', () => {
  it('returns the defaults on a fresh database', async () => {
    const { db } = await freshDB();
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a patch, persists it and notifies with the changed keys', async () => {
    const { db, factory, notify } = await freshDB();
    const first = await updateSettings(db, { weekStart: 0, density: 'compact' });
    expect(first).toEqual({ ...DEFAULT_SETTINGS, weekStart: 0, density: 'compact' });
    const second = await updateSettings(db, { dailyTargetMin: 360 });
    expect(second).toEqual({ ...first, dailyTargetMin: 360 });
    expect(notify).toHaveBeenLastCalledWith({ type: 'settings', ids: ['dailyTargetMin'] });
    db.close();
    const reopened = await openDB({ factory });
    expect(await getSettings(reopened)).toEqual(second);
    reopened.close();
  });

  it('rejects unknown keys and invalid values without writing', async () => {
    const { db, notify } = await freshDB();
    await expect(updateSettings(db, /** @type {any} */ ({ theme: 'dark' }))).rejects.toMatchObject({
      constructor: ValidationError,
      code: 'settings',
    });
    await expect(updateSettings(db, /** @type {any} */ ({ weekStart: 3 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(updateSettings(db, /** @type {any} */ (null))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    expect(notify).not.toHaveBeenCalled();
  });

  it('ignores stored keys this version does not know or values it no longer accepts', async () => {
    const { db } = await freshDB();
    await tx(db, ['meta'], 'readwrite', ({ meta }) =>
      req(meta.put({ weekStart: 0, futureSetting: true, roundingMin: 7 }, 'settings')),
    );
    expect(await getSettings(db)).toEqual({ ...DEFAULT_SETTINGS, weekStart: 0 });
  });

  // M7: a corrupt `meta.settings` (hand-edited, damaged) falls back to the defaults, and the next
  // change replaces it with a valid object.
  it.each([
    ['a string', 'compact'],
    ['a number', 42],
    ['an array', ['compact', 0]],
    ['wrong types', { density: 3, weekStart: '1', accent: null, showDone: 'yes' }],
    ['a prototype key', JSON.parse('{"__proto__": {"density": "compact"}, "weekStart": 0}')],
  ])('falls back to the defaults for %s', async (_name, stored) => {
    const { db } = await freshDB();
    await tx(db, ['meta'], 'readwrite', ({ meta }) => req(meta.put(stored, 'settings')));
    const settings = await getSettings(db);
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    for (const [key, value] of Object.entries(settings)) {
      if (!(key === 'weekStart' && value === 0)) {
        expect(value).toEqual(DEFAULT_SETTINGS[/** @type {keyof typeof DEFAULT_SETTINGS} */ (key)]);
      }
    }
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
    await updateSettings(db, { density: 'relaxed' });
    const repaired = await tx(db, ['meta'], 'readonly', ({ meta }) => req(meta.get('settings')));
    expect(repaired).toMatchObject({ density: 'relaxed' });
    expect(Array.isArray(repaired)).toBe(false);
  });
});
