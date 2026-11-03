import { describe, expect, it } from 'vitest';
import { fuzzyFilter, normalize, wordScore } from '../../src/lib/fuzzy.js';

const tasks = [
  { name: 'Product image pipeline', path: 'Client work / Harbor Coffee — website / Build' },
  { name: 'Checkout form validation', path: 'Client work / Harbor Coffee — website / Build' },
  { name: 'Monthly bookkeeping', path: 'Internal' },
  { name: 'Café menu redesign', path: 'Client work / Northwind Bakery' },
];
/** @param {string} query */
const names = (query) =>
  fuzzyFilter(tasks, query, (t) => ({ primary: t.name, secondary: t.path })).map((t) => t.name);

describe('fuzzyFilter', () => {
  it('returns nothing for a blank query', () => {
    expect(names('   ')).toEqual([]);
  });

  it('matches substrings and subsequences, ignoring case and accents', () => {
    expect(names('CHECK')).toEqual(['Checkout form validation']);
    expect(names('chkf')).toEqual(['Checkout form validation']);
    expect(names('cafe')).toEqual(['Café menu redesign']);
  });

  it('needs every word, in the name or the project path', () => {
    expect(names('harbor image')).toEqual(['Product image pipeline']);
    expect(names('internal book')).toEqual(['Monthly bookkeeping']);
    expect(names('harbor zzz')).toEqual([]);
  });

  it('ranks name matches above path matches', () => {
    // "build" is only in the path; "pipeline" is in a name.
    expect(names('pi')[0]).toBe('Product image pipeline');
    expect(names('build')).toEqual(['Product image pipeline', 'Checkout form validation']);
  });
});

describe('wordScore', () => {
  it('prefers word starts and substrings', () => {
    const text = normalize('Monthly bookkeeping');
    expect(wordScore('book', text)).toBeGreaterThan(wordScore('keep', text));
    expect(wordScore('keep', text)).toBeGreaterThan(wordScore('mbk', text));
    expect(wordScore('xyz', text)).toBe(0);
    // A subsequence starts at a word start; paths only match substrings.
    expect(wordScore('onth', text)).toBeGreaterThan(0);
    expect(wordScore('otly', text)).toBe(0);
    expect(wordScore('mbk', text, { subsequence: false })).toBe(0);
  });
});
