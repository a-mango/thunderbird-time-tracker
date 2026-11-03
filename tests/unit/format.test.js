import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDay,
  formatTimeRange,
  formatTimerLabel,
  formatDuration,
  formatElapsed,
  formatEstimate,
  formatRelative,
  formatTime,
  NO_VALUE,
} from '../../src/lib/format.js';

const min = (n) => n * 60_000;
/** ICU may put a narrow no-break space before AM/PM; compare with plain spaces. */
const plain = (text) => text.replace(/\s/gu, ' ');

describe('formatDuration', () => {
  it.each([
    [0, '0m'],
    [59_999, '0m'],
    [min(25), '25m'],
    [min(65), '1h 05m'],
    [min(30 * 60 + 45), '30h 45m'],
    [min(60), '1h 00m'],
    [-min(5), '0m'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it('shows a dash for missing values', () => {
    expect(formatDuration(null)).toBe(NO_VALUE);
    expect(formatDuration(undefined)).toBe(NO_VALUE);
    expect(formatDuration(Number.NaN)).toBe(NO_VALUE);
  });
});

describe('formatDuration, decimal format', () => {
  it.each([
    [0, '0.00h'],
    [min(65), '1.08h'],
    [min(90), '1.50h'],
    [min(30 * 60 + 45), '30.75h'],
    [min(1), '0.02h'],
    [-min(5), '0.00h'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatDuration(ms, { format: 'decimal' })).toBe(text);
  });

  it('shows a dash for missing values', () => {
    expect(formatDuration(null, { format: 'decimal' })).toBe(NO_VALUE);
    expect(formatDuration(Number.POSITIVE_INFINITY, { format: 'decimal' })).toBe(NO_VALUE);
  });

  it("keeps 'hm' as the default", () => {
    expect(formatDuration(min(65), { format: 'hm' })).toBe('1h 05m');
    expect(formatDuration(min(65), {})).toBe('1h 05m');
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0:00:00'],
    [9_999, '0:00:09'],
    [(3600 + 5 * 60 + 12) * 1000, '1:05:12'],
    [36 * 3600 * 1000, '36:00:00'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});

describe('formatEstimate', () => {
  it.each([
    [1200, '20h'],
    [90, '1h 30m'],
    [30, '30m'],
  ])('%d min -> %s', (minutes, text) => {
    expect(formatEstimate(minutes)).toBe(text);
  });
});

describe('formatRelative', () => {
  // Tue 20 Oct 2026, 14:45 local time.
  const now = new Date(2026, 9, 20, 14, 45).getTime();
  const options = {
    now,
    locale: 'en-GB',
    todayLabel: 'Today',
    hourCycle: /** @type {const} */ ('h23'),
  };
  it.each([
    [new Date(2026, 9, 20, 10, 25), 'Today 10:25'],
    [new Date(2026, 9, 20, 0, 0), 'Today 00:00'],
    [new Date(2026, 9, 19, 17, 30), 'Mon 17:30'],
    [new Date(2026, 9, 14, 9, 0), 'Wed 09:00'],
    [new Date(2026, 9, 13, 23, 59), '13 Oct'],
    [new Date(2025, 9, 16, 12, 0), '16/10/2025'],
    // Future timestamps (clock skew) are dates, never "Today".
    [new Date(2026, 9, 21, 9, 0), '21 Oct'],
  ])('%s -> %s', (date, text) => {
    expect(formatRelative(date.getTime(), options)).toBe(text);
  });
});

describe('formatTime', () => {
  const morning = new Date(2026, 9, 20, 9, 5).getTime();
  const evening = new Date(2026, 9, 20, 21, 40).getTime();
  const midnight = new Date(2026, 9, 20, 0, 0).getTime();

  it.each([
    ['en-US', morning, '9:05 AM'],
    ['en-US', evening, '9:40 PM'],
    ['en-US', midnight, '12:00 AM'],
    ['en-GB', morning, '09:05'],
    ['en-GB', evening, '21:40'],
    ['de-CH', midnight, '00:00'],
  ])('uses the locale default hour cycle (%s)', (locale, ms, text) => {
    expect(plain(formatTime(ms, { locale }))).toBe(text);
  });

  it('honours an explicit hour cycle', () => {
    expect(formatTime(morning, { locale: 'en-US', hourCycle: 'h23' })).toBe('09:05');
    expect(plain(formatTime(evening, { locale: 'en-GB', hourCycle: 'h12' }))).toMatch(
      /^9:40 pm$/iu,
    );
  });
});

describe('formatRelative, locale defaults', () => {
  const now = new Date(2026, 9, 20, 14, 45).getTime();
  const ms = new Date(2026, 9, 20, 10, 25).getTime();

  it('is 12-hour in en-US and 24-hour in en-GB without an hour cycle', () => {
    expect(plain(formatRelative(ms, { now, locale: 'en-US', todayLabel: 'Today' }))).toBe(
      'Today 10:25 AM',
    );
    expect(formatRelative(ms, { now, locale: 'en-GB', todayLabel: 'Today' })).toBe('Today 10:25');
  });

  it('formats weekdays with the same time format', () => {
    const monday = new Date(2026, 9, 19, 17, 30).getTime();
    expect(plain(formatRelative(monday, { now, locale: 'en-US', todayLabel: 'Today' }))).toBe(
      'Mon 5:30 PM',
    );
  });
});

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [min(9) + 59_000, '0:09'],
    [min(65), '1:05'],
    [min(25 * 60), '25:00'],
    [-1, '0:00'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});

describe('formatTimeRange', () => {
  const start = new Date(2026, 9, 20, 13, 40).getTime();
  const end = new Date(2026, 9, 20, 15, 25).getTime();
  it('joins start and end, or start and the now label', () => {
    expect(formatTimeRange(start, end, { locale: 'en-GB', nowLabel: 'now' })).toBe('13:40 – 15:25');
    expect(formatTimeRange(start, null, { locale: 'en-GB', nowLabel: 'now' })).toBe('13:40 – now');
    expect(plain(formatTimeRange(start, end, { locale: 'en-US', nowLabel: 'now' }))).toBe(
      '1:40 PM – 3:25 PM',
    );
  });
});

describe('formatDay', () => {
  const now = new Date(2026, 9, 20, 12).getTime();
  it('shows weekday, day and month, and the year for other years', () => {
    expect(formatDay(new Date(2026, 9, 19, 9).getTime(), { now, locale: 'en-GB' })).toBe(
      'Mon 19 Oct',
    );
    expect(formatDay(new Date(2025, 9, 16).getTime(), { now, locale: 'en-GB' })).toBe(
      'Thu, 16 Oct 2025',
    );
  });
});

describe('formatTimerLabel', () => {
  it('keeps short labels and cuts long ones to the limit', () => {
    expect(formatTimerLabel(min(65), 'Bookkeeping')).toBe('1:05 · Bookkeeping');
    const long = formatTimerLabel(min(65), 'Checkout form validation');
    expect(long).toBe('1:05 · Checkout form va…');
    expect([...long]).toHaveLength(24);
    expect(formatTimerLabel(0, 'Task name here', { max: 12 })).toBe('0:00 · Task…');
  });
});
