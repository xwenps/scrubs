/**
 * Namespaced, failure-tolerant wrappers around Web Storage.
 *
 * Every call is guarded: Safari private mode, disabled site data and embedded
 * contexts all throw on access, and none of those should take the app down.
 */

const PREFIX = 'scrubs.';

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function makeStore(backing) {
  return {
    get(key, fallback = null) {
      return safe(() => {
        const raw = backing().getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      }, fallback);
    },
    set(key, value) {
      return safe(() => {
        backing().setItem(PREFIX + key, JSON.stringify(value));
        return true;
      }, false);
    },
    remove(key) {
      return safe(() => {
        backing().removeItem(PREFIX + key);
        return true;
      }, false);
    },
    /** Raw string access, for values that are already strings (e.g. theme). */
    getRaw(key, fallback = null) {
      return safe(() => backing().getItem(PREFIX + key) ?? fallback, fallback);
    },
    setRaw(key, value) {
      return safe(() => {
        backing().setItem(PREFIX + key, value);
        return true;
      }, false);
    },
  };
}

export const local = makeStore(() => window.localStorage);
export const session = makeStore(() => window.sessionStorage);

export const KEYS = Object.freeze({
  theme: 'theme',
  spreadsheetId: 'spreadsheetId',
  token: 'token',
  profile: 'profile',
  localRules: 'localRules',
  localSettings: 'localSettings',
  lastRange: 'lastRange',
  selectedCalendars: 'selectedCalendars',
});
