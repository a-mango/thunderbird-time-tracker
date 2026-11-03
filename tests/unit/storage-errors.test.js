import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockedError, VersionError, storageErrorKind } from '../../src/lib/errors.js';
import { storageMessage } from '../../src/ui/storage-errors.js';

afterEach(() => vi.unstubAllGlobals());

describe('storageErrorKind', () => {
  it.each([
    [new BlockedError('blocked'), 'blocked'],
    [new VersionError('version'), 'version'],
    [{ name: 'QuotaExceededError' }, 'quota'],
    [{ name: 'NS_ERROR_DOM_QUOTA_REACHED' }, 'quota'],
    [new Error('boom'), 'unknown'],
    [null, 'unknown'],
    ['text', 'unknown'],
  ])('%o is %s', (error, kind) => {
    expect(storageErrorKind(error)).toBe(kind);
  });
});

describe('storageMessage', () => {
  it('picks the hint and whether Reload helps', () => {
    vi.stubGlobal('messenger', { i18n: { getMessage: (/** @type {string} */ name) => name } });
    expect(storageMessage(new BlockedError('blocked'), 'open')).toEqual({
      message: 'errorBlocked',
      reload: true,
    });
    expect(storageMessage(new VersionError('version'), 'open')).toEqual({
      message: 'errorNewerVersion',
      reload: false,
    });
    expect(storageMessage({ name: 'QuotaExceededError' }, 'write')).toEqual({
      message: 'errorQuota',
      reload: false,
    });
    expect(storageMessage(new Error('x'), 'open')).toEqual({
      message: 'trackerLoadError',
      reload: true,
    });
    expect(storageMessage(new Error('x'), 'write')).toEqual({
      message: 'errorSave',
      reload: false,
    });
  });
});
