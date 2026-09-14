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
import { renderColumnChart } from '../charts/column-chart.js';
import { renderHeatmap } from '../charts/heatmap.js';
import { foldSeries, seriesColor, seqColor } from '../palette.js';
import { createDateRangePicker } from '../components/date-range-picker.js';
import { createCalendarPicker } from '../components/calendar-picker.js';
import { number, decimal, percent, hours as fmtHours, date as fmtDate, plural } from '../../core/format.js';
import { setRange, setCalendars, loadEvents, saveDefaultRange, saveDefaultCalendars, resolveCalendarIds, sheetUrl } from '../../app-state.js';
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

  // Held in a variable so the saved default can be written back onto it: the
  // pickers read their options on every open, so the footer stays truthful
  // without rebuilding the toolbar.
  const rangeConfig = {
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
        rangeConfig.options = store.get().settings || {};
        notify.success(
          'Default view updated',
          savedToSheet ? 'Saved to your configuration sheet.' : 'Saved in this browser — no writable config sheet is connected.',
        );
      } catch (error) {
        notify.error('Could not save the default view', error.message);
      }
    },
  };
  const rangePicker = createDateRangePicker(rangeConfig);
  qs('[data-range-slot]', root).append(rangePicker.element);
  teardowns.push(() => rangePicker.destroy());

  if (state.calendars?.length > 1) {
    const calendarConfig = {
      calendars: state.calendars,
      selected: state.selectedCalendarIds,
      // The sheet may say `primary`; compare against the id that actually is.
      defaultIds: resolveCalendarIds(state.settings?.calendarIds, state.calendars),
      onChange: (ids) => setCalendars(ids),
      onSetDefault: async (ids) => {
        try {
          const { savedToSheet } = await saveDefaultCalendars(ids);
          calendarConfig.defaultIds = resolveCalendarIds(store.get().settings?.calendarIds, state.calendars);
          notify.success(
            'Default calendars updated',
            savedToSheet ? 'Saved to your configuration sheet.' : 'Saved in this browser — no writable config sheet is connected.',
          );
        } catch (error) {
          notify.error('Could not save the default calendars', error.message);
        }
      },
    };
    const calendarPicker = createCalendarPicker(calendarConfig);
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
    const nodes = [
      heroCard(summary, range, result),
      statGrid(summary),
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

function heroCard(summary, range, result) {
  const now = new Date();
  const rangeIsFuture = range.end > now;

  // The counters that moved the most shifts, so the number at the top of the
  // page is backed by which shift types actually made it up.
  const topCounters = result.buckets
    .filter((bucket) => bucket.rule.enabled && bucket.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  return el('div.hero.dash__hero', {}, [
    el('div.hero__top', {}, [
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
    ]),
    topCounters.length ? el('div.hero__counters', {}, topCounters.map((bucket) => el('div.hero__split-item', {}, [
      el('p.hero__split-label', {}, [
        el('span.swatch', { style: { '--swatch': seriesColor(bucket.rule.color) } }),
        el('span.truncate', { text: bucket.rule.label, title: bucket.rule.label }),
      ]),
      el('p.hero__split-value', { text: number(bucket.total) }),
    ]))) : null,
  ]);
}

function statGrid(summary) {
  const tiles = [
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
