import { describe, expect, it } from 'vitest';
import { formatDuration, formatElapsed, NO_VALUE } from '../../src/lib/format.js';

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
