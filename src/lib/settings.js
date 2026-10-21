// Settings defaults and validation (docs/SPEC.md, Settings). Used by db/settings.js and the importer.
import { ValidationError } from './errors.js';

/** @typedef {import('./types.js').Settings} Settings */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  density: 'default',
  accent: 'system',
  weekStart: 1,
  dailyTargetMin: 480,
  durationFormat: 'hm',
  showDone: false,
  confirmDelete: true,
  idleThresholdMin: 5,
  roundingMin: 0,
});

/** @type {Record<keyof Settings, (value: unknown) => boolean>} */
const CHECKS = {
  density: (v) => v === 'compact' || v === 'default' || v === 'relaxed',
  accent: (v) =>
    typeof v === 'string' &&
    ['system', 'thunderbird', 'purple', 'orange', 'pink', 'ink', 'teal'].includes(v),
  weekStart: (v) => v === 0 || v === 1,
  dailyTargetMin: (v) =>
    Number.isInteger(v) && /** @type {number} */ (v) >= 0 && /** @type {number} */ (v) <= 24 * 60,
  durationFormat: (v) => v === 'hm' || v === 'decimal',
  showDone: (v) => typeof v === 'boolean',
  confirmDelete: (v) => typeof v === 'boolean',
  idleThresholdMin: (v) =>
    Number.isInteger(v) && /** @type {number} */ (v) >= 1 && /** @type {number} */ (v) <= 240,
  roundingMin: (v) => v === 0 || v === 5 || v === 6 || v === 15,
};

/**
 * Checks a partial settings object and returns a clean copy with only known keys.
 * @param {unknown} patch
 * @returns {Partial<Settings>}
 * @throws {ValidationError} `settings` for a non-object, an unknown key or a bad value
 */
export function validateSettings(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('settings', 'settings must be an object');
  }
  /** @type {Record<string, unknown>} */
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(CHECKS, key)) {
      throw new ValidationError('settings', `unknown setting ${key}`, { key });
    }
    if (!CHECKS[/** @type {keyof Settings} */ (key)](value)) {
      throw new ValidationError('settings', `invalid value for ${key}`, { key });
    }
    clean[key] = value;
  }
  return /** @type {Partial<Settings>} */ (clean);
}
