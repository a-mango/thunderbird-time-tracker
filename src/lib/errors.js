// Typed errors shared by lib/ and db/. Callers branch on `instanceof` or `code`, never on messages.

export class TrackerError extends Error {
  /**
   * @param {string} code stable machine-readable reason
   * @param {string} [message]
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Input has the wrong shape or an out-of-range value. */
export class ValidationError extends TrackerError {}

/** A referenced record doesn't exist. */
export class NotFoundError extends TrackerError {}

/** The write would break a data invariant (one running entry, start < end, no cycles). */
export class InvariantError extends TrackerError {}

/** Starting a task whose status is `done`; the UI asks to reopen it. */
export class TaskDoneError extends TrackerError {}

/** Deleting a project or task that still has children needs `{cascade: true}`. */
export class CascadeRequiredError extends TrackerError {}

/** A schema upgrade is waiting for another open connection to close. */
export class BlockedError extends TrackerError {}

/** The stored database is newer than this code knows. */
export class VersionError extends TrackerError {}

/** A backup file was rejected; `code` says why, `details.path` where. */
export class ImportError extends TrackerError {}

/**
 * @typedef {'blocked' | 'version' | 'quota' | 'unknown'} StorageErrorKind
 */

/**
 * What kind of storage failure `error` is, for the recovery hint the UI shows.
 * - `blocked`: an older connection keeps a schema upgrade waiting (close the other tab);
 * - `version`: the stored database is newer than this code (update the add-on);
 * - `quota`: the disk or the origin's storage is full (`QuotaExceededError`, also as the cause of
 *   an aborted transaction);
 * - `unknown`: anything else (reload, restart).
 * @param {unknown} error
 * @returns {StorageErrorKind}
 */
export function storageErrorKind(error) {
  if (error instanceof BlockedError) return 'blocked';
  if (error instanceof VersionError) return 'version';
  const name = /** @type {{name?: unknown} | null} */ (error)?.name;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'quota';
  return 'unknown';
}
