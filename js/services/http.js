/**
 * Authorised fetch for the Google REST APIs.
 *
 * Google's JS client library is deliberately not used: it pulls in a large
 * dependency for what amounts to `fetch` with a bearer token, and it makes the
 * error surface harder to reason about.
 */
import { auth, AuthError } from './auth.js';

export class ApiError extends Error {
  constructor(message, { status, reason, url } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.url = url;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} url
 * @param {{method?: string, body?: any, scopes?: string[], retries?: number, signal?: AbortSignal}} [options]
 */
export async function apiFetch(url, options = {}) {
  const { method = 'GET', body, scopes = [], retries = 3, signal } = options;
  let attempt = 0;
  let refreshed = false;

  for (;;) {
    const accessToken = await auth.getAccessToken({ scopes });
    const response = await fetch(url, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.ok) {
      if (response.status === 204) return null;
      return response.json();
    }

    const payload = await response.json().catch(() => ({}));
    const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status;
    const message = payload?.error?.message || response.statusText;

    // A 401 on a token we believed to be valid: drop it and force one silent
    // re-issue, rather than replaying the rejected token.
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      auth.invalidate();
      try {
        await auth.getAccessToken({ scopes });
        continue;
      } catch (error) {
        throw error instanceof AuthError ? error : new ApiError(message, { status: 401, reason, url });
      }
    }

    if (RETRYABLE.has(response.status) && attempt < retries) {
      // Exponential back-off with jitter; Google's rate limits are per-minute.
      await sleep(2 ** attempt * 400 + Math.random() * 250);
      attempt += 1;
      continue;
    }

    throw new ApiError(message, { status: response.status, reason, url });
  }
}

/** Build a URL with search params, skipping empty values. */
export function withQuery(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}
