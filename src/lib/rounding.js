// Report-time rounding (docs/SPEC.md, Settings; S3). Nothing rounded is ever stored: reports and
// their exports round the durations they show, the database keeps the exact entries.

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * @typedef {0 | 5 | 6 | 15} RoundingStep minutes; 0 = no rounding
 * @typedef {'entry' | 'day'} RoundingMode round each entry's part of a day, or each task's day
 * @typedef {{minutes: RoundingStep, mode: RoundingMode}} Rounding
 */

/** @type {Rounding} */
export const NO_ROUNDING = Object.freeze({ minutes: 0, mode: 'entry' });

/**
 * Rounds a duration up to the next multiple of the step, as billing usually does. Leftover
 * milliseconds below a whole second are dropped first, so a 15:00.4 timer stays 15 min.
 * @param {number} ms
 * @param {RoundingStep} minutes
 */
export function roundUp(ms, minutes) {
  const whole = Math.floor(Math.max(0, ms) / SECOND) * SECOND;
  if (minutes === 0) return whole;
  const step = minutes * MINUTE;
  return Math.ceil(whole / step) * step;
}

/**
 * Total of one task's day: the parts are the entries' pieces of that day (`splitByDay`).
 * Per entry, each part is rounded before summing; per day, the sum is rounded once.
 * @param {number[]} parts durations in ms
 * @param {Rounding} rounding
 */
export function roundDay(parts, { minutes, mode }) {
  if (mode === 'entry') return parts.reduce((sum, ms) => sum + roundUp(ms, minutes), 0);
  return roundUp(
    parts.reduce((sum, ms) => sum + ms, 0),
    minutes,
  );
}
