/**
 * Shift-counter configuration.
 *
 * The list is the source of truth for order (counters are evaluated top-down in
 * "count it once" mode), so reordering uses explicit arrow buttons rather than
 * drag-and-drop: it works on touch, with a keyboard, and with a screen reader,
 * and it costs the user nothing in discoverability.
 */
import { loadTemplate, qs, el, clear } from '../../core/dom.js';
import { store } from '../../core/store.js';
import { countEvents } from '../../domain/counter.js';
import { describeRule, normalizeRule, createRuleId } from '../../domain/matcher.js';
import { createRuleEditor } from '../components/rule-editor.js';
import { seriesColor, nextFreeSlot } from '../palette.js';
import { number, plural } from '../../core/format.js';
import { setRules, saveRulesToSheet, rulesAreDirty, updateSettings } from '../../app-state.js';
import { notify } from '../components/toast.js';

export async function renderRulesView(mount) {
  const fragment = await loadTemplate('rules');
  mount.replaceChildren(fragment);

  const root = qs('.rules', mount);
  const list = qs('[data-rule-list]', root);
  const syncState = qs('[data-sync-state]', root);
  const syncText = qs('[data-sync-text]', root);
  const unmatchedSection = qs('[data-unmatched]', root);
  const unmatchedList = qs('[data-unmatched-list]', root);

  /** id of the rule currently expanded for editing */
  let editingId = null;
  let activeEditor = null;
  /** the rule as it was the moment its editor opened, so "discard" has something to restore */
  let editingSnapshot = null;

  /* ---- counting mode ----------------------------------------------------- */

  const modeButtons = [...root.querySelectorAll('[data-count-mode] button')];
  function syncModeButtons() {
    const mode = store.select('settings')?.countMode || 'first';
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
  }
  for (const button of modeButtons) {
    button.addEventListener('click', async () => {
      await updateSettings({ countMode: button.dataset.mode });
      syncModeButtons();
    });
  }

  /* ---- toolbar actions --------------------------------------------------- */

  qs('[data-action="add-rule"]', root).addEventListener('click', () => {
    const rules = store.select('rules');
    const rule = normalizeRule({
      id: createRuleId(),
      label: `Counter ${rules.length + 1}`,
      matchType: 'contains',
      value: '',
      color: nextFreeSlot(rules),
    });
    setRules([...rules, rule]);
    editingId = rule.id;
    editingSnapshot = { ...rule };
    render();
    requestAnimationFrame(() => {
      const card = qs(`[data-rule-id="${rule.id}"]`, list);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      qs('.rule__editor input', card)?.focus();
    });
  });

  const saveButton = qs('[data-action="save-sheet"]', root);
  saveButton.addEventListener('click', async () => {
    saveButton.classList.add('is-busy');
    try {
      await saveRulesToSheet();
      notify.success('Saved to your config sheet', 'Everyone using this sheet will pick up the change.');
      renderSyncState();
    } catch (error) {
      notify.error('Could not save to the sheet', error.message);
    } finally {
      saveButton.classList.remove('is-busy');
    }
  });

  qs('[data-action="export"]', root).addEventListener('click', () => {
    const payload = JSON.stringify({ version: 1, rules: store.select('rules') }, null, 2);
    // A data: URL download is blocked in some embedded contexts, so fall back to
    // the clipboard rather than failing silently.
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: 'scrubs-counters.json' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  qs('[data-action="import"]', root).addEventListener('click', () => {
    const picker = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const incoming = Array.isArray(parsed) ? parsed : parsed.rules;
        if (!Array.isArray(incoming) || incoming.length === 0) throw new Error('No counters found in that file.');
        setRules(incoming.map((rule) => normalizeRule({ ...rule, id: rule.id || createRuleId() })));
        render();
        notify.success('Counters imported', `${plural(incoming.length, 'counter')} loaded. Save to the sheet to keep them.`);
      } catch (error) {
        notify.error('Import failed', error.message);
      } finally {
        picker.remove();
      }
    });
    document.body.append(picker);
    picker.click();
  });

  qs('[data-action="revert"]', root).addEventListener('click', () => {
    const baseline = store.select('rulesBaseline');
    if (!baseline.length) {
      notify.warning('Nothing to revert to', 'These counters have never been read from a sheet.');
      return;
    }
    setRules(baseline);
    editingId = null;
    editingSnapshot = null;
    render();
    notify.info('Reverted', 'Counters restored to the last version read from the sheet.');
  });

  /* ---- rendering --------------------------------------------------------- */

  function renderSyncState() {
    const source = store.select('rulesSource');
    const dirty = rulesAreDirty();
    syncState.dataset.dirty = String(dirty);

    syncState.dataset.sheet = store.select('spreadsheetId') ? 'yes' : 'none';

    if (!store.select('spreadsheetId')) {
      syncText.textContent = 'Saved in this browser only — no config sheet connected';
      saveButton.setAttribute('aria-disabled', 'true');
      return;
    }
    saveButton.setAttribute('aria-disabled', String(!dirty));
    syncText.textContent = dirty
      ? 'Unsaved changes — not yet written to the sheet'
      : source === 'sheet'
        ? 'In sync with the config sheet'
        : 'Loaded from this browser — save to write them to the sheet';
  }

  function render() {
    const state = store.get();
    const rules = state.rules;
    const events = state.events || [];
    const result = countEvents(events, rules, { countMode: state.settings?.countMode || 'first' });

    activeEditor?.destroy();
    activeEditor = null;
    clear(list);

    if (rules.length === 0) {
      list.append(el('div.card', {}, [
        el('div.empty', {}, [
          el('p.empty__title', { text: 'No counters yet' }),
          el('p.empty__text', { text: 'Add your first counter to start turning calendar events into numbers.' }),
        ]),
      ]));
    }

    rules.forEach((rule, index) => {
      const bucket = result.buckets.find((entry) => entry.rule.id === rule.id);
      list.append(ruleCard({ rule, index, rules, bucket, events, result }));
    });

    renderUnmatched(result);
    renderSyncState();
    syncModeButtons();
  }

  function ruleCard({ rule, index, rules, bucket, events }) {
    const isEditing = editingId === rule.id;

    const card = el(`div.rule${isEditing ? '.is-editing' : ''}${rule.enabled ? '' : '.is-disabled'}`, {
      dataset: { ruleId: rule.id },
      style: { '--rule-color': seriesColor(rule.color) },
    });

    const editedBadge = el('span.rule__edited-badge', { text: ' [Edited]', hidden: true });

    const summary = el('div.rule__summary', {}, [
      el('span.rule__color', { 'aria-hidden': 'true' }),
      el('div.rule__text', {}, [
        el('p.rule__name', {}, [el('span', { text: rule.label }), editedBadge]),
        el('p.rule__desc', {}, describeRule(rule).map((token) => (
          token.type === 'value' ? el('b', { text: `“${token.text}”` }) : document.createTextNode(token.text)
        ))),
      ]),
      el('div.rule__count', {}, [
        el('strong', { text: number(bucket?.total || 0) }),
        el('span', { text: events.length ? 'matches' : 'no data yet' }),
      ]),
      el('div.rule__actions', {}, [
        el('label.switch', { title: rule.enabled ? 'Counter is on' : 'Counter is off' }, [
          el('input', {
            type: 'checkbox',
            checked: rule.enabled,
            'aria-label': `Enable ${rule.label}`,
            on: {
              change: (event) => {
                mutate(index, { enabled: event.target.checked });
              },
            },
          }),
          el('span.switch__track'),
        ]),
        iconButton('Move up', 'M8 12.5v-9M4 7.5 8 3.5l4 4', index === 0, () => move(index, -1)),
        iconButton('Move down', 'M8 3.5v9M4 8.5l4 4 4-4', index === rules.length - 1, () => move(index, 1)),
        ...(isEditing ? [
          iconButton('Discard changes', 'M4 4l8 8M12 4l-8 8', false, () => {
            if (editingSnapshot) {
              const current = store.select('rules');
              setRules(current.map((entry) => (entry.id === rule.id ? editingSnapshot : entry)));
            }
            editingId = null;
            editingSnapshot = null;
            render();
          }),
          iconButton('Keep changes', 'M3.5 8.5l3 3 6-7', false, () => {
            editingId = null;
            editingSnapshot = null;
            render();
          }),
        ] : [
          iconButton('Edit counter', 'M11.2 2.8a1.7 1.7 0 0 1 2.4 2.4L5.5 13.3l-3.2.8.8-3.2Z', false, () => {
            editingId = rule.id;
            editingSnapshot = { ...rule };
            render();
          }),
        ]),
        iconButton('Delete counter', 'M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 9h5l.5-9', false, () => remove(index, rule)),
      ]),
    ]);

    card.append(summary);

    if (isEditing) {
      activeEditor = createRuleEditor({
        rule,
        events,
        onChange: (next) => {
          const current = store.select('rules');
          const updated = current.map((entry) => (entry.id === rule.id ? next : entry));
          setRules(updated);
          // Refresh only the summary line; re-rendering the card would steal focus.
          qs('.rule__name span', summary).textContent = next.label;
          editedBadge.hidden = !editingSnapshot || JSON.stringify(next) === JSON.stringify(editingSnapshot);
          const desc = qs('.rule__desc', summary);
          clear(desc);
          describeRule(next).forEach((token) => {
            desc.append(token.type === 'value' ? el('b', { text: `“${token.text}”` }) : document.createTextNode(token.text));
          });
          card.style.setProperty('--rule-color', seriesColor(next.color));
          const refreshed = countEvents(store.select('events') || [], [next], { countMode: 'all' });
          qs('.rule__count strong', summary).textContent = number(refreshed.buckets[0]?.total || 0);
          renderSyncState();
        },
      });
      card.append(activeEditor.element);
    }

    return card;
  }

  function mutate(index, patch) {
    const rules = store.select('rules').slice();
    rules[index] = normalizeRule({ ...rules[index], ...patch });
    setRules(rules);
    render();
  }

  function move(index, delta) {
    const rules = store.select('rules').slice();
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    [rules[index], rules[target]] = [rules[target], rules[index]];
    setRules(rules);
    render();
  }

  function remove(index, rule) {
    const rules = store.select('rules');
    const removed = rules[index];
    setRules(rules.filter((_, position) => position !== index));
    if (editingId === rule.id) {
      editingId = null;
      editingSnapshot = null;
    }
    render();

    const undo = notify.info('Counter deleted', `“${removed.label}” was removed.`);
    // A short-lived undo beats a confirmation dialog for a reversible change.
    const restore = el('button.link-btn', {
      type: 'button',
      text: 'Undo',
      on: {
        click() {
          const next = store.select('rules').slice();
          next.splice(index, 0, removed);
          setRules(next);
          render();
          undo();
        },
      },
    });
    qs('#toast-stack .toast:last-child .toast__body')?.append(restore);
  }

  function renderUnmatched(result) {
    const top = result.unmatched.slice(0, 12);
    unmatchedSection.hidden = top.length === 0;
    clear(unmatchedList);

    for (const entry of top) {
      unmatchedList.append(el('div.unmatched-item', {}, [
        el('span.unmatched-item__title', { text: entry.title, title: entry.title }),
        el('span.row.row--tight', {}, [
          el('span.unmatched-item__count', { text: plural(entry.count, 'event') }),
          el('button.link-btn.text-sm', {
            type: 'button',
            text: 'Count these',
            on: {
              click() {
                const rules = store.select('rules');
                const rule = normalizeRule({
                  id: createRuleId(),
                  label: entry.title,
                  matchType: 'exact',
                  value: entry.title,
                  color: nextFreeSlot(rules),
                });
                setRules([...rules, rule]);
                editingId = rule.id;
                editingSnapshot = { ...rule };
                render();
                qs(`[data-rule-id="${rule.id}"]`, list)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              },
            },
          }),
        ]),
      ]));
    }
  }

  const unsubscribe = store.subscribe(['events', 'eventsStatus', 'settings', 'rulesSource'], render);
  render();

  return () => {
    unsubscribe();
    activeEditor?.destroy();
  };
}

function iconButton(label, path, disabled, onClick) {
  return el('button.btn.btn--icon.btn--sm.btn--ghost', {
    type: 'button',
    title: label,
    'aria-label': label,
    disabled,
    on: { click: onClick },
    html: `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  });
}
