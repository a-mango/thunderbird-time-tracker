import { describe, expect, it } from 'vitest';
import {
  ancestorPath,
  badgeStyle,
  buildProjectTree,
  canDrop,
  dropTarget,
  showsTotal,
  moveTargets,
  subtreeIds,
  viewTotals,
} from '../../src/lib/sidebar.js';

/** @typedef {import('../../src/lib/types.js').Project} Project */
/** @typedef {import('../../src/lib/sidebar.js').SidebarNode} SidebarNode */

/**
 * @param {string} id
 * @param {string | null} parentId
 * @param {number} order
 * @param {Partial<Project>} [extra]
 * @returns {Project}
 */
const project = (id, parentId, order, extra = {}) => ({
  id,
  parentId,
  name: id,
  color: '#2493ef',
  order,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

/** client > harbor > (discovery, build), client > fern; internal > training */
const PROJECTS = [
  project('internal', null, 1),
  project('client', null, 0),
  project('build', 'harbor', 1),
  project('harbor', 'client', 0),
  project('discovery', 'harbor', 0),
  project('fern', 'client', 1),
  project('training', 'internal', 0),
];

/** @param {SidebarNode[]} nodes @returns {unknown[]} */
const shape = (nodes) => nodes.map((n) => (n.children.length ? [n.id, shape(n.children)] : n.id));

describe('buildProjectTree', () => {
  it('nests projects in sibling order with labels', () => {
    const { nodes, archived } = buildProjectTree(PROJECTS);
    expect(shape(nodes)).toEqual([
      ['client', [['harbor', ['discovery', 'build']], 'fern']],
      ['internal', ['training']],
    ]);
    expect(nodes[0].label).toBe('client');
    expect(archived).toEqual([]);
  });

  it('moves archived subtrees to the Archive, children included', () => {
    const projects = PROJECTS.map((p) =>
      p.id === 'harbor' || p.id === 'build' || p.id === 'internal' ? { ...p, archived: true } : p,
    );
    const { nodes, archived } = buildProjectTree(projects);
    expect(shape(nodes)).toEqual([['client', ['fern']]]);
    expect(shape(archived)).toEqual([
      ['harbor', ['discovery', 'build']],
      ['internal', ['training']],
    ]);
  });

  it('treats orphans as roots and cuts stored cycles', () => {
    const projects = [
      project('a', 'missing', 0),
      project('loop1', 'loop2', 0),
      project('loop2', 'loop1', 0),
    ];
    expect(shape(buildProjectTree(projects).nodes)).toEqual(['a']);
  });
});

describe('paths and badges', () => {
  it('collects subtrees and ancestor paths', () => {
    expect([...subtreeIds(PROJECTS, 'harbor')].sort()).toEqual(['build', 'discovery', 'harbor']);
    expect(ancestorPath(PROJECTS, 'build')).toEqual(['build', 'harbor', 'client']);
    expect(ancestorPath(PROJECTS, null)).toEqual([]);
    const cycle = [project('x', 'y', 0), project('y', 'x', 0)];
    expect(ancestorPath(cycle, 'x')).toEqual(['x', 'y']);
  });

  it('marks the running project new and its collapsed ancestors outlined', () => {
    const runningPath = ancestorPath(PROJECTS, 'build');
    expect(badgeStyle('build', { runningPath, expanded: false })).toBe('new');
    expect(badgeStyle('harbor', { runningPath, expanded: false })).toBe('outlined');
    expect(badgeStyle('harbor', { runningPath, expanded: true })).toBeNull();
    expect(badgeStyle('fern', { runningPath, expanded: false })).toBeNull();
    expect(badgeStyle('fern', { runningPath: [], expanded: false })).toBeNull();
  });
});

describe('moving', () => {
  it('offers visible projects outside the own subtree, with depth', () => {
    expect(moveTargets(PROJECTS, 'harbor').map((t) => [t.id, t.depth])).toEqual([
      ['client', 0],
      ['fern', 1],
      ['internal', 0],
      ['training', 1],
    ]);
    const archived = PROJECTS.map((p) => (p.id === 'internal' ? { ...p, archived: true } : p));
    expect(moveTargets(archived, null).map((t) => t.id)).toEqual([
      'client',
      'harbor',
      'discovery',
      'build',
      'fern',
    ]);
  });

  it('allows drops between and into visible projects only', () => {
    expect(canDrop(PROJECTS, 'build', 'fern', 'inside')).toBe(true);
    expect(canDrop(PROJECTS, 'build', 'discovery', 'before')).toBe(true);
    // Own subtree, itself, and the current parent are refused.
    expect(canDrop(PROJECTS, 'client', 'build', 'after')).toBe(false);
    expect(canDrop(PROJECTS, 'client', 'client', 'before')).toBe(false);
    expect(canDrop(PROJECTS, 'build', 'harbor', 'inside')).toBe(false);
    expect(canDrop(PROJECTS, 'build', 'harbor', 'after')).toBe(true);
    const archived = PROJECTS.map((p) => (p.id === 'internal' ? { ...p, archived: true } : p));
    expect(canDrop(archived, 'build', 'training', 'inside')).toBe(false);
    expect(canDrop(archived, 'training', 'fern', 'inside')).toBe(false);
  });

  it('resolves drops to a parent and the sibling to insert before', () => {
    expect(dropTarget(PROJECTS, 'fern', 'build', 'inside')).toEqual({
      parentId: 'build',
      beforeId: null,
    });
    expect(dropTarget(PROJECTS, 'fern', 'build', 'before')).toEqual({
      parentId: 'harbor',
      beforeId: 'build',
    });
    expect(dropTarget(PROJECTS, 'fern', 'discovery', 'after')).toEqual({
      parentId: 'harbor',
      beforeId: 'build',
    });
    expect(dropTarget(PROJECTS, 'fern', 'build', 'after')).toEqual({
      parentId: 'harbor',
      beforeId: null,
    });
    // The dragged project is not its own next sibling.
    expect(dropTarget(PROJECTS, 'build', 'discovery', 'after')).toEqual({
      parentId: 'harbor',
      beforeId: null,
    });
    expect(dropTarget(PROJECTS, 'build', 'client', 'after')).toEqual({
      parentId: null,
      beforeId: 'internal',
    });
  });
});

describe('viewTotals', () => {
  it('sums today and week over every task and counts open starred tasks', () => {
    /** @type {any[]} */
    const tasks = [
      { id: 't1', starred: true, status: 'open' },
      { id: 't2', starred: true, status: 'done' },
      { id: 't3', starred: false, status: 'open' },
    ];
    /** @type {Record<string, {today: number, week: number, total: number}>} */
    const totals = {
      t1: { today: 1, week: 10, total: 100 },
      t2: { today: 2, week: 20, total: 200 },
      t3: { today: 0, week: 30, total: 300 },
    };
    expect(viewTotals(tasks, (id) => totals[id])).toEqual({ today: 3, week: 60, starred: 1 });
  });
});

describe('showsTotal', () => {
  const row = { root: true, expanded: true, hasChildren: true, running: false };
  it('hides the total of an expanded top-level project with subprojects', () => {
    expect(showsTotal(row)).toBe(false);
  });
  it('shows it when collapsed, without children, nested or running', () => {
    expect(showsTotal({ ...row, expanded: false })).toBe(true);
    expect(showsTotal({ ...row, hasChildren: false })).toBe(true);
    expect(showsTotal({ ...row, root: false })).toBe(true);
    expect(showsTotal({ ...row, running: true })).toBe(true);
  });
});
