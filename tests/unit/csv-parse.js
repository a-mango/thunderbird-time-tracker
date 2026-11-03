// Test helper: a strict CSV parser, so tests read back what lib/csv.js writes.

/**
 * Strict RFC 4180 parser for the round-trip test: CRLF record ends, quoted fields with doubled
 * quotes, and no bare quote inside an unquoted field.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
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
