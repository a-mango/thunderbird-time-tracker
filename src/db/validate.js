// Input checks shared by the repositories. Each throws a ValidationError whose `code` names the
// field, so callers can point at it. The limits are the importer's (lib/limits.js), so every
// record the repositories store survives an export and re-import.
import { ValidationError } from '../lib/errors.js';
import { COLOR, LIMITS } from '../lib/limits.js';

export { LIMITS };

/** @returns {string} */
export const newId = () => crypto.randomUUID();

/**
 * @param {unknown} input
 * @param {readonly string[]} allowed keys the object may have
 * @returns {Record<string, unknown>}
 */
export function checkFields(input, allowed) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('input', 'expected an object');
  }
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ValidationError('field', `unknown field ${key}`, { key });
  }
  return /** @type {Record<string, unknown>} */ (input);
}

/**
 * @param {unknown} value
 * @returns {string} trimmed, non-empty
 */
export function checkName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name === '' || name.length > LIMITS.name) {
    throw new ValidationError('name', `name must be 1–${LIMITS.name} characters`);
  }
  return name;
}

/**
 * @param {unknown} value
 * @param {string} code
 * @param {number} [max]
 * @returns {string}
 */
export function checkString(value, code, max = LIMITS.text) {
  if (typeof value !== 'string' || value.length > max) {
    throw new ValidationError(code, `${code} must be a string of at most ${max} characters`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string} `#rrggbb`
 */
export function checkColor(value) {
  if (typeof value !== 'string' || !COLOR.test(value)) {
    throw new ValidationError('color', 'color must be #rrggbb');
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string[]} a copy
 */
export function checkTags(value) {
  if (
    !Array.isArray(value) ||
    value.length > LIMITS.tags ||
    !value.every((tag) => typeof tag === 'string' && tag !== '' && tag.length <= LIMITS.tag)
  ) {
    throw new ValidationError(
      'tags',
      `tags must be at most ${LIMITS.tags} non-empty strings of at most ${LIMITS.tag} characters`,
    );
  }
  return [...value];
}

/**
 * @param {unknown} value
 * @param {string} code
 * @returns {number}
 */
export function checkFinite(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(code, `${code} must be a finite number`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} code
 * @returns {boolean}
 */
export function checkBoolean(value, code) {
  if (typeof value !== 'boolean') throw new ValidationError(code, `${code} must be a boolean`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} code
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function checkInteger(value, code, min, max) {
  const n = /** @type {number} */ (value);
  if (!Number.isSafeInteger(value) || n < min || n > max) {
    throw new ValidationError(code, `${code} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

/**
 * An epoch-ms timestamp.
 * @param {unknown} value
 * @param {string} code
 * @returns {number}
 */
export function checkTime(value, code) {
  return checkInteger(value, code, 0, LIMITS.time);
}

/**
 * @param {unknown} value
 * @param {string} code
 * @returns {string} a non-empty id
 */
export function checkId(value, code) {
  if (typeof value !== 'string' || value === '' || value.length > LIMITS.id) {
    throw new ValidationError(code, `${code} must be an id of 1–${LIMITS.id} characters`);
  }
  return value;
}
