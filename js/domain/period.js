/**
 * Repeating and custom "periods" — the unit goals and caps are tracked against.
 *
 * A period is one config object shared by a goal and a cap at the same scope
 * (overall, or a single counter), so "12 of 15 this pay period" and "cap of 15
 * per pay period" always agree on what "this pay period" means.
 *
 * Nothing here touches formatting or the DOM: callers get back plain Date
 * windows and format them however the view needs.
 */
import {
  startOfDay, endOfDay, addDays, daysBetween,
  startOfWeek, startOfMonth, endOfMonth, toISODate, fromISODate,
} from './date-range.js';

export const PERIOD_TYPES = [
  { id: 'week', label: 'Weekly' },
  { id: 'biweek', label: 'Bi-weekly (pay period)' },
  { id: 'month', label: 'Monthly' },
  { id: 'customDays', label: 'Custom N-day period' },
  { id: 'customRanges', label: 'Custom date ranges' },
];

export const PERIOD_TYPE_BY_ID = Object.fromEntries(PERIOD_TYPES.map((type) => [type.id, type]));

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let rangeIdCounter = 0;
export function createPeriodRangeId() {
  rangeIdCounter += 1;
  return `pr${Date.now().toString(36)}${rangeIdCounter.toString(36)}`;
}

/** Fill in defaults so a partial/legacy period (e.g. `undefined`) stays valid. */
export function normalizePeriod(period) {
  const type = PERIOD_TYPE_BY_ID[period?.type] ? period.type : 'week';
  return {
    type,
    anchor: ISO_DATE_RE.test(period?.anchor) ? period.anchor : '',
    days: Math.max(1, Math.round(Number(period?.days)) || 14),
    // A range without both dates yet (e.g. one just added in the editor, not
    // filled in) is kept as-is rather than dropped — only code that actually
    // resolves windows (below) needs a complete range, so it filters there.
    ranges: Array.isArray(period?.ranges)
      ? period.ranges.map((range) => ({
        id: range?.id || createPeriodRangeId(),
        label: String(range?.label ?? '').trim(),
        start: String(range?.start ?? ''),
        end: String(range?.end ?? ''),
      }))
      : [],
  };
}

function repeatLength(period) {
  if (period.type === 'week') return 7;
  if (period.type === 'biweek') return 14;
  return period.days;
}

/** Start of the repeating window that contains `date`. */
function windowStartContaining(period, date, weekStart) {
  if (period.type === 'week') return startOfWeek(date, weekStart);
  if (period.type === 'month') return startOfMonth(date);
  const length = repeatLength(period);
  const anchor = fromISODate(period.anchor) || startOfDay(date);
  const offset = ((daysBetween(anchor, date) % length) + length) % length;
  return addDays(startOfDay(date), -offset);
}

function windowEndFor(period, start) {
  if (period.type === 'month') return endOfMonth(start);
  return endOfDay(addDays(start, repeatLength(period) - 1));
}

function customRangeWindows(period) {
  return period.ranges
    .filter((range) => fromISODate(range.start) && fromISODate(range.end))
    .map((range) => ({
      id: range.id,
      label: range.label,
      start: startOfDay(fromISODate(range.start)),
      end: endOfDay(fromISODate(range.end)),
    }))
    .filter((window) => window.start <= window.end)
    .sort((a, b) => a.start - b.start);
}

const MAX_WINDOWS = 500; // guards against pathologically wide from/to spans

/** Windows of this period that overlap `[from, to]`, earliest first. */
export function periodWindows(period, from, to, { weekStart = 'monday' } = {}) {
  const p = normalizePeriod(period);
  if (from > to) return [];

  if (p.type === 'customRanges') {
    return customRangeWindows(p).filter((window) => window.end >= from && window.start <= to);
  }

  const windows = [];
  let cursor = windowStartContaining(p, from, weekStart);
  let guard = 0;
  while (cursor <= to && guard < MAX_WINDOWS) {
    guard += 1;
    const end = windowEndFor(p, cursor);
    windows.push({ id: toISODate(cursor), label: null, start: cursor, end });
    cursor = addDays(end, 1);
  }
  return windows;
}

/** The window containing `now` (soonest future one, for a custom-ranges period without one). */
export function currentWindow(period, now, { weekStart = 'monday' } = {}) {
  const p = normalizePeriod(period);

  if (p.type === 'customRanges') {
    const windows = customRangeWindows(p);
    return windows.find((window) => window.start <= now && now <= window.end)
      || windows.find((window) => window.start > now)
      || windows[windows.length - 1]
      || null;
  }

  const start = windowStartContaining(p, now, weekStart);
  return { id: toISODate(start), label: null, start, end: windowEndFor(p, start) };
}
