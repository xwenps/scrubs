/**
 * Sign-in view.
 *
 * The configuration-source override lives behind a disclosure drawer: the
 * default is correct for almost everyone, so it is pre-filled and out of the
 * way, but it is one click from being changed for the people who need to.
 */
import { loadTemplate, qs, el } from '../../core/dom.js';
import { APP_CONFIG } from '../../../config/app.config.js';
import { auth } from '../../services/auth.js';
import { looksLikeSpreadsheetId, extractSpreadsheetId } from '../../services/sheets.js';
import { currentSpreadsheetId, setSpreadsheetOverride, sheetUrl, initializeSession } from '../../app-state.js';
import { router } from '../../core/router.js';
import { notify } from '../components/toast.js';
import { local, KEYS } from '../../core/storage.js';

export async function renderLoginView(mount) {
  const fragment = await loadTemplate('login');
  mount.replaceChildren(fragment);

  const root = qs('.login', mount);
  const drawer = qs('[data-drawer]', root);
  const toggle = qs('[data-drawer-toggle]', root);
  const badge = qs('[data-sheet-badge]', root);
  const input = qs('#sheet-id', root);
  const errorNode = qs('[data-sheet-error]', root);
  const openLink = qs('[data-sheet-open]', root);
  const signInButton = qs('[data-action="sign-in"]', root);
  const warning = qs('[data-config-warning]', root);

  const defaultId = extractSpreadsheetId(APP_CONFIG.defaultSpreadsheetId || '');
  const activeId = currentSpreadsheetId();
  input.value = activeId;

  function refreshBadge() {
    const value = extractSpreadsheetId(input.value);
    const isOverride = Boolean(value) && value !== defaultId;
    const isEmpty = !value;

    badge.textContent = isEmpty ? 'Not set' : isOverride ? 'Custom' : 'Default';
    badge.style.background = isOverride ? 'var(--status-warning-soft)' : '';
    badge.style.color = isOverride ? 'var(--ink-1)' : '';

    openLink.hidden = !value;
    if (value) openLink.href = sheetUrl(value);

    const invalid = Boolean(value) && !looksLikeSpreadsheetId(value);
    errorNode.hidden = !invalid;
    errorNode.textContent = invalid
      ? 'That does not look like a sheet ID. Paste the long ID from the sheet’s URL, or the whole link.'
      : '';
    input.setAttribute('aria-invalid', String(invalid));
  }

  // Open the drawer on arrival when the override is already in play, so the
  // user is never surprised by a non-default configuration.
  const startsOpen = Boolean(local.get(KEYS.spreadsheetId, ''));
  setDrawer(startsOpen);

  function setDrawer(open) {
    drawer.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setDrawer(!drawer.classList.contains('is-open')));
  input.addEventListener('input', refreshBadge);
  qs('[data-action="reset-sheet"]', root).addEventListener('click', () => {
    input.value = defaultId;
    refreshBadge();
    input.focus();
  });

  if (!auth.isConfigured()) {
    warning.hidden = false;
    warning.append(
      el('strong', { text: 'This deployment is not configured yet. ' }),
      document.createTextNode('Set '),
      el('code.mono', { text: 'SCRUBS_GOOGLE_CLIENT_ID' }),
      document.createTextNode(' in the deployment’s '),
      el('code.mono', { text: '.env' }),
      document.createTextNode(' and restart — see docs/SETUP.md.'),
    );
    signInButton.setAttribute('aria-disabled', 'true');
  }

  if (!defaultId && !activeId) {
    notify.info('No configuration sheet set', 'Scrubs will start with example counters. Add a sheet ID under “Configuration source” to save them.');
  }

  signInButton.addEventListener('click', async () => {
    if (signInButton.getAttribute('aria-disabled') === 'true') return;
    refreshBadge();
    if (!errorNode.hidden) {
      input.focus();
      return;
    }

    setSpreadsheetOverride(input.value);
    signInButton.classList.add('is-busy');

    try {
      const token = await auth.signIn();
      if (!token) return; // the user closed the popup, or a newer request superseded this one
      await initializeSession();
      router.navigate('dashboard', { replace: true });
    } catch (error) {
      notify.error('Sign-in failed', error.message);
    } finally {
      signInButton.classList.remove('is-busy');
    }
  });

  refreshBadge();
  auth.warmUp();

  return () => {};
}
