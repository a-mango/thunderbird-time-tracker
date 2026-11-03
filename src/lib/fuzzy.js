// Fuzzy matching for the popup's "Switch to…" field: every word of the query must appear in the
// task name as a substring or as a subsequence that starts a word ("chkf" finds "Checkout form"),
// or in the project path as a substring. Case and accents are ignored. Pure and DOM-free.

/** @param {string} text */
export const normalize = (text) =>
  text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLocaleLowerCase('en');

/** @param {string} text @param {number} i */
const wordStart = (text, i) => i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);

/**
 * Score of one query word in one normalised text, or 0 when it doesn't match. A substring beats
 * any subsequence; matches at word starts and consecutive characters score higher.
 * @param {string} word normalised, non-empty
 * @param {string} text normalised
 * @param {{subsequence?: boolean}} [options] `false`: substrings only
 */
export function wordScore(word, text, { subsequence = true } = {}) {
  const at = text.indexOf(word);
  if (at >= 0) {
    // A word-start hit anywhere beats a mid-word one.
    let best = at;
    for (let i = at; i >= 0; i = text.indexOf(word, i + 1)) {
      if (wordStart(text, i)) {
        best = i;
        break;
      }
    }
    return 100 + word.length * 4 + (wordStart(text, best) ? 50 : 0) - Math.min(best, 20);
  }
  if (!subsequence) return 0;
  let score = 0;
  let last = -2;
  // The first character starts a word, so "cafe" doesn't match "client work / harbor coffee".
  let from = text.indexOf(word[0]);
  while (from >= 0 && !wordStart(text, from)) from = text.indexOf(word[0], from + 1);
  if (from < 0) return 0;
  for (const char of word) {
    const i = text.indexOf(char, from);
    if (i < 0) return 0;
    score += 1 + (i === last + 1 ? 3 : 0) + (wordStart(text, i) ? 5 : 0);
    last = i;
    from = i + 1;
  }
  return score;
}

/**
 * Items matching every word of `query`, best first (ties keep the input order). A word scores in
 * the primary text (the task name) twice as much as in the secondary one (the project path), which
 * only matches substrings.
 * @template T
 * @param {T[]} items
 * @param {string} query
 * @param {(item: T) => {primary: string, secondary?: string}} textOf
 * @returns {T[]} empty for a blank query
 */
export function fuzzyFilter(items, query, textOf) {
  const words = normalize(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  /** @type {{item: T, score: number, index: number}[]} */
  const hits = [];
  items.forEach((item, index) => {
    const { primary, secondary = '' } = textOf(item);
    const name = normalize(primary);
    const path = normalize(secondary);
    let total = 0;
    for (const word of words) {
      const score = Math.max(
        wordScore(word, name) * 2,
        wordScore(word, path, { subsequence: false }),
      );
      if (score === 0) return;
      total += score;
    }
    hits.push({ item, score: total, index });
  });
  return hits.sort((a, b) => b.score - a.score || a.index - b.index).map((hit) => hit.item);
}
