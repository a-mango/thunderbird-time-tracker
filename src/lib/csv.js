// RFC 4180 CSV writer: CRLF after every record, quoting only when needed, optional UTF-8 BOM
// (for spreadsheet apps), and a guard against formula injection in text cells.

/** Byte order mark; prepend it so spreadsheet apps read the file as UTF-8. */
export const UTF8_BOM = '\uFEFF';

/** @typedef {string | number | boolean | null | undefined} CsvValue */

/** Text cells starting with these are read as formulas by spreadsheet apps. */
const FORMULA_START = /^[=+\-@\t\r]/u;
const NEEDS_QUOTES = /[",\r\n]/u;

/**
 * One field: `null`/`undefined` are empty, numbers and booleans are `String(value)`.
 * @param {CsvValue} value
 * @param {boolean} neutralizeFormulas
 */
function field(value, neutralizeFormulas) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (neutralizeFormulas && typeof value === 'string' && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Serialises rows to CSV text.
 * @param {CsvValue[][]} rows
 * @param {{bom?: boolean, neutralizeFormulas?: boolean}} [options] `neutralizeFormulas` prefixes
 *   text cells starting with `=`, `+`, `-`, `@`, TAB or CR with `'`; numbers are never changed
 */
export function toCsv(rows, { bom = false, neutralizeFormulas = true } = {}) {
  const body = rows
    .map((row) => `${row.map((value) => field(value, neutralizeFormulas)).join(',')}\r\n`)
    .join('');
  return bom ? `${UTF8_BOM}${body}` : body;
}
