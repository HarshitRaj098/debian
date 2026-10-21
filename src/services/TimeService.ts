export const TimeService = {
  /** Returns the current wall-clock time in milliseconds. */
  now: (): number => Date.now(),

  /** Returns a monotonic timestamp in milliseconds, suitable for measuring durations. */
  monotonicNow: (): number => typeof performance !== 'undefined' ? performance.now() : Date.now(),

  /** Formats a timestamp into a human-readable date and time string. */
  formatWall: (timestamp: number): string => {
    const date = new Date(timestamp);
    const datePart = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${datePart}  ${timePart}`;
  },

  /** Returns a formatted duration string (e.g., 'X ms'). */
  formatDuration: (ms: number): string => `${Math.floor(ms)} ms`,
};
