import { describe, expect, it } from 'vitest';
import { combine, dateInput, entryProblem, latestAt, timeInput } from '../../src/lib/entry-form.js';

const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo, d, h, mi, s).getTime();
const NOW = at(2026, 9, 20, 12);

describe('input values', () => {
  it('formats local dates and times for native inputs', () => {
    expect(dateInput(at(2026, 0, 5, 7, 3))).toBe('2026-01-05');
    expect(timeInput(at(2026, 0, 5, 7, 3, 59))).toBe('07:03');
  });

  it('combines inputs back to local time, blank or bad values give null', () => {
    expect(combine('2026-10-20', '13:40')).toBe(at(2026, 9, 20, 13, 40));
    expect(combine('2026-10-20', '13:40:15')).toBe(at(2026, 9, 20, 13, 40));
    expect(combine('', '13:40')).toBeNull();
    expect(combine('2026-10-20', '')).toBeNull();
    expect(combine('20.10.2026', '13:40')).toBeNull();
  });
});

describe('latestAt', () => {
  it('finds the latest matching time of day inside the range', () => {
    const range = { after: at(2026, 9, 19, 22), before: at(2026, 9, 20, 1) };
    expect(latestAt('23:30', range)).toBe(at(2026, 9, 19, 23, 30));
    expect(latestAt('00:30', range)).toBe(at(2026, 9, 20, 0, 30));
    expect(latestAt('01:00', range)).toBe(at(2026, 9, 20, 1));
    expect(latestAt('22:00', range)).toBeNull();
    expect(latestAt('12:00', range)).toBeNull();
    expect(latestAt('', range)).toBeNull();
  });

  it('prefers today over the same time yesterday', () => {
    expect(latestAt('09:00', { after: at(2026, 9, 18, 8), before: NOW })).toBe(at(2026, 9, 20, 9));
  });
});

describe('entryProblem', () => {
  const ok = { start: at(2026, 9, 20, 9), end: at(2026, 9, 20, 10), running: false, now: NOW };
  it('accepts a valid stopped entry and a running one without end', () => {
    expect(entryProblem(ok)).toBeNull();
    expect(entryProblem({ ...ok, end: null, running: true })).toBeNull();
    // A stopped entry may lie in the future (planned work); only the running one may not.
    expect(entryProblem({ ...ok, end: at(2026, 9, 20, 15) })).toBeNull();
  });

  it('names the problem', () => {
    expect(entryProblem({ ...ok, start: null })).toBe('start-missing');
    expect(entryProblem({ ...ok, end: null })).toBe('end-missing');
    expect(entryProblem({ ...ok, end: ok.start })).toBe('end-before-start');
    expect(entryProblem({ ...ok, end: at(2026, 9, 20, 8) })).toBe('end-before-start');
    expect(entryProblem({ ...ok, running: true, end: at(2026, 9, 20, 13) })).toBe('end-future');
    expect(entryProblem({ ...ok, running: true, end: null, start: NOW })).toBe('start-future');
  });
});
