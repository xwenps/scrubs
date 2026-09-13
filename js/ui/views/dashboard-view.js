/**
 * Dashboard.
 *
 * Reads the store, recomputes the counters, and draws. The whole body is
 * re-rendered on any state change that matters; charts are cheap enough that
 * diffing would cost more in complexity than it saves in milliseconds.
 */
import { loadTemplate, qs, el, clear } from '../../core/dom.js';
import { store } from '../../core/store.js';
import { countEvents } from '../../domain/counter.js';
import { timeSeries, weekdayDistribution, dailyCounts, startHourDistribution, summarize, upcoming } from '../../domain/stats.js';
import { chooseBucketUnit } from '../../domain/date-range.js';
import { currentWindow, periodWindows } from '../../domain/period.js';
import { renderColumnChart } from '../charts/column-chart.js';
import { renderHeatmap } from '../charts/heatmap.js';
import { foldSeries, seriesColor, seqColor } from '../palette.js';
import { createDateRangePicker } from '../components/date-range-picker.js';
import { createCalendarPicker } from '../components/calendar-picker.js';
import { number, decimal, percent, hours as fmtHours, date as fmtDate, plural } from '../../core/format.js';
import { setRange, setCalendars, loadEvents, saveDefaultRange, sheetUrl } from '../../app-state.js';
import { notify } from '../components/toast.js';

export async function renderDashboardView(mount) {
  const fragment = await loadTemplate('dashboard');
  mount.replaceChildren(fragment);

  const root = qs('.dash', mount);
  const body = qs('[data-dash-body]', root);
  const banner = qs('[data-config-banner]', root);
  const rangeSummary = qs('[data-range-summary]', root);
  const eventCount = qs('[data-event-count]', root);

  const teardowns = [];
  const state = store.get();

  /* ---- toolbar ----------------------------------------------------------- */

  const rangePicker = createDateRangePicker({
    value: { preset: state.range?.preset || 'last12months', start: state.range?.startISO, end: state.range?.endISO },
    options: state.settings || {},
    onChange: (resolved) => setRange(resolved),
    onSetDefault: async (descriptor) => {
      try {
        const { savedToSheet } = await saveDefaultRange({
          preset: descriptor.preset,
          start: descriptor.start,
          end: descriptor.end,
        });
        notify.success(
          'Default view updated',
          savedToSheet ? 'Saved to your configuration sheet.' : 'Saved in this browser — no writable config sheet is connected.',
        );
      } catch (error) {
        notify.error('Could not save the default view', error.message);
      }
    },
  });
  qs('[data-range-slot]', root).append(rangePicker.element);
  teardowns.push(() => rangePicker.destroy());

  if (state.calendars?.length > 1) {
    const calendarPicker = createCalendarPicker({
      calendars: state.calendars,
      selected: state.selectedCalendarIds,
      onChange: (ids) => setCalendars(ids),
    });
    qs('[data-calendar-slot]', root).append(calendarPicker.element);
    teardowns.push(() => calendarPicker.destroy());
  } else if (!state.calendars?.length && state.selectedCalendarIds?.length) {
    // This deployment did not request the calendar-listing permission, so there
    // is nothing to pick between. Still say which calendars are being counted,
    // rather than leaving it a mystery.
    const names = state.selectedCalendarIds.join(', ');
    qs('[data-calendar-slot]', root).append(el('span.chip', {
      title: names,
      style: { 'max-width': '260px' },
    }, [el('span.truncate', { text: names })]));
  }

  qs('[data-action="refresh"]', root).addEventListener('click', (event) => {
    const button = event.currentTarget;
    button.classList.add('is-busy');
    loadEvents().finally(() => button.classList.remove('is-busy'));
  });

  /* ---- render ------------------------------------------------------------ */

  let chartTeardowns = [];

  function render() {
    chartTeardowns.forEach((fn) => fn());
    chartTeardowns = [];

    const current = store.get();
    const { range, settings, rules, events, eventsStatus } = current;
    if (!range) return;

    // Keep the picker's own state in sync — it's created once, outside this
    // function, so it wouldn't otherwise notice the range or the default
    // changing (e.g. after "Make this my default view", or a picker-external
    // range change).
    rangePicker.setValue({ preset: range.preset, start: range.startISO, end: range.endISO });
    rangePicker.setOptions(settings || {});

    rangeSummary.textContent = `${fmtDate.range(range.start, range.end)} · ${range.label}`;
    renderBanner(banner, current);

    if (eventsStatus === 'loading') {
      eventCount.textContent = 'Loading…';
      body.replaceChildren(loadingSkeleton());
      return;
    }

    if (eventsStatus === 'error') {
      eventCount.textContent = '';
      body.replaceChildren(emptyState({
        title: 'Your calendar could not be loaded',
        text: current.eventsError || 'Something went wrong talking to Google Calendar.',
        action: el('button.btn.btn--primary', { type: 'button', text: 'Try again', on: { click: () => loadEvents() } }),
      }));
      return;
    }

    eventCount.textContent = `${plural(events.length, 'event')} in range`;

    const enabledRules = rules.filter((rule) => rule.enabled);
    if (enabledRules.length === 0) {
      body.replaceChildren(emptyState({
        title: 'No counters yet',
        text: 'A counter is a rule such as “title contains HP6”. Create one and this page fills with your numbers.',
        action: el('a.btn.btn--primary', { href: '#/rules', text: 'Set up counters' }),
      }));
      return;
    }

    const result = countEvents(events, rules, { countMode: settings?.countMode || 'first' });
    for (const error of result.errors) notify.warning(`Counter “${error.label}”`, error.error);

    if (result.totals.total === 0) {
      body.replaceChildren(emptyState({
        title: 'Nothing matched in this range',
        text: events.length
          ? `Scrubs read ${plural(events.length, 'event')} but none matched your counters. Widen a counter, or pick a different date range.`
          : 'There are no events in this date range on the selected calendars.',
        action: el('a.btn', { href: '#/rules', text: 'Review counters' }),
      }));
      return;
    }

    const summary = summarize(result, range);
    const now = new Date();
    const nodes = [
      heroCard(summary, range),
      statGrid(summary),
      goalCard(result, rules, settings, range, now),
      overcommitCard(result, rules, settings, range, now),
      timeChartCard(result, range, settings, chartTeardowns),
      distributionRow(result, settings, chartTeardowns),
      heatmapCard(result, range, settings, chartTeardowns),
      breakdownCard(result),
      upcomingCard(result),
    ].filter(Boolean);

    body.replaceChildren(...nodes);
  }

  const unsubscribe = store.subscribe(
    ['events', 'eventsStatus', 'rules', 'range', 'settings', 'configError'],
    render,
  );
  teardowns.push(unsubscribe);

  render();

  return () => {
    chartTeardowns.forEach((fn) => fn());
    teardowns.forEach((fn) => fn());
  };
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

function heroCard(summary, range) {
  const now = new Date();
  const rangeIsFuture = range.end > now;

  return el('div.hero.dash__hero', {}, [
    el('div.hero__figure', {}, [
      el('p.hero__label', { text: 'Shifts counted' }),
      el('p.hero__value', {}, [
        number(summary.total),
        el('span.hero__unit', { text: summary.total === 1 ? 'shift' : 'shifts' }),
      ]),
      el('p.hero__meta', {
        text: summary.distinctDays === summary.total
          ? `Across ${plural(summary.distinctDays, 'day')}`
          : `Across ${plural(summary.distinctDays, 'day')} · ${decimal(summary.perWeek, 1)} per week`,
      }),
    ]),
    el('div.hero__split', {}, [
      el('div.hero__split-item', {}, [
        el('p.hero__split-label', {}, [
          el('span.swatch', { style: { '--swatch': 'var(--ink-2)' } }),
          'Worked',
        ]),
        el('p.hero__split-value', { text: number(summary.past) }),
      ]),
      rangeIsFuture ? el('div.hero__split-item', {}, [
        el('p.hero__split-label', {}, [
          el('span.swatch', { style: { '--swatch': 'var(--ink-3)', opacity: '0.5' } }),
          'Scheduled',
        ]),
        el('p.hero__split-value', { text: number(summary.future) }),
      ]) : null,
    ]),
  ]);
}

function statGrid(summary) {
  const tiles = [
    {
      label: 'Hours on the clock',
      value: fmtHours(summary.hours),
      meta: summary.avgHours ? `${fmtHours(summary.avgHours)} average shift` : 'All-day events count as 0h',
    },
    {
      label: 'Shifts per week',
      value: decimal(summary.perWeek, 1),
      meta: `Over ${plural(Math.round(summary.elapsedDays / 7), 'week')} elapsed`,
    },
    {
      label: 'Longest run',
      value: number(summary.longestStreak),
      meta: summary.longestStreak === 1 ? 'No back-to-back days' : 'Consecutive days on shift',
    },
    summary.busiestMonth ? {
      label: 'Busiest month',
      value: summary.busiestMonth.label,
      meta: plural(summary.busiestMonth.value, 'shift'),
    } : null,
  ].filter(Boolean);

  return el('div.grid.grid--stats.section', {}, tiles.map((tile) => el('div.stat', {}, [
    el('span.stat__label', { text: tile.label }),
    el('p.stat__value', { text: tile.value }),
    el('p.stat__meta', { text: tile.meta, title: tile.meta }),
  ])));
}

/** One shared period per tracker drives both its goal and its cap. */
function buildTracker({ label, period, events, goalEnabled, goalTarget, capEnabled, capTarget, colorVar, now, weekStart }) {
  const window = currentWindow(period, now, { weekStart });
  const count = window ? events.filter((event) => event.start >= window.start && event.start <= window.end).length : 0;
  return { label, window, count, goalEnabled, goalTarget, capEnabled, capTarget, colorVar };
}

function trackerRow(tracker) {
  const { label, window, count, goalEnabled, goalTarget, capEnabled, capTarget, colorVar } = tracker;
  const target = capEnabled ? capTarget : goalTarget;
  const over = capEnabled && count > capTarget;
  const met = !capEnabled && goalEnabled && goalTarget > 0 && count >= goalTarget;
  const barColor = over ? 'var(--status-critical)' : met ? 'var(--status-good)' : colorVar;
  const pct = target ? Math.min(100, (count / target) * 100) : 0;

  return el('div.stack.stack--2', {}, [
    el('div.row.row--between', {}, [
      el('span', { text: label, style: { 'font-weight': '550' } }),
      el('span.text-sm.muted', { text: window ? fmtDate.range(window.start, window.end) : '' }),
    ]),
    el('div.share', {}, [
      el('div.share__track', {}, [
        el('div.share__fill', { style: { width: `${pct}%`, '--share-color': barColor } }),
      ]),
      el('span.share__pct', { text: target ? `${number(count)} / ${number(target)}` : number(count) }),
    ]),
    over ? el('p.stat__meta', { text: `${plural(count - capTarget, 'shift')} over the cap`, style: { color: 'var(--status-critical)' } }) : null,
  ].filter(Boolean));
}

/** Progress toward every tracked goal/cap, for the period in progress right now. */
function goalCard(result, rules, settings, range, now) {
  const weekStart = settings?.weekStart;
  const trackers = [];
  const hasTracking = settings?.goalEnabled || settings?.capEnabled
    || rules.some((rule) => rule.enabled && (rule.goalEnabled || rule.capEnabled));
  if (!hasTracking) return null;

  // The loaded `events` only cover the selected range, so if "now" falls
  // outside it, the current period's count would be wrong (missing data), not
  // just zero — say so instead of showing a misleading progress bar.
  if (now < range.start || now > range.end) {
    return el('div.card.card--pad.section', {}, [
      el('div.chart-card__head', {}, [
        el('div', {}, [
          el('p.chart-card__title', { text: 'Goals & limits' }),
          el('p.chart-card__sub', { text: 'This range doesn’t include today, so current progress can’t be shown.' }),
        ]),
      ]),
      el('p.field__hint', { text: 'Pick a range that includes today to track the period in progress.' }),
    ]);
  }

  if (settings?.goalEnabled || settings?.capEnabled) {
    trackers.push(buildTracker({
      label: 'Overall',
      period: settings.period,
      events: result.matchedEvents,
      goalEnabled: settings.goalEnabled,
      goalTarget: settings.goalTarget,
      capEnabled: settings.capEnabled,
      capTarget: settings.capTarget,
      colorVar: 'var(--ink-2)',
      now,
      weekStart,
    }));
  }

  for (const rule of rules) {
    if (!rule.enabled || (!rule.goalEnabled && !rule.capEnabled)) continue;
    const bucket = result.buckets.find((entry) => entry.rule.id === rule.id);
    trackers.push(buildTracker({
      label: rule.label,
      period: rule.period,
      events: bucket?.events || [],
      goalEnabled: rule.goalEnabled,
      goalTarget: rule.goalTarget,
      capEnabled: rule.capEnabled,
      capTarget: rule.capTarget,
      colorVar: seriesColor(rule.color),
      now,
      weekStart,
    }));
  }

  return el('div.card.card--pad.section', {}, [
    el('div.chart-card__head', {}, [
      el('div', {}, [
        el('p.chart-card__title', { text: 'Goals & limits' }),
        el('p.chart-card__sub', { text: 'Progress for the period in progress right now.' }),
      ]),
    ]),
    el('div.stack.stack--4', { style: { 'margin-top': 'var(--s-3)' } }, trackers.map(trackerRow)),
  ]);
}

/** Future periods over a cap, with their scheduled shifts as cancellation candidates. */
function overcommitCard(result, rules, settings, range, now) {
  const weekStart = settings?.weekStart;
  const trackers = [];

  if (settings?.capEnabled && settings.capTarget) {
    trackers.push({ label: 'Overall', period: settings.period, cap: settings.capTarget, events: result.matchedEvents });
  }
  for (const rule of rules) {
    if (!rule.enabled || !rule.capEnabled || !rule.capTarget) continue;
    const bucket = result.buckets.find((entry) => entry.rule.id === rule.id);
    trackers.push({ label: rule.label, period: rule.period, cap: rule.capTarget, events: bucket?.events || [] });
  }

  if (!trackers.length) return null;

  const flagged = [];
  for (const tracker of trackers) {
    const windows = periodWindows(tracker.period, now, range.end, { weekStart });
    for (const window of windows) {
      const inWindow = tracker.events.filter((event) => event.start >= window.start && event.start <= window.end);
      if (inWindow.length <= tracker.cap) continue;
      const hasUpcoming = inWindow.some((event) => event.start >= now);
      if (!hasUpcoming) continue; // already worked — nothing left to cancel
      flagged.push({ label: tracker.label, window, cap: tracker.cap, total: inWindow.length });
    }
  }

  const looksForward = range.end - now > 2 * 86_400_000;

  if (!flagged.length) {
    if (looksForward) return null; // nothing over any cap
    return el('div.card.card--pad.section', {}, [
      el('div.chart-card__head', {}, [
        el('div', {}, [
          el('p.chart-card__title', { text: 'Over-committed periods' }),
          el('p.chart-card__sub', { text: 'No future shifts are loaded to check against your caps.' }),
        ]),
      ]),
      el('p.field__hint', { text: 'Pick a date range that reaches further ahead — “Next 90 days”, say — to see this.' }),
    ]);
  }

  flagged.sort((a, b) => a.window.start - b.window.start);

  const table = el('table.table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Counter' }),
        el('th', { text: 'Period' }),
        el('th.num', { text: 'Scheduled' }),
        el('th.num', { text: 'Cap' }),
        el('th.num', { text: 'Over' }),
      ]),
    ]),
    el('tbody', {}, flagged.map((flag) => el('tr', {}, [
      el('td', { text: flag.label }),
      el('td', { text: fmtDate.range(flag.window.start, flag.window.end) }),
      el('td.num', { text: number(flag.total) }),
      el('td.num', { text: number(flag.cap) }),
      el('td.num', {}, [
        el('strong', { text: `+${number(flag.total - flag.cap)}`, style: { color: 'var(--status-critical)' } }),
      ]),
    ]))),
  ]);

  return el('div.card.section', {}, [
    el('div.card__head', {}, [
      el('p.card__title', { text: 'Over-committed periods' }),
      el('p.card__note', { text: 'Future periods over a cap, soonest first.' }),
    ]),
    el('div.card__body', {}, [el('div.table-wrap', {}, [table])]),
  ]);
}

function timeChartCard(result, range, settings, teardowns) {
  const unit = chooseBucketUnit(range.start, range.end);
  const { buckets, series } = timeSeries(result, range, unit, settings?.weekStart);
  const folded = foldSeries(series.filter((entry) => entry.values.some((value) => value > 0)));
  if (!folded.length) return null;

  const chartHost = el('div');
  const card = el('div.card.card--pad.section', {}, [
    el('div.chart-card__head', {}, [
      el('div', {}, [
        el('p.chart-card__title', { text: 'Shifts over time' }),
        el('p.chart-card__sub', { text: `Grouped by ${unit}. Hover a column for the split.` }),
      ]),
    ]),
    chartHost,
  ]);

  queueMicrotask(() => {
    teardowns.push(renderColumnChart(chartHost, {
      buckets,
      series: folded,
      height: 250,
      unitLabel: 'shifts',
    }));
  });

  return card;
}

function distributionRow(result, settings, teardowns) {
  const weekday = weekdayDistribution(result.matchedEvents, settings?.weekStart);
  const { counts: hourCounts, timed } = startHourDistribution(result.matchedEvents);

  const weekdayHost = el('div');
  const weekdayCard = el('div.card.card--pad', {}, [
    el('div.chart-card__head', {}, [
      el('div', {}, [
        el('p.chart-card__title', { text: 'By day of week' }),
        el('p.chart-card__sub', { text: 'Where your shifts land across the week.' }),
      ]),
    ]),
    weekdayHost,
  ]);

  queueMicrotask(() => {
    teardowns.push(renderColumnChart(weekdayHost, {
      buckets: weekday.map((entry) => ({ key: String(entry.day), label: entry.label })),
      series: [{ id: 'weekday', label: 'Shifts', colorSlot: null, values: weekday.map((entry) => entry.value) }],
      height: 200,
      showLegend: false,
    }));
    // Single series: sequential hue, not a categorical slot.
    weekdayHost.querySelectorAll('.chart__mark').forEach((mark) => mark.style.setProperty('fill', seqColor(4)));
  });

  if (!timed) {
    return el('div.grid.grid--halves.section', {}, [weekdayCard]);
  }

  const firstHour = Math.max(0, hourCounts.findIndex((value) => value > 0) - 1);
  const lastHour = Math.min(23, hourCounts.length - 1 - [...hourCounts].reverse().findIndex((value) => value > 0) + 1);
  const hourBuckets = [];
  const hourValues = [];
  for (let hour = firstHour; hour <= lastHour; hour += 1) {
    hourBuckets.push({
      key: String(hour),
      label: hour % 3 === 0 ? formatHour(hour) : '',
      tooltipLabel: `Starting ${formatHour(hour)}`,
    });
    hourValues.push(hourCounts[hour]);
  }

  const hourHost = el('div');
  const hourCard = el('div.card.card--pad', {}, [
    el('div.chart-card__head', {}, [
      el('div', {}, [
        el('p.chart-card__title', { text: 'Start times' }),
        el('p.chart-card__sub', { text: `${plural(timed, 'timed shift')} · all-day events excluded.` }),
      ]),
    ]),
    hourHost,
  ]);

  queueMicrotask(() => {
    teardowns.push(renderColumnChart(hourHost, {
      buckets: hourBuckets,
      series: [{ id: 'hour', label: 'Shifts', colorSlot: null, values: hourValues }],
      height: 200,
      showLegend: false,
    }));
    hourHost.querySelectorAll('.chart__mark').forEach((mark) => mark.style.setProperty('fill', seqColor(4)));
  });

  return el('div.grid.grid--halves.section', {}, [weekdayCard, hourCard]);
}

function formatHour(hour) {
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

function heatmapCard(result, range, settings, teardowns) {
  const counts = dailyCounts(result.matchedEvents);
  const host = el('div.heatmap');

  const card = el('div.card.card--pad.section', {}, [
    el('div.chart-card__head', {}, [
      el('div', {}, [
        el('p.chart-card__title', { text: 'Activity calendar' }),
        el('p.chart-card__sub', { text: 'One square per day. Darker means more shifts.' }),
      ]),
    ]),
    host,
  ]);

  queueMicrotask(() => {
    teardowns.push(renderHeatmap(host, {
      counts,
      start: range.start,
      end: range.end,
      weekStart: settings?.weekStart,
    }));
  });

  return card;
}

function breakdownCard(result) {
  const rows = result.buckets.filter((bucket) => bucket.rule.enabled);
  const grandTotal = rows.reduce((sum, bucket) => sum + bucket.total, 0);

  const table = el('table.table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Counter' }),
        el('th.num', { text: 'Worked' }),
        el('th.num', { text: 'Scheduled' }),
        el('th.num', { text: 'Total' }),
        el('th.num', { text: 'Hours' }),
        el('th', { text: 'Share' }),
      ]),
    ]),
    el('tbody', {}, rows.map((bucket) => el('tr', {}, [
      el('td', {}, [
        el('div.table__name', {}, [
          el('span.swatch', { style: { '--swatch': seriesColor(bucket.rule.color) } }),
          el('span', { text: bucket.rule.label, title: bucket.rule.label }),
        ]),
      ]),
      el('td.num', { text: number(bucket.past) }),
      el('td.num', { text: number(bucket.future) }),
      el('td.num', { text: number(bucket.total) }),
      el('td.num', { text: fmtHours(bucket.hours) }),
      el('td', {}, [
        el('div.share', {}, [
          el('div.share__track', {}, [
            el('div.share__fill', {
              style: {
                width: `${grandTotal ? (bucket.total / grandTotal) * 100 : 0}%`,
                '--share-color': seriesColor(bucket.rule.color),
              },
            }),
          ]),
          el('span.share__pct', { text: percent(bucket.total, grandTotal) }),
        ]),
      ]),
    ]))),
    el('tfoot', {}, [
      el('tr', {}, [
        el('td', { text: result.countMode === 'all' ? 'Total (events may appear twice)' : 'Total' }),
        el('td.num', { text: number(result.totals.past) }),
        el('td.num', { text: number(result.totals.future) }),
        el('td.num', { text: number(result.totals.total) }),
        el('td.num', { text: fmtHours(result.totals.hours) }),
        el('td', { text: '' }),
      ]),
    ]),
  ]);

  return el('div.card.section', {}, [
    el('div.card__head', {}, [
      el('p.card__title', { text: 'Counter breakdown' }),
      el('p.card__note', { text: 'Every number on this page, as a table.' }),
    ]),
    el('div.card__body', {}, [el('div.table-wrap', {}, [table])]),
  ]);
}

function upcomingCard(result) {
  const next = upcoming(result.matchedEvents, new Date(), 6);
  if (!next.length) return null;

  return el('div.card.card--pad.section', {}, [
    el('div.chart-card__head', {}, [
      el('div', {}, [
        el('p.chart-card__title', { text: 'Coming up' }),
        el('p.chart-card__sub', { text: 'Your next scheduled shifts in this range.' }),
      ]),
    ]),
    el('div.upcoming', {}, next.map((event) => el('div.upcoming__item', {}, [
      el('div.upcoming__date', {}, [
        el('p.upcoming__dow', { text: fmtDate.weekday(event.start) }),
        el('p.upcoming__day', { text: String(event.start.getDate()) }),
      ]),
      el('div.upcoming__body', {}, [
        el('p.upcoming__title', { text: event.title || 'Untitled', title: event.title }),
        el('p.upcoming__meta', {
          text: event.allDay
            ? `${fmtDate.month(event.start)} · all day`
            : `${fmtDate.month(event.start)} · ${fmtDate.time(event.start)}–${fmtDate.time(event.end)}`,
        }),
      ]),
    ]))),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                 */
/* -------------------------------------------------------------------------- */

function renderBanner(host, state) {
  clear(host);
  if (!state.configError) return;

  host.append(el('div.callout.callout--warning', { style: { 'margin-bottom': 'var(--s-4)' } }, [
    el('span.callout__dot'),
    el('div', {}, [
      el('strong', { text: 'Configuration sheet unavailable. ' }),
      document.createTextNode(`${state.configError} `),
      state.spreadsheetId
        ? el('a', { href: sheetUrl(state.spreadsheetId), target: '_blank', rel: 'noopener', text: 'Open the sheet' })
        : null,
    ]),
  ]));
}

function loadingSkeleton() {
  return el('div.dash__loading', {}, [
    el('div.skeleton', { style: { height: '118px' } }),
    el('div.grid.grid--stats', {}, Array.from({ length: 4 }, () => el('div.skeleton', { style: { height: '92px' } }))),
    el('div.skeleton.skeleton--tall'),
  ]);
}

function emptyState({ title, text, action }) {
  return el('div.card', {}, [
    el('div.empty', {}, [
      el('span.empty__icon', {
        html: '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 6.5h12M5.5 1.5v2M10.5 1.5v2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
      }),
      el('p.empty__title', { text: title }),
      el('p.empty__text', { text }),
      action,
    ]),
  ]);
}
