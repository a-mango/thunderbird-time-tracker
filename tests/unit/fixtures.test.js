import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateFixtures, summarize } from '../../dev/fixtures.js';

const now = Date.UTC(2026, 9, 20, 12, 0);

describe('dev fixtures', () => {
  it('are deterministic for a seed', () => {
    expect(generateFixtures({ seed: 7, now })).toEqual(generateFixtures({ seed: 7, now }));
    expect(generateFixtures({ seed: 7, now })).not.toEqual(generateFixtures({ seed: 8, now }));
  });

  it('form a valid tree with valid references', () => {
    const { projects, tasks, entries } = generateFixtures({ now });
    const projectIds = new Set(projects.map((p) => p.id));
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const p of projects) if (p.parentId !== null) expect(projectIds).toContain(p.parentId);
    for (const t of tasks) expect(projectIds).toContain(t.projectId);
    for (const e of entries) expect(taskIds).toContain(e.taskId);
  });

  it('respect the entry invariants: start < end, at most one running', () => {
    const { entries } = generateFixtures({ now });
    expect(entries.filter((e) => e.end === null)).toHaveLength(1);
    for (const e of entries) if (e.end !== null) expect(e.start).toBeLessThan(e.end);
    expect(generateFixtures({ now, running: false }).entries.every((e) => e.end !== null)).toBe(
      true,
    );
  });

  it('use only names that appear in the design references', async () => {
    const html = (
      await Promise.all(
        ['three-pane-light', 'cards-timeline-light'].map((name) =>
          readFile(new URL(`../../design/reference/${name}.html`, import.meta.url), 'utf8'),
        ),
      )
    )
      .join('\n')
      .replaceAll('&amp;', '&');
    const { projects, tasks, entries } = generateFixtures({ now });
    const names = [...projects, ...tasks].map((x) => x.name);
    const notes = entries.map((e) => e.note).filter(Boolean);
    for (const name of [...names, ...notes]) expect(html, name).toContain(name);
  });

  it('summarize flattens the tree depth-first in order', () => {
    const summary = summarize(generateFixtures({ now }));
    expect(summary.projects.slice(0, 3).map((p) => [p.name, p.depth])).toEqual([
      ['Client work', 0],
      ['Harbor Coffee — website', 1],
      ['Discovery', 2],
    ]);
  });
});
