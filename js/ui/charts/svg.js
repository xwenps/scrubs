/** SVG primitives and scale helpers shared by every chart. */

const NS = 'http://www.w3.org/2000/svg';

export function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

/** Round a maximum up to a readable axis top and return its ticks. */
export function niceTicks(max, targetCount = 4) {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: [0, 1] };

  const rough = max / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step;

  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Math.round(value * 1000) / 1000);
  return { top, ticks };
}

/** Approximate rendered width of a label in the UI sans at a given size. */
export function textWidth(text, fontSize = 11) {
  return String(text).length * fontSize * 0.56;
}

/**
 * Choose a label stride so x-axis labels never collide.
 * @returns {number} render every Nth label
 */
export function labelStride(labels, bandWidth, fontSize = 11) {
  const widest = labels.reduce((max, label) => Math.max(max, textWidth(label, fontSize)), 0);
  return Math.max(1, Math.ceil((widest + 10) / Math.max(1, bandWidth)));
}

/** Rect path with only the top corners rounded — a bar cap that sits flat on its baseline. */
export function topRoundedPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (height <= 0) return '';
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    'Z',
  ].join(' ');
}

/** Same, for horizontal bars growing rightwards. */
export function endRoundedPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, height / 2, width));
  if (width <= 0) return '';
  return [
    `M${x},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height - r}`,
    `Q${x + width},${y + height} ${x + width - r},${y + height}`,
    `H${x}`,
    'Z',
  ].join(' ');
}

/** Apply a `var(--token)` colour through style so theme switches repaint live. */
export function paint(node, color, property = 'fill') {
  node.style.setProperty(property, color);
  return node;
}

/**
 * Mount a chart that re-renders on container resize.
 * @param {HTMLElement} container
 * @param {(width: number) => SVGElement | null} render
 * @returns {() => void} teardown
 */
export function mountResponsive(container, render) {
  let lastWidth = 0;

  const draw = () => {
    const width = Math.max(220, Math.floor(container.clientWidth));
    if (width === lastWidth) return;
    lastWidth = width;
    const svg = render(width);
    container.replaceChildren();
    if (svg) container.append(svg);
  };

  const observer = new ResizeObserver(() => {
    // Width-only re-render: height is derived, so a height change is our own doing.
    const width = Math.floor(container.clientWidth);
    if (width !== lastWidth) draw();
  });
  observer.observe(container);
  draw();

  return () => observer.disconnect();
}
