/** DOM helpers. Small on purpose — no virtual DOM, no template language. */

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Create an element.
 * @param {string} tag  tag name, optionally with `.class` suffixes: `div.card.card--pad`
 * @param {object} [props] attributes; `class`, `dataset`, `style`, `on` and `html` are special-cased
 * @param {Array<Node|string|null|undefined|false>} [children]
 */
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.className = [node.className, value].filter(Boolean).join(' ');
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style') {
      if (typeof value === 'string') node.style.cssText = value;
      else for (const [prop, val] of Object.entries(value)) node.style.setProperty(prop, val);
    } else if (key === 'on') {
      for (const [type, handler] of Object.entries(value)) node.addEventListener(type, handler);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Escape a string for safe interpolation into an innerHTML fragment. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

/** Inline SVG icon from a 16-unit viewBox path set. */
export function icon(paths, { size = 16, viewBox = '0 0 16 16', fill = 'none' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = [].concat(paths).map((d) => (
    `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
  )).join('');
  return svg;
}

/**
 * Close a popover/menu when the user clicks outside it or presses Escape.
 * Returns a teardown function.
 */
export function onDismiss(node, onClose) {
  const handlePointer = (event) => {
    if (!node.contains(event.target)) onClose(event);
  };
  const handleKey = (event) => {
    if (event.key === 'Escape') onClose(event);
  };
  // `capture: false` + a microtask delay so the opening click isn't the one that closes it.
  setTimeout(() => {
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
  }, 0);
  return () => {
    document.removeEventListener('pointerdown', handlePointer);
    document.removeEventListener('keydown', handleKey);
  };
}

const templateCache = new Map();

/**
 * Fetch a view partial from /views and return a detached DocumentFragment.
 *
 * The URL is resolved against this module rather than the document, so the
 * templates load correctly from any page depth (the dev preview harness lives
 * one directory down). Templates are cached for the life of the page.
 */
export async function loadTemplate(name) {
  if (!templateCache.has(name)) {
    const url = new URL(`../../views/${name}.html`, import.meta.url);
    templateCache.set(name, fetch(url, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load view "${name}" (${response.status})`);
      return response.text();
    }));
  }
  const html = await templateCache.get(name);
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.cloneNode(true);
}

/** requestAnimationFrame-throttled callback, used for resize-driven re-renders. */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}
