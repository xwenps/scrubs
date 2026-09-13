/**
 * Google sign-in via Google Identity Services (implicit token flow).
 *
 * Why this flow: Scrubs is a static site with no server, so there is nowhere
 * safe to keep a client secret and nowhere to exchange an authorisation code.
 * GIS issues a short-lived access token directly to the page, which is exactly
 * the right shape for a read-mostly, client-only dashboard.
 *
 * Consequences we handle explicitly:
 *  - tokens last about an hour and there is no refresh token, so we attempt a
 *    silent re-issue (`prompt: ''`) before ever interrupting the user;
 *  - the token is held in sessionStorage so a page refresh does not sign the
 *    user out, and is gone when the tab closes.
 */
import { APP_CONFIG, isDeploymentConfigured } from '../../config/app.config.js';
import { session, KEYS } from '../core/storage.js';
import { createEmitter } from '../core/emitter.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * Google's OAuth scopes are per *resource type*, not per resource: there is no
 * scope that grants access to one named calendar. The narrowest thing a
 * deployment can do is ask for the least capable scope that still works, which
 * is what `calendarAccess` selects.
 *
 *   events  (default)  read events on all calendars — no settings, no ACLs,
 *                      no calendar metadata beyond the subscription list
 *   owned              read events only on calendars this account OWNS; a
 *                      roster calendar shared *with* the user is invisible
 *   full               the original broad read scope; only needed if something
 *                      outside event reading is ever added
 *
 * `calendarPicker` controls the extra scope needed to list calendars for the
 * in-app picker. Turn it off and the calendars must be named in configuration
 * instead — one fewer permission on the consent screen.
 */
export const SCOPES = Object.freeze({
  identity: 'openid email profile',
  calendarEvents: 'https://www.googleapis.com/auth/calendar.events.readonly',
  calendarEventsOwned: 'https://www.googleapis.com/auth/calendar.events.owned.readonly',
  calendarList: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  calendarFull: 'https://www.googleapis.com/auth/calendar.readonly',
  sheetsRead: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  sheetsWrite: 'https://www.googleapis.com/auth/spreadsheets',
});

/** The event-reading scope this deployment is configured to use. */
export const CALENDAR_EVENTS_SCOPE = {
  owned: SCOPES.calendarEventsOwned,
  full: SCOPES.calendarFull,
}[APP_CONFIG.calendarAccess] || SCOPES.calendarEvents;

/**
 * Whether the calendar picker can be offered. `calendar.readonly` already
 * covers listing, so it needs no extra scope; the narrower scopes do.
 */
export const CAN_LIST_CALENDARS = APP_CONFIG.calendarPicker
  || APP_CONFIG.calendarAccess === 'full';

const CALENDAR_SCOPES = [CALENDAR_EVENTS_SCOPE];
if (APP_CONFIG.calendarPicker && APP_CONFIG.calendarAccess !== 'full') {
  CALENDAR_SCOPES.push(SCOPES.calendarList);
}

const BASE_SCOPES = [SCOPES.identity, ...CALENDAR_SCOPES, SCOPES.sheetsRead].join(' ');

/** The exact scope list this deployment will ask for — surfaced on the sign-in screen. */
export const REQUESTED_SCOPES = Object.freeze(BASE_SCOPES.split(' '));

const emitter = createEmitter();
let gisPromise = null;
let tokenClient = null;
let pending = null;
/** @type {{access_token: string, expires_at: number, scope: string} | null} */
let token = null;

function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve(window.google);
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google);
      else reject(new Error('Google Identity Services loaded but did not initialise.'));
    };
    script.onerror = () => reject(new Error('Could not reach Google Identity Services. Check your connection or any content blockers.'));
    document.head.append(script);
  });
  return gisPromise;
}

function settlePending(error, value) {
  if (!pending) return;
  const { resolve, reject } = pending;
  pending = null;
  if (error) reject(error);
  else resolve(value);
}

async function getTokenClient(scope) {
  const google = await loadGis();
  // A token client is bound to its scope string at construction, so a scope
  // upgrade needs a fresh client rather than a different request argument.
  if (!tokenClient || tokenClient.__scope !== scope) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: APP_CONFIG.googleClientId,
      scope,
      callback: (response) => {
        if (response.error) {
          settlePending(new AuthError(response.error_description || response.error, response.error));
          return;
        }
        token = {
          access_token: response.access_token,
          expires_at: Date.now() + (Number(response.expires_in) || 3600) * 1000,
          scope: response.scope || scope,
        };
        session.set(KEYS.token, token);
        emitter.emit('token', token);
        settlePending(null, token);
      },
      error_callback: (error) => {
        const code = error?.type === 'popup_closed' ? 'popup_closed' : (error?.type || 'popup_failed');
        settlePending(new AuthError(describePopupError(code), code));
      },
    });
    tokenClient.__scope = scope;
  }
  return tokenClient;
}

function describePopupError(code) {
  switch (code) {
    case 'popup_closed': return 'Sign-in window was closed before finishing.';
    case 'popup_failed_to_open': return 'The sign-in window was blocked. Allow pop-ups for this site and try again.';
    default: return 'Sign-in could not be completed.';
  }
}

export class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

function isFresh(candidate, skewMs = 60_000) {
  return Boolean(candidate?.access_token) && candidate.expires_at - skewMs > Date.now();
}

export const auth = {
  on: emitter.on,

  /** True when the deployment has been given a real OAuth client ID. */
  isConfigured: isDeploymentConfigured,

  /** Restore a token from this tab's session, if one is still valid. */
  restore() {
    const stored = session.get(KEYS.token);
    token = isFresh(stored) ? stored : null;
    if (!token) session.remove(KEYS.token);
    return token;
  },

  isSignedIn() {
    return isFresh(token);
  },

  /**
   * Drop the current token without signing the user out of Google. Used when
   * the API rejects a token we still believed to be valid, so the next call is
   * forced to request a fresh one instead of replaying the bad one.
   */
  invalidate() {
    token = null;
    session.remove(KEYS.token);
  },

  hasScope(scope) {
    return Boolean(token?.scope?.split(' ').includes(scope));
  },

  /** Preload the GIS script so the first click is instant. */
  warmUp() {
    return loadGis().catch(() => null);
  },

  /**
   * Interactive sign-in.
   * @param {{scopes?: string[], prompt?: '' | 'consent' | 'select_account'}} [options]
   */
  async signIn({ scopes = [], prompt = 'select_account' } = {}) {
    if (!auth.isConfigured()) {
      throw new AuthError('This deployment has no Google client ID configured yet. Set SCRUBS_GOOGLE_CLIENT_ID in .env — see docs/SETUP.md.', 'not_configured');
    }
    const scope = [BASE_SCOPES, ...scopes].join(' ');
    const client = await getTokenClient(scope);
    return new Promise((resolve, reject) => {
      settlePending(new AuthError('Superseded by a newer sign-in request.', 'superseded'));
      pending = { resolve, reject };
      client.requestAccessToken({ prompt });
    }).catch((error) => {
      if (error.code === 'superseded') return null;
      throw error;
    });
  },

  /**
   * Return a usable token, silently re-issuing an expired one when the Google
   * session is still alive. Throws `AuthError('reauth_required')` when the user
   * must act.
   */
  async getAccessToken({ scopes = [] } = {}) {
    const hasAllScopes = scopes.every((scope) => auth.hasScope(scope));

    if (isFresh(token) && hasAllScopes) return token.access_token;

    try {
      const next = await auth.signIn({ scopes, prompt: '' });
      if (next?.access_token) return next.access_token;
    } catch (error) {
      if (error.code === 'popup_closed' || error.code === 'popup_failed_to_open') throw error;
      // Fall through to an explicit re-auth request.
    }
    throw new AuthError('Your Google session expired. Sign in again to continue.', 'reauth_required');
  },

  /** Ask for an additional scope (used for writing rules back to the sheet). */
  async requestScope(scope) {
    if (auth.hasScope(scope)) return true;
    const next = await auth.signIn({ scopes: [scope], prompt: 'consent' });
    return Boolean(next && auth.hasScope(scope));
  },

  async fetchProfile() {
    const accessToken = await auth.getAccessToken();
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return { name: data.name || data.email, email: data.email, picture: data.picture, sub: data.sub };
  },

  async signOut() {
    const current = token?.access_token;
    token = null;
    session.remove(KEYS.token);
    session.remove(KEYS.profile);
    emitter.emit('signed-out');
    if (!current) return;
    try {
      const google = await loadGis();
      google.accounts.oauth2.revoke(current, () => {});
    } catch {
      /* Revocation is best-effort; the local token is already gone. */
    }
  },
};
