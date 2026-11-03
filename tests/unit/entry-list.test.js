import { describe, expect, it } from 'vitest';
import { ENTRY_RANGES, findOverlaps, groupByDay, rangeOf } from '../../src/lib/entry-list.js';

const MIN = 60_000;
const at = (/** @type {number[]} */ ...parts) =>
  new Date(parts[0], parts[1], parts[2], parts[3] ?? 0, parts[4] ?? 0).getTime();
/** Tuesday 2026-10-20 12:00 local (TZ=Europe/Zurich). */
const NOW = at(2026, 9, 20, 12);

/** @returns {import('../../src/lib/types.js').Entry} */
function entry(id, start, end, extra = {}) {
  return {
    id,
    taskId: 't',
    start,
    end,
    note: '',
    source: 'timer',
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
    ...extra,
  };
}

describe('rangeOf', () => {
  it('lists the presets in menu order', () => {
    expect(ENTRY_RANGES).toEqual(['today', 'week', 'lastWeek', 'month', 'all']);
  });

  it('computes local ranges for each preset', () => {
    const opts = { now: NOW, weekStart: /** @type {const} */ (1) };
    expect(rangeOf('today', opts)).toEqual({ start: at(2026, 9, 20), end: at(2026, 9, 21) });
    expect(rangeOf('week', opts)).toEqual({ start: at(2026, 9, 19), end: at(2026, 9, 26) });
    expect(rangeOf('lastWeek', opts)).toEqual({ start: at(2026, 9, 12), end: at(2026, 9, 19) });
    expect(rangeOf('month', opts)).toEqual({ start: at(2026, 9, 1), end: at(2026, 10, 1) });
    expect(rangeOf('all', opts)).toBeNull();
    expect(rangeOf('week', { now: NOW, weekStart: 0 })).toEqual({
      start: at(2026, 9, 18),
      end: at(2026, 9, 25),
    });
  });

  it('spans the DST change at the end of October', () => {
    // DST ends on Sunday 25 Oct 2026 in Europe/Zurich.
    const range = rangeOf('lastWeek', { now: at(2026, 9, 28, 9), weekStart: 1 });
    expect(range).toEqual({ start: at(2026, 9, 19), end: at(2026, 9, 26) });
    // 7 days with one 25 h day.
    expect((range?.end ?? 0) - (range?.start ?? 0)).toBe((7 * 24 + 1) * 60 * MIN);
  });
});

describe('groupByDay', () => {
  const entries = [
    entry('a', at(2026, 9, 19, 10, 30), at(2026, 9, 19, 11, 5)),
    entry('b', at(2026, 9, 19, 14, 5), at(2026, 9, 19, 16, 40)),
    entry('night', at(2026, 9, 19, 23), at(2026, 9, 20, 1)),
    entry('run', at(2026, 9, 20, 11), null),
    entry('old', at(2026, 9, 12, 9), at(2026, 9, 12, 10)),
  ];

  it('groups newest day first with day totals; midnight entries count on both days', () => {
    const groups = groupByDay(entries, { now: NOW, range: null });
    expect(groups.map((g) => g.day)).toEqual(['2026-10-20', '2026-10-19', '2026-10-12']);
    const [today, monday] = groups;
    expect(today.start).toBe(at(2026, 9, 20));
    expect(today.rows.map((r) => r.entry.id)).toEqual(['run', 'night']);
    expect(today.rows.map((r) => r.ms)).toEqual([60 * MIN, 60 * MIN]);
    expect(today.total).toBe(120 * MIN);
    expect(monday.rows.map((r) => r.entry.id)).toEqual(['night', 'b', 'a']);
    expect(monday.total).toBe((60 + 155 + 35) * MIN);
  });

  it('lists a timer started this instant with zero length', () => {
    const groups = groupByDay([entry('now', NOW, null)], { now: NOW, range: null });
    expect(groups).toEqual([
      {
        day: '2026-10-20',
        start: at(2026, 9, 20),
        total: 0,
        rows: [{ entry: expect.objectContaining({ id: 'now' }), ms: 0 }],
      },
    ]);
  });

  it('keeps only days inside the range', () => {
    const range = rangeOf('today', { now: NOW, weekStart: 1 });
    expect(groupByDay(entries, { now: NOW, range }).map((g) => g.day)).toEqual(['2026-10-20']);
    expect(groupByDay([], { now: NOW, range })).toEqual([]);
  });
});

describe('findOverlaps', () => {
  const entries = [
    entry('a', at(2026, 9, 20, 9), at(2026, 9, 20, 10)),
    entry('run', at(2026, 9, 20, 11), null),
    entry('gone', at(2026, 9, 20, 9), at(2026, 9, 20, 10), { deletedAt: NOW }),
  ];

  it('finds overlapping entries, excluding the edited one and touching ends', () => {
    const find = (start, end, id = null) =>
      findOverlaps(entries, { id, start, end }, { now: NOW }).map((e) => e.id);
    expect(find(at(2026, 9, 20, 9, 30), at(2026, 9, 20, 9, 45))).toEqual(['a']);
    expect(find(at(2026, 9, 20, 10), at(2026, 9, 20, 11))).toEqual([]);
    expect(find(at(2026, 9, 20, 9, 30), at(2026, 9, 20, 10), 'a')).toEqual([]);
    expect(find(at(2026, 9, 20, 11, 30), at(2026, 9, 20, 11, 45))).toEqual(['run']);
    // The running entry only reaches `now`.
    expect(find(at(2026, 9, 20, 12), at(2026, 9, 20, 13))).toEqual([]);
  });
});
