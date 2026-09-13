/**
 * Column chart — stacked or single-series.
 *
 * Conventions it enforces so every chart in the app reads the same way:
 *  - marks capped at 24px wide, the band's leftover left as air;
 *  - a 2px surface gap between touching stacked segments (never a stroke);
 *  - a 4px rounded cap on the topmost segment only, square at the baseline;
 *  - solid hairline gridlines, one step off the surface;
 *  - every non-empty column labelled directly, space permitting.
 */
import { svgEl, niceTicks, labelStride, topRoundedPath, paint, mountResponsive, textWidth } from './svg.js';
import { bindTooltip } from './tooltip.js';
import { colorFor } from '../palette.js';
import { number } from '../../core/format.js';

const GAP = 2;
const CAP_RADIUS = 4;
const MAX_BAR = 24;

/**
 * @param {HTMLElement} container
 * @param {{buckets: Array<{key: string, label: string, tooltipLabel?: string}>,
 *          series: Array<{id: string, label: string, colorSlot: number|null, values: number[]}>,
 *          height?: number, unitLabel?: string, showLegend?: boolean}} data
 * @returns {() => void} teardown
 */
export function renderColumnChart(container, data) {
  const {
    buckets, series, height = 230, unitLabel = 'shifts', showLegend = true,
  } = data;

  container.classList.add('chart');
  let unbindTooltip = null;

  const teardown = mountResponsive(container, (width) => {
    unbindTooltip?.();

    const totals = buckets.map((_, index) => series.reduce((sum, entry) => sum + entry.values[index], 0));
    const peak = Math.max(...totals, 0);
    const { top, ticks } = niceTicks(peak, 4);

    const padLeft = Math.ceil(textWidth(number(top), 11)) + 12;
    const padRight = 8;
    const padTop = 18;
    const padBottom = 26;
    const plotWidth = Math.max(40, width - padLeft - padRight);
    const plotHeight = Math.max(60, height - padTop - padBottom);

    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: 'img',
      'aria-label': `${unitLabel} per period`,
    });

    const band = plotWidth / Math.max(1, buckets.length);
    const barWidth = Math.max(3, Math.min(MAX_BAR, band - Math.max(4, band * 0.28)));
    const yOf = (value) => padTop + plotHeight - (value / top) * plotHeight;

    // Gridlines and y ticks
    for (const tick of ticks) {
      const y = yOf(tick);
      svg.append(svgEl('line', {
        class: 'chart__grid-line', x1: padLeft, x2: padLeft + plotWidth, y1: y, y2: y,
      }));
      svg.append(Object.assign(svgEl('text', {
        class: 'chart__tick', x: padLeft - 8, y: y + 3.5, 'text-anchor': 'end',
      }), { textContent: number(tick) }));
    }

    // Baseline
    svg.append(svgEl('line', {
      class: 'chart__axis-line',
      x1: padLeft, x2: padLeft + plotWidth, y1: padTop + plotHeight, y2: padTop + plotHeight,
    }));

    // Columns
    const stride = labelStride(buckets.map((bucket) => bucket.label), band);

    buckets.forEach((bucket, index) => {
      const x = padLeft + index * band + (band - barWidth) / 2;
      let cursor = padTop + plotHeight;
      let isTopSegment = true;

      for (let s = series.length - 1; s >= 0; s -= 1) {
        const value = series[s].values[index];
        if (!value) continue;

        const rawHeight = (value / top) * plotHeight;
        const y = cursor - rawHeight;
        // The gap is taken off the TOP of each lower segment, so it separates
        // this segment from the one above without shrinking the stack's base.

        const path = svgEl('path', {
          class: 'chart__mark',
          d: isTopSegment
            ? topRoundedPath(x, y, barWidth, Math.max(2, rawHeight), CAP_RADIUS)
            : topRoundedPath(x, y + GAP, barWidth, Math.max(1.5, rawHeight - GAP), 0),
          'data-band': index,
        });
        paint(path, colorFor(series[s]));
        svg.append(path);

        cursor = y;
        isTopSegment = false;
      }

      // Direct label on every non-empty column, space permitting.
      const isLabelled = totals[index] > 0;
      if (isLabelled && band > 22) {
        svg.append(Object.assign(svgEl('text', {
          class: 'chart__value',
          x: x + barWidth / 2,
          y: yOf(totals[index]) - 6,
          'text-anchor': 'middle',
        }), { textContent: number(totals[index]) }));
      }

      // X-axis labels, thinned so they never collide.
      if (index % stride === 0) {
        svg.append(Object.assign(svgEl('text', {
          class: 'chart__tick',
          x: padLeft + index * band + band / 2,
          y: height - 8,
          'text-anchor': 'middle',
        }), { textContent: bucket.label }));
      }

      // Full-height hit target — bigger than the mark, per the interaction rules.
      svg.append(svgEl('rect', {
        class: 'chart__hit',
        x: padLeft + index * band,
        y: padTop,
        width: band,
        height: plotHeight,
        'data-band': index,
      }));
    });

    unbindTooltip = bindTooltip(container, (event) => {
      const hit = event.target.closest?.('[data-band]');
      if (!hit) return null;
      const index = Number(hit.dataset.band);
      const bucket = buckets[index];
      if (!bucket) return null;

      container.querySelectorAll('.chart__mark').forEach((mark) => {
        mark.classList.toggle('is-active', Number(mark.dataset.band) === index);
      });

      const rows = series
        .map((entry) => ({ entry, value: entry.values[index] }))
        .filter((row) => row.value > 0)
        .map((row) => ({ label: row.entry.label, value: number(row.value), color: colorFor(row.entry) }));

      if (series.length > 1) {
        rows.push({ label: 'Total', value: number(totals[index]) });
      } else if (rows.length === 0) {
        rows.push({ label: unitLabel, value: '0' });
      }

      return { title: bucket.tooltipLabel || bucket.label, rows };
    });

    return svg;
  });

  const legend = showLegend && series.length > 1 ? buildLegend(series) : null;
  if (legend) container.after(legend);

  return () => {
    unbindTooltip?.();
    teardown();
    legend?.remove();
  };
}

function buildLegend(series) {
  const list = document.createElement('div');
  list.className = 'legend';
  for (const entry of series) {
    const item = document.createElement('span');
    item.className = 'legend__item';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--swatch', colorFor(entry));
    const label = document.createElement('span');
    label.textContent = entry.label;
    item.append(swatch, label);
    list.append(item);
  }
  return list;
}
