/** Transient status messages. Errors stay until dismissed; the rest time out. */
import { el, qs } from '../../core/dom.js';

const DEFAULT_MS = 5000;

function stack() {
  return qs('#toast-stack');
}

/**
 * @param {{title?: string, text?: string, tone?: 'info'|'success'|'warning'|'error', timeout?: number}} options
 */
export function toast({ title, text, tone = 'info', timeout } = {}) {
  const host = stack();
  if (!host) return () => {};

  const node = el(`div.toast.toast--${tone}`, { role: tone === 'error' ? 'alert' : 'status' }, [
    el('span.toast__dot', { 'aria-hidden': 'true' }),
    el('div.toast__body', {}, [
      title ? el('p.toast__title', { text: title }) : null,
      text ? el('p.toast__text', { text }) : null,
    ]),
    el('button.toast__close', {
      type: 'button',
      'aria-label': 'Dismiss',
      html: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      on: { click: () => dismiss() },
    }),
  ]);

  host.append(node);

  const ms = timeout ?? (tone === 'error' ? 0 : DEFAULT_MS);
  const timer = ms ? setTimeout(() => dismiss(), ms) : null;

  function dismiss() {
    if (timer) clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 220);
  }

  return dismiss;
}

export const notify = {
  info: (title, text) => toast({ title, text, tone: 'info' }),
  success: (title, text) => toast({ title, text, tone: 'success' }),
  warning: (title, text) => toast({ title, text, tone: 'warning' }),
  error: (title, text) => toast({ title, text, tone: 'error' }),
};
