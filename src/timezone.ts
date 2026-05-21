/**
 * Centralized UTC+8 (Asia/Shanghai) time helpers.
 * All date/time operations in the project should go through here
 * to ensure consistent timezone handling.
 */

const TIMEZONE = 'Asia/Shanghai';

function extractParts(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  // Intl returns hour "24" for midnight, normalize to "00"
  if (map.hour === '24') map.hour = '00';
  return map;
}

/**
 * Format a Date as ISO-like string in UTC+8: "YYYY-MM-DDTHH:mm:ss+08:00"
 * Includes the +08:00 offset so JS new Date() parses it correctly across timezones.
 */
export function toLocalISO(date: Date = new Date()): string {
  const p = extractParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/**
 * Get today's date string in UTC+8: "YYYY-MM-DD"
 */
export function getTodayString(date: Date = new Date()): string {
  return toLocalISO(date).slice(0, 10);
}

/**
 * Format a Date as readable string in UTC+8: YYYY-MM-DD HH:mm:ss
 */
export function toLocalDisplay(date: Date = new Date()): string {
  return toLocalISO(date).replace('T', ' ');
}
