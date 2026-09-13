/**
 * Three-state theme control: follow the system, force light, force dark.
 *
 * "Follow system" is a real state rather than an implicit default, because a
 * person who has never touched the control and a person who deliberately chose
 * light are not the same user.
 */
import { el } from '../../core/dom.js';
import { local, KEYS } from '../../core/storage.js';

const MODES = [
  {
    id: 'auto',
    label: 'Follow system theme',
    // Half-filled circle ("contrast" glyph) — visually distinct from the
    // light/dark icons at a glance, unlike the previous small-sun variant.
    outline: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z',
    fill: 'M8 1.5v13a6.5 6.5 0 0 0 0-13Z',
  },
  {
    id: 'light',
    label: 'Light theme',
    path: 'M8 2.25v1M8 12.75v1M3.4 3.4l.7.7M11.9 11.9l.7.7M2.25 8h1M12.75 8h1M3.4 12.6l.7-.7M11.9 4.1l.7-.7M8 4.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z',
  },
  {
    id: 'dark',
    label: 'Dark theme',
    path: 'M13 9.4A5.4 5.4 0 0 1 6.6 3a5.5 5.5 0 1 0 6.4 6.4Z',
  },
];

export function getTheme() {
  const stored = local.getRaw(KEYS.theme, 'auto');
  return MODES.some((mode) => mode.id === stored) ? stored : 'auto';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  local.setRaw(KEYS.theme, theme);
}

export function createThemeToggle() {
  const current = getTheme();

  const buttons = MODES.map((mode) => el('button.segmented__option', {
    type: 'button',
    title: mode.label,
    'aria-label': mode.label,
    'aria-pressed': String(mode.id === current),
    dataset: { mode: mode.id },
    on: {
      click() {
        applyTheme(mode.id);
        for (const button of buttons) {
          button.setAttribute('aria-pressed', String(button.dataset.mode === mode.id));
        }
      },
    },
  }, [iconFor(mode)]));

  return el('div.segmented.theme-toggle', { role: 'group', 'aria-label': 'Theme' }, buttons);
}

function iconFor(mode) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = mode.outline
    ? `<path d="${mode.fill}" fill="currentColor" stroke="none"/><path d="${mode.outline}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`
    : `<path d="${mode.path}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
}
