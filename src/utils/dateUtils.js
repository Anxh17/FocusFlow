/**
 * Format a Date object to YYYY-MM-DD string using LOCAL date components.
 * This avoids UTC conversion bugs.
 */
export function formatDateLocal(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date as YYYY-MM-DD string in local timezone.
 */
export function getTodayStr() {
  return formatDateLocal(new Date());
}

/**
 * Add days to a YYYY-MM-DD local date string and return YYYY-MM-DD.
 */
export function addDaysLocal(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatDateLocal(d);
}

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert an ISO timestamp, Date object, or YYYY-MM-DD string into a local YYYY-MM-DD calendar date.
 * Never parses YYYY-MM-DD as UTC and never slices UTC ISO strings directly.
 */
export function toLocalDateStr(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (DATE_ONLY_REGEX.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return '';
    return formatDateLocal(parsed);
  }
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return '';
    return formatDateLocal(input);
  }
  return '';
}

/**
 * Get the Monday (YYYY-MM-DD) of the Monday-to-Sunday week containing dateOrStr.
 */
export function getWeekStartLocal(dateOrStr = getTodayStr()) {
  const baseStr = toLocalDateStr(dateOrStr) || getTodayStr();
  const d = new Date(baseStr + 'T00:00:00');
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDaysLocal(baseStr, diffToMonday);
}

/**
 * Return the 7 local YYYY-MM-DD dates [Monday .. Sunday] for the week containing dateOrStr.
 */
export function getWeekDatesLocal(dateOrStr = getTodayStr()) {
  const monday = getWeekStartLocal(dateOrStr);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    dates.push(addDaysLocal(monday, i));
  }
  return dates;
}

/**
 * Derive the local calendar completion date for a completed task.
 */
export function getTaskCompletionLocalDate(task) {
  if (!task) return '';
  if (task.completedAt) {
    const localFromTimestamp = toLocalDateStr(task.completedAt);
    if (localFromTimestamp) return localFromTimestamp;
  }
  return toLocalDateStr(task.date);
}

/**
 * Format a date string to a human-readable format.
 * e.g. "2024-03-15" -> "Mar 15, 2024"
 */
export function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format minutes to a human-readable duration.
 * e.g. 90 -> "1h 30m", 45 -> "45m"
 */
export function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '0m';
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Format seconds to HH:MM:SS or MM:SS for live timer display.
 */
export function formatTimerSeconds(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Format seconds as compact duration (e.g. "1h 12m" or "4m 30s" or "0m").
 */
export function formatSecondsCompact(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  if (safe === 0) return '0m';
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Calculate days remaining until a deadline.
 */
export function daysUntil(deadlineStr) {
  if (!deadlineStr) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(deadlineStr + 'T00:00:00');
  const diff = deadline - today;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Check if a date string is today.
 */
export function isToday(dateStr) {
  return dateStr === getTodayStr();
}

/**
 * Check if a date string is in the past (before today).
 */
export function isPast(dateStr) {
  if (!dateStr) return false;
  return dateStr < getTodayStr();
}

/**
 * Get a greeting based on time of day.
 */
export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
