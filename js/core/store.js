/**
 * A single, shallow, observable application state.
 *
 * Deliberately tiny: `patch` merges top-level keys and notifies subscribers
 * with the keys that actually changed, so views can cheaply decide whether to
 * re-render. There is no deep reactivity and no proxying — state is replaced,
 * never mutated in place.
 */
import { createEmitter } from './emitter.js';

const emitter = createEmitter();

/** @type {Record<string, any>} */
let state = {
  /** 'booting' | 'signed-out' | 'signed-in' */
  status: 'booting',
  profile: null,
  spreadsheetId: '',
  settings: null,
  /** Settings as they were last read from / written to the sheet, for dirty checks.
   * `null` means there is no sheet-confirmed copy yet (no sheet, or its Settings tab
   * was never read), so any local settings should be treated as unsaved. */
  settingsBaseline: null,
  rules: [],
  /** Rules as they were last read from / written to the sheet, for dirty checks. */
  rulesBaseline: [],
  rulesSource: 'none', // 'sheet' | 'local' | 'starter' | 'none'
  calendars: [],
  selectedCalendarIds: [],
  range: null,
  events: [],
  eventsStatus: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  eventsError: null,
  configError: null,
};

export const store = {
  get() {
    return state;
  },

  /** @returns {any} */
  select(key) {
    return state[key];
  },

  patch(partial) {
    const changed = [];
    for (const [key, value] of Object.entries(partial)) {
      if (!Object.is(state[key], value)) changed.push(key);
    }
    if (changed.length === 0) return;
    state = { ...state, ...partial };
    emitter.emit('change', { state, changed });
  },

  /**
   * Subscribe to state changes. When `keys` is given the handler only fires if
   * one of those keys changed.
   */
  subscribe(keys, handler) {
    const watch = Array.isArray(keys) ? keys : null;
    const wrapped = ({ state: next, changed }) => {
      if (watch && !changed.some((key) => watch.includes(key))) return;
      handler(next, changed);
    };
    return emitter.on('change', wrapped);
  },
};
