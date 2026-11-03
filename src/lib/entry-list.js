// Pure helpers for the detail pane's entry list: range presets, grouping by local day with day
// totals, and overlap checks for the entry dialog. An entry that crosses midnight is listed under
// every day it overlaps and counts toward each one (docs/SPEC.md, Data model).
import { addDays, dayKey, dayRange, overlapMs, splitByDay, startOfDay, weekRange } from './time.js';

/**
 * @typedef {import('./types.js').Entry} Entry
 * @typedef {import('./time.js').Range} Range
 * @typedef {import('./time.js').WeekStart} WeekStart
 * @typedef {'today' | 'week' | 'lastWeek' | 'month' | 'all'} EntryRange
 * @typedef {{entry: Entry, ms: number}} DayRow `ms`: the part of the entry on that day
 * @typedef {{day: string, start: number, total: number, rows: DayRow[]}} DayGroup
 */

/** @type {readonly EntryRange[]} */
export const ENTRY_RANGES = Object.freeze(['today', 'week', 'lastWeek', 'month', 'all']);

/**
 * The local-time range of a preset; `null` for `all`.
 * @param {EntryRange} name
 * @param {{now: number, weekStart: WeekStart}} options
 * @returns {Range | null}
 */
export function rangeOf(name, { now, weekStart }) {
  switch (name) {
    case 'today':
      return dayRange(now);
    case 'week':
      return weekRange(now, weekStart);
    case 'lastWeek': {
      const { start } = weekRange(now, weekStart);
      return { start: weekRange(addDays(start, -1), weekStart).start, end: start };
    }
    case 'month': {
      const date = new Date(now);
      const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
      return { start: startOfDay(start), end: startOfDay(end) };
    }
    default:
      return null;
  }
}

/**
 * Groups entries by local day, newest day first and newest entry first within a day. Only the
 * days inside `range` (all days when `null`) are kept; running entries run up to `now`.
 * @param {readonly Entry[]} entries
 * @param {{now: number, range: Range | null}} options
 * @returns {DayGroup[]}
 */
export function groupByDay(entries, { now, range }) {
  /** @type {Map<string, DayGroup>} */
  const groups = new Map();
  for (const entry of entries) {
    const parts = splitByDay(entry, { now });
    // A timer started this instant has no length yet but is listed.
    if (parts.length === 0 && entry.end === null && entry.start <= now) {
      parts.push({ day: dayKey(entry.start), start: entry.start, end: entry.start, ms: 0 });
    }
    for (const part of parts) {
      // Inside the range: overlapping it, or (zero length) starting in it.
      const inside =
        !range || (part.start < range.end && (part.end > range.start || part.start >= range.start));
      if (!inside) continue;
      let group = groups.get(part.day);
      if (!group) {
        group = { day: part.day, start: startOfDay(part.start), total: 0, rows: [] };
        groups.set(part.day, group);
      }
      group.total += part.ms;
      group.rows.push({ entry, ms: part.ms });
    }
  }
  const sorted = [...groups.values()].sort((a, b) => b.start - a.start);
  for (const group of sorted) group.rows.sort((a, b) => b.entry.start - a.entry.start);
  return sorted;
}

/**
 * Entries that overlap `[start, end)` (the entry being edited, `id`, excluded). A running entry
 * counts up to `now`.
 * @param {readonly Entry[]} entries
 * @param {{id?: string | null, start: number, end: number}} candidate
 * @param {{now: number}} options
 * @returns {Entry[]}
 */
export function findOverlaps(entries, { id = null, start, end }, { now }) {
  return entries.filter(
    (entry) =>
      entry.id !== id &&
      entry.deletedAt === null &&
      overlapMs(entry.start, entry.end ?? now, start, end) > 0,
  );
}
