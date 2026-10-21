// Pure, DOM-free formatting of durations, times and dates. Render the results with tabular-nums.
// The caller passes the UI locale (`messenger.i18n.getUILanguage()`); the hour cycle defaults
// to the locale's own (en-US 12-hour, en-GB and de-CH 24-hour).
import { startOfDay } from './time.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** @typedef {'h11' | 'h12' | 'h23' | 'h24'} HourCycle */

/** Shown when there is no value, like Thunderbird's empty cells. */
export const NO_VALUE = '–';

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/**
 * Cached `Intl.DateTimeFormat`: building one per table cell is slow.
 * @param {string} locale
 * @param {Intl.DateTimeFormatOptions} options
 */
function dateTimeFormat(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, format);
  }
  return format;
}

/**
 * Total duration as `1h 05m`, `25m`, `0m` (minutes rounded down), or with
 * `{format: 'decimal'}` as hours to two decimals (`1.08h`, `0.00h`). `–` for null/undefined.
 * @param {number | null | undefined} ms
 * @param {{format?: 'hm' | 'decimal'}} [options] the `durationFormat` setting
 */
export function formatDuration(ms, { format = 'hm' } = {}) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return NO_VALUE;
  if (format === 'decimal') {
    return `${(Math.round((Math.max(0, ms) / HOUR) * 100) / 100).toFixed(2)}h`;
  }
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest}m` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/**
 * Running time as `h:mm:ss` (seconds rounded down), e.g. `1:05:12`, `0:00:09`.
 * @param {number} ms
 */
export function formatElapsed(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Estimate label: whole hours as `20h`, otherwise like formatDuration (`1h 30m`).
 * @param {number} minutes
 */
export function formatEstimate(minutes) {
  return minutes % 60 === 0 ? `${minutes / 60}h` : formatDuration(minutes * MINUTE);
}

/**
 * Local time of day: `10:25` / `09:05` on a 24-hour clock, `9:05 AM` on a 12-hour one.
 * @param {number} ms
 * @param {{locale: string, hourCycle?: HourCycle}} options `hourCycle` overrides the locale's
 */
export function formatTime(ms, { locale, hourCycle }) {
  const resolved = dateTimeFormat(locale, { hour: 'numeric', hourCycle }).resolvedOptions();
  const twelveHour = resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12';
  return dateTimeFormat(locale, {
    hour: twelveHour ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: resolved.hourCycle,
  }).format(ms);
}

/**
 * Message-list style date (local time): `Today 10:25`, `Mon 17:30` within the last 6 days,
 * `16 Oct` this year, `16/10/2025` otherwise. Times as in `formatTime`.
 * @param {number} ms
 * @param {{now: number, locale: string, todayLabel: string, hourCycle?: HourCycle}} options
 */
export function formatRelative(ms, { now, locale, todayLabel, hourCycle }) {
  const today = startOfDay(now);
  const time = (/** @type {number} */ value) => formatTime(value, { locale, hourCycle });
  // Future timestamps (clock skew, edited entries) fall through to plain dates.
  if (ms >= today && ms < startOfDay(now, 1)) {
    return `${todayLabel} ${time(ms)}`;
  }
  if (ms >= startOfDay(now, -6) && ms < today) {
    const weekday = dateTimeFormat(locale, { weekday: 'short' }).format(ms);
    return `${weekday} ${time(ms)}`;
  }
  if (new Date(ms).getFullYear() === new Date(now).getFullYear()) {
    return dateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(ms);
  }
  return dateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms);
}
