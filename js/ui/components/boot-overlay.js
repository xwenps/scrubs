/**
 * The full-screen loader from `index.html` (`#app-boot`), reused after the
 * initial page load.
 *
 * The DOM node is markup, not module state, so `main.js` never removes it —
 * only hides it — leaving it available for any other multi-step network
 * sequence (right now, just the post-sign-in one) that would otherwise have
 * to leave a stale view up while it works.
 */
import { qs } from '../../core/dom.js';

function overlay() {
  return qs('#app-boot');
}

export function showBootOverlay(text) {
  const node = overlay();
  if (!node) return;
  const message = qs('p', node);
  if (text && message) message.textContent = text;
  node.hidden = false;
}

export function hideBootOverlay() {
  const node = overlay();
  if (node) node.hidden = true;
}
