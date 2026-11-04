import { describe, expect, it } from 'vitest';
import { roundDay, roundUp } from '../../src/lib/rounding.js';

const MIN = 60_000;

describe('roundUp', () => {
  it.each([
    [0, 15, 0],
    [1, 15, 0], // below a second
    [1000, 15, 15 * MIN],
    [15 * MIN, 15, 15 * MIN],
    [15 * MIN + 400, 15, 15 * MIN], // a timer's leftover milliseconds
    [15 * MIN + 1000, 15, 30 * MIN],
    [7 * MIN, 5, 10 * MIN],
    [7 * MIN, 6, 12 * MIN],
    [61 * MIN, 6, 66 * MIN],
    [7 * MIN + 30_500, 0, 7 * MIN + 30_000],
    [-5 * MIN, 15, 0],
  ])('rounds %i ms to a %i-minute step as %i', (ms, step, expected) => {
    expect(roundUp(ms, /** @type {0 | 5 | 6 | 15} */ (step))).toBe(expected);
  });
});

describe('roundDay', () => {
  const parts = [7 * MIN, 7 * MIN, 1 * MIN];

  it('per entry rounds every part, then sums', () => {
    expect(roundDay(parts, { minutes: 15, mode: 'entry' })).toBe(45 * MIN);
    expect(roundDay(parts, { minutes: 6, mode: 'entry' })).toBe(30 * MIN);
    expect(roundDay(parts, { minutes: 5, mode: 'entry' })).toBe(25 * MIN);
  });

  it('per day sums, then rounds once', () => {
    expect(roundDay(parts, { minutes: 15, mode: 'day' })).toBe(15 * MIN);
    expect(roundDay(parts, { minutes: 6, mode: 'day' })).toBe(18 * MIN);
    expect(roundDay(parts, { minutes: 5, mode: 'day' })).toBe(15 * MIN);
  });

  it('without a step only drops sub-second leftovers, in either mode', () => {
    expect(roundDay([MIN + 300, MIN + 300], { minutes: 0, mode: 'entry' })).toBe(2 * MIN);
    expect(roundDay([MIN + 600, MIN + 600], { minutes: 0, mode: 'day' })).toBe(2 * MIN + 1000);
  });

  it('gives 0 for a day without parts', () => {
    expect(roundDay([], { minutes: 15, mode: 'entry' })).toBe(0);
    expect(roundDay([], { minutes: 15, mode: 'day' })).toBe(0);
  });
});
