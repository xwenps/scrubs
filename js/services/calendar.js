/**
 * Google Calendar read client.
 *
 * Events are normalised the moment they arrive so nothing downstream has to
 * know about Google's `date` vs `dateTime` split or its pagination.
 */
import { apiFetch, withQuery } from './http.js';
import { CALENDAR_EVENTS_SCOPE, CAN_LIST_CALENDARS, SCOPES } from './auth.js';

const BASE = 'https://www.googleapis.com/calendar/v3';
const PAGE_SIZE = 2500;

/**
 * List the user's calendars for the picker.
 *
 * Returns an empty array when the deployment did not request the listing scope
 * — the caller then falls back to the calendar IDs in configuration, so the
 * app still works with one fewer permission granted.
 *
 * @returns {Promise<Array<{id, summary, primary, backgroundColor, accessRole}>>}
 */
export async function listCalendars() {
  if (!CAN_LIST_CALENDARS) return [];
  const calendars = [];
  let pageToken;
  do {
    const data = await apiFetch(withQuery(`${BASE}/users/me/calendarList`, {
      maxResults: 250,
      minAccessRole: 'reader',
      showHidden: false,
      pageToken,
    }), { scopes: [SCOPES.calendarList] });

    for (const item of data.items || []) {
      calendars.push({
        id: item.id,
        summary: item.summaryOverride || item.summary || item.id,
        primary: Boolean(item.primary),
        backgroundColor: item.backgroundColor,
        accessRole: item.accessRole,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Primary first, then alphabetical — the order people expect to scan.
  return calendars.sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary));
}

/**
 * Fetch every event in [start, end) across the given calendars.
 * @param {{calendarIds: string[], start: Date, end: Date, hoursPerAllDayShift?: number, signal?: AbortSignal, onProgress?: (info) => void}} params
 */
export async function fetchEvents({ calendarIds, start, end, hoursPerAllDayShift = 0, signal, onProgress }) {
  const ids = calendarIds.filter(Boolean);
  const results = await Promise.all(ids.map(async (calendarId, index) => {
    const events = [];
    let pageToken;
    do {
      const data = await apiFetch(withQuery(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,          // expand recurring series into instances
        orderBy: 'startTime',
        maxResults: PAGE_SIZE,
        showDeleted: false,
        pageToken,
      }), { scopes: [CALENDAR_EVENTS_SCOPE], signal });

      const calendarName = data.summary || calendarId;
      for (const item of data.items || []) {
        const event = normalizeEvent(item, calendarId, calendarName, hoursPerAllDayShift);
        if (event) events.push(event);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    onProgress?.({ done: index + 1, total: ids.length, calendarId });
    return events;
  }));

  return results.flat().sort((a, b) => a.start - b.start);
}

function normalizeEvent(item, calendarId, calendarName, hoursPerAllDayShift) {
  if (item.status === 'cancelled') return null;

  const allDay = Boolean(item.start?.date);
  const start = allDay ? parseLocalDate(item.start.date) : new Date(item.start?.dateTime);
  const endRaw = allDay ? parseLocalDate(item.end?.date) : new Date(item.end?.dateTime);
  if (!start || Number.isNaN(start.getTime())) return null;

  const end = endRaw && !Number.isNaN(endRaw.getTime()) ? endRaw : start;
  const hours = allDay
    ? Number(hoursPerAllDayShift) || 0
    : Math.max(0, (end - start) / 3_600_000);

  return {
    id: `${calendarId}::${item.id}::${item.start?.dateTime || item.start?.date}`,
    calendarId,
    calendarName,
    title: item.summary || '',
    description: item.description || '',
    location: item.location || '',
    start,
    end,
    allDay,
    hours,
    htmlLink: item.htmlLink || '',
    status: item.status || 'confirmed',
  };
}

/** Google sends all-day dates as `YYYY-MM-DD`; `new Date()` would read that as UTC. */
function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
