/**
 * Apply counter rules to a set of calendar events.
 *
 * Two counting modes, because both are legitimate and the right one depends on
 * how the rules were written:
 *
 *  - `first`  an event is counted once, by the first enabled rule it matches.
 *             Rule order is therefore meaningful, and totals never double-count.
 *  - `all`    an event is counted by every rule it matches. Useful for
 *             overlapping views ("all HP6" alongside "HP6 mornings"). The
 *             headline total still counts distinct events.
 */
import { compileRules } from './matcher.js';
import { toISODate } from './date-range.js';
import { blockDaySpan, blockHours } from './block.js';

/**
 * @param {Array} events
 * @param {Array} rules
 * @param {{countMode?: 'first'|'all', now?: Date}} [options]
 */
export function countEvents(events, rules, options = {}) {
  const countMode = options.countMode === 'all' ? 'all' : 'first';
  const now = options.now instanceof Date ? options.now : new Date();
  const compiled = compileRules(rules);

  const buckets = compiled.map(({ rule, matcher }) => ({
    rule,
    matcher,
    error: matcher.ok ? null : matcher.error,
    events: [],
    total: 0,
    past: 0,
    future: 0,
    hours: 0,
    days: new Set(),
  }));

  const matchedById = new Map();
  const unmatchedTitles = new Map();

  for (const event of events) {
    let representative = null;

    for (const bucket of buckets) {
      if (!bucket.rule.enabled || !bucket.matcher.ok) continue;
      if (!bucket.matcher.test(event)) continue;

      // A block-mode counter's matches are one calendar event standing in for
      // several daily shifts, so its raw duration is meaningless — credit
      // days-spanned × hours/day instead. Every other counter keeps the
      // event's actual duration, untouched.
      const hours = bucket.rule.blockMode ? blockHours(event, bucket.rule.blockHoursPerDay) : (event.hours || 0);
      const counted = hours === (event.hours || 0) ? event : { ...event, hours, rawHours: event.hours, blockDays: blockDaySpan(event) };

      bucket.events.push(counted);
      bucket.total += 1;
      bucket.hours += hours;
      bucket.days.add(toISODate(event.start));
      if (event.start < now) bucket.past += 1;
      else bucket.future += 1;
      if (!representative) representative = counted;

      if (countMode === 'first') break;
    }

    if (representative) {
      matchedById.set(event.id, representative);
    } else {
      const key = event.title || '(no title)';
      unmatchedTitles.set(key, (unmatchedTitles.get(key) || 0) + 1);
    }
  }

  // Rebuilt from the (possibly block-hours-adjusted) matched events rather than
  // re-filtering `events`, so the override above survives into every consumer
  // of `matchedEvents` (stats.js, the breakdown table, "coming up"). Order is
  // preserved since `events` is already sorted by start.
  const matchedEvents = events.map((event) => matchedById.get(event.id)).filter(Boolean);
  const totals = {
    total: matchedEvents.length,
    past: matchedEvents.filter((event) => event.start < now).length,
    hours: matchedEvents.reduce((sum, event) => sum + (event.hours || 0), 0),
    days: new Set(matchedEvents.map((event) => toISODate(event.start))).size,
    scanned: events.length,
    unmatched: events.length - matchedEvents.length,
  };
  totals.future = totals.total - totals.past;

  return {
    countMode,
    buckets,
    matchedEvents,
    totals,
    errors: buckets.filter((bucket) => bucket.error && bucket.rule.enabled)
      .map((bucket) => ({ ruleId: bucket.rule.id, label: bucket.rule.label, error: bucket.error })),
    unmatched: [...unmatchedTitles.entries()]
      .map(([title, count]) => ({ title, count }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
  };
}

/**
 * Count matches for a single draft rule without disturbing the main result —
 * this is what powers the live preview in the rule editor.
 */
export function previewRule(events, rule, { limit = 40 } = {}) {
  const [{ matcher }] = compileRules([rule]);
  if (!matcher.ok) {
    return { ok: false, error: matcher.error, matcher, total: 0, samples: [], scanned: events.length };
  }
  const matches = [];
  let total = 0;
  for (const event of events) {
    if (!matcher.test(event)) continue;
    total += 1;
    if (matches.length < limit) matches.push(event);
  }
  return { ok: true, error: null, matcher, total, samples: matches, scanned: events.length };
}
