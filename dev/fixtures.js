/**
 * Synthetic calendar data for local development.
 *
 * Deterministic (a seeded PRNG) so a visual change in the preview is always a
 * change you made, never a reshuffle of the fake data.
 */
import { normalizeRule } from '../js/domain/matcher.js';

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHIFTS = [
  { title: 'HP6 AM', start: 7, length: 8.5, weight: 0.3 },
  { title: 'HP6 PM', start: 14, length: 8.5, weight: 0.22 },
  { title: 'HP6 Night', start: 22, length: 10, weight: 0.12 },
  { title: 'HP7 AM', start: 7, length: 8.5, weight: 0.14 },
  { title: 'Clinic — general', start: 9, length: 6, weight: 0.1 },
  { title: 'Teaching block', start: 13, length: 3, weight: 0.06 },
  { title: 'Annual Leave', start: 0, length: 0, weight: 0.06, allDay: true },
];

export function makeEvents({ months = 14, seed = 7 } = {}) {
  const random = mulberry32(seed);
  const events = [];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 2), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    if (random() > (isWeekend ? 0.32 : 0.62)) continue;

    let roll = random();
    const shift = SHIFTS.find((candidate) => (roll -= candidate.weight) <= 0) || SHIFTS[0];

    const startAt = new Date(day);
    startAt.setHours(shift.start, random() > 0.7 ? 30 : 0, 0, 0);
    const endAt = new Date(startAt.getTime() + shift.length * 3_600_000);

    events.push({
      id: `demo-${events.length}`,
      calendarId: 'demo@example.com',
      calendarName: 'Demo roster',
      title: shift.title,
      description: '',
      location: shift.allDay ? '' : 'Ward 6',
      start: shift.allDay ? new Date(day.getFullYear(), day.getMonth(), day.getDate()) : startAt,
      end: shift.allDay ? new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) : endAt,
      allDay: Boolean(shift.allDay),
      hours: shift.allDay ? 0 : shift.length,
      htmlLink: '',
      status: 'confirmed',
    });
  }

  return events;
}

export const demoRules = [
  { label: 'HP6 mornings', matchType: 'exact', value: 'HP6 AM', color: 1 },
  { label: 'HP6 afternoons', matchType: 'exact', value: 'HP6 PM', color: 2 },
  { label: 'HP6 nights', matchType: 'contains', value: 'Night', color: 3 },
  { label: 'HP7 cover', matchType: 'startsWith', value: 'HP7', color: 4 },
  { label: 'Clinics', matchType: 'contains', value: 'Clinic', color: 5 },
].map((rule, index) => normalizeRule({ ...rule, id: `demo-rule-${index}` }));
