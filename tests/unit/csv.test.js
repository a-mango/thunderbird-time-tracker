import { describe, expect, it } from 'vitest';
import { toCsv, UTF8_BOM } from '../../src/lib/csv.js';

/**
 * Strict RFC 4180 parser for the round-trip test: CRLF record ends, quoted fields with doubled
 * quotes, and no bare quote inside an unquoted field.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let i = 0;
  if (!text.endsWith('\r\n')) throw new Error('missing final CRLF');
  while (i < text.length) {
    let field = '';
    if (text[i] === '"') {
      i += 1;
      for (;;) {
        if (i >= text.length) throw new Error('unterminated quote');
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          field += text[i];
          i += 1;
        }
      }
    } else {
      while (i < text.length && text[i] !== ',' && text[i] !== '\r') {
        if (text[i] === '"' || text[i] === '\n') throw new Error(`bare ${text[i]} at ${i}`);
        field += text[i];
        i += 1;
      }
    }
    row.push(field);
    if (text[i] === ',') {
      i += 1;
    } else if (text.startsWith('\r\n', i)) {
      rows.push(row);
      row = [];
      i += 2;
    } else {
      throw new Error(`unexpected ${JSON.stringify(text[i])} at ${i}`);
    }
  }
  return rows;
}

describe('toCsv', () => {
  it('ends every record with CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('a,b\r\nc,d\r\n');
    expect(toCsv([])).toBe('');
  });

  it.each([
    ['a comma', 'a,b', '"a,b"'],
    ['a quote', 'say "hi"', '"say ""hi"""'],
    ['a CR', 'a\rb', '"a\rb"'],
    ['an LF', 'a\nb', '"a\nb"'],
    ['CRLF', 'a\r\nb', '"a\r\nb"'],
    ['nothing special', 'Harbor Coffee', 'Harbor Coffee'],
    ['spaces only', ' padded ', ' padded '],
    ['non-ASCII', 'Fern & Co — café', 'Fern & Co — café'],
  ])('quotes a field with %s', (_name, value, field) => {
    expect(toCsv([[value]])).toBe(`${field}\r\n`);
  });

  it('writes empty fields for null and undefined, and numbers and booleans as text', () => {
    expect(toCsv([[null, undefined, 0, 1.5, true, false, '']])).toBe(',,0,1.5,true,false,\r\n');
  });

  it('adds a UTF-8 BOM only when asked', () => {
    expect(toCsv([['a']], { bom: true })).toBe(`${UTF8_BOM}a\r\n`);
    expect(toCsv([['a']], { bom: false })).toBe('a\r\n');
    expect(toCsv([['a']]).startsWith(UTF8_BOM)).toBe(false);
    expect(UTF8_BOM).toBe('﻿');
  });

  it.each([
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+1', "'+1"],
    ['-5', "'-5"],
    ['@cmd', "'@cmd"],
    ['\tlead', "'\tlead"],
    ['\rlead', `"'\rlead"`],
    ['=1,2', `"'=1,2"`],
    ['a=b', 'a=b'],
  ])('neutralises the formula-like string %j', (value, field) => {
    expect(toCsv([[value]])).toBe(`${field}\r\n`);
  });

  it('never touches numbers, including negative ones', () => {
    expect(toCsv([[-5, -0.25, 3]])).toBe('-5,-0.25,3\r\n');
  });

  it('can leave formulas alone', () => {
    expect(toCsv([['=1+1', '-5']], { neutralizeFormulas: false })).toBe('=1+1,-5\r\n');
  });

  it('round-trips through a strict RFC 4180 parser', () => {
    const rows = [
      ['Date', 'Project', 'Task', 'Note', 'Minutes'],
      ['2026-10-20', 'Client work / Harbor Coffee', 'Checkout, "form" validation', 'a\r\nb', '90'],
      ['2026-10-21', 'Internal', 'Bookkeeping', '', '0'],
      ['', '"', '""', ',', '\n'],
    ];
    expect(parseCsv(toCsv(rows, { neutralizeFormulas: false }))).toEqual(rows);
    expect(parseCsv(toCsv([['=1', '-2']]))).toEqual([["'=1", "'-2"]]);
  });
});
