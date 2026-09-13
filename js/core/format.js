/** Locale-aware formatting helpers shared by views and charts. */

const locale = undefined; // let the browser decide

export const fmtInt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
export const fmtDec = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

export function number(value) {
  return fmtInt.format(Math.round(value || 0));
}

export function decimal(value, digits = 1) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

export function percent(value, total) {
  if (!total) return '0%';
  const pct = (value / total) * 100;
  return `${pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%`;
}

/** "2 shifts" / "1 shift" */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${number(count)} ${count === 1 ? singular : pluralForm}`;
}

const dayFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
const dayYearFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
const monthShortFmt = new Intl.DateTimeFormat(locale, { month: 'short' });
const monthLongFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });

export const date = {
  short: (d) => dayFmt.format(d),
  full: (d) => dayYearFmt.format(d),
  /** "Oct ’26" — the apostrophe keeps it from reading as a day of the month. */
  month: (d) => `${monthShortFmt.format(d)} ’${String(d.getFullYear()).slice(2)}`,
  monthName: (d) => monthShortFmt.format(d),
  monthLong: (d) => monthLongFmt.format(d),
  weekday: (d) => weekdayFmt.format(d),
  time: (d) => timeFmt.format(d),
  /** "Mar 3 – Jun 12, 2025" */
  range(start, end) {
    const sameYear = start.getFullYear() === end.getFullYear();
    return `${sameYear ? dayFmt.format(start) : dayYearFmt.format(start)} – ${dayYearFmt.format(end)}`;
  },
};

/** Duration in hours, shown as "7.5h" or "7h 30m" for small values. */
export function hours(value) {
  if (!value) return '0h';
  if (value < 10) {
    const whole = Math.floor(value);
    const mins = Math.round((value - whole) * 60);
    return mins ? `${whole}h ${mins}m` : `${whole}h`;
  }
  return `${decimal(value, 1)}h`;
}
