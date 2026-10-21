// Field limits shared by db/ (input checks) and the importer, so every stored record survives an
// export and re-import (tests/unit/db-backup.test.js).

export const LIMITS = Object.freeze({
  id: 100,
  name: 500,
  text: 100_000,
  tag: 100,
  tags: 50,
  estimateMin: 10_000_000,
  /** Largest valid `Date` time value. */
  time: 8.64e15,
});

/** `#rrggbb` only: colours reach `style.setProperty`, where `url(…)` would hit the network. */
export const COLOR = /^#[0-9a-f]{6}$/iu;
