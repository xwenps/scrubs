/**
 * Date-range control: preset rows plus a custom range behind a hairline.
 *
 * The footer action promotes the current selection to the deployment's default
 * view, which is what the `defaultRange` key in the config sheet stores.
 */
import { el, qs, onDismiss } from '../../core/dom.js';
import { RANGE_PRESETS, PRESET_GROUPS, resolveRange } from '../../domain/date-range.js';
import { date as fmtDate } from '../../core/format.js';

/**
 * @param {{value: {preset: string, start?: string, end?: string},
 *          onChange: (next) => void,
 *          onSetDefault?: (next) => void,
 *          options?: object}} config
 */
export function createDateRangePicker(config) {
  let value = { ...config.value };
  let closePopover = null;

  /** Whether `value` is exactly the deployment's saved default — recomputed
   * live (not cached) so it stays correct as the range or the default change. */
  function isCurrentDefault() {
    const options = config.options || {};
    if (!options.defaultRange) return false;
    if (value.preset !== options.defaultRange) return false;
    if (value.preset !== 'custom') return true;
    return value.start === options.defaultRangeStart && value.end === options.defaultRangeEnd;
  }

  function defaultDescriptor() {
    const options = config.options || {};
    if (options.defaultRange === 'custom') {
      return { preset: 'custom', start: options.defaultRangeStart, end: options.defaultRangeEnd };
    }
    return { preset: options.defaultRange };
  }

  const button = el('button.btn.dash__range-btn', {
    type: 'button',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    on: { click: () => (closePopover ? close() : open()) },
  }, [
    calendarIcon(),
    el('span', { text: labelFor(value, config.options) }),
    chevron(),
  ]);

  const host = el('div.popover-host', {}, [button]);

  function labelFor(next, options) {
    const resolved = resolveRange(next, options);
    if (next.preset === 'custom') return fmtDate.range(resolved.start, resolved.end);
    return resolved.label;
  }

  function refreshButton() {
    qs('span', button).textContent = labelFor(value, config.options);
  }

  function commit(next, { close: shouldClose = true } = {}) {
    value = next;
    refreshButton();
    config.onChange(resolveRange(value, config.options));
    if (shouldClose) close();
  }

  function open() {
    const resolved = resolveRange(value, config.options);

    const panel = el('div.popover', {
      role: 'dialog',
      'aria-label': 'Choose a date range',
      style: {
        'inset-inline-start': '0',
        top: 'calc(100% + 6px)',
        'min-width': 'min(300px, calc(100vw - 32px))',
        'max-width': 'min(340px, calc(100vw - 32px))',
        // The list is long; keep the custom range and the footer reachable on
        // short screens instead of pushing them below the fold.
        'max-height': 'min(70vh, 560px)',
        'overflow-y': 'auto',
      },
    });

    for (const group of PRESET_GROUPS) {
      const presets = RANGE_PRESETS.filter((preset) => preset.group === group);
      if (!presets.length) continue;
      panel.append(el('p.popover__title', { text: group }));
      for (const preset of presets) {
        const isActive = value.preset === preset.id;
        panel.append(el('button.popover__option', {
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': String(isActive),
          on: { click: () => commit({ preset: preset.id }) },
        }, [
          el('span.popover__check', { text: isActive ? '✓' : '' }),
          el('span', { text: preset.label }),
        ]));
      }
    }

    panel.append(el('div.popover__divider'));
    panel.append(el('p.popover__title', { text: 'Custom range' }));

    const startInput = el('input.input', {
      type: 'date',
      value: value.preset === 'custom' ? (value.start || resolved.startISO) : resolved.startISO,
      'aria-label': 'Start date',
    });
    const endInput = el('input.input', {
      type: 'date',
      value: value.preset === 'custom' ? (value.end || resolved.endISO) : resolved.endISO,
      'aria-label': 'End date',
    });

    panel.append(el('div.popover__foot.stack.stack--2', {}, [
      el('div.input-row.input-row--dates', {}, [startInput, el('span.muted.text-sm', { text: 'to' }), endInput]),
      el('button.btn.btn--primary.btn--sm.btn--block', {
        type: 'button',
        text: 'Apply custom range',
        on: {
          click: () => commit({ preset: 'custom', start: startInput.value, end: endInput.value }),
        },
      }),
    ]));

    if (config.onSetDefault) {
      panel.append(el('div.popover__divider'));
      panel.append(el('div.popover__foot.row.row--tight', {}, isCurrentDefault() ? [
        el('button.link-btn.text-sm', {
          type: 'button',
          text: '✓ This is your default view',
          disabled: true,
        }),
      ] : [
        el('button.link-btn.text-sm', {
          type: 'button',
          text: 'Make this my default view',
          on: {
            click: () => {
              config.onSetDefault(value);
              close();
            },
          },
        }),
        config.options?.defaultRange ? el('button.link-btn.text-sm', {
          type: 'button',
          text: 'View default',
          on: { click: () => commit(defaultDescriptor()) },
        }) : null,
      ]));
    }

    host.append(panel);
    button.setAttribute('aria-expanded', 'true');
    closePopover = onDismiss(host, close);
  }

  function close() {
    closePopover?.();
    closePopover = null;
    button.setAttribute('aria-expanded', 'false');
    qs('.popover', host)?.remove();
  }

  return {
    element: host,
    setValue(next, { silent = true } = {}) {
      value = { ...next };
      refreshButton();
      if (!silent) config.onChange(resolveRange(value, config.options));
    },
    setOptions(next) {
      config.options = next;
      refreshButton();
    },
    destroy: close,
  };
}

function calendarIcon() {
  return svg('<rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2"/><path d="M2.25 6.5h11.5M5.5 1.75v2.5M10.5 1.75v2.5"/>');
}

function chevron() {
  return svg('<path d="M4 6.5 8 10.5l4-4"/>', 12);
}

function svg(inner, size = 14) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 16 16');
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = inner.replace(/<(rect|path)/g, '<$1 fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"');
  return node;
}
