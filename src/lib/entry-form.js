// Pure helpers behind the entry and split dialogs: native date/time input values in local time,
// and the checks the dialogs show before saving. Inputs have minute precision; the dialogs keep
// an entry's stored milliseconds until the user edits that field.
import { addDays, startOfDay } from './time.js';

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the local day of `ms` (an `<input type="date">` value). @param {number} ms */
export function dateInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HH:MM` local time of `ms` (an `<input type="time">` value). @param {number} ms */
export function timeInput(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Epoch ms of a local date and time from inputs, or `null` when either is blank or malformed.
 * @param {string} date `YYYY-MM-DD`
 * @param {string} time `HH:MM` (seconds, if the browser adds them, are ignored)
 */
export function combine(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  const t = /^(\d{2}):(\d{2})/u.exec(time);
  if (!d || !t) return null;
  const ms = new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The end from an end-time input: on the start's day, or the next day when that time isn't
 * after the start (23:00 – 01:00 ends the next day). `null` for a blank or malformed time.
 * @param {string} time `HH:MM`
 * @param {number} start
 */
export function endAfter(time, start) {
  const sameDay = combine(dateInput(start), time);
  if (sameDay === null || sameDay > start) return sameDay;
  return combine(dateInput(addDays(startOfDay(start), 1)), time);
}

/**
 * The latest instant with local time `time` in `(after, before]`, or `null` (split points: a
 * time of day inside an entry that may cross midnight).
 * @param {string} time `HH:MM`
 * @param {{after: number, before: number}} range
 */
export function latestAt(time, { after, before }) {
  for (let day = startOfDay(before); day >= startOfDay(after); day = addDays(day, -1)) {
    const at = combine(dateInput(day), time);
    if (at !== null && at > after && at <= before) return at;
  }
  return null;
}

/**
 * @typedef {'start-missing' | 'start-future' | 'end-missing' | 'end-before-start' | 'end-future'}
 *   EntryProblem
 */

/**
 * What is wrong with an entry draft, or `null`. `end === null` means "still running", which only
 * the running entry may be; the running entry must have started, and can't end in the future.
 * @param {{start: number | null, end: number | null, running: boolean, now: number}} draft
 * @returns {EntryProblem | null}
 */
export function entryProblem({ start, end, running, now }) {
  if (start === null) return 'start-missing';
  if (running && start >= now) return 'start-future';
  if (end === null) return running ? null : 'end-missing';
  if (!(start < end)) return 'end-before-start';
  if (running && end > now) return 'end-future';
  return null;
}
