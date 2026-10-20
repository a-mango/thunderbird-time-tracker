import { describe, expect, it } from 'vitest';
import { SPACE_NAME, TRACKER_PATH, ensureSpace } from '../../src/background/space.js';
import { handleMessage } from '../../src/background/messages.js';
import { createMessenger } from '../../dev/mock-messenger.js';

const messages = { spaceTitle: { message: 'Time Tracker' } };
/** @returns {any} */
const mock = () => createMessenger({ messages, baseUrl: 'moz-extension://test/' });

describe('ensureSpace', () => {
  it('creates the space when it is missing', async () => {
    const api = mock();
    const space = await ensureSpace(api);
    expect(space).toMatchObject({ name: SPACE_NAME, isSelfOwned: true, isBuiltIn: false });
    expect(api.spaces._props(space.id)).toEqual({
      url: `moz-extension://test/${TRACKER_PATH}`,
      button: { title: 'Time Tracker' },
    });
  });

  it('does not create a duplicate when called again (install, then startup)', async () => {
    const api = mock();
    const first = await ensureSpace(api);
    const second = await ensureSpace(api);
    expect(second.id).toBe(first.id);
    expect(await api.spaces.query({ isSelfOwned: true })).toHaveLength(1);
  });

  it('repairs the tab URL of an existing space', async () => {
    const api = mock();
    const stale = await api.spaces.create(SPACE_NAME, 'moz-extension://test/old.html');
    await ensureSpace(api);
    expect(api.spaces._props(stale.id).url).toBe(`moz-extension://test/${TRACKER_PATH}`);
  });

  it('ignores built-in spaces with other names', async () => {
    const api = mock();
    await ensureSpace(api);
    expect((await api.spaces.query({ isBuiltIn: true })).map((s) => s.name)).toContain('mail');
  });
});

describe('background messages', () => {
  it('answers tt:summary with an empty summary until M2', async () => {
    await expect(handleMessage({ type: 'tt:summary' })).resolves.toEqual({
      projects: [],
      taskCount: 0,
      entryCount: 0,
    });
  });

  it('ignores unknown messages so other listeners can answer', () => {
    expect(handleMessage({ type: 'other' })).toBeUndefined();
    expect(handleMessage(null)).toBeUndefined();
  });
});
