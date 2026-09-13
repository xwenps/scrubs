/**
 * Google Sheets read/write client, scoped to what the config file needs.
 */
import { apiFetch, withQuery, ApiError } from './http.js';
import { SCOPES } from './auth.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** A Sheets URL, a bare ID, or something in between — all resolve to the ID. */
export function extractSpreadsheetId(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(value);
  if (fromUrl) return fromUrl[1];
  return looksLikeSpreadsheetId(value) ? value : '';
}

export function looksLikeSpreadsheetId(value) {
  return /^[a-zA-Z0-9-_]{20,}$/.test(String(value || '').trim());
}

/** Tab names of a spreadsheet, used to decide what we can read. */
export async function getSheetNames(spreadsheetId) {
  const data = await apiFetch(withQuery(`${BASE}/${encodeURIComponent(spreadsheetId)}`, {
    fields: 'properties.title,sheets.properties.title',
  }), { scopes: [SCOPES.sheetsRead] });

  return {
    title: data.properties?.title || 'Untitled spreadsheet',
    tabs: (data.sheets || []).map((sheet) => sheet.properties.title),
  };
}

/** @returns {Promise<Record<string, string[][]>>} keyed by the requested range */
export async function batchGetValues(spreadsheetId, ranges) {
  if (!ranges.length) return {};
  const url = new URL(`${BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet`);
  for (const range of ranges) url.searchParams.append('ranges', range);
  url.searchParams.set('majorDimension', 'ROWS');
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');

  const data = await apiFetch(url.toString(), { scopes: [SCOPES.sheetsRead] });
  const out = {};
  (data.valueRanges || []).forEach((valueRange, index) => {
    out[ranges[index]] = valueRange.values || [];
  });
  return out;
}

/** Replace a rectangular block of values, clearing any longer previous content. */
export async function replaceValues(spreadsheetId, { tab, rows, clearRows = 500, clearCols = 'J' }) {
  const id = encodeURIComponent(spreadsheetId);
  await apiFetch(`${BASE}/${id}/values/${encodeURIComponent(`${tab}!A2:${clearCols}${clearRows}`)}:clear`, {
    method: 'POST',
    body: {},
    scopes: [SCOPES.sheetsWrite],
  });
  await apiFetch(withQuery(`${BASE}/${id}/values/${encodeURIComponent(`${tab}!A1`)}`, {
    valueInputOption: 'RAW',
  }), {
    method: 'PUT',
    body: { range: `${tab}!A1`, majorDimension: 'ROWS', values: rows },
    scopes: [SCOPES.sheetsWrite],
  });
}

/** Create a tab if it is missing, so first-time saves do not fail. */
export async function ensureTab(spreadsheetId, tab) {
  const { tabs } = await getSheetNames(spreadsheetId);
  if (tabs.includes(tab)) return false;
  await apiFetch(`${BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: { requests: [{ addSheet: { properties: { title: tab } } }] },
    scopes: [SCOPES.sheetsWrite],
  });
  return true;
}

/** Turn a Sheets API failure into something a person can act on. */
export function explainSheetError(error, spreadsheetId) {
  if (!(error instanceof ApiError)) return error.message;
  if (error.status === 404) {
    return `No spreadsheet found with ID “${spreadsheetId}”. Check the ID, or that the file has not been moved to the bin.`;
  }
  if (error.status === 403) {
    return 'Your Google account cannot open that spreadsheet. Ask the owner to share it with you (Viewer is enough).';
  }
  if (error.status === 400) {
    return `The spreadsheet was found but could not be read: ${error.message}`;
  }
  return error.message;
}
