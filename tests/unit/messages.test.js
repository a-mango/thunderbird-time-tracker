import { describe, expect, it } from 'vitest';
import { handleMessage } from '../../src/background/messages.js';

describe('runtime messages', () => {
  it('leaves every message, including tt:changed, to other listeners', () => {
    expect(
      handleMessage({ type: 'tt:changed', change: { type: 'tasks', ids: [] } }),
    ).toBeUndefined();
    expect(handleMessage({ type: 'tt:summary' })).toBeUndefined();
    expect(handleMessage(null)).toBeUndefined();
  });
});
