/**
 * The Google Sheet as a configuration file.
 *
 * Layout (both tabs optional; sensible defaults fill any gap):
 *
 *   Settings tab —  A: key            B: value
 *   Rules tab    —  a header row, then one row per counter. Columns are located
 *                   by *header name*, so people can reorder or add columns in
 *                   the sheet without breaking the app.
 *
 * Parsing is deliberately forgiving: headers are matched case- and
 * punctuation-insensitively, booleans accept yes/no/true/false/1/0, and match
 * types accept the plain-English label shown in the UI as well as the internal
 * id. A config file people edit by hand has to tolerate how people type.
 */
import { APP_CONFIG } from '../../config/app.config.js';
import { batchGetValues, getSheetNames, ensureTab, replaceValues } from './sheets.js';
import { normalizeRule, createRuleId, MATCH_TYPES, clampColorSlot } from '../domain/matcher.js';
import { isValidPresetId, toISODate } from '../domain/date-range.js';

const RULE_HEADERS = ['Label', 'Field', 'Match type', 'Value', 'Case sensitive', 'Whole word', 'Enabled', 'Colour', 'ID'];

const MATCH_ALIASES = new Map();
for (const type of MATCH_TYPES) {
  MATCH_ALIASES.set(slug(type.id), type.id);
  MATCH_ALIASES.set(slug(type.label), type.id);
}
// Extra spellings people reach for.
Object.entries({
  exactmatch: 'exact', equals: 'exact', is: 'exact',
  includes: 'contains', has: 'contains',
  beginswith: 'startsWith', prefix: 'startsWith',
  suffix: 'endsWith',
  oneof: 'anyOf', in: 'anyOf',
  containsoneof: 'containsAny', containsany: 'containsAny',
  excludes: 'notContains', doesnotcontain: 'notContains', not: 'notContains',
  pattern: 'regex', regexp: 'regex', advanced: 'regex',
}).forEach(([alias, id]) => MATCH_ALIASES.set(alias, id));

const FIELD_ALIASES = new Map(Object.entries({
  title: 'title', summary: 'title', name: 'title', eventtitle: 'title',
  description: 'description', notes: 'description', details: 'description',
  location: 'location', where: 'location',
  any: 'any', anywhere: 'any', all: 'any',
}));

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A date cell → `YYYY-MM-DD`, or '' when there is nothing usable there.
 *
 * Values come back with `UNFORMATTED_VALUE`, so a cell Sheets recognised as a
 * date arrives as a *serial number* (days since 1899-12-30) rather than the
 * text that was typed into it. Someone typing `2026-07-01` into the Settings
 * tab sees an ISO date and reasonably expects it to be read as one, so accept
 * both that serial and plain ISO text.
 */
function toSheetDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : toISODate(value);

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Sheets' epoch: serial 0 is 1899-12-30. Times are the fractional part.
    const date = new Date(1899, 11, 30 + Math.floor(value));
    return Number.isNaN(date.getTime()) ? '' : toISODate(date);
  }

  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);          // also trims a time suffix
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/^\d+(\.\d+)?$/.test(text)) return toSheetDate(Number(text)); // serial stored as text
  return '';
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on', 'enabled'].includes(text)) return true;
  if (['false', 'no', 'n', '0', 'off', 'disabled'].includes(text)) return false;
  return fallback;
}

/** Read settings + rules. Never throws for a *missing* tab — only for an unreadable file. */
export async function loadConfig(spreadsheetId) {
  const { settings: settingsTab, rules: rulesTab } = APP_CONFIG.sheetTabs;
  const meta = await getSheetNames(spreadsheetId);

  const ranges = [];
  if (meta.tabs.includes(settingsTab)) ranges.push(`${settingsTab}!A1:B100`);
  if (meta.tabs.includes(rulesTab)) ranges.push(`${rulesTab}!A1:J500`);

  const values = ranges.length ? await batchGetValues(spreadsheetId, ranges) : {};

  const settings = parseSettings(values[`${settingsTab}!A1:B100`] || []);
  const parsedRules = parseRules(values[`${rulesTab}!A1:J500`] || []);

  return {
    spreadsheetId,
    title: meta.title,
    tabs: meta.tabs,
    hasSettingsTab: meta.tabs.includes(settingsTab),
    hasRulesTab: meta.tabs.includes(rulesTab),
    settings,
    rules: parsedRules.rules,
    ruleWarnings: parsedRules.warnings,
  };
}

/** @param {string[][]} rows key/value pairs */
export function parseSettings(rows) {
  const raw = {};
  for (const row of rows) {
    const key = slug(row[0]);
    if (!key || key === 'key' || key === 'setting') continue;
    raw[key] = row[1];
  }

  const fallback = APP_CONFIG.fallbackSettings;
  const requested = String(raw.defaultrange ?? raw.defaultview ?? raw.defaultdaterange ?? '').trim();
  const countMode = slug(raw.countmode ?? raw.counting ?? '');
  const weekStart = slug(raw.weekstart ?? raw.weekstartson ?? '');

  // When the sheet names no range at all, the deployment's fallback supplies the
  // dates too — otherwise a `custom` fallback would have nothing to resolve.
  const fromSheet = isValidPresetId(requested);
  const rangeStart = toSheetDate(raw.defaultrangestart) || (fromSheet ? '' : fallback.defaultRangeStart || '');
  const rangeEnd = toSheetDate(raw.defaultrangeend) || (fromSheet ? '' : fallback.defaultRangeEnd || '');

  // A `custom` default is only usable with both of its dates. Without them there
  // is nothing to resolve, so drop to a real preset rather than quietly showing
  // an arbitrary window nobody asked for.
  let defaultRange = fromSheet ? requested : fallback.defaultRange;
  if (defaultRange === 'custom' && !(rangeStart && rangeEnd)) defaultRange = 'last12months';

  return {
    defaultRange,
    defaultRangeStart: defaultRange === 'custom' ? rangeStart : '',
    defaultRangeEnd: defaultRange === 'custom' ? rangeEnd : '',
    calendarIds: splitIds(raw.calendarids ?? raw.calendarid ?? raw.calendars ?? fallback.calendarIds),
    countMode: countMode === 'all' || countMode === 'every' ? 'all' : 'first',
    weekStart: weekStart === 'sunday' ? 'sunday' : 'monday',
    defaultHoursPerShift: Number(raw.defaulthourspershift ?? raw.hourspershift ?? fallback.defaultHoursPerShift) || 0,
    allTimeYearsBack: Number(raw.alltimeyearsback ?? fallback.allTimeYearsBack) || fallback.allTimeYearsBack,
    title: String(raw.title ?? raw.deploymentname ?? '').trim(),
  };
}

function splitIds(value) {
  return String(value ?? '')
    .split(/[\n,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** @param {string[][]} rows header row + data rows */
export function parseRules(rows) {
  const warnings = [];
  if (!rows.length) return { rules: [], warnings };

  const header = rows[0].map(slug);
  const columnOf = (...names) => {
    for (const name of names) {
      const index = header.indexOf(slug(name));
      if (index !== -1) return index;
    }
    return -1;
  };

  const cols = {
    label: columnOf('label', 'name', 'counter'),
    field: columnOf('field', 'match on', 'target'),
    matchType: columnOf('match type', 'matchtype', 'type', 'rule'),
    value: columnOf('value', 'pattern', 'text', 'regex'),
    caseSensitive: columnOf('case sensitive', 'casesensitive', 'case'),
    wholeWord: columnOf('whole word', 'wholeword'),
    enabled: columnOf('enabled', 'active', 'on'),
    color: columnOf('colour', 'color'),
    id: columnOf('id', 'key'),
  };

  if (cols.label === -1 && cols.value === -1) {
    warnings.push('The Rules tab has no recognisable header row, so no counters were loaded. Expected columns: ' + RULE_HEADERS.join(', ') + '.');
    return { rules: [], warnings };
  }

  const rules = [];
  rows.slice(1).forEach((row, index) => {
    const cell = (key) => (cols[key] === -1 ? '' : row[cols[key]]);
    const label = String(cell('label') ?? '').trim();
    const value = String(cell('value') ?? '').trim();
    if (!label && !value) return; // blank spacer row

    const matchRaw = slug(cell('matchType'));
    const matchType = MATCH_ALIASES.get(matchRaw) || 'contains';
    if (matchRaw && !MATCH_ALIASES.has(matchRaw)) {
      warnings.push(`Row ${index + 2}: unknown match type “${cell('matchType')}” — treated as “Contains”.`);
    }

    const fieldRaw = slug(cell('field'));
    const field = FIELD_ALIASES.get(fieldRaw) || 'title';

    rules.push(normalizeRule({
      id: String(cell('id') ?? '').trim() || createRuleId(),
      label: label || value,
      field,
      matchType,
      value,
      caseSensitive: toBool(cell('caseSensitive'), false),
      wholeWord: toBool(cell('wholeWord'), false),
      enabled: toBool(cell('enabled'), true),
      color: clampColorSlot(cell('color') || (rules.length % 8) + 1),
    }));
  });

  return { rules, warnings };
}

/** Rules → the exact grid written back to the sheet. */
export function serializeRules(rules) {
  return [
    RULE_HEADERS,
    ...rules.map((rule) => {
      const normalized = normalizeRule(rule);
      const type = MATCH_TYPES.find((entry) => entry.id === normalized.matchType);
      return [
        normalized.label,
        normalized.field,
        type ? type.label : normalized.matchType,
        normalized.value,
        normalized.caseSensitive ? 'TRUE' : 'FALSE',
        normalized.wholeWord ? 'TRUE' : 'FALSE',
        normalized.enabled ? 'TRUE' : 'FALSE',
        normalized.color,
        normalized.id,
      ];
    }),
  ];
}

export function serializeSettings(settings) {
  return [
    ['Key', 'Value'],
    ['defaultRange', settings.defaultRange],
    ['defaultRangeStart', settings.defaultRangeStart || ''],
    ['defaultRangeEnd', settings.defaultRangeEnd || ''],
    ['calendarIds', (settings.calendarIds || []).join(', ')],
    ['countMode', settings.countMode],
    ['weekStart', settings.weekStart],
    ['defaultHoursPerShift', settings.defaultHoursPerShift || 0],
    ['allTimeYearsBack', settings.allTimeYearsBack || 5],
  ];
}

/** Write both tabs back, creating them if the sheet has never been used before. */
export async function saveConfig(spreadsheetId, { rules, settings }) {
  const { settings: settingsTab, rules: rulesTab } = APP_CONFIG.sheetTabs;

  if (rules) {
    await ensureTab(spreadsheetId, rulesTab);
    await replaceValues(spreadsheetId, { tab: rulesTab, rows: serializeRules(rules) });
  }
  if (settings) {
    await ensureTab(spreadsheetId, settingsTab);
    await replaceValues(spreadsheetId, { tab: settingsTab, rows: serializeSettings(settings), clearCols: 'C' });
  }
}

/** Compare two rule lists ignoring key order, to drive the "unsaved" indicator. */
export function rulesEqual(a = [], b = []) {
  const shape = (rules) => JSON.stringify(rules.map((rule) => {
    const { id, label, field, matchType, value, caseSensitive, wholeWord, enabled, color } = normalizeRule(rule);
    return [id, label, field, matchType, value, caseSensitive, wholeWord, enabled, color];
  }));
  return shape(a) === shape(b);
}

export { RULE_HEADERS };
