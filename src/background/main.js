import { ensureSpace } from './space.js';
import { handleMessage } from './messages.js';

// Event page: listeners are registered synchronously at top level, no state in memory.

messenger.runtime.onInstalled.addListener(() => {
  ensureSpace().catch((error) => console.error('time tracker: space setup failed', error));
});

messenger.runtime.onStartup.addListener(() => {
  ensureSpace().catch((error) => console.error('time tracker: space setup failed', error));
});

messenger.runtime.onMessage.addListener((message) => handleMessage(message));

messenger.commands.onCommand.addListener((command) => {
  if (command === 'toggle-timer') {
    // M5: start the last task or stop the running timer.
  }
});
