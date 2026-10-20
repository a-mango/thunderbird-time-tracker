import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatElapsed,
  formatEstimate,
  formatRelative,
  NO_VALUE,
} from '../../src/lib/format.js';

const min = (n) => n * 60_000;

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
  ])('%s -> %s', (date, text) => {
    expect(formatRelative(date.getTime(), options)).toBe(text);
  });
});
