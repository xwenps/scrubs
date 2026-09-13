/**
 * Application orchestration.
 *
 * Views never call Google directly — they call into here, and read results off
 * the store. That keeps the network/auth/error handling in one place and makes
 * each view a pure function of state plus event handlers.
 */
import { APP_CONFIG } from '../config/app.config.js';
import { store } from './core/store.js';
import { local, KEYS } from './core/storage.js';
import { auth, SCOPES } from './services/auth.js';
import { listCalendars, fetchEvents } from './services/calendar.js';
import { loadConfig, saveConfig, rulesEqual } from './services/config-service.js';
import { explainSheetError, extractSpreadsheetId } from './services/sheets.js';
import { normalizeRule, createRuleId } from './domain/matcher.js';
import { resolveRange, isValidPresetId, defaultDescriptor } from './domain/date-range.js';
import { notify } from './ui/components/toast.js';

let loadController = null;

/** The sheet this session should read: a user override wins over the deployment default. */
export function currentSpreadsheetId() {
  const override = local.get(KEYS.spreadsheetId, '');
  return extractSpreadsheetId(override || APP_CONFIG.defaultSpreadsheetId || '');
}

export function setSpreadsheetOverride(value) {
  const id = extractSpreadsheetId(value);
  if (!id || id === extractSpreadsheetId(APP_CONFIG.defaultSpreadsheetId || '')) local.remove(KEYS.spreadsheetId);
  else local.set(KEYS.spreadsheetId, id);
  return currentSpreadsheetId();
}

export function sheetUrl(id = currentSpreadsheetId()) {
  return id ? APP_CONFIG.sheetUrlTemplate.replace('{id}', id) : '';
}

/**
 * Configured calendar ids → ids that actually exist in this account.
 * `primary` is a placeholder the sheet may use, so it is resolved against the
 * real calendar list; anything the account cannot see is dropped.
 */
export function resolveCalendarIds(ids, calendars = []) {
  const available = new Set(calendars.map((calendar) => calendar.id));
  return (ids || [])
    .map((id) => (id === 'primary' ? (calendars.find((calendar) => calendar.primary)?.id || 'primary') : id))
    .filter((id) => available.size === 0 || available.has(id));
}

function starterRules() {
  return APP_CONFIG.starterRules.map((rule, index) => normalizeRule({
    ...rule,
    id: createRuleId(),
    color: rule.color || index + 1,
  }));
}

/**
 * Sign in, then load everything the dashboard needs.
 * Safe to call again to re-sync.
 */
export async function initializeSession() {
  store.patch({ status: 'signed-in', configError: null });

  const profile = await auth.fetchProfile().catch(() => null);
  store.patch({ profile });

  const spreadsheetId = currentSpreadsheetId();
  let settings = { ...APP_CONFIG.fallbackSettings, calendarIds: ['primary'] };
  let rules = [];
  let rulesSource = 'none';
  let configError = null;
  let sheetTitle = '';
  let settingsFromSheet = false;

  if (spreadsheetId) {
    try {
      const config = await loadConfig(spreadsheetId);
      settings = config.settings;
      settingsFromSheet = true;
      sheetTitle = config.title;
      rules = config.rules;
      rulesSource = config.hasRulesTab && rules.length ? 'sheet' : 'none';
      for (const warning of config.ruleWarnings) notify.warning('Config sheet', warning);
    } catch (error) {
      configError = explainSheetError(error, spreadsheetId);
    }
  }

  // The sheet is authoritative whenever it can be read. Only when there is no
  // readable sheet do this browser's own settings take over, so a preference
  // changed offline is not silently lost on the next load.
  if (!settingsFromSheet) {
    const localSettings = local.get(KEYS.localSettings, null);
    if (localSettings) settings = { ...settings, ...localSettings };
  }

  // Fall back through: sheet → this browser's saved rules → starter examples.
  if (rulesSource !== 'sheet') {
    const saved = local.get(KEYS.localRules, null);
    if (Array.isArray(saved) && saved.length) {
      rules = saved.map(normalizeRule);
      rulesSource = 'local';
    } else if (rules.length === 0) {
      rules = starterRules();
      rulesSource = 'starter';
    }
  }

  let calendars = [];
  try {
    calendars = await listCalendars();
  } catch (error) {
    notify.error('Could not list your calendars', error.message);
  }

  const stored = local.get(KEYS.selectedCalendars, null);
  const preferred = resolveCalendarIds(
    Array.isArray(stored) && stored.length ? stored : settings.calendarIds || ['primary'],
    calendars,
  );

  const selectedCalendarIds = preferred.length
    ? preferred
    : [calendars.find((calendar) => calendar.primary)?.id || calendars[0]?.id].filter(Boolean);

  // This browser's last-used range wins over the sheet's default, but only if it
  // is actually resolvable — a half-written custom range falls back to the sheet.
  const storedRange = local.get(KEYS.lastRange, null);
  const storedIsUsable = Boolean(storedRange)
    && isValidPresetId(storedRange.preset)
    && (storedRange.preset !== 'custom' || (storedRange.start && storedRange.end));
  const rangeDescriptor = storedIsUsable ? storedRange : defaultDescriptor(settings);

  store.patch({
    spreadsheetId,
    sheetTitle,
    settings,
    rules,
    rulesBaseline: rulesSource === 'sheet' ? rules : [],
    rulesSource,
    configError,
    calendars,
    selectedCalendarIds,
    range: resolveRange(rangeDescriptor, settings),
  });

  if (configError) {
    notify.error('Config sheet could not be read', `${configError} Using ${rulesSource === 'local' ? 'the counters saved in this browser' : 'example counters'} for now.`);
  }

  await loadEvents();
}

/** Fetch calendar events for the current range + calendar selection. */
export async function loadEvents() {
  const { range, selectedCalendarIds, settings } = store.get();
  if (!range || !selectedCalendarIds?.length) {
    store.patch({ events: [], eventsStatus: 'ready' });
    return;
  }

  loadController?.abort();
  loadController = new AbortController();
  const { signal } = loadController;

  store.patch({ eventsStatus: 'loading', eventsError: null });

  try {
    const events = await fetchEvents({
      calendarIds: selectedCalendarIds,
      start: range.start,
      end: range.end,
      hoursPerAllDayShift: settings?.defaultHoursPerShift || 0,
      signal,
    });
    if (signal.aborted) return;
    store.patch({ events, eventsStatus: 'ready' });
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') return;
    store.patch({ eventsStatus: 'error', eventsError: error.message, events: [] });
    notify.error('Could not load your calendar', error.message);
  }
}

export function setRange(resolved) {
  local.set(KEYS.lastRange, {
    preset: resolved.preset,
    start: resolved.startISO,
    end: resolved.endISO,
  });
  store.patch({ range: resolved });
  return loadEvents();
}

export function setCalendars(ids) {
  local.set(KEYS.selectedCalendars, ids);
  store.patch({ selectedCalendarIds: ids });
  return loadEvents();
}

/** Update the working set of rules; always mirrored to this browser. */
export function setRules(rules) {
  const normalized = rules.map(normalizeRule);
  local.set(KEYS.localRules, normalized);
  store.patch({ rules: normalized });
}

export function rulesAreDirty() {
  const { rules, rulesBaseline, rulesSource } = store.get();
  if (rulesSource !== 'sheet' && rulesBaseline.length === 0) return rules.length > 0;
  return !rulesEqual(rules, rulesBaseline);
}

/** Write the current rules back to the config sheet, upgrading scope if needed. */
export async function saveRulesToSheet() {
  const { spreadsheetId, rules, settings } = store.get();
  if (!spreadsheetId) {
    throw new Error('No config sheet is set for this session. Add one from the sign-in screen.');
  }

  const granted = await auth.requestScope(SCOPES.sheetsWrite);
  if (!granted) {
    throw new Error('Permission to edit the spreadsheet was not granted.');
  }

  await saveConfig(spreadsheetId, { rules, settings });
  store.patch({ rulesBaseline: rules, rulesSource: 'sheet' });
}

/** Persist the current range as the deployment's default view. */
export async function saveDefaultRange(descriptor) {
  const { spreadsheetId, settings } = store.get();
  const nextSettings = {
    ...settings,
    defaultRange: descriptor.preset,
    defaultRangeStart: descriptor.preset === 'custom' ? descriptor.start : '',
    defaultRangeEnd: descriptor.preset === 'custom' ? descriptor.end : '',
  };
  store.patch({ settings: nextSettings });
  local.set(KEYS.localSettings, nextSettings);

  if (!spreadsheetId) return { savedToSheet: false };

  const granted = await auth.requestScope(SCOPES.sheetsWrite);
  if (!granted) return { savedToSheet: false };

  await saveConfig(spreadsheetId, { settings: nextSettings });
  return { savedToSheet: true };
}

/**
 * Persist the current calendar selection as the deployment's default.
 * The mirror image of `saveDefaultRange`: the toolbar's other control also
 * deserves a way to say "this is what the dashboard should open on".
 */
export async function saveDefaultCalendars(ids) {
  const { spreadsheetId, settings } = store.get();
  const nextSettings = { ...settings, calendarIds: [...ids] };
  store.patch({ settings: nextSettings });
  local.set(KEYS.localSettings, nextSettings);

  if (!spreadsheetId) return { savedToSheet: false };

  const granted = await auth.requestScope(SCOPES.sheetsWrite);
  if (!granted) return { savedToSheet: false };

  await saveConfig(spreadsheetId, { settings: nextSettings });
  return { savedToSheet: true };
}

export async function updateSettings(patch) {
  const { settings } = store.get();
  const next = { ...settings, ...patch };
  store.patch({ settings: next });
  local.set(KEYS.localSettings, next);
  return next;
}

export async function signOut() {
  loadController?.abort();
  await auth.signOut();
  store.patch({
    status: 'signed-out',
    profile: null,
    events: [],
    eventsStatus: 'idle',
    rules: [],
    rulesBaseline: [],
    calendars: [],
  });
}
