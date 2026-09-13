/**
 * Period picker — the control behind every goal and cap (overall, or one
 * counter). Same period drives both the floor (goal) and the ceiling (cap) at
 * whatever scope it's attached to, so "this pay period" always means the same
 * thing for both.
 */
import { el, clear } from '../../core/dom.js';
import { PERIOD_TYPES, normalizePeriod, createPeriodRangeId } from '../../domain/period.js';

/**
 * @param {{value: object, onChange: (period) => void}} config
 * @returns {{element: HTMLElement, setValue: (period) => void, destroy: () => void}}
 */
export function createPeriodPicker(config) {
  let period = normalizePeriod(config.value);

  const typeSelect = el('select.select', {
    'aria-label': 'Track by period',
    on: { change: () => update({ type: typeSelect.value }) },
  }, PERIOD_TYPES.map((type) => el('option', {
    value: type.id, text: type.label, selected: type.id === period.type,
  })));

  const fieldsHost = el('div.stack.stack--2');

  const root = el('div.period-picker.stack.stack--3', {}, [
    el('div.field', {}, [
      el('label.field__label', { text: 'Track by period' }),
      typeSelect,
    ]),
    fieldsHost,
  ]);

  function update(patch) {
    period = normalizePeriod({ ...period, ...patch });
    config.onChange(period);
    renderFields();
  }

  function patchRange(index, patch) {
    const ranges = period.ranges.slice();
    ranges[index] = { ...ranges[index], ...patch };
    update({ ranges });
  }

  function renderFields() {
    clear(fieldsHost);
    typeSelect.value = period.type;

    if (period.type === 'week') {
      fieldsHost.append(el('p.field__hint', { text: 'Resets every week, aligned to your week-start setting.' }));
      return;
    }
    if (period.type === 'month') {
      fieldsHost.append(el('p.field__hint', { text: 'Resets on the 1st of each calendar month.' }));
      return;
    }

    if (period.type === 'biweek' || period.type === 'customDays') {
      const anchorInput = el('input.input', {
        type: 'date',
        value: period.anchor,
        'aria-label': 'A date on a period boundary',
        on: { change: () => update({ anchor: anchorInput.value }) },
      });
      const fields = [
        el('div.field', {}, [
          el('label.field__label', { text: 'Anchor date' }),
          anchorInput,
          el('p.field__hint', { text: 'Any date that should be the first day of a period.' }),
        ]),
      ];
      if (period.type === 'customDays') {
        const daysInput = el('input.input', {
          type: 'number',
          min: '1',
          step: '1',
          value: String(period.days),
          'aria-label': 'Period length in days',
          on: { change: () => update({ days: Math.max(1, Math.round(Number(daysInput.value)) || 14) }) },
        });
        fields.push(el('div.field', {}, [
          el('label.field__label', { text: 'Days per period' }),
          daysInput,
        ]));
      }
      fieldsHost.append(el('div.grid.grid--halves', {}, fields));
      return;
    }

    // customRanges — a hand-authored, non-repeating list of named windows.
    const list = el('div.stack.stack--2');
    period.ranges.forEach((range, index) => {
      const labelInput = el('input.input', {
        type: 'text',
        placeholder: 'Label, e.g. “Spring rotation”',
        value: range.label,
        on: { change: () => patchRange(index, { label: labelInput.value }) },
      });
      const startInput = el('input.input', {
        type: 'date',
        value: range.start,
        'aria-label': 'Start date',
        on: { change: () => patchRange(index, { start: startInput.value }) },
      });
      const endInput = el('input.input', {
        type: 'date',
        value: range.end,
        'aria-label': 'End date',
        on: { change: () => patchRange(index, { end: endInput.value }) },
      });
      const removeButton = el('button.btn.btn--icon.btn--sm.btn--ghost', {
        type: 'button',
        title: 'Remove range',
        'aria-label': 'Remove range',
        on: { click: () => update({ ranges: period.ranges.filter((_, i) => i !== index) }) },
        html: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      });
      list.append(el('div.input-row', {}, [labelInput, startInput, endInput, removeButton]));
    });

    fieldsHost.append(
      el('p.field__hint', { text: 'Define your own windows by hand — they don’t repeat.' }),
      list,
      el('button.btn.btn--sm.btn--ghost', {
        type: 'button',
        text: 'Add range',
        on: {
          click: () => update({ ranges: [...period.ranges, { id: createPeriodRangeId(), label: '', start: '', end: '' }] }),
        },
      }),
    );
  }

  renderFields();

  return {
    element: root,
    setValue(next) {
      period = normalizePeriod(next);
      renderFields();
    },
    destroy() {
      root.remove();
    },
  };
}
