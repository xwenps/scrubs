/**
 * Calendar heatmap — one cell per day, weeks as columns.
 *
 * Magnitude, so the colour job is sequential: a single hue, light → dark, with
 * a scale legend. Days with no shift use the surface-adjacent step so "nothing"
 * recedes rather than competing with "one".
 */
import { svgEl, paint, mountResponsive } from './svg.js';
import { bindTooltip } from './tooltip.js';
import { seqColor, SEQ_STEPS } from '../palette.js';
import { addDays, daysBetween, startOfWeek, toISODate } from '../../domain/date-range.js';
import { date as fmtDate, plural } from '../../core/format.js';

const CELL = 11;
const CELL_GAP = 3;
const TOP_PAD = 16;
const LEFT_PAD = 26;
const RIGHT_PAD = 28;
const MAX_WEEKS = 53;

/**
 * @param {HTMLElement} container
 * @param {{counts: Map<string, number>, start: Date, end: Date, weekStart?: string}} data
 * @returns {() => void} teardown
 */
export function renderHeatmap(container, data) {
  const { counts, weekStart = 'monday' } = data;
  container.classList.add('chart');

  // A range longer than a year would produce an unreadably wide grid; show the
  // most recent 53 weeks of it and say so in the caption.
  const spanDays = daysBetween(data.start, data.end);
  const clipped = spanDays > MAX_WEEKS * 7;
  const end = data.end;
  const start = clipped ? addDays(end, -(MAX_WEEKS * 7 - 1)) : data.start;

  const gridStart = startOfWeek(start, weekStart);
  const weeks = Math.min(MAX_WEEKS, Math.ceil((daysBetween(gridStart, end) + 1) / 7));
  const max = Math.max(1, ...[...counts.values()]);
  // With few distinct values (a 0-or-1 roster, say) the full ramp would paint
  // every worked day at maximum darkness. Spread the used levels over the
  // upper half of the ramp instead, so "one shift" still reads as mid-tone.
  const levels = Math.min(SEQ_STEPS, max);
  const RAMP_FLOOR = 3;
  const stepFor = (value) => {
    if (value <= 0) return 0;
    const bucket = Math.max(1, Math.ceil((value / max) * levels));
    if (levels === 1) return RAMP_FLOOR;
    return Math.round(RAMP_FLOOR + ((SEQ_STEPS - RAMP_FLOOR) * (bucket - 1)) / (levels - 1));
  };

  let unbind = null;

  const teardown = mountResponsive(container, () => {
    unbind?.();

    const width = LEFT_PAD + weeks * (CELL + CELL_GAP) + RIGHT_PAD;
    const height = TOP_PAD + 7 * (CELL + CELL_GAP);

    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: 'img',
      'aria-label': 'Shifts per day',
      style: `min-width:${width}px`,
    });

    // Day-of-week labels: every other row, so they never crowd the grid.
    for (let row = 0; row < 7; row += 1) {
      if (row % 2 === 0) continue;
      const sample = addDays(gridStart, row);
      svg.append(Object.assign(svgEl('text', {
        class: 'heatmap__dow',
        x: LEFT_PAD - 6,
        y: TOP_PAD + row * (CELL + CELL_GAP) + CELL - 1,
        'text-anchor': 'end',
      }), { textContent: fmtDate.weekday(sample).slice(0, 2) }));
    }

    let lastMonth = -1;
    for (let week = 0; week < weeks; week += 1) {
      const weekStartDate = addDays(gridStart, week * 7);
      if (weekStartDate.getMonth() !== lastMonth) {
        lastMonth = weekStartDate.getMonth();
        svg.append(Object.assign(svgEl('text', {
          class: 'heatmap__month',
          x: LEFT_PAD + week * (CELL + CELL_GAP),
          y: TOP_PAD - 5,
        }), { textContent: fmtDate.monthName(weekStartDate) }));
      }

      for (let row = 0; row < 7; row += 1) {
        const day = addDays(weekStartDate, row);
        if (day < start || day > end) continue;

        const key = toISODate(day);
        const value = counts.get(key) || 0;
        const step = stepFor(value);

        const cell = svgEl('rect', {
          class: 'heatmap__cell',
          x: LEFT_PAD + week * (CELL + CELL_GAP),
          y: TOP_PAD + row * (CELL + CELL_GAP),
          width: CELL,
          height: CELL,
          rx: 2.5,
          'data-date': key,
          'data-value': value,
        });
        paint(cell, seqColor(step));
        svg.append(cell);
      }
    }

    unbind = bindTooltip(container, (event) => {
      const cell = event.target.closest?.('[data-date]');
      if (!cell) return null;
      const value = Number(cell.dataset.value);
      const day = new Date(`${cell.dataset.date}T00:00:00`);
      return {
        title: fmtDate.full(day),
        rows: [{ label: value ? 'Shifts' : 'No shifts', value: value ? String(value) : '—' }],
      };
    });

    return svg;
  });

  const rampSteps = [0, ...Array.from({ length: levels }, (_, index) => stepFor(((index + 1) / levels) * max))];
  const caption = buildScaleLegend(max, rampSteps, clipped ? `Showing the most recent ${weeks} weeks of the range` : null);
  container.after(caption);

  return () => {
    unbind?.();
    teardown();
    caption.remove();
  };
}

function buildScaleLegend(max, rampSteps, note) {
  const wrap = document.createElement('div');
  wrap.className = 'scale-legend';

  const less = document.createElement('span');
  less.textContent = 'None';

  const steps = document.createElement('span');
  steps.className = 'scale-legend__steps';
  for (const step of rampSteps) {
    const swatch = document.createElement('span');
    swatch.className = 'scale-legend__step';
    swatch.style.background = seqColor(step);
    steps.append(swatch);
  }

  const more = document.createElement('span');
  more.textContent = plural(max, 'shift');

  wrap.append(less, steps, more);

  if (note) {
    const noteEl = document.createElement('span');
    noteEl.style.marginInlineStart = 'auto';
    noteEl.textContent = note;
    wrap.append(noteEl);
  }
  return wrap;
}
