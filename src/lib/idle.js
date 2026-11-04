// Idle detection math (S2), DOM-free. The background feeds it `idle` events and tick alarms;
// db/idle.js stores the result.
import { formatAwayRange, formatDuration } from './format.js';

const MINUTE = 60_000;
/** `idle.setDetectionInterval` accepts 15 s at least. */
const MIN_INTERVAL_S = 15;

/**
 * Detection interval for `idle.setDetectionInterval`, or `null` when idle detection is off.
 * @param {number} thresholdMin the `idleThresholdMin` setting (0 = off)
 * @returns {number | null} seconds
 */
export function detectionInterval(thresholdMin) {
  if (!(thresholdMin > 0)) return null;
  return Math.max(MIN_INTERVAL_S, Math.round(thresholdMin * 60));
}

/**
 * When the user went away: the `idle` event fires once the threshold has passed without input.
 * @param {number} now
 * @param {number} thresholdMin
 */
export function idleSince(now, thresholdMin) {
  return now - thresholdMin * MINUTE;
}

/**
 * A suspend (or a stalled Thunderbird) shows as a tick alarm that fires late. When it is later
 * than the threshold, the user was away from the previous tick (one period before the missed
 * one) until now.
 * @param {{scheduledTime: number, periodInMinutes?: number}} alarm
 * @param {number} now
 * @param {number} thresholdMin
 * @returns {{since: number, until: number} | null}
 */
export function sleepGap(alarm, now, thresholdMin) {
  if (!(thresholdMin > 0)) return null;
  if (now - alarm.scheduledTime <= thresholdMin * MINUTE) return null;
  return { since: alarm.scheduledTime - (alarm.periodInMinutes ?? 1) * MINUTE, until: now };
}

/**
 * Total time away and the ranges: `23m` and `14:02 – 14:25`, or with several absences
 * `1h 10m` and `10:10 – 10:20, 12:00 – 13:00`.
 * @param {{since: number, until: number | null}[]} spans closed spans
 * @param {{locale: string}} options
 */
export function awayParts(spans, { locale }) {
  const closed = spans.map(({ since, until }) => ({ since, until: until ?? since }));
  const total = closed.reduce((sum, { since, until }) => sum + (until - since), 0);
  return {
    duration: formatDuration(total),
    ranges: closed.map(({ since, until }) => formatAwayRange(since, until, { locale })).join(', '),
  };
}

/**
 * "You were away 23m (14:02 – 14:25)." for the notification and the prompt bars.
 * @param {{since: number, until: number | null}[]} spans closed spans
 * @param {{getMessage: (name: string, substitutions?: string[]) => string, locale: string}} i18n
 */
export function awayMessage(spans, { getMessage, locale }) {
  const { duration, ranges } = awayParts(spans, { locale });
  return getMessage('idleAway', [duration, ranges]);
}
