// Settings stored in `meta.settings` as a partial object; reads merge it over the defaults.
import { DEFAULT_SETTINGS, validateSettings } from '../lib/settings.js';
import { emit, req, tx } from './idb.js';
import { META, STORES } from './schema.js';

/** @typedef {import('../lib/types.js').Settings} Settings */

/**
 * Keeps only stored keys and values this version accepts (a newer version or a hand-edited
 * database may hold others).
 * @param {unknown} stored
 * @returns {Partial<Settings>}
 */
function known(stored) {
  if (stored === null || typeof stored !== 'object') return {};
  /** @type {Record<string, unknown>} */
  const clean = {};
  for (const [key, value] of Object.entries(stored)) {
    try {
      Object.assign(clean, validateSettings({ [key]: value }));
    } catch {
      // Unknown key or a value this version rejects: fall back to the default.
    }
  }
  return clean;
}

/**
 * @param {IDBDatabase} db
 * @returns {Promise<Settings>} defaults merged with the stored values
 */
export async function getSettings(db) {
  const stored = await tx(db, STORES.meta, 'readonly', ({ meta }) => req(meta.get(META.settings)));
  return { ...DEFAULT_SETTINGS, ...known(stored) };
}

/**
 * Validates `patch` and merges it into the stored settings.
 * @param {IDBDatabase} db
 * @param {Partial<Settings>} patch
 * @returns {Promise<Settings>} the full settings after the update
 * @throws {import('../lib/errors.js').ValidationError} `settings`
 */
export async function updateSettings(db, patch) {
  const clean = validateSettings(patch);
  const stored = await tx(db, STORES.meta, 'readwrite', async ({ meta }) => {
    const next = { ...known(await req(meta.get(META.settings))), ...clean };
    await req(meta.put(next, META.settings));
    return next;
  });
  emit(db, { type: 'settings', ids: Object.keys(clean) });
  return { ...DEFAULT_SETTINGS, ...stored };
}
