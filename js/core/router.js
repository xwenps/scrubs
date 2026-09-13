/**
 * Hash router.
 *
 * Hash routing (rather than the History API) is a deliberate choice: it keeps
 * the app deployable to any static host — GitHub Pages, S3, nginx — with no
 * rewrite rules, and it keeps deep links working on refresh.
 */

const routes = new Map();
let notFound = null;
let guard = null;
let current = null;
let disposeCurrent = null;

export const router = {
  /** @param {string} path  e.g. 'dashboard' */
  add(path, handler) {
    routes.set(path, handler);
    return router;
  },

  fallback(handler) {
    notFound = handler;
    return router;
  },

  /**
   * Runs before every navigation. Return a route name to redirect, or
   * undefined to allow.
   */
  useGuard(fn) {
    guard = fn;
    return router;
  },

  start() {
    window.addEventListener('hashchange', () => router.resolve());
    router.resolve();
  },

  navigate(path, { replace = false } = {}) {
    const hash = `#/${path.replace(/^#?\/?/, '')}`;
    if (window.location.hash === hash) {
      router.resolve();
      return;
    }
    if (replace) window.location.replace(hash);
    else window.location.hash = hash;
  },

  get current() {
    return current;
  },

  /** Re-run the active route (used after auth or config state changes). */
  refresh() {
    router.resolve({ force: true });
  },

  async resolve({ force = false } = {}) {
    const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    let name = raw || 'dashboard';

    if (guard) {
      const redirect = guard(name);
      if (redirect && redirect !== name) {
        router.navigate(redirect, { replace: true });
        return;
      }
    }

    if (!force && name === current) return;

    const handler = routes.get(name) || notFound;
    if (!handler) return;

    if (typeof disposeCurrent === 'function') {
      try { disposeCurrent(); } catch (error) { console.error('[router] teardown failed', error); }
    }
    disposeCurrent = null;
    current = name;

    document.querySelectorAll('[data-route]').forEach((link) => {
      if (link.dataset.route === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    const result = await handler();
    if (typeof result === 'function') disposeCurrent = result;
  },
};
