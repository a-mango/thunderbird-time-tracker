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
