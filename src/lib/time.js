// Pure local-time calendar math. Days and weeks come from `Date` calendar fields, never from
// adding 24 h, so DST days are 23 h or 25 h long. Times are epoch ms; `now` is always passed in.

/** @typedef {0 | 1} WeekStart 0 = Sunday, 1 = Monday (the `Date#getDay` numbering). */
/** @typedef {{start: number, end: number}} Range half-open `[start, end)` in epoch ms */
/** @typedef {{day: string, start: number, end: number, ms: number}} DayPart */

/**
 * Local midnight at the start of the day containing `ms`.
 * @param {number} ms
 */
export function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Same local wall-clock time `n` calendar days later (or earlier for negative `n`).
 * @param {number} ms
 * @param {number} n
 */
export function addDays(ms, n) {
  const date = new Date(ms);
  date.setDate(date.getDate() + n);
  return date.getTime();
}

/**
 * Local calendar day as `YYYY-MM-DD`.
 * @param {number} ms
 */
export function dayKey(ms) {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The local day containing `ms`.
 * @param {number} ms
 * @returns {Range}
 */
export function dayRange(ms) {
  const start = startOfDay(ms);
  return { start, end: addDays(start, 1) };
}

/**
 * Local midnight at the start of the week containing `ms`.
 * @param {number} ms
 * @param {WeekStart} weekStart
 */
export function startOfWeek(ms, weekStart) {
  const date = new Date(ms);
  const back = (date.getDay() - weekStart + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back).getTime();
}

/**
 * The local week containing `ms`.
 * @param {number} ms
 * @param {WeekStart} weekStart
 * @returns {Range}
 */
export function weekRange(ms, weekStart) {
  const start = startOfWeek(ms, weekStart);
  return { start, end: addDays(start, 7) };
}

/**
 * Length of the overlap of `[start, end)` with `[rangeStart, rangeEnd)`; 0 when disjoint.
 * @param {number} start
 * @param {number} end
 * @param {number} rangeStart
 * @param {number} rangeEnd
 */
export function overlapMs(start, end, rangeStart, rangeEnd) {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}

/**
 * Splits an entry at local midnights. A running entry (`end === null`) runs up to `now`.
 * Empty, reversed or not-yet-started entries give no parts.
 * @param {{start: number, end: number | null}} entry
 * @param {{now: number}} options
 * @returns {DayPart[]}
 */
export function splitByDay({ start, end }, { now }) {
  const stop = end ?? now;
  /** @type {DayPart[]} */
  const parts = [];
  let from = start;
  while (from < stop) {
    const to = Math.min(stop, dayRange(from).end);
    parts.push({ day: dayKey(from), start: from, end: to, ms: to - from });
    from = to;
  }
  return parts;
}
