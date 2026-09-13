/**
 * Application configuration.
 *
 * Two tiers, deliberately separated:
 *
 *  1. **Deployment values** — client ID, spreadsheet ID, tab names, defaults.
 *     These change per environment, so they are NOT hard-coded here. They are
 *     injected at container start into `config/runtime-config.js`, which sets
 *     `window.__SCRUBS_CONFIG__` before the app's modules load. That means one
 *     Docker image can be promoted from staging to production unchanged.
 *
 *  2. **Application constants** — starter rules, URL templates, fallback
 *     settings. These are part of the app, not of the environment, so they live
 *     in this file and are reviewed like any other code.
 *
 * IMPORTANT: everything here is served to the browser and is therefore PUBLIC.
 * The `.env` file is a deployment-configuration mechanism, not a secret store.
 * An OAuth *client ID* is safe to expose by design — it is protected by the
 * authorised-origins list, not by secrecy. Never put a client secret, an API
 * key or any credential in it.
 */

/** Values injected by `config/runtime-config.js`; empty when running unconfigured. */
const runtime = (typeof window !== 'undefined' && window.__SCRUBS_CONFIG__) || {};

/** Treat empty strings and leftover placeholders as "not set". */
function value(key, fallback = '') {
  const raw = runtime[key];
  if (raw === undefined || raw === null) return fallback;
  const text = String(raw).trim();
  if (!text || text.startsWith('REPLACE_ME') || text.startsWith('${')) return fallback;
  return text;
}

function number(key, fallback) {
  const parsed = Number(value(key, ''));
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : fallback;
}

export const APP_CONFIG = Object.freeze({
  /* ---- deployment values (from the environment) ------------------------- */

  /** OAuth 2.0 Web client ID from the Google Cloud console. Env: SCRUBS_GOOGLE_CLIENT_ID */
  googleClientId: value('googleClientId'),

  /**
   * Google Sheet holding this deployment's counters and view preferences.
   * Users may override it on the sign-in screen; the override is remembered in
   * their browser only. Env: SCRUBS_DEFAULT_SPREADSHEET_ID
   */
  defaultSpreadsheetId: value('defaultSpreadsheetId'),

  /**
   * How much calendar access to request. Google has no per-calendar scope, so
   * this picks the least capable scope that still works.
   * 'events' (default) | 'owned' | 'full'. Env: SCRUBS_CALENDAR_ACCESS
   */
  calendarAccess: ['events', 'owned', 'full'].includes(value('calendarAccess'))
    ? value('calendarAccess')
    : 'events',

  /**
   * Whether to request the extra scope needed to list calendars for the in-app
   * picker. Turn off to drop one permission; calendars must then be named in
   * configuration. Env: SCRUBS_CALENDAR_PICKER
   */
  calendarPicker: value('calendarPicker', 'on') !== 'off',

  /** Tab (worksheet) names read from that spreadsheet. */
  sheetTabs: Object.freeze({
    settings: value('settingsTab', 'Settings'),
    rules: value('rulesTab', 'Rules'),
  }),

  /**
   * Fallbacks used when the sheet is unreachable, empty, or omits a key.
   * They also define the shape of a valid settings object.
   */
  fallbackSettings: Object.freeze({
    defaultRange: value('defaultRange', 'last12months'),
    /** Only meaningful when defaultRange is `custom`. Both are `YYYY-MM-DD`. */
    defaultRangeStart: value('defaultRangeStart'),
    defaultRangeEnd: value('defaultRangeEnd'),
    calendarIds: value('defaultCalendarIds', 'primary'),
    countMode: value('countMode', 'first') === 'all' ? 'all' : 'first',
    weekStart: value('weekStart', 'monday') === 'sunday' ? 'sunday' : 'monday',
    defaultHoursPerShift: number('defaultHoursPerShift', 0),
    allTimeYearsBack: number('allTimeYearsBack', 5),
  }),

  /* ---- application constants (part of the code) ------------------------- */

  /**
   * Starter rules offered when the sheet has no Rules tab. Purely illustrative —
   * the point is that a first-time user sees a working example rather than a
   * blank page.
   */
  starterRules: Object.freeze([
    { label: 'HP6 mornings', field: 'title', matchType: 'exact', value: 'HP6 AM', color: 1 },
    { label: 'All HP6 shifts', field: 'title', matchType: 'contains', value: 'HP6', color: 2 },
  ]),

  /** Written into the "open in Google Sheets" links. */
  sheetUrlTemplate: 'https://docs.google.com/spreadsheets/d/{id}/edit',
});

/** True when this deployment has been given a usable client ID. */
export function isDeploymentConfigured() {
  return Boolean(APP_CONFIG.googleClientId);
}
