import { ensureSpace } from './space.js';
import { handleMessage } from './messages.js';
import { openDB, purgeDeleted } from '../db/index.js';

// Event page: listeners are registered synchronously at top level, no state in memory.

/** @param {unknown} error */
const logSpaceError = (error) => console.error('time tracker: space setup failed', error);

// Every background start (app start, install, re-enable, wake-up) makes sure the space exists:
// Thunderbird drops extension spaces when the add-on shuts down.
const spaceReady = ensureSpace().catch(logSpaceError);

messenger.runtime.onInstalled.addListener(() => {
  // After the startup check, so both never race to create the space.
  spaceReady.then(() => ensureSpace(messenger, { repair: true })).catch(logSpaceError);
});

// Thunderbird start: the space check runs at top level; this ends the undo window for deleted
// entries ("until the next session"). Not at top level: the event page wakes up many times.
messenger.runtime.onStartup.addListener(async () => {
  try {
    const db = await openDB();
    try {
      await purgeDeleted(db);
    } finally {
      db.close();
    }
  } catch (error) {
    console.error('time tracker: purging deleted entries failed', error);
  }
});

messenger.runtime.onMessage.addListener((message) => handleMessage(message));

messenger.commands.onCommand.addListener((command) => {
  if (command === 'toggle-timer') {
    // M5: start the last task or stop the running timer.
  }
});
