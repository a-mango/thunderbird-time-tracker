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
