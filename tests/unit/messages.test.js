import { describe, expect, it, vi } from 'vitest';
import { handleMessage } from '../../src/background/messages.js';

describe('runtime messages', () => {
  it('never answers, so other listeners can', () => {
    const syncStatus = vi.fn();
    expect(
      handleMessage({ type: 'tt:changed', change: { type: 'tasks', ids: [] } }, { syncStatus }),
    ).toBeUndefined();
    expect(handleMessage({ type: 'tt:summary' }, { syncStatus })).toBeUndefined();
    expect(handleMessage(null, { syncStatus })).toBeUndefined();
  });

  it('refreshes the timer status on entry, task and settings changes only', () => {
    const syncStatus = vi.fn();
    const changed = (type) => ({ type: 'tt:changed', change: { type, ids: ['x'] } });
    handleMessage(changed('entries'), { syncStatus });
    handleMessage(changed('tasks'), { syncStatus });
    // The idle threshold sets the detection interval at once.
    handleMessage(changed('settings'), { syncStatus });
    expect(syncStatus).toHaveBeenCalledTimes(3);
    handleMessage(changed('projects'), { syncStatus });
    handleMessage({ type: 'other' }, { syncStatus });
    expect(syncStatus).toHaveBeenCalledTimes(3);
  });
});
