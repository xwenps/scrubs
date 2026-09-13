/**
 * The shift-counter editor.
 *
 * Design goal: someone who has never seen a regular expression should be able
 * to build every counter they need. So the primary controls are a plain-English
 * sentence ("Count an event when its title contains HP6") and a grid of named
 * match types with worked examples. The generated pattern is shown read-only as
 * a footnote, and raw regex is available but clearly marked "advanced".
 *
 * Every keystroke re-runs the rule against the loaded calendar, so the user
 * sees exactly what they are about to count instead of guessing.
 */
import { el, clear } from '../../core/dom.js';
import { MATCH_TYPES, MATCH_TYPE_BY_ID, FIELDS, compileRule, highlightSegments, normalizeRule } from '../../domain/matcher.js';
import { previewRule } from '../../domain/counter.js';
import { SERIES_SLOTS, seriesColor } from '../palette.js';
import { date as fmtDate, number } from '../../core/format.js';
import { createPeriodPicker } from './period-picker.js';

const PREVIEW_DEBOUNCE = 140;

/**
 * @param {{rule: object, events: Array, onChange: (rule) => void}} config
 * @returns {{element: HTMLElement, setEvents: (events) => void, destroy: () => void}}
 */
export function createRuleEditor(config) {
  let rule = normalizeRule(config.rule);
  let events = config.events || [];
  let previewTimer = null;

  const root = el('div.rule__editor');

  /* ---- identity: name + colour ------------------------------------------ */

  const nameInput = el('input.input', {
    type: 'text',
    value: rule.label,
    placeholder: 'e.g. HP6 mornings',
    'aria-label': 'Counter name',
    on: { input: () => update({ label: nameInput.value }, { preview: false }) },
  });

  const colorButtons = SERIES_SLOTS.map((slot) => el('button.color-dot', {
    type: 'button',
    'aria-label': `Colour ${slot}`,
    'aria-pressed': String(rule.color === slot),
    style: { '--dot': seriesColor(slot) },
    on: {
      click() {
        update({ color: slot }, { preview: false });
        colorButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(SERIES_SLOTS[index] === slot)));
        root.style.setProperty('--rule-color', seriesColor(slot));
      },
    },
  }));

  /* ---- the sentence ------------------------------------------------------ */

  const fieldSelect = el('select.select', {
    'aria-label': 'Which part of the event to look at',
    on: { change: () => update({ field: fieldSelect.value }) },
  }, FIELDS.map((field) => el('option', { value: field.id, text: field.label, selected: field.id === rule.field })));

  const valueInput = el('input.input', {
    type: 'text',
    value: rule.value,
    placeholder: 'e.g. HP6 AM',
    'aria-label': 'Text to match',
    spellcheck: 'false',
    autocapitalize: 'off',
    on: { input: () => update({ value: valueInput.value }) },
  });

  const valueTextarea = el('textarea.textarea', {
    placeholder: 'One per line, e.g.\nHP6 AM\nHP6 PM',
    'aria-label': 'Values to match, one per line',
    spellcheck: 'false',
    on: { input: () => update({ value: valueTextarea.value }) },
  });

  const valueWrap = el('div', { style: { flex: '1 1 220px', 'min-width': '0' } }, [valueInput]);

  const matchButtons = MATCH_TYPES.map((type) => el('button.match-option', {
    type: 'button',
    'aria-pressed': String(rule.matchType === type.id),
    on: { click: () => selectMatchType(type.id) },
  }, [
    el('span.match-option__name', { text: type.label }),
    el('span.match-option__eg', { text: type.example }),
  ]));

  function selectMatchType(id) {
    update({ matchType: id });
    matchButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(MATCH_TYPES[index].id === id)));
    syncValueControl();
  }

  /** Swap between a single-line input and a list textarea as the type demands. */
  function syncValueControl() {
    const type = MATCH_TYPE_BY_ID[rule.matchType];
    const wantsList = Boolean(type.multi);
    const active = wantsList ? valueTextarea : valueInput;
    if (wantsList) {
      valueTextarea.value = rule.value;
      valueTextarea.placeholder = type.id === 'anyOf'
        ? 'One exact title per line'
        : 'One word or phrase per line';
    } else {
      valueInput.value = rule.value;
      valueInput.placeholder = type.advanced ? 'e.g. ^HP[67]\\s+(AM|PM)$' : 'e.g. HP6 AM';
      valueInput.classList.toggle('input--mono', Boolean(type.advanced));
    }
    if (valueWrap.firstChild !== active) valueWrap.replaceChildren(active);

    advancedNote.hidden = !type.advanced;
    wholeWordRow.hidden = Boolean(type.advanced) || type.id === 'exact' || type.id === 'anyOf';
  }

  const advancedNote = el('p.field__hint', {
    text: 'Advanced mode: this value is used as a regular expression exactly as written.',
    hidden: true,
  });

  /* ---- options ----------------------------------------------------------- */

  const caseToggle = el('label.check', {}, [
    el('input', {
      type: 'checkbox',
      checked: rule.caseSensitive,
      on: { change: (event) => update({ caseSensitive: event.target.checked }) },
    }),
    'Match upper and lower case exactly',
  ]);

  const wholeWordRow = el('label.check', {}, [
    el('input', {
      type: 'checkbox',
      checked: rule.wholeWord,
      on: { change: (event) => update({ wholeWord: event.target.checked }) },
    }),
    'Whole words only (HP6 will not match HP60)',
  ]);

  const spaceToggle = el('label.check', {}, [
    el('input', {
      type: 'checkbox',
      checked: rule.normalizeSpace,
      on: { change: (event) => update({ normalizeSpace: event.target.checked }) },
    }),
    'Ignore extra spaces',
  ]);

  /* ---- hours: multi-day blocks -------------------------------------------
   * A block is one calendar event standing in for several daily shifts (e.g.
   * a 14-day stretch instead of fourteen 8-hour entries), so its raw duration
   * is meaningless — this credits days-spanned × hours/day instead. */

  const blockHoursInput = el('input.input', {
    type: 'number',
    min: '0',
    step: '0.5',
    value: rule.blockHoursPerDay || '',
    style: { 'max-width': '120px' },
    'aria-label': 'Hours credited per day',
    on: { change: () => update({ blockHoursPerDay: Number(blockHoursInput.value) || 0 }, { preview: false }) },
  });

  const blockHoursField = el('div.field', { hidden: !rule.blockMode }, [
    el('label.field__label', { text: 'Hours credited per day' }),
    blockHoursInput,
  ]);

  const blockModeToggle = el('label.check', {}, [
    el('input', {
      type: 'checkbox',
      checked: rule.blockMode,
      on: {
        change: (event) => {
          const checked = event.target.checked;
          const patch = { blockMode: checked };
          if (checked && !rule.blockHoursPerDay) patch.blockHoursPerDay = config.settings?.defaultHoursPerShift || 8;
          update(patch, { preview: false });
          blockHoursInput.value = rule.blockHoursPerDay || '';
          blockHoursField.hidden = !rule.blockMode;
        },
      },
    }),
    'This counter matches multi-day blocks (one event covers several shift-days)',
  ]);

  /* ---- goals & limits ------------------------------------------------------
   * One period drives both the goal (floor) and the cap (ceiling) for this
   * counter, so "this pay period" means the same thing for both. */

  const periodPicker = createPeriodPicker({
    value: rule.period,
    onChange: (period) => update({ period }, { preview: false }),
  });

  const goalTargetInput = el('input.input', {
    type: 'number',
    min: '0',
    step: '1',
    value: rule.goalTarget || '',
    style: { 'max-width': '100px' },
    hidden: !rule.goalEnabled,
    'aria-label': 'Goal target — shifts per period',
    on: { change: () => update({ goalTarget: Math.max(0, Math.round(Number(goalTargetInput.value)) || 0) }, { preview: false }) },
  });
  const goalToggle = el('label.check', {}, [
    el('input', {
      type: 'checkbox',
      checked: rule.goalEnabled,
      on: {
        change: (event) => {
          update({ goalEnabled: event.target.checked }, { preview: false });
          goalTargetInput.hidden = !rule.goalEnabled;
        },
      },
    }),
    'Track a goal (minimum shifts per period)',
  ]);

  const capTargetInput = el('input.input', {
    type: 'number',
    min: '0',
    step: '1',
    value: rule.capTarget || '',
    style: { 'max-width': '100px' },
    hidden: !rule.capEnabled,
    'aria-label': 'Cap target — shifts per period',
    on: { change: () => update({ capTarget: Math.max(0, Math.round(Number(capTargetInput.value)) || 0) }, { preview: false }) },
  });
  const capToggle = el('label.check', {}, [
    el('input', {
      type: 'checkbox',
      checked: rule.capEnabled,
      on: {
        change: (event) => {
          update({ capEnabled: event.target.checked }, { preview: false });
          capTargetInput.hidden = !rule.capEnabled;
        },
      },
    }),
    'Track a cap (maximum shifts per period, for cancellation planning)',
  ]);

  /* ---- live preview ------------------------------------------------------ */

  const previewCount = el('p.preview__count');
  const previewList = el('div.preview__list');
  const patternNote = el('p.field__hint.mono');

  const testInput = el('input.input', {
    type: 'text',
    placeholder: 'Type an event title to test it…',
    'aria-label': 'Test a title against this counter',
    on: { input: renderTester },
  });
  const testResult = el('span.tester__result', { dataset: { match: 'no' }, text: 'Type something to test' });

  function renderTester() {
    const matcher = compileRule(rule);
    const text = testInput.value;
    if (!text) {
      testResult.dataset.match = 'no';
      testResult.textContent = 'Type something to test';
      return;
    }
    const hit = matcher.ok && matcher.testText(text);
    testResult.dataset.match = hit ? 'yes' : 'no';
    testResult.textContent = hit ? '✓ This would be counted' : '✕ This would not be counted';
  }

  function renderPreview() {
    const result = previewRule(events, rule, { limit: 30 });
    clear(previewList);

    if (!result.ok) {
      previewCount.textContent = result.error || 'Not ready yet';
      previewList.append(el('p.preview__empty', { text: 'Fill in what to match and the preview will fill itself in.' }));
    } else {
      previewCount.replaceChildren(
        el('strong', { text: number(result.total) }),
        document.createTextNode(` of ${number(result.scanned)} events in the current date range`),
      );

      if (result.samples.length === 0) {
        previewList.append(el('p.preview__empty', {
          text: 'Nothing matched yet. Try a shorter phrase, or switch to “Contains”.',
        }));
      } else {
        for (const event of result.samples) {
          previewList.append(el('div.preview__item', {}, [
            el('span.preview__title', {}, highlight(event.title || '(no title)', result.matcher)),
            el('span.preview__date', { text: fmtDate.short(event.start) }),
          ]));
        }
      }
    }

    const matcher = compileRule(rule);
    patternNote.textContent = matcher.ok ? `Pattern used: ${matcher.regex}` : '';
    patternNote.hidden = !matcher.ok;
    renderTester();
  }

  function highlight(text, matcher) {
    return highlightSegments(text, matcher).map((segment) => (
      segment.match ? el('mark', { text: segment.text }) : document.createTextNode(segment.text)
    ));
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, PREVIEW_DEBOUNCE);
  }

  function update(patch, { preview = true } = {}) {
    rule = normalizeRule({ ...rule, ...patch });
    config.onChange(rule);
    if (preview) schedulePreview();
  }

  /* ---- assembly ---------------------------------------------------------- */

  root.style.setProperty('--rule-color', seriesColor(rule.color));

  root.append(
    el('div.grid.grid--halves', {}, [
      el('div.field', {}, [
        el('label.field__label', { text: 'Counter name' }),
        nameInput,
        el('p.field__hint', { text: 'Shown on the dashboard and in the legend.' }),
      ]),
      el('div.field', {}, [
        el('label.field__label', { text: 'Colour' }),
        el('div.color-picker', {}, colorButtons),
      ]),
    ]),

    el('div.rule__fieldset', {}, [
      el('p.rule__legend', { text: 'What counts' }),
      el('div.sentence', {}, [
        el('span.sentence__word', { text: 'Count an event when its' }),
        fieldSelect,
      ]),
      el('div.match-grid', {}, matchButtons),
      el('div.sentence', {}, [
        el('span.sentence__word', { text: 'this text:' }),
        valueWrap,
      ]),
      advancedNote,
    ]),

    el('div.rule__fieldset', {}, [
      el('p.rule__legend', { text: 'Fine tuning' }),
      el('div.stack.stack--2', {}, [caseToggle, wholeWordRow, spaceToggle]),
      patternNote,
    ]),

    el('div.rule__fieldset', {}, [
      el('p.rule__legend', { text: 'Hours' }),
      blockModeToggle,
      blockHoursField,
    ]),

    el('div.rule__fieldset', {}, [
      el('p.rule__legend', { text: 'Goals & limits' }),
      periodPicker.element,
      el('div.stack.stack--2', {}, [
        el('div.row.row--tight', {}, [goalToggle, goalTargetInput]),
        el('div.row.row--tight', {}, [capToggle, capTargetInput]),
      ]),
    ]),

    el('div.rule__fieldset', {}, [
      el('p.rule__legend', { text: 'Live preview' }),
      el('div.preview', {}, [
        el('div.preview__head', {}, [previewCount]),
        previewList,
      ]),
      el('div.tester', {}, [testInput, testResult]),
    ]),
  );

  syncValueControl();
  renderPreview();

  return {
    element: root,
    setEvents(nextEvents) {
      events = nextEvents || [];
      renderPreview();
    },
    destroy() {
      clearTimeout(previewTimer);
      periodPicker.destroy();
      root.remove();
    },
  };
}
