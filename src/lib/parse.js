// Parsing of user-typed values (the task dialog's estimate field, the timesheet's cells).
import { ValidationError } from './errors.js';
import { LIMITS } from './limits.js';

/** `1h30`, `1h 30m`, `1.5h`, `1,5 h`, `90m`, `2h`. */
const UNITS = /^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+(?:[.,]\d+)?)\s*m?)?$/iu;
/** `1:30`. */
const CLOCK = /^(\d+):([0-5]\d)$/u;
/** A bare number from this value up is minutes; below it, hours. */
const BARE_MINUTES = 10;

/**
 * Minutes from an estimate typed by the user: `90m`, `1.5h`, `1,5h`, `1h30`, `1h 30m`, `1:30`,
 * or a bare number: hours below 10 (`2`, `0.5`), minutes from 10 (`90`), so `90` is never 90 h.
 * Blank means no estimate.
 * @param {string} text
 * @returns {number | null} whole minutes (rounded), or null for blank
 * @throws {ValidationError} `estimate` when it can't be read or is out of range
 */
export function parseEstimate(text) {
  const value = text.trim();
  if (value === '') return null;
  const rounded = Math.round(readMinutes(value, 'estimate'));
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > LIMITS.estimateMin) {
    throw new ValidationError('estimate', `estimate out of range: ${value}`);
  }
  return rounded;
}

/**
 * Minutes of a timesheet cell (S3): the estimate formats, plus `0` or blank for none.
 * At most 24 h: a day can't hold more.
 * @param {string} text
 * @returns {number} whole minutes (rounded)
 * @throws {ValidationError} `duration` when it can't be read or is out of range
 */
export function parseDayTotal(text) {
  const value = text.trim();
  if (value === '' || /^0+(?:[.,]0+)?\s*[hm]?$/iu.test(value)) return 0;
  const rounded = Math.round(readMinutes(value, 'duration'));
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > 24 * 60) {
    throw new ValidationError('duration', `duration out of range: ${value}`);
  }
  return rounded;
}

/**
 * Minutes (not rounded) from a non-blank duration in any of the estimate formats.
 * @param {string} value trimmed
 * @param {string} code error code
 * @throws {ValidationError} `code` when it can't be read
 */
function readMinutes(value, code) {
  /** @param {string} s */
  const num = (s) => Number(s.replace(',', '.'));
  /** @type {number} */
  let minutes;
  const clock = CLOCK.exec(value);
  const units = UNITS.exec(value);
  if (clock) {
    minutes = num(clock[1]) * 60 + num(clock[2]);
  } else if (/^\d+(?:[.,]\d+)?$/u.test(value)) {
    minutes = num(value) < BARE_MINUTES ? num(value) * 60 : num(value);
  } else if (units && (units[1] !== undefined || /m\s*$/iu.test(value))) {
    // After hours, a bare number is minutes (`1h30`); alone it needs the `m` (`90m`).
    minutes = (units[1] ? num(units[1]) * 60 : 0) + (units[2] ? num(units[2]) : 0);
  } else {
    throw new ValidationError(code, `unreadable ${code}: ${value}`);
  }
  return minutes;
}
