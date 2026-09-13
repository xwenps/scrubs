/**
 * "Block mode" hours — for a counter whose matches are single calendar events
 * standing in for several daily shifts (e.g. one 14-day entry instead of
 * fourteen 8-hour ones).
 *
 * The event's raw duration is meaningless for a block ("end - start" would read
 * a 14-day block as ~336 hours), so instead we count the number of 24-hour
 * chunks it spans and credit a configurable number of hours for each. That's
 * elapsed real time between two instants, so — unlike bucketing by calendar
 * date — it's the same number no matter what timezone the dashboard happens to
 * be viewed from, and it doesn't over-count a block whose start and end land on
 * different calendar dates but are only hours apart.
 */
import { daysBetween, fromISODate } from './date-range.js';

const MS_PER_DAY = 86_400_000;

/** Number of 24-hour chunks an event spans. */
export function blockDaySpan(event) {
  if (event.allDay && event.rawStartDate && event.rawEndDate) {
    const start = fromISODate(event.rawStartDate);
    const end = fromISODate(event.rawEndDate); // Google's all-day end date is already exclusive
    if (start && end) return Math.max(1, daysBetween(start, end));
  }
  return Math.max(1, Math.ceil((event.end - event.start) / MS_PER_DAY));
}

/** Hours credited for a block-mode match: days spanned × hours/day. */
export function blockHours(event, hoursPerDay) {
  return blockDaySpan(event) * (Number(hoursPerDay) || 0);
}
