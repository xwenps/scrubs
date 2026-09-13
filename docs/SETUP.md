# Setup

Two things are needed before Scrubs will sign anyone in: a Google OAuth client
ID, and (optionally but recommended) a configuration spreadsheet.

---

## 1. Create an OAuth client ID

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create
   a project (or pick an existing one).
2. **APIs & Services → Library** — enable both:
   - *Google Calendar API*
   - *Google Sheets API*
3. **APIs & Services → OAuth consent screen**
   - User type: **Internal** if everyone using Scrubs is in your Workspace
     organisation, otherwise **External**.
   - Add the scopes Scrubs requests (the default set):
     ```
     openid
     .../auth/userinfo.email
     .../auth/userinfo.profile
     https://www.googleapis.com/auth/calendar.events.readonly
     https://www.googleapis.com/auth/calendar.calendarlist.readonly
     https://www.googleapis.com/auth/spreadsheets.readonly
     https://www.googleapis.com/auth/spreadsheets
     ```
     The last one is only requested when someone presses **Save to sheet**; list
     it so that request does not fail verification later. If you change
     `SCRUBS_CALENDAR_ACCESS` or `SCRUBS_CALENDAR_PICKER` (see *Calendar
     permissions* below), adjust this list to match.
   - On an **External** app in *Testing*, add each user under **Test users**, or
     publish the app.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorised JavaScript origins** — add every origin Scrubs is served from,
     with no path and no trailing slash:
     ```
     http://localhost:8000
     https://your-domain.example
     ```
   - Leave **Authorised redirect URIs** empty. Scrubs uses the token flow, which
     returns to the page that opened it and needs no redirect URI.
5. Copy the client ID (it ends in `.apps.googleusercontent.com`).

> A client ID is **not a secret**. It is safe in a public repository and visible
> in the page source by design — the origin allow-list is what protects it. No
> API key is used anywhere: every request is authorised with the signed-in
> user's own access token.

---

## 2. Point the app at it

Deployment values live in `.env`, never in the source. Copy the example and fill
in the client ID:

```bash
cp .env.example .env
```

```dotenv
SCRUBS_GOOGLE_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com
SCRUBS_DEFAULT_SPREADSHEET_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789
```

`SCRUBS_DEFAULT_SPREADSHEET_ID` may be left empty. Scrubs then starts with
example counters saved in the browser, and any user can attach their own sheet
from the **Configuration source** drawer on the sign-in screen.

`.env.example` documents every variable. All of them are optional except the
client ID.

> **Nothing in `.env` is secret.** Its values are written into
> `config/runtime-config.js`, which is served to every visitor's browser. An
> OAuth *client ID* is designed to be public — the authorised-origins list is
> what protects it. Never put a client secret or an API key there. Scrubs uses
> no API keys: every Google request carries the signed-in user's own token.

### How the values reach the app

```
.env  ──►  scripts/write-runtime-config.sh  ──►  config/runtime-config.js
                  (at container start)                      │
                                                            ▼
                                          config/app.config.js  ──►  the app
```

`config/runtime-config.js` is a plain script loaded before the ES modules, so
`config/app.config.js` can read the values synchronously. It is regenerated
every time the container starts — which is why changing `.env` needs only a
restart, not a rebuild.

Locally, generate it by hand:

```bash
./scripts/generate-config.sh
```

---

## Calendar permissions

**Google has no per-calendar OAuth scope.** Scopes are granted per *resource
type*, so there is no way to authorise access to one named calendar — the
consent screen will always talk about calendars in the plural. The only real
lever is how *capable* the requested scope is, which `SCRUBS_CALENDAR_ACCESS`
controls.

| `SCRUBS_CALENDAR_ACCESS` | Scope requested | Grants | Trade-off |
|---|---|---|---|
| `events` *(default)* | `calendar.events.readonly` | Read events on all calendars | Cannot read calendar settings, sharing rules, or other calendar metadata |
| `owned` | `calendar.events.owned.readonly` | Read events only on calendars this account **owns** | Narrowest — but a roster calendar **shared with** the user is invisible |
| `full` | `calendar.readonly` | The broad "see and download any calendar" scope | Only needed if functionality beyond event reading is added |

`SCRUBS_CALENDAR_PICKER=off` additionally drops
`calendar.calendarlist.readonly`, removing one more line from the consent
screen. The in-app calendar picker then disappears and the calendars to count
must be named in `SCRUBS_DEFAULT_CALENDAR_IDS` or in the `calendarIds` setting
of the config sheet. The dashboard shows which ones are in play instead.

The tightest configuration, for a single owned calendar:

```dotenv
SCRUBS_CALENDAR_ACCESS=owned
SCRUBS_CALENDAR_PICKER=off
SCRUBS_DEFAULT_CALENDAR_IDS=primary
```

Use `events` rather than `owned` if the shift calendar was shared with the
account rather than created by it — `owned` cannot see it at all.

Regardless of the scope granted, Scrubs only ever *reads*, and only from the
calendars selected. But that is the app's own restraint, not a limit the
permission enforces — so pick the narrowest scope that works.

> Scopes are Google's to define and they do change. Check the current list at
> [Google's OAuth scopes reference](https://developers.google.com/identity/protocols/oauth2/scopes#calendar)
> if a scope is rejected at consent.

### The same question for the spreadsheet

`spreadsheets.readonly` is likewise all-spreadsheets. The per-file alternative
is `drive.file`, which grants access only to files the user picks through the
Google Picker — genuinely per-resource, but it requires adding the Picker API
and an API key, and Scrubs does not implement it today.

---

## 3. Create the configuration sheet

Make a new Google Sheet with two tabs, `Settings` and `Rules`, and share it with
everyone who will use this deployment (**Viewer** is enough to read; **Editor**
is needed to use *Save to sheet*).

The sheet ID is the long string in its URL:

```
https://docs.google.com/spreadsheets/d/  1AbCdEfGhIjKlMnOpQrStUvWxYz  /edit
                                         └──────── this part ────────┘
```

[docs/CONFIG-SHEET.md](CONFIG-SHEET.md) documents every key and column. You can
also skip this step entirely: build your counters in the app first, then press
**Save to sheet** — Scrubs creates both tabs with the right headers.

---

## 4. Deploy

### Docker (recommended)

```bash
docker compose up --build -d
```

The container serves on port 8080 (`SCRUBS_PORT` maps the host side) and exposes
`/healthz` for orchestrator health checks. The `dev/` preview harness is not
copied into the image and is additionally blocked by the nginx config.

Reconfiguring an already-built image:

```bash
$EDITOR .env
docker compose restart
```

Running the image directly, without compose:

```bash
docker build -t scrubs .
docker run -d -p 8080:8080 \
  -e SCRUBS_GOOGLE_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com \
  -e SCRUBS_DEFAULT_SPREADSHEET_ID=1AbCdEf... \
  scrubs
```

Remember to add the deployed origin (including the port, if it is not 80/443) to
**Authorised JavaScript origins** in Google Cloud.

### Any other static host

Upload the repository as-is, minus `dev/`, and generate
`config/runtime-config.js` as part of your release step. There is nothing to
build. For GitHub Pages: push to `main`, then *Settings → Pages → Deploy from a
branch → main / (root)*, and commit a `config/runtime-config.js` containing your
client ID (it is public either way).

If you are writing your own nginx config rather than using
[docker/nginx.conf](../docker/nginx.conf), the rules that matter are:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}

# Asset names are not content-hashed, so the browser must revalidate;
# otherwise a deploy can leave users pinned to a stale module.
location ~* \.(?:html|js|css)$ {
    add_header Cache-Control "no-cache, must-revalidate" always;
}

location = /config/runtime-config.js {
    add_header Cache-Control "no-store" always;
}
```

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| *"This deployment is not configured yet"* | `SCRUBS_GOOGLE_CLIENT_ID` is empty. Set it in `.env`, then `docker compose restart` (or re-run `./scripts/generate-config.sh`). |
| Page stuck on *"Scrubs needs to be served over http"* | `index.html` was opened from the filesystem. Serve it over HTTP. |
| Config changes have no effect | The browser cached `config/runtime-config.js`. The shipped nginx config sends `no-store`; check your own config if you replaced it. |
| Sign-in popup closes immediately | The serving origin is not in **Authorised JavaScript origins**. It must match scheme, host *and* port exactly. |
| `Error 403: access_denied` | External consent screen still in *Testing* and the account is not a listed test user. |
| *"Your Google account cannot open that spreadsheet"* | The sheet is not shared with the signed-in account. |
| *"No spreadsheet found with ID …"* | Wrong ID, or the file is in the bin. Paste the whole sheet URL instead — Scrubs extracts the ID. |
| Sign-in works, calendars are empty | The Calendar API is not enabled on the project, or the selected calendar has no events in the chosen range. |
| Nothing loads, console shows a CORS or module error | The site is being opened as `file://`. Serve it over HTTP. |
