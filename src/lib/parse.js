// Parsing of user-typed values (the task dialog's estimate field).
import { ValidationError } from './errors.js';
import { LIMITS } from './limits.js';

/** `1h30`, `1h 30m`, `1.5h`, `1,5 h`, `90m`, `2h`. */
const UNITS = /^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+(?:[.,]\d+)?)\s*m?)?$/iu;
/** `1:30`. */
const CLOCK = /^(\d+):([0-5]\d)$/u;

/**
 * Minutes from an estimate typed by the user: `90m`, `1.5h`, `1,5h`, `1h30`, `1h 30m`, `1:30`,
 * or a bare number of hours (`2`, `0.5`). Blank means no estimate.
 * @param {string} text
 * @returns {number | null} whole minutes (rounded), or null for blank
 * @throws {ValidationError} `estimate` when it can't be read or is out of range
 */
export function parseEstimate(text) {
  const value = text.trim();
  if (value === '') return null;
  /** @param {string} s */
  const num = (s) => Number(s.replace(',', '.'));
  /** @type {number} */
  let minutes;
  const clock = CLOCK.exec(value);
  const units = UNITS.exec(value);
  if (clock) {
    minutes = num(clock[1]) * 60 + num(clock[2]);
  } else if (/^\d+(?:[.,]\d+)?$/u.test(value)) {
    minutes = num(value) * 60;
  } else if (units && (units[1] !== undefined || /m\s*$/iu.test(value))) {
    // After hours, a bare number is minutes (`1h30`); alone it needs the `m` (`90m`).
    minutes = (units[1] ? num(units[1]) * 60 : 0) + (units[2] ? num(units[2]) : 0);
  } else {
    throw new ValidationError('estimate', `unreadable estimate: ${value}`);
  }
  const rounded = Math.round(minutes);
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > LIMITS.estimateMin) {
    throw new ValidationError('estimate', `estimate out of range: ${value}`);
  }
  return rounded;
}
