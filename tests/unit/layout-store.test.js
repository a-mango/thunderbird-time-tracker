// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLayout,
  localStorageStore,
  setLayout,
  setLayoutStore,
} from '../../src/ui/layout-store.js';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  setLayoutStore(localStorageStore);
});

describe('layout store', () => {
  it('round-trips JSON values through localStorage under a prefix', () => {
    setLayout('sidebar', { width: 240 });
    expect(getLayout('sidebar')).toEqual({ width: 240 });
    expect(localStorage.getItem('tt.layout.sidebar')).toBe('{"width":240}');
    expect(getLayout('missing')).toBeUndefined();
  });

  it('survives blocked storage and corrupt values', () => {
    localStorage.setItem('tt.layout.bad', '{');
    expect(getLayout('bad')).toBeUndefined();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => setLayout('x', 1)).not.toThrow();
  });

  it('can be swapped for another backend', () => {
    const values = new Map();
    setLayoutStore({ get: (k) => values.get(k), set: (k, v) => values.set(k, v) });
    setLayout('a', 2);
    expect(values.get('a')).toBe(2);
    expect(getLayout('a')).toBe(2);
  });
});
