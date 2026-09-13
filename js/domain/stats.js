/**
 * Derived statistics and chart-ready series.
 *
 * Nothing here touches the DOM or the network: give it events and a range, get
 * back plain arrays. That keeps the numbers testable and lets the chart layer
 * stay purely about drawing.
 */
import {
  addDays, addMonths, daysBetween, endOfDay, startOfMonth,
  startOfWeek, toISODate,
} from './date-range.js';
import { date as fmtDate } from '../core/format.js';

const WEEKDAY_ORDER_MONDAY = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_ORDER_SUNDAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * Bucket events over time.
 * @param {'week'|'month'|'quarter'} unit
 * @returns {{key: string, label: string, start: Date, end: Date}[]}
 */
export function buildBuckets(start, end, unit, weekStart = 'monday') {
  const buckets = [];
  if (unit === 'week') {
    let cursor = startOfWeek(start, weekStart);
    while (cursor <= end && buckets.length < 400) {
      const bucketEnd = endOfDay(addDays(cursor, 6));
      buckets.push({ key: toISODate(cursor), label: fmtDate.short(cursor), start: cursor, end: bucketEnd });
      cursor = addDays(cursor, 7);
    }
    return buckets;
  }

  const step = unit === 'quarter' ? 3 : 1;
  let cursor = startOfMonth(start);
  if (unit === 'quarter') cursor = new Date(cursor.getFullYear(), Math.floor(cursor.getMonth() / 3) * 3, 1);

  while (cursor <= end && buckets.length < 400) {
    const next = addMonths(cursor, step);
    buckets.push({
      key: toISODate(cursor),
      label: unit === 'quarter'
        ? `Q${Math.floor(cursor.getMonth() / 3) + 1} ’${String(cursor.getFullYear()).slice(2)}`
        : fmtDate.month(cursor),
      start: cursor,
      end: new Date(next.getTime() - 1),
    });
    cursor = next;
  }
  return buckets;
}

function bucketIndexFor(buckets, when) {
  // Buckets are contiguous and ordered, so a binary search is exact and cheap.
  let low = 0;
  let high = buckets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (when < buckets[mid].start) high = mid - 1;
    else if (when > buckets[mid].end) low = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Stacked series over time, one stack per counter.
 * @returns {{buckets: Array, series: Array<{id, label, color, values: number[]}>, max: number}}
 */
export function timeSeries(result, range, unit, weekStart = 'monday') {
  const buckets = buildBuckets(range.start, range.end, unit, weekStart);
  const series = result.buckets
    .filter((bucket) => bucket.rule.enabled)
    .map((bucket) => ({
      id: bucket.rule.id,
      label: bucket.rule.label,
      colorSlot: bucket.rule.color,
      values: new Array(buckets.length).fill(0),
    }));

  result.buckets.forEach((bucket) => {
    if (!bucket.rule.enabled) return;
    const target = series.find((entry) => entry.id === bucket.rule.id);
    for (const event of bucket.events) {
      const index = bucketIndexFor(buckets, event.start);
      if (index >= 0) target.values[index] += 1;
    }
  });

  const max = buckets.reduce((peak, _, index) => (
    Math.max(peak, series.reduce((sum, entry) => sum + entry.values[index], 0))
  ), 0);

  return { buckets, series, max };
}

/** Shift count by day of week, in the configured week order. */
export function weekdayDistribution(events, weekStart = 'monday') {
  const counts = new Array(7).fill(0);
  for (const event of events) counts[event.start.getDay()] += 1;
  const order = weekStart === 'sunday' ? WEEKDAY_ORDER_SUNDAY : WEEKDAY_ORDER_MONDAY;
  return order.map((day) => ({
    day,
    label: fmtDate.weekday(new Date(2024, 0, 7 + day)), // 2024-01-07 is a Sunday
    value: counts[day],
  }));
}

/** Per-day counts keyed by ISO date — the calendar heatmap's input. */
export function dailyCounts(events) {
  const map = new Map();
  for (const event of events) {
    const key = toISODate(event.start);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

/** Shifts per hour-of-day start, to surface a morning/evening skew. */
export function startHourDistribution(events) {
  const counts = new Array(24).fill(0);
  let timed = 0;
  for (const event of events) {
    if (event.allDay) continue;
    counts[event.start.getHours()] += 1;
    timed += 1;
  }
  return { counts, timed };
}

/**
 * Headline statistics for the KPI row.
 * All rates are computed over the *elapsed* part of the range, so a range that
 * runs into the future does not depress the average.
 */
export function summarize(result, range, now = new Date()) {
  const events = result.matchedEvents;
  const totalDays = Math.max(1, daysBetween(range.start, range.end) + 1);
  const elapsedEnd = now < range.end ? now : range.end;
  const elapsedDays = Math.max(1, daysBetween(range.start, elapsedEnd) + 1);

  const byDay = dailyCounts(events);
  const busiestDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  const monthCounts = new Map();
  for (const event of events) {
    const key = `${event.start.getFullYear()}-${event.start.getMonth()}`;
    monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
  }
  const busiestMonthEntry = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  let busiestMonth = null;
  if (busiestMonthEntry) {
    const [year, month] = busiestMonthEntry[0].split('-').map(Number);
    busiestMonth = { label: fmtDate.month(new Date(year, month, 1)), value: busiestMonthEntry[1] };
  }

  const pastEvents = events.filter((event) => event.start < now);
  const futureEvents = events.filter((event) => event.start >= now);

  return {
    total: result.totals.total,
    past: pastEvents.length,
    future: futureEvents.length,
    hours: result.totals.hours,
    pastHours: pastEvents.reduce((sum, event) => sum + (event.hours || 0), 0),
    distinctDays: byDay.size,
    perWeek: (pastEvents.length / elapsedDays) * 7,
    perWeekAll: (events.length / totalDays) * 7,
    avgHours: events.length ? result.totals.hours / events.length : 0,
    busiestDay: busiestDay ? { date: busiestDay[0], value: busiestDay[1] } : null,
    busiestMonth,
    longestStreak: longestStreak([...byDay.keys()]),
    nextShift: futureEvents.slice().sort((a, b) => a.start - b.start)[0] || null,
    lastShift: pastEvents.slice().sort((a, b) => b.start - a.start)[0] || null,
    totalDays,
    elapsedDays,
  };
}

/** Longest run of consecutive calendar days with at least one shift. */
export function longestStreak(isoDays) {
  if (!isoDays.length) return 0;
  const sorted = isoDays.slice().sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00`);
    const curr = new Date(`${sorted[i]}T00:00:00`);
    run = daysBetween(prev, curr) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Next N upcoming shifts, soonest first. */
export function upcoming(events, now = new Date(), limit = 6) {
  return events
    .filter((event) => event.start >= now)
    .sort((a, b) => a.start - b.start)
    .slice(0, limit);
}
