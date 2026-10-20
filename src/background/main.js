import { ensureSpace } from './space.js';
import { handleMessage } from './messages.js';

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

// Registered so the event page starts with Thunderbird; the top-level check does the work.
messenger.runtime.onStartup.addListener(() => {});

messenger.runtime.onMessage.addListener((message) => handleMessage(message));

messenger.commands.onCommand.addListener((command) => {
  if (command === 'toggle-timer') {
    // M5: start the last task or stop the running timer.
  }
});
