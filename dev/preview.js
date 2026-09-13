/**
 * Local preview harness.
 *
 * Seeds the store with synthetic events and mounts each view directly, so the
 * whole UI — including charts, empty states and both themes — can be worked on
 * without signing in to Google. Never referenced by the production entry point.
 */
import { store } from '../js/core/store.js';
import { qs } from '../js/core/dom.js';
import { applyTheme, getTheme, createThemeToggle } from '../js/ui/components/theme-toggle.js';
import { resolveRange } from '../js/domain/date-range.js';
import { APP_CONFIG } from '../config/app.config.js';
import { makeEvents, demoRules } from './fixtures.js';
import { renderDashboardView } from '../js/ui/views/dashboard-view.js';
import { renderRulesView } from '../js/ui/views/rules-view.js';
import { renderLoginView } from '../js/ui/views/login-view.js';

applyTheme(getTheme());
qs('#theme-slot').append(createThemeToggle());

const settings = {
  ...APP_CONFIG.fallbackSettings,
  calendarIds: ['demo@example.com'],
  goalEnabled: true,
  goalTarget: 3,
  capEnabled: true,
  capTarget: 4,
  period: { type: 'week' },
};

store.patch({
  status: 'signed-in',
  profile: { name: 'Demo user', email: 'demo@example.com' },
  spreadsheetId: '',
  settings,
  rules: demoRules,
  rulesBaseline: demoRules,
  rulesSource: 'sheet',
  calendars: [{ id: 'demo@example.com', summary: 'Demo roster', primary: true }],
  selectedCalendarIds: ['demo@example.com'],
  range: resolveRange({ preset: settings.defaultRange }, settings),
  events: makeEvents(),
  eventsStatus: 'ready',
});

const views = {
  dashboard: renderDashboardView,
  rules: renderRulesView,
  login: renderLoginView,
};

let teardown = null;

async function show(name) {
  teardown?.();
  teardown = await views[name](qs('#main'));
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  });
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${name}`);

  // ?edit opens the first rule editor, so the editor can be screenshotted and
  // styled without a manual click.
  if (name === 'rules' && new URLSearchParams(window.location.search).has('edit')) {
    requestAnimationFrame(() => qs('.rule [aria-label="Edit counter"]')?.click());
  }
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => show(button.dataset.view));
});

show(window.location.hash.slice(1) in views ? window.location.hash.slice(1) : 'dashboard')
  .then(() => document.getElementById('app-boot')?.remove());
