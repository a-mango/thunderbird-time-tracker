// Pure, DOM-free formatting of durations. Render the results with tabular-nums.
// M2 extends this module (dates, relative times).

const MINUTE = 60_000;

/** Shown when there is no value, like Thunderbird's empty cells. */
export const NO_VALUE = '–';

/**
 * Total duration as `1h 05m`, `25m`, `0m` (minutes rounded down); `–` for null/undefined.
 * @param {number | null | undefined} ms
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return NO_VALUE;
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
 * Message-list style date (local time): `Today 10:25`, `Mon 17:30` within the last 6 days,
 * `16 Oct` this year, `16/10/2025` otherwise. M2 settles the locale and hour cycle defaults.
 * @param {number} ms
 * @param {{now: number, locale: string, todayLabel: string, hourCycle?: 'h12' | 'h23'}} options
 */
export function formatRelative(ms, { now, locale, todayLabel, hourCycle }) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sixDaysAgo = new Date(today);
  sixDaysAgo.setDate(today.getDate() - 6);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle });
  if (ms >= today.getTime()) return `${todayLabel} ${time.format(ms)}`;
  if (ms >= sixDaysAgo.getTime()) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(ms);
    return `${weekday} ${time.format(ms)}`;
  }
  if (new Date(ms).getFullYear() === today.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(ms);
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(ms);
}
