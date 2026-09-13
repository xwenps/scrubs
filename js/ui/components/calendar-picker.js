/** Multi-select over the user's Google calendars. */
import { el, qs, onDismiss } from '../../core/dom.js';

/**
 * @param {{calendars: Array<{id, summary, primary}>, selected: string[], onChange: (ids: string[]) => void}} config
 */
export function createCalendarPicker(config) {
  let selected = new Set(config.selected);
  let close = null;

  const button = el('button.btn', {
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    on: { click: () => (close ? dismiss() : open()) },
  }, [el('span', { text: summary() }), chevron()]);

  const host = el('div.popover-host', {}, [button]);

  function summary() {
    if (selected.size === 0) return 'No calendars';
    if (selected.size === 1) {
      const only = config.calendars.find((calendar) => calendar.id === [...selected][0]);
      return only ? truncate(only.summary) : '1 calendar';
    }
    if (selected.size === config.calendars.length) return 'All calendars';
    return `${selected.size} calendars`;
  }

  function refresh() {
    qs('span', button).textContent = summary();
  }

  function open() {
    const panel = el('div.popover', {
      role: 'listbox',
      'aria-multiselectable': 'true',
      'aria-label': 'Calendars to include',
      style: { 'inset-inline-start': '0', top: 'calc(100% + 6px)', 'max-height': '320px', 'overflow-y': 'auto', 'max-width': 'min(320px, calc(100vw - 32px))' },
    });

    for (const calendar of config.calendars) {
      const isOn = selected.has(calendar.id);
      panel.append(el('button.popover__option', {
        type: 'button',
        role: 'option',
        'aria-checked': String(isOn),
        'aria-selected': String(isOn),
        on: {
          click(event) {
            const option = event.currentTarget;
            if (selected.has(calendar.id)) selected.delete(calendar.id);
            else selected.add(calendar.id);
            // Never leave the dashboard with nothing to count.
            if (selected.size === 0) selected.add(calendar.id);
            option.setAttribute('aria-checked', String(selected.has(calendar.id)));
            option.setAttribute('aria-selected', String(selected.has(calendar.id)));
            qs('.popover__check', option).textContent = selected.has(calendar.id) ? '✓' : '';
            refresh();
            config.onChange([...selected]);
          },
        },
      }, [
        el('span.popover__check', { text: isOn ? '✓' : '' }),
        el('span.swatch', { style: { '--swatch': calendar.backgroundColor || 'var(--ink-3)' } }),
        el('span.truncate', { text: calendar.summary }),
      ]));
    }

    host.append(panel);
    button.setAttribute('aria-expanded', 'true');
    close = onDismiss(host, dismiss);
  }

  function dismiss() {
    close?.();
    close = null;
    button.setAttribute('aria-expanded', 'false');
    qs('.popover', host)?.remove();
  }

  return {
    element: host,
    setSelected(ids) {
      selected = new Set(ids);
      refresh();
    },
    destroy: dismiss,
  };
}

function truncate(value, max = 22) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function chevron() {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 16 16');
  node.setAttribute('width', '12');
  node.setAttribute('height', '12');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = '<path d="M4 6.5 8 10.5l4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';
  return node;
}
