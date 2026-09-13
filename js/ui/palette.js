/**
 * Series colours.
 *
 * Colours are returned as `var(--series-N)` references rather than resolved hex
 * values, and applied through inline *style* (not the `fill` attribute) so the
 * browser resolves them live. A theme switch therefore repaints every mark with
 * no re-render and no chart-side theme awareness at all.
 *
 * Hues are assigned in fixed slot order and never generated: past eight series
 * the tail folds into a single neutral "Other" bucket.
 */

export const MAX_SERIES = 8;

export const SERIES_SLOTS = Array.from({ length: MAX_SERIES }, (_, index) => index + 1);

export function seriesColor(slot) {
  const index = Number(slot);
  if (!Number.isFinite(index) || index < 1 || index > MAX_SERIES) return 'var(--series-other)';
  return `var(--series-${index})`;
}

export const OTHER_COLOR = 'var(--series-other)';

/** Sequential ramp, 0 (empty) through 6 (densest). */
export const SEQ_STEPS = 6;
export function seqColor(step) {
  const index = Math.max(0, Math.min(SEQ_STEPS, Math.round(step)));
  return `var(--seq-${index})`;
}

/**
 * Pick the next unused colour slot for a new rule, so two counters do not land
 * on the same hue until every slot is taken.
 */
export function nextFreeSlot(rules) {
  const used = new Set(rules.map((rule) => Number(rule.color)));
  return SERIES_SLOTS.find((slot) => !used.has(slot)) || SERIES_SLOTS[rules.length % MAX_SERIES];
}

/**
 * Cap a series list at MAX_SERIES, folding the smallest into "Other".
 * @param {Array<{id, label, colorSlot, values: number[]}>} series
 */
export function foldSeries(series) {
  if (series.length <= MAX_SERIES) return series;

  const totals = series.map((entry) => ({
    entry,
    total: entry.values.reduce((sum, value) => sum + value, 0),
  }));
  totals.sort((a, b) => b.total - a.total);

  const kept = totals.slice(0, MAX_SERIES - 1).map((item) => item.entry);
  const folded = totals.slice(MAX_SERIES - 1).map((item) => item.entry);
  const length = series[0]?.values.length || 0;

  const other = {
    id: '__other__',
    label: `Other (${folded.length} counters)`,
    colorSlot: null,
    values: Array.from({ length }, (_, index) => folded.reduce((sum, entry) => sum + entry.values[index], 0)),
  };

  // Preserve the author's ordering among the kept series so colours stay put.
  const keptIds = new Set(kept.map((entry) => entry.id));
  return [...series.filter((entry) => keptIds.has(entry.id)), other];
}

export function colorFor(entry) {
  return entry.colorSlot ? seriesColor(entry.colorSlot) : OTHER_COLOR;
}
