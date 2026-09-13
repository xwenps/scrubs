/**
 * Rule → matcher compilation.
 *
 * Counting is regex-based under the hood, but the *authoring* model is plain
 * language: a user picks "contains" and types `HP6`. The regex is generated,
 * never typed — except in the deliberately-labelled advanced mode, which is
 * there as an escape hatch for people who do know the syntax.
 *
 * A rule is a plain object so it round-trips through Google Sheets, JSON
 * export and localStorage unchanged:
 *
 *   {
 *     id, label, field, matchType, value,
 *     caseSensitive, wholeWord, normalizeSpace, enabled, color
 *   }
 */

export const FIELDS = [
  { id: 'title', label: 'title', pick: (event) => event.title },
  { id: 'description', label: 'description', pick: (event) => event.description },
  { id: 'location', label: 'location', pick: (event) => event.location },
  { id: 'any', label: 'title, description or location', pick: (event) => `${event.title}\n${event.description}\n${event.location}` },
];

export const MATCH_TYPES = [
  {
    id: 'exact',
    label: 'Is exactly',
    example: 'HP6 AM — and nothing else',
    multi: false,
    build: (value) => `^${escapeRegExp(value)}$`,
  },
  {
    id: 'contains',
    label: 'Contains',
    example: 'anything with HP6 in it',
    multi: false,
    build: (value) => escapeRegExp(value),
  },
  {
    id: 'startsWith',
    label: 'Starts with',
    example: 'HP6 AM, HP6 PM…',
    multi: false,
    build: (value) => `^${escapeRegExp(value)}`,
  },
  {
    id: 'endsWith',
    label: 'Ends with',
    example: '…AM, Night AM',
    multi: false,
    build: (value) => `${escapeRegExp(value)}$`,
  },
  {
    id: 'anyOf',
    label: 'Is any of',
    example: 'exactly HP6 AM or HP6 PM',
    multi: true,
    build: (value) => `^(?:${splitList(value).map(escapeRegExp).join('|')})$`,
  },
  {
    id: 'containsAny',
    label: 'Contains any of',
    example: 'mentions HP6 or HP7',
    multi: true,
    build: (value) => `(?:${splitList(value).map(escapeRegExp).join('|')})`,
  },
  {
    id: 'notContains',
    label: 'Does not contain',
    example: 'everything except Leave',
    multi: false,
    negate: true,
    build: (value) => escapeRegExp(value),
  },
  {
    id: 'regex',
    label: 'Matches pattern',
    example: 'advanced — write your own regex',
    multi: false,
    advanced: true,
    build: (value) => value,
  },
];

export const MATCH_TYPE_BY_ID = Object.fromEntries(MATCH_TYPES.map((type) => [type.id, type]));
export const FIELD_BY_ID = Object.fromEntries(FIELDS.map((field) => [field.id, field]));

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a multi-value input on newlines, commas or pipes; drop blanks. */
export function splitList(value) {
  return String(value || '')
    .split(/[\n,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function collapseSpace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Fill in defaults so partially-specified rules (e.g. from a sheet) stay valid. */
export function normalizeRule(rule = {}) {
  const matchType = MATCH_TYPE_BY_ID[rule.matchType] ? rule.matchType : 'contains';
  return {
    id: rule.id || createRuleId(),
    label: String(rule.label ?? '').trim() || 'Untitled counter',
    field: FIELD_BY_ID[rule.field] ? rule.field : 'title',
    matchType,
    value: String(rule.value ?? ''),
    caseSensitive: Boolean(rule.caseSensitive),
    wholeWord: Boolean(rule.wholeWord),
    normalizeSpace: rule.normalizeSpace === undefined ? true : Boolean(rule.normalizeSpace),
    enabled: rule.enabled === undefined ? true : Boolean(rule.enabled),
    color: clampColorSlot(rule.color),
  };
}

export function clampColorSlot(value) {
  const slot = Number.parseInt(value, 10);
  if (!Number.isFinite(slot) || slot < 1 || slot > 8) return 1;
  return slot;
}

let idCounter = 0;
export function createRuleId() {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 7);
  return `r${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

/**
 * Compile a rule into a reusable matcher.
 * @returns {{ok: boolean, error?: string, regex?: RegExp, negate?: boolean, test: (event) => boolean, testText: (text) => boolean}}
 */
export function compileRule(rule) {
  const normalized = normalizeRule(rule);
  const type = MATCH_TYPE_BY_ID[normalized.matchType];
  const field = FIELD_BY_ID[normalized.field];
  const rawValue = normalized.normalizeSpace ? collapseSpace(normalized.value) : normalized.value;

  const noop = {
    ok: false,
    error: 'Nothing to match on yet',
    test: () => false,
    testText: () => false,
  };

  if (!rawValue) return noop;
  if (type.multi && splitList(rawValue).length === 0) return noop;

  let source;
  try {
    source = type.build(rawValue);
  } catch (error) {
    return { ...noop, error: error.message };
  }

  if (normalized.wholeWord && !type.advanced) {
    // \b is wrong next to non-word characters ("HP6 AM" ends in a word char, but
    // a value like "(HP6)" does not), so guard with lookarounds instead.
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  }

  let regex;
  try {
    regex = new RegExp(source, `${normalized.caseSensitive ? '' : 'i'}u`);
  } catch (error) {
    // The `u` flag rejects some otherwise-valid legacy patterns; retry without it
    // so advanced users are not blocked by our own strictness.
    try {
      regex = new RegExp(source, normalized.caseSensitive ? '' : 'i');
    } catch (innerError) {
      return { ...noop, error: `Invalid pattern: ${innerError.message}` };
    }
  }

  const negate = Boolean(type.negate);
  const prepare = (text) => (normalized.normalizeSpace ? collapseSpace(text ?? '') : String(text ?? ''));
  const testText = (text) => {
    const result = regex.test(prepare(text));
    return negate ? !result : result;
  };

  return {
    ok: true,
    regex,
    negate,
    rule: normalized,
    testText,
    test: (event) => testText(field.pick(event)),
  };
}

/** Compile a list once; keeps `countEvents` free of per-event compilation cost. */
export function compileRules(rules) {
  return rules.map((rule) => ({ rule: normalizeRule(rule), matcher: compileRule(rule) }));
}

/**
 * Human-readable summary of a rule, as tokens so the UI can style the value.
 * @returns {Array<{type: 'text'|'value', text: string}>}
 */
export function describeRule(rule) {
  const normalized = normalizeRule(rule);
  const type = MATCH_TYPE_BY_ID[normalized.matchType];
  const field = FIELD_BY_ID[normalized.field];
  const tokens = [{ type: 'text', text: `${capitalize(field.label)} ` }];

  const verb = {
    exact: 'is exactly',
    contains: 'contains',
    startsWith: 'starts with',
    endsWith: 'ends with',
    anyOf: 'is any of',
    containsAny: 'contains any of',
    notContains: 'does not contain',
    regex: 'matches the pattern',
  }[normalized.matchType];

  tokens.push({ type: 'text', text: `${verb} ` });

  if (type.multi) {
    const parts = splitList(normalized.value);
    parts.forEach((part, index) => {
      if (index > 0) tokens.push({ type: 'text', text: index === parts.length - 1 ? ' or ' : ', ' });
      tokens.push({ type: 'value', text: part });
    });
  } else {
    tokens.push({ type: 'value', text: normalized.value || '…' });
  }

  const qualifiers = [];
  if (normalized.caseSensitive) qualifiers.push('case-sensitive');
  if (normalized.wholeWord) qualifiers.push('whole words only');
  if (qualifiers.length) tokens.push({ type: 'text', text: ` (${qualifiers.join(', ')})` });

  return tokens;
}

export function describeRuleText(rule) {
  return describeRule(rule).map((token) => (token.type === 'value' ? `“${token.text}”` : token.text)).join('');
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Split text into matched / unmatched segments so the preview can highlight
 * exactly what the rule caught. Negated rules highlight nothing by definition.
 */
export function highlightSegments(text, matcher) {
  const source = String(text ?? '');
  if (!matcher?.ok || matcher.negate || !matcher.regex) return [{ text: source, match: false }];

  const global = new RegExp(matcher.regex.source, `${matcher.regex.flags.replace('g', '')}g`);
  const segments = [];
  let cursor = 0;
  let guard = 0;

  for (const found of source.matchAll(global)) {
    if (guard++ > 200) break;
    const start = found.index;
    if (found[0].length === 0) continue;
    if (start > cursor) segments.push({ text: source.slice(cursor, start), match: false });
    segments.push({ text: found[0], match: true });
    cursor = start + found[0].length;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), match: false });
  return segments.length ? segments : [{ text: source, match: false }];
}
