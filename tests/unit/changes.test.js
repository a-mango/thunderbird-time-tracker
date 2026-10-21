import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_NAME, notifyChanged } from '../../src/db/changes.js';
import { openDB } from '../../src/db/idb.js';
import { createProject, getProject, updateProject } from '../../src/db/projects.js';
import { InvariantError } from '../../src/lib/errors.js';

const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';

/** @param {(message: any) => Promise<unknown>} [sendMessage] */
function fakes(sendMessage = async () => undefined) {
  return { channel: { postMessage: vi.fn() }, runtime: { sendMessage: vi.fn(sendMessage) } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('notifyChanged', () => {
  it('posts the change on the channel and pings the runtime', async () => {
    const { channel, runtime } = fakes();
    const change = { type: /** @type {const} */ ('tasks'), ids: ['t1'] };
    await notifyChanged(change, { channel, runtime });
    expect(channel.postMessage).toHaveBeenCalledWith(change);
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: 'tt:changed', change });
  });

  it('swallows the "no receiver" rejection', async () => {
    const { channel, runtime } = fakes(() => Promise.reject(new Error(NO_RECEIVER)));
    await expect(
      notifyChanged({ type: 'entries', ids: [] }, { channel, runtime }),
    ).resolves.toBeUndefined();
    expect(channel.postMessage).toHaveBeenCalledTimes(1);
  });

  it('surfaces other errors', async () => {
    const boom = new Error('Extension context invalidated.');
    const { channel, runtime } = fakes(() => Promise.reject(boom));
    await expect(notifyChanged({ type: 'entries', ids: [] }, { channel, runtime })).rejects.toBe(
      boom,
    );
  });

  it('works without a runtime (plain page in the dev harness)', async () => {
    const { channel } = fakes();
    await expect(
      notifyChanged({ type: 'settings', ids: [] }, { channel, runtime: null }),
    ).resolves.toBeUndefined();
    expect(channel.postMessage).toHaveBeenCalledTimes(1);
  });

  it('defaults to a lazily created BroadcastChannel("tt") and messenger.runtime', async () => {
    const created = /** @type {string[]} */ ([]);
    const postMessage = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        /** @param {string} name */
        constructor(name) {
          created.push(name);
        }
        postMessage = postMessage;
      },
    );
    const sendMessage = vi.fn(async () => undefined);
    vi.stubGlobal('messenger', { runtime: { sendMessage } });
    await notifyChanged({ type: 'projects', ids: ['p1'] });
    await notifyChanged({ type: 'projects', ids: ['p2'] });
    expect(created).toEqual([CHANNEL_NAME]);
    expect(CHANNEL_NAME).toBe('tt');
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('repositories notify after commit', () => {
  it('posts only once the write is visible to other connections', async () => {
    const factory = new IDBFactory();
    const { channel, runtime } = fakes();
    const other = await openDB({ factory });
    /** @type {Promise<unknown>[]} */
    const seen = [];
    channel.postMessage.mockImplementation((change) => {
      seen.push(getProject(other, change.ids[0]));
    });
    const db = await openDB({
      factory,
      notify: (change) => notifyChanged(change, { channel, runtime }),
    });
    const project = await createProject(db, { name: 'Support retainer' });
    expect(channel.postMessage).toHaveBeenCalledWith({ type: 'projects', ids: [project.id] });
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: 'tt:changed',
      change: { type: 'projects', ids: [project.id] },
    });
    expect(await seen[0]).toEqual(project);
  });

  it('posts nothing when the transaction aborts', async () => {
    const { channel, runtime } = fakes();
    const db = await openDB({
      factory: new IDBFactory(),
      notify: (change) => notifyChanged(change, { channel, runtime }),
    });
    const project = await createProject(db, { name: 'Support retainer' });
    channel.postMessage.mockClear();
    runtime.sendMessage.mockClear();
    await expect(updateProject(db, project.id, { parentId: project.id })).rejects.toBeInstanceOf(
      InvariantError,
    );
    expect(channel.postMessage).not.toHaveBeenCalled();
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('logs a failing notifier without failing the write', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('boom');
    const db = await openDB({ factory: new IDBFactory(), notify: () => Promise.reject(boom) });
    const project = await createProject(db, { name: 'Support retainer' });
    expect(project.name).toBe('Support retainer');
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.any(String), boom));
  });

  it('logs a notifier that throws synchronously', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('sync boom');
    const db = await openDB({
      factory: new IDBFactory(),
      notify: () => {
        throw boom;
      },
    });
    await createProject(db, { name: 'Support retainer' });
    expect(error).toHaveBeenCalledWith(expect.any(String), boom);
  });
});
