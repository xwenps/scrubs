/**
 * One tooltip element, shared by every chart on the page.
 *
 * A single fixed-position node avoids per-chart DOM and keeps the tooltip above
 * any card overflow. It is `pointer-events: none`, so it can never steal the
 * hover it is describing.
 */
import { el, clear } from '../../core/dom.js';

let node = null;

function ensureNode() {
  if (node && node.isConnected) return node;
  node = el('div.chart-tip', { role: 'presentation' });
  document.body.append(node);
  return node;
}

/**
 * @param {{x: number, y: number}} point  viewport coordinates
 * @param {{title: string, rows: Array<{label: string, value: string, color?: string}>}} content
 */
export function showTooltip(point, content) {
  const tip = ensureNode();
  clear(tip);

  if (content.title) tip.append(el('div.chart-tip__title', { text: content.title }));
  for (const row of content.rows || []) {
    tip.append(el('div.chart-tip__row', {}, [
      row.color ? el('span.swatch', { style: { '--swatch': row.color } }) : null,
      el('span', { text: row.label }),
      el('strong', { text: row.value }),
    ]));
  }

  tip.classList.add('is-visible');

  // Measure, then clamp inside the viewport so edge marks stay readable.
  const rect = tip.getBoundingClientRect();
  const margin = 8;
  let left = point.x;
  let top = point.y - margin;

  left = Math.min(Math.max(left, rect.width / 2 + margin), window.innerWidth - rect.width / 2 - margin);
  if (top - rect.height < margin) top = point.y + rect.height + margin * 2;

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function hideTooltip() {
  if (node) node.classList.remove('is-visible');
}

/** Wire show/hide for a chart: pointer moves inside, and every exit path out. */
export function bindTooltip(root, resolve) {
  const handleMove = (event) => {
    const content = resolve(event);
    if (!content) {
      hideTooltip();
      root.classList.remove('is-hovering');
      return;
    }
    root.classList.add('is-hovering');
    showTooltip({ x: event.clientX, y: event.clientY }, content);
  };

  const handleLeave = () => {
    hideTooltip();
    root.classList.remove('is-hovering');
    root.querySelectorAll('.is-active').forEach((mark) => mark.classList.remove('is-active'));
  };

  // `pointerdown` matters for touch: a tap that doesn't drag can fire no
  // `pointermove` at all, which would otherwise leave a stationary finger
  // with no feedback until it moves.
  root.addEventListener('pointerdown', handleMove);
  root.addEventListener('pointermove', handleMove);
  root.addEventListener('pointerleave', handleLeave);
  root.addEventListener('pointercancel', handleLeave);
  window.addEventListener('scroll', hideTooltip, { passive: true });

  return () => {
    root.removeEventListener('pointerdown', handleMove);
    root.removeEventListener('pointermove', handleMove);
    root.removeEventListener('pointerleave', handleLeave);
    root.removeEventListener('pointercancel', handleLeave);
    window.removeEventListener('scroll', hideTooltip);
    hideTooltip();
  };
}
