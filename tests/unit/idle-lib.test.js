import { describe, expect, it } from 'vitest';
import { detectionInterval, idleSince, sleepGap } from '../../src/lib/idle.js';
import { formatAwayRange } from '../../src/lib/format.js';

const MIN = 60_000;
/** Tuesday 2026-10-20 14:02 in Europe/Zurich. */
const T = Date.UTC(2026, 9, 20, 12, 2);

describe('idle math', () => {
  it('turns the threshold into a detection interval', () => {
    expect(detectionInterval(0)).toBeNull();
    expect(detectionInterval(10)).toBe(600);
    expect(detectionInterval(0.1)).toBe(15);
  });

  it('dates the absence back by the threshold', () => {
    expect(idleSince(T + 10 * MIN, 10)).toBe(T);
  });

  it('reads a late tick as a sleep', () => {
    const alarm = { scheduledTime: T, periodInMinutes: 1 };
    expect(sleepGap(alarm, T + 2 * MIN, 10)).toBeNull();
    expect(sleepGap(alarm, T + 10 * MIN, 10)).toBeNull();
    expect(sleepGap(alarm, T + 90 * MIN, 10)).toEqual({ since: T - MIN, until: T + 90 * MIN });
    expect(sleepGap(alarm, T + 90 * MIN, 0)).toBeNull();
    expect(sleepGap({ scheduledTime: T }, T + 90 * MIN, 5)?.since).toBe(T - MIN);
  });
});

describe('formatAwayRange', () => {
  it('shows times on one day', () => {
    expect(formatAwayRange(T, T + 23 * MIN, { locale: 'en-GB' })).toBe('14:02 – 14:25');
    expect(formatAwayRange(T, T + 23 * MIN, { locale: 'fr' })).toBe('14:02 – 14:25');
  });

  it('adds weekdays across midnight', () => {
    const late = Date.UTC(2026, 9, 20, 21, 50); // 23:50
    expect(formatAwayRange(late, late + 30 * MIN, { locale: 'en-GB' })).toBe(
      'Tue\u00a023:50 – Wed\u00a000:20',
    );
  });

  it('keeps each time whole on a 12-hour clock', () => {
    expect(formatAwayRange(T, T + 23 * MIN, { locale: 'en-US' })).toBe(
      '2:02\u00a0PM – 2:25\u00a0PM',
    );
  });
});
