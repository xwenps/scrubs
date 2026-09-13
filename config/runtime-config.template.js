/**
 * TEMPLATE — do not edit the generated copy.
 *
 * `docker/entrypoint.sh` (in a container) or `scripts/generate-config.sh`
 * (locally) reads the environment and writes `config/runtime-config.js` from
 * this shape. That generated file is loaded as a classic script before the
 * app's modules, so `config/app.config.js` can read the values synchronously.
 *
 * Everything here is public: it is served to every visitor's browser.
 */
window.__SCRUBS_CONFIG__ = {
  googleClientId: '',
  defaultSpreadsheetId: '',
  calendarAccess: 'events',
  calendarPicker: 'on',
  settingsTab: 'Settings',
  rulesTab: 'Rules',
  defaultRange: 'last12months',
  defaultRangeStart: '',
  defaultRangeEnd: '',
  defaultCalendarIds: 'primary',
  countMode: 'first',
  weekStart: 'monday',
  defaultHoursPerShift: '0',
  allTimeYearsBack: '5',
};
