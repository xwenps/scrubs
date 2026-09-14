/**
 * Entry point: wires the shell, restores any live session, and starts routing.
 */
import { qs, el, onDismiss } from './core/dom.js';
import { router } from './core/router.js';
import { store } from './core/store.js';
import { auth } from './services/auth.js';
import { applyTheme, getTheme, createThemeToggle } from './ui/components/theme-toggle.js';
import { notify } from './ui/components/toast.js';
import { hideBootOverlay } from './ui/components/boot-overlay.js';
import { renderLoginView } from './ui/views/login-view.js';
import { renderDashboardView } from './ui/views/dashboard-view.js';
import { renderRulesView } from './ui/views/rules-view.js';
import { initializeSession, signOut, loadEvents, sheetUrl } from './app-state.js';

const main = qs('#main');
const appBar = qs('#app-bar');

applyTheme(getTheme());
qs('#theme-toggle-slot').append(createThemeToggle());

/* -------------------------------------------------------------------------- */
/* Account menu                                                                */
/* -------------------------------------------------------------------------- */

const account = qs('#account');
const accountButton = qs('#account-button');
const accountMenu = qs('#account-menu');
let closeMenu = null;

accountButton.addEventListener('click', () => {
  if (closeMenu) {
    dismissMenu();
    return;
  }
  accountMenu.hidden = false;
  accountButton.setAttribute('aria-expanded', 'true');
  closeMenu = onDismiss(account, dismissMenu);
});

function dismissMenu() {
  closeMenu?.();
  closeMenu = null;
  accountMenu.hidden = true;
  accountButton.setAttribute('aria-expanded', 'false');
}

accountMenu.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  dismissMenu();

  if (action === 'sign-out') {
    await signOut();
    router.navigate('login', { replace: true });
  } else if (action === 'reload') {
    await loadEvents();
    notify.success('Calendar reloaded');
  }
});

store.subscribe(['profile', 'status', 'spreadsheetId'], (state) => {
  const signedIn = state.status === 'signed-in';
  appBar.hidden = !signedIn;
  account.hidden = !state.profile;

  if (state.profile) {
    qs('#account-name').textContent = state.profile.name || state.profile.email;
    qs('#account-email').textContent = state.profile.email || '';
    const avatar = qs('#account-avatar');
    if (state.profile.picture) {
      avatar.src = state.profile.picture;
      avatar.hidden = false;
    } else {
      avatar.hidden = true;
    }
  }

  const sheetLink = qs('#account-sheet-link');
  const url = sheetUrl(state.spreadsheetId);
  sheetLink.hidden = !url;
  if (url) sheetLink.href = url;
});

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

function withView(render) {
  return async () => {
    try {
      return await render(main);
    } catch (error) {
      console.error(error);
      main.replaceChildren(el('div.view', {}, [
        el('div.card', {}, [
          el('div.empty', {}, [
            el('p.empty__title', { text: 'This page failed to load' }),
            el('p.empty__text', { text: error.message }),
            el('button.btn', { type: 'button', text: 'Reload', on: { click: () => window.location.reload() } }),
          ]),
        ]),
      ]));
      return () => {};
    }
  };
}

router
  .add('login', withView(renderLoginView))
  .add('dashboard', withView(renderDashboardView))
  .add('rules', withView(renderRulesView))
  .fallback(withView(renderDashboardView))
  .useGuard((name) => {
    const signedIn = store.select('status') === 'signed-in';
    if (!signedIn && name !== 'login') return 'login';
    if (signedIn && name === 'login') return 'dashboard';
    return undefined;
  });

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

(async function boot_() {
  const restored = auth.restore();

  if (restored) {
    try {
      await initializeSession();
    } catch (error) {
      console.error(error);
      store.patch({ status: 'signed-out' });
      notify.error('Could not restore your session', error.message);
    }
  } else {
    store.patch({ status: 'signed-out' });
  }

  hideBootOverlay();
  router.start();

  // Re-entering the tab after the token's hour is up should not strand the user
  // on a dashboard that silently stops updating.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (store.select('status') !== 'signed-in') return;
    if (auth.isSignedIn()) return;
    notify.warning('Session expired', 'Sign in again to refresh your calendar.');
  });
}());
