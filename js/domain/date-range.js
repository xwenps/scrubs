/**
 * Date-range presets.
 *
 * Every preset resolves to a half-open [start, end) interval in the browser's
 * local time zone, because "a shift on the 3rd" means the 3rd where the user
 * lives, not in UTC. Ranges that reach into the future are first-class: a
 * roster is half history and half plan, and the dashboard splits the two.
 */

export function startOfDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function endOfDay(d) {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

export function addDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function addMonths(d, months) {
  const out = new Date(d);
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + months);
  // Clamp for short months: 31 Jan + 1 month → 28/29 Feb, not 2/3 Mar.
  out.setDate(Math.min(day, daysInMonth(out.getFullYear(), out.getMonth())));
  return out;
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d) {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}

export function endOfYear(d) {
  return endOfDay(new Date(d.getFullYear(), 11, 31));
}

/** Monday- or Sunday-based week start. */
export function startOfWeek(d, weekStart = 'monday') {
  const out = startOfDay(d);
  const offset = weekStart === 'sunday' ? out.getDay() : (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - offset);
  return out;
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

/** ISO `YYYY-MM-DD` in local time — safe as a map key and as an <input type=date> value. */
export function toISODate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Preset catalogue. `group` drives the visual sectioning of the picker;
 * `resolve` receives `now` so the whole module stays testable.
 */
export const RANGE_PRESETS = [
  { id: 'last30', label: 'Last 30 days', group: 'Recent', resolve: (now) => [startOfDay(addDays(now, -29)), endOfDay(now)] },
  { id: 'last90', label: 'Last 90 days', group: 'Recent', resolve: (now) => [startOfDay(addDays(now, -89)), endOfDay(now)] },
  { id: 'mtd', label: 'Month to date', group: 'Recent', resolve: (now) => [startOfMonth(now), endOfDay(now)] },

  { id: 'ytd', label: 'Year to date', group: 'Year', resolve: (now) => [startOfYear(now), endOfDay(now)] },
  { id: 'last12months', label: 'Last 12 months', group: 'Year', resolve: (now) => [startOfDay(addMonths(now, -12)), endOfDay(now)] },
  { id: 'thisYear', label: 'This calendar year', group: 'Year', resolve: (now) => [startOfYear(now), endOfYear(now)] },
  {
    id: 'lastYear',
    label: 'Last calendar year',
    group: 'Year',
    resolve: (now) => {
      const prev = new Date(now.getFullYear() - 1, 0, 1);
      return [startOfYear(prev), endOfYear(prev)];
    },
  },

  { id: 'thisMonth', label: 'This month', group: 'Upcoming', resolve: (now) => [startOfMonth(now), endOfMonth(now)] },
  { id: 'next30', label: 'Next 30 days', group: 'Upcoming', resolve: (now) => [startOfDay(now), endOfDay(addDays(now, 30))] },
  { id: 'next90', label: 'Next 90 days', group: 'Upcoming', resolve: (now) => [startOfDay(now), endOfDay(addDays(now, 90))] },

  {
    id: 'all',
    label: 'Everything',
    group: 'Wide',
    resolve: (now, options = {}) => {
      const yearsBack = Number(options.allTimeYearsBack) || 5;
      return [startOfYear(new Date(now.getFullYear() - yearsBack, 0, 1)), endOfYear(addMonths(now, 12))];
    },
  },
];

export const PRESET_GROUPS = ['Recent', 'Year', 'Upcoming', 'Wide'];

export function findPreset(id) {
  return RANGE_PRESETS.find((preset) => preset.id === id) || null;
}

export function isValidPresetId(id) {
  return id === 'custom' || Boolean(findPreset(id));
}

/**
 * Resolve a range descriptor into concrete bounds.
 * @param {{preset: string, start?: string, end?: string}} descriptor
 * @returns {{preset: string, start: Date, end: Date, label: string, startISO: string, endISO: string}}
 */
export function resolveRange(descriptor, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const presetId = descriptor?.preset || 'last12months';

  if (presetId === 'custom') {
    const start = fromISODate(descriptor.start) || startOfDay(addMonths(now, -1));
    const endRaw = fromISODate(descriptor.end) || now;
    const end = endOfDay(endRaw < start ? start : endRaw);
    return {
      preset: 'custom',
      start: startOfDay(start),
      end,
      label: 'Custom range',
      startISO: toISODate(start),
      endISO: toISODate(end),
    };
  }

  const preset = findPreset(presetId) || findPreset('last12months');
  const [start, end] = preset.resolve(now, options);
  return {
    preset: preset.id,
    start,
    end,
    label: preset.label,
    startISO: toISODate(start),
    endISO: toISODate(end),
  };
}

/** Pick month or week buckets based on how long the range is. */
export function chooseBucketUnit(start, end) {
  const days = daysBetween(start, end);
  if (days <= 92) return 'week';
  if (days <= 800) return 'month';
  return 'quarter';
}
