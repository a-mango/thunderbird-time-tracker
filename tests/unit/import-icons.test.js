import { describe, expect, it } from 'vitest';
import { parseIconList, rewriteSvg } from '../../scripts/import-icons.mjs';

const MPL = `<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->`;

const svg = (paths) =>
  `${MPL}\n<svg xmlns="http://www.w3.org/2000/svg" fill-opacity="context-fill-opacity" viewBox="0 0 16 16">\n${paths}\n</svg>\n`;

describe('parseIconList', () => {
  it('drops comments and blank lines', () => {
    expect(parseIconList('# head\n\ncompact/a.svg  # inline\n  b.svg\n')).toEqual([
      'compact/a.svg',
      'b.svg',
    ]);
  });
});

describe('rewriteSvg', () => {
  it('maps context-stroke to currentColor and context-fill to a 20% overridable tint', () => {
    const out = rewriteSvg(
      svg('<path d="M0" fill="context-fill"/><path d="M1" fill="context-stroke"/>'),
      'compact/x.svg',
    );
    expect(out).toContain(
      '<path d="M0" fill="currentColor" style="fill-opacity: var(--icon-fill-opacity, 0.2)"/>',
    );
    expect(out).toContain('<path d="M1" fill="currentColor"/>');
    expect(out).not.toContain('context-');
  });

  it('handles the "context-fill transparent" fallback form', () => {
    const out = rewriteSvg(
      svg('<path fill="context-fill transparent"/><path fill="context-stroke transparent"/>'),
      'nav-down-sm.svg',
    );
    expect(out).not.toContain('transparent');
    expect(out).not.toContain('context-');
  });

  it('keeps the MPL header first, adds provenance and an id for <use>', () => {
    const out = rewriteSvg(svg('<path fill="context-stroke"/>'), 'compact/x.svg');
    expect(out.startsWith(MPL)).toBe(true);
    expect(out).toContain('icons/new/compact/x.svg (THUNDERBIRD_157_0_RELEASE)');
    expect(out).toMatch(/<svg id="i" xmlns=/);
    expect(out).not.toContain('fill-opacity="context-fill-opacity"');
  });

  it('drops inner comments', () => {
    const out = rewriteSvg(svg('<!-- note --><path fill="context-stroke"/>'), 'a.svg');
    expect(out).not.toContain('note');
  });

  it('rejects a root <svg> that already has an id', () => {
    const withId = svg('<path fill="context-stroke"/>').replace('<svg ', '<svg id="x" ');
    expect(() => rewriteSvg(withId, 'a.svg')).toThrow(/already has an id/);
  });

  it('rejects files without the MPL header or with unknown context paint', () => {
    expect(() => rewriteSvg('<svg/>', 'a.svg')).toThrow(/MPL/);
    expect(() => rewriteSvg(svg('<path stroke="context-stroke"/>'), 'a.svg')).toThrow(/unhandled/);
  });
});
