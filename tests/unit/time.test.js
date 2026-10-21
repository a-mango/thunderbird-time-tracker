import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  dayKey,
  dayRange,
  overlapMs,
  splitByDay,
  startOfDay,
  startOfWeek,
  weekRange,
} from '../../src/lib/time.js';

const HOUR = 3_600_000;
/** Local time in Europe/Zurich (the vitest TZ). */
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('test environment', () => {
  it('runs in Europe/Zurich', () => {
    expect(new Date(2026, 2, 29, 12).getTimezoneOffset()).toBe(-120);
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(-60);
  });
});

describe('startOfDay / addDays / dayKey', () => {
  it('snaps to local midnight', () => {
    expect(startOfDay(at(2026, 10, 20, 14, 45))).toBe(at(2026, 10, 20));
    expect(startOfDay(at(2026, 10, 20))).toBe(at(2026, 10, 20));
  });

  it('adds calendar days, keeping the wall clock across DST', () => {
    expect(addDays(at(2026, 3, 28, 12), 1)).toBe(at(2026, 3, 29, 12));
    expect(addDays(at(2026, 3, 28, 12), 1) - at(2026, 3, 28, 12)).toBe(23 * HOUR);
    expect(addDays(at(2026, 10, 25), 1) - at(2026, 10, 25)).toBe(25 * HOUR);
    expect(addDays(at(2026, 1, 1), -1)).toBe(at(2025, 12, 31));
    expect(addDays(at(2026, 2, 28), 1)).toBe(at(2026, 3, 1));
  });

  it('keys days in local time', () => {
    expect(dayKey(at(2026, 3, 9, 0, 30))).toBe('2026-03-09');
    expect(dayKey(at(2026, 12, 31, 23, 59))).toBe('2026-12-31');
    // 00:30 local is still the previous day in UTC.
    expect(dayKey(at(2026, 7, 1, 0, 30))).toBe('2026-07-01');
  });
});

describe('dayRange', () => {
  it.each([
    ['2026-03-29 (spring forward)', at(2026, 3, 29, 12), 23],
    ['2026-10-25 (fall back)', at(2026, 10, 25, 12), 25],
    ['an ordinary day', at(2026, 10, 20, 12), 24],
  ])('%s is %d h long', (_name, ms, hours) => {
    const { start, end } = dayRange(ms);
    expect(end - start).toBe(hours * HOUR);
    expect(start).toBe(startOfDay(ms));
  });
});

describe('startOfWeek / weekRange', () => {
  it.each([
    // [label, date, weekStart, expected start]
    ['Tuesday, Monday start', at(2026, 10, 20, 9), 1, at(2026, 10, 19)],
    ['Tuesday, Sunday start', at(2026, 10, 20, 9), 0, at(2026, 10, 18)],
    ['Sunday, Monday start', at(2026, 10, 25, 23), 1, at(2026, 10, 19)],
    ['Sunday, Sunday start', at(2026, 10, 25, 23), 0, at(2026, 10, 25)],
    ['Monday, Monday start', at(2026, 10, 19, 0), 1, at(2026, 10, 19)],
    ['Monday, Sunday start', at(2026, 10, 19, 0), 0, at(2026, 10, 18)],
    ['Saturday, Sunday start', at(2026, 10, 24, 23, 59), 0, at(2026, 10, 18)],
    ['across a year', at(2026, 1, 1, 12), 1, at(2025, 12, 29)],
  ])('%s', (_name, ms, weekStart, expected) => {
    expect(startOfWeek(ms, /** @type {0|1} */ (weekStart))).toBe(expected);
  });

  it.each([
    ['the spring-forward week', at(2026, 3, 29, 12), 167],
    ['the fall-back week', at(2026, 10, 25, 12), 169],
    ['an ordinary week', at(2026, 10, 14, 12), 168],
  ])('%s is %d h long (Monday start)', (_name, ms, hours) => {
    const { start, end } = weekRange(ms, 1);
    expect(end - start).toBe(hours * HOUR);
  });

  it('Sunday-start week containing 2026-03-29 is 167 h', () => {
    const { start, end } = weekRange(at(2026, 3, 29, 12), 0);
    expect(start).toBe(at(2026, 3, 29));
    expect(end).toBe(at(2026, 4, 5));
    expect(end - start).toBe(167 * HOUR);
  });
});

describe('overlapMs', () => {
  it.each([
    ['inside', 10, 20, 0, 100, 10],
    ['clamped at both ends', 0, 100, 10, 20, 10],
    ['clamped at the start', 0, 15, 10, 20, 5],
    ['clamped at the end', 15, 30, 10, 20, 5],
    ['disjoint before', 0, 5, 10, 20, 0],
    ['disjoint after', 25, 30, 10, 20, 0],
    ['touching', 0, 10, 10, 20, 0],
    ['reversed entry', 20, 10, 0, 100, 0],
  ])('%s', (_name, start, end, rangeStart, rangeEnd, expected) => {
    expect(overlapMs(start, end, rangeStart, rangeEnd)).toBe(expected);
  });
});

describe('splitByDay', () => {
  const sum = (parts) => parts.reduce((total, part) => total + part.ms, 0);

  it('keeps an entry within one day whole', () => {
    const entry = { start: at(2026, 10, 20, 9), end: at(2026, 10, 20, 10, 30) };
    expect(splitByDay(entry, { now: 0 })).toEqual([
      { day: '2026-10-20', start: entry.start, end: entry.end, ms: 1.5 * HOUR },
    ]);
  });

  it('counts a midnight-crossing entry toward both days', () => {
    const entry = { start: at(2026, 10, 20, 22), end: at(2026, 10, 21, 1, 30) };
    expect(splitByDay(entry, { now: 0 })).toEqual([
      { day: '2026-10-20', start: entry.start, end: at(2026, 10, 21), ms: 2 * HOUR },
      { day: '2026-10-21', start: at(2026, 10, 21), end: entry.end, ms: 1.5 * HOUR },
    ]);
  });

  it('ends exactly at midnight without an empty part', () => {
    const entry = { start: at(2026, 10, 20, 22), end: at(2026, 10, 21) };
    expect(splitByDay(entry, { now: 0 })).toHaveLength(1);
  });

  it('splits across the spring-forward night (2026-03-29 02:00)', () => {
    const entry = { start: at(2026, 3, 28, 23), end: at(2026, 3, 29, 4) };
    const parts = splitByDay(entry, { now: 0 });
    expect(parts.map((p) => [p.day, p.ms / HOUR])).toEqual([
      ['2026-03-28', 1],
      ['2026-03-29', 3], // 00:00 to 04:00 local, but 02:00-03:00 doesn't exist
    ]);
    expect(sum(parts)).toBe(entry.end - entry.start);
  });

  it('splits across the fall-back night (2026-10-25 03:00)', () => {
    const entry = { start: at(2026, 10, 24, 23), end: at(2026, 10, 25, 4) };
    const parts = splitByDay(entry, { now: 0 });
    expect(parts.map((p) => [p.day, p.ms / HOUR])).toEqual([
      ['2026-10-24', 1],
      ['2026-10-25', 5], // 02:00-03:00 happens twice
    ]);
    expect(sum(parts)).toBe(entry.end - entry.start);
  });

  it.each([
    ['spring forward', at(2026, 3, 27, 12), at(2026, 3, 31, 12), [12, 24, 23, 24, 12]],
    ['fall back', at(2026, 10, 23, 12), at(2026, 10, 27, 12), [12, 24, 25, 24, 12]],
  ])('splits a multi-day entry across %s', (_name, start, end, hours) => {
    const parts = splitByDay({ start, end }, { now: 0 });
    expect(parts.map((p) => p.ms / HOUR)).toEqual(hours);
    expect(sum(parts)).toBe(end - start);
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i].start).toBe(parts[i - 1].end);
    }
  });

  it('splits a running entry up to now', () => {
    const now = at(2026, 10, 21, 0, 45);
    const parts = splitByDay({ start: at(2026, 10, 20, 23, 30), end: null }, { now });
    expect(parts.map((p) => [p.day, p.ms / 60_000])).toEqual([
      ['2026-10-20', 30],
      ['2026-10-21', 45],
    ]);
    expect(parts.at(-1)?.end).toBe(now);
  });

  it('returns nothing for empty, reversed or not-yet-started entries', () => {
    const start = at(2026, 10, 20, 9);
    expect(splitByDay({ start, end: start }, { now: 0 })).toEqual([]);
    expect(splitByDay({ start, end: start - 1 }, { now: 0 })).toEqual([]);
    expect(splitByDay({ start, end: null }, { now: start - 1 })).toEqual([]);
  });
});

describe('DST starting at midnight (America/Santiago, 2026-09-06 00:00 → 01:00)', () => {
  // Node re-reads TZ when it changes; restore Zurich for the other suites.
  beforeEach(() => {
    process.env.TZ = 'America/Santiago';
  });
  afterEach(() => {
    process.env.TZ = 'Europe/Zurich';
  });
  const H = 3_600_000;

  it('starts the day at the first existing instant and lasts 23 h', () => {
    const { start, end } = dayRange(new Date(2026, 8, 6, 12).getTime());
    expect(new Date(start).getHours()).toBe(1);
    expect(end).toBe(new Date(2026, 8, 7).getTime());
    expect(end - start).toBe(23 * H);
  });

  it('books the next day from its own midnight', () => {
    const start = new Date(2026, 8, 6, 22).getTime();
    const end = new Date(2026, 8, 7, 2).getTime();
    expect(splitByDay({ start, end }, { now: end }).map((p) => [p.day, p.ms])).toEqual([
      ['2026-09-06', 2 * H],
      ['2026-09-07', 2 * H],
    ]);
  });

  it('gives the week starting on that Sunday 167 h', () => {
    const { start, end } = weekRange(new Date(2026, 8, 10).getTime(), 0);
    expect(dayKey(start)).toBe('2026-09-06');
    expect(end).toBe(new Date(2026, 8, 13).getTime());
    expect(end - start).toBe(167 * H);
  });
});
