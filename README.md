# Scrubs

Count the shifts you have worked and are scheduled to work, straight from Google
Calendar.

Scrubs is a **static site** — no backend, no build step, no dependencies. It
signs in with Google in the browser, reads your calendars, matches event titles
against counters you define, and turns the result into a dashboard. The counters
and your preferred date range live in a Google Sheet, so a team can share one
configuration.

| Area | What it does |
|---|---|
| **Counting** | Regular-expression matching under the hood; a plain-language builder on top, so nobody has to write a pattern |
| **Configuration** | A Google Sheet, set per deployment and overridable per user at sign-in |
| **Date ranges** | Presets (last 30 days, YTD, last 12 months, next 90 days…) plus custom, with a default stored in the sheet |
| **Views** | Hero total, KPI tiles, stacked trend, day-of-week and start-time distributions, a calendar heatmap, and a full breakdown table |
| **Themes** | Light, dark, and follow-the-system |

---

## Quick start

> **Serve it — do not double-click `index.html`.** Browsers block JavaScript
> modules on `file://` URLs, and Google sign-in needs a real origin, so opening
> the file directly cannot work. (The page says so rather than hanging.)

### With Docker (how it is meant to be deployed)

```bash
cp .env.example .env       # then fill in SCRUBS_GOOGLE_CLIENT_ID
docker compose up --build
# → http://localhost:8080
```

The image contains no configuration. `.env` is read at **container start** and
written into `config/runtime-config.js`, so the same image can be promoted from
staging to production, and reconfiguring is a restart rather than a rebuild:

```bash
docker compose restart     # after editing .env
```

### Without Docker

```bash
cp .env.example .env       # then fill in SCRUBS_GOOGLE_CLIENT_ID
./scripts/generate-config.sh
python3 -m http.server 8000
# → http://localhost:8000
```

Equivalents for the server: `npx serve`, `php -S localhost:8000`, or the **Live
Server** extension in VS Code. `generate-config.sh` overwrites the committed
placeholder at `config/runtime-config.js`; that local change is expected and
`git checkout config/runtime-config.js` puts it back.

Then follow **[docs/SETUP.md](docs/SETUP.md)** to create the Google OAuth client
ID and the configuration sheet. Until the client ID is set, sign-in is disabled
and the landing page says which variable is missing.

There is no install step and nothing to compile: the browser loads ES modules
directly.

### Working on the UI without a Google account

With the server above running, open:

```
http://localhost:8000/dev/preview.html
```

The preview harness seeds the app with deterministic synthetic data and mounts
each view directly, so charts, empty states and both themes can be developed
without signing in. It is excluded from the production entry point.

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Google Cloud client ID, OAuth scopes, deploying |
| [docs/CONFIG-SHEET.md](docs/CONFIG-SHEET.md) | The sheet format: every key and column |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the code is organised and how to extend it |

---

## Repository layout

```
index.html            App shell. Loads css/main.css and js/main.js, nothing else.

config/
  app.config.js       Merges the environment over the app's own constants.
  runtime-config.js   GENERATED from .env — the only per-environment file.
  runtime-config.template.js
                      The shape the generators produce, documented.

css/
  base/               Tokens, reset, typography — tokens are defined here only.
  layout/             App shell and composition primitives.
  components/         One file per reusable component.
  views/              Styles specific to a single view.
  main.css            Import manifest; defines the cascade order.

js/
  core/               Router, store, DOM helpers, storage, formatting. No app logic.
  services/           Everything that talks to Google: auth, HTTP, Calendar, Sheets.
  domain/             Pure logic: matching, counting, statistics, date ranges.
  ui/
    charts/           Hand-rolled SVG charts.
    components/       Reusable UI pieces.
    views/            One controller per route.
  app-state.js        Orchestration: the only module that wires services to the store.
  boot-guard.js       Classic (non-module) script that explains boot failures.
  main.js             Entry point.

views/                HTML partials, one per route, fetched at runtime.
docker/               nginx config and the container entrypoint.
scripts/              Config generation, shared by Docker and local development.
dev/                  Preview harness and synthetic fixtures. Not served in the image.
```

The three layers do not reach across each other: `domain/` never imports from
`services/` or `ui/`, `services/` never imports from `ui/`, and views never call
Google directly — they go through `app-state.js`. Keeping that direction means
the counting logic can be tested and changed without touching the network code,
and the network code can be swapped without touching the views.

---

## Configuration

Deployment values come from the environment, never from checked-in code:

| Variable | Required | Purpose |
|---|---|---|
| `SCRUBS_GOOGLE_CLIENT_ID` | yes | OAuth 2.0 Web client ID |
| `SCRUBS_DEFAULT_SPREADSHEET_ID` | no | The shared configuration sheet |
| `SCRUBS_CALENDAR_ACCESS` | no | How capable a calendar scope to request: `events` (default), `owned`, `full` |
| `SCRUBS_CALENDAR_PICKER` | no | `off` drops the calendar-listing permission |
| `SCRUBS_SETTINGS_TAB` / `SCRUBS_RULES_TAB` | no | Tab names in that sheet |
| `SCRUBS_DEFAULT_RANGE` | no | Which date range the dashboard opens on |
| `SCRUBS_DEFAULT_CALENDAR_IDS` | no | Calendars counted by default |
| `SCRUBS_COUNT_MODE` / `SCRUBS_WEEK_START` | no | Counting and week-start defaults |
| `SCRUBS_DEFAULT_HOURS_PER_SHIFT` | no | Hours credited to an all-day event |
| `SCRUBS_ALL_TIME_YEARS_BACK` | no | How far back the *Everything* preset reaches |

Full descriptions are in [.env.example](.env.example).

> **These values are public.** They are written into a file served to every
> visitor's browser. `.env` here is a deployment-configuration mechanism, not a
> secret store — never put a client secret or API key in it. An OAuth *client
> ID* is safe to expose by design: it is protected by the authorised-origins
> list in Google Cloud, not by secrecy. Scrubs uses no API keys at all.

Everything that is *not* environment-specific — starter rules, the sheet URL
template, fallback shapes — lives in [config/app.config.js](config/app.config.js)
and is reviewed like any other code.

---

## Privacy

Everything happens in the browser. Scrubs has no server, no analytics, and no
storage outside your own browser and your own Google account:

- the access token lives in `sessionStorage` and is gone when the tab closes;
- the sheet-ID override and your counters are mirrored to `localStorage` so the
  app still works if the sheet is unreachable;
- calendar data is never written anywhere — it is read, counted, and discarded
  on reload.

Scopes requested at sign-in are read-only. The write scope for spreadsheets is
requested separately, and only at the moment you press **Save to sheet**.

Google grants calendar access per *resource type*, not per calendar, so no
configuration can limit consent to a single calendar. Scrubs asks for the
narrowest scope that works — `calendar.events.readonly`, not the broad
`calendar.readonly` — and `SCRUBS_CALENDAR_ACCESS` can narrow it further. See
[docs/SETUP.md](docs/SETUP.md#calendar-permissions).

---

## Browser support

Modern evergreen browsers. Scrubs uses ES modules, `ResizeObserver`,
`Intl.DateTimeFormat`, CSS custom properties, `color-mix()` and container-free
responsive layout. No polyfills are shipped.
