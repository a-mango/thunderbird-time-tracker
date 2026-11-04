import { describe, expect, it } from 'vitest';
import { trayCommand, trayStatus } from '../../src/lib/tray.js';

const t = (/** @type {string} */ name) =>
  ({
    extensionName: 'Time Tracker',
    trayIdle: 'No timer running',
    trayStop: 'Stop Timer',
    trayStartLast: 'Start Last Task',
    trayOpen: 'Open Time Tracker',
  })[name] ?? name;
const MIN = 60_000;

describe('trayStatus', () => {
  it('shows the running task with h:mm and a Stop item', () => {
    const status = trayStatus({ start: 0 }, 'Checkout form validation', {
      now: 65 * MIN + 30_000,
      t,
    });
    expect(status).toEqual({
      type: 'status',
      running: true,
      title: 'Time Tracker',
      tooltip: { title: 'Time Tracker', text: '1:05 · Checkout form validation' },
      menu: [
        { id: 'toggle', label: 'Stop Timer', enabled: true },
        { type: 'separator' },
        { id: 'tracker', label: 'Open Time Tracker', enabled: true },
      ],
    });
  });

  it('without a timer says so and offers the last task', () => {
    const status = trayStatus(null, null, { now: 0, t });
    expect(status.running).toBe(false);
    expect(status.tooltip.text).toBe('No timer running');
    expect(status.menu[0]).toEqual({ id: 'toggle', label: 'Start Last Task', enabled: true });
  });
});

describe('trayCommand', () => {
  it.each([
    [{ type: 'command', command: 'toggle' }, 'toggle'],
    [{ type: 'command', command: 'tracker' }, 'tracker'],
    [{ type: 'command', command: 'activate' }, 'activate'],
    [{ type: 'command', command: 'rm -rf' }, null],
    [{ type: 'ready', version: 1 }, null],
    [null, null],
    ['toggle', null],
  ])('reads %j as %j', (message, command) => {
    expect(trayCommand(message)).toBe(command);
  });
});
