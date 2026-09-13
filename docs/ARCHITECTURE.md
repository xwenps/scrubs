# Architecture

Written for anyone picking this codebase up to change or extend it.

## Principles

1. **No build step.** The browser loads ES modules as written. What is in the
   repository is what runs, which makes debugging and reviewing the same
   activity. The cost is that dependencies must be vendored; so far there are
   none.
2. **One direction of dependency.** `domain/` → nothing. `services/` →
   `core/` only. `ui/` → anything below it. `app-state.js` is the single seam
   where services meet the store. Nothing imports "upwards".
3. **Tokens are declared once.** Every colour, space, radius and duration lives
   in `css/base/tokens.css`. No other stylesheet defines one.
4. **Colour comes from the data's job.** Counters get categorical slots assigned
   in a fixed order and never cycled; magnitude (the heatmap) uses one
   sequential hue; the brand accent is never used as a data colour, so it cannot
   be mistaken for a series.

## Configuration boundary

Deployment values never appear in source. `config/runtime-config.js` is
generated from the environment at container start and loaded as a *classic*
script, so it has set `window.__SCRUBS_CONFIG__` by the time any module runs.
`config/app.config.js` merges those values over the application's own constants
and is the single import every other module uses.

The practical consequence: one image, promoted between environments, configured
by restart rather than rebuild. The cost: the values are public, because they
are served to the browser — so the boundary is "per-environment", not "secret".

`js/boot-guard.js` is the other non-module file. It exists because the failure
it reports — ES modules blocked on `file://` — is precisely the case where a
module cannot run to report it.

## The layers

### `js/core/`

Framework-shaped utilities with no knowledge of shifts, calendars or Google.

| Module | Responsibility |
|---|---|
| `router.js` | Hash routing with a guard and per-route teardown. Hash, not History API, so any static host works with no rewrite rules. |
| `store.js` | A single shallow object plus `patch`/`subscribe`. Subscribers can name the keys they care about. |
| `dom.js` | `el()`, `qs()`, dismiss handling, and the view-template loader. |
| `storage.js` | Namespaced `localStorage`/`sessionStorage` that never throws. |
| `format.js` | All `Intl` formatting, in one place so dates read consistently. |
| `emitter.js` | Minimal pub/sub. |

### `js/domain/`

Pure functions. No DOM, no network, no globals — this is the part worth testing
first if tests are ever added.

| Module | Responsibility |
|---|---|
| `matcher.js` | Rule → `RegExp`. Owns the match-type catalogue and the plain-English descriptions. |
| `counter.js` | Events + rules → per-counter totals, past/future split, unmatched titles. |
| `stats.js` | Time buckets, weekday and start-hour distributions, per-day counts, summary statistics. |
| `date-range.js` | Preset catalogue and local-time date arithmetic. |

### `js/services/`

Everything that touches Google.

| Module | Responsibility |
|---|---|
| `auth.js` | Google Identity Services token flow, silent re-issue, incremental scopes. |
| `http.js` | Authorised `fetch` with retry, back-off, and one forced token refresh on 401. |
| `calendar.js` | Calendar list and paged event fetch, normalised into a flat event shape. |
| `sheets.js` | Values read/write, tab creation, and human-readable error explanations. |
| `config-service.js` | The sheet ⇄ config mapping, in both directions. |

### `js/ui/`

`charts/` draw SVG, `components/` are reusable pieces, `views/` are one
controller per route. A view receives its mount node, returns a teardown
function, and subscribes to the store for updates.

## Data flow

```
     Google  ──►  services/  ──►  app-state.js  ──►  store
                                                       │
                                    ui/views ◄─────────┘  (subscribe)
                                        │
                                        ▼
                          domain/  (counting & statistics)
```

A view never calls a service. It calls `app-state.js`, which owns the
error handling, the abort controllers and the ordering, and writes the result to
the store. Everything then re-renders from state.

## Adding things

**A new match type** — add an entry to `MATCH_TYPES` in `js/domain/matcher.js`
with a `label`, a worked `example` and a `build(value)` that returns a regex
source. It appears in the editor grid, in `describeRule()` and in the sheet
parser's alias table automatically. Add spellings people might type to
`MATCH_ALIASES` in `config-service.js`.

**A new date preset** — add it to `RANGE_PRESETS` in `js/domain/date-range.js`
with a `group` from `PRESET_GROUPS`. The picker and the sheet validation pick it
up with no further changes.

**A new chart** — add a module under `js/ui/charts/` that takes a container and
data, uses `mountResponsive()` from `svg.js` so it redraws on resize, and paints
marks via `paint(node, 'var(--series-N)')` rather than resolved hex. Painting
through a custom property is what makes charts repaint on a theme switch without
re-rendering.

**A new statistic** — put the computation in `js/domain/stats.js` and render it
as a stat tile in `dashboard-view.js`. Keep the arithmetic out of the view.

**A new view** — add `views/<name>.html`, a controller in `js/ui/views/`, a
`router.add(...)` line in `main.js`, and a nav link in `index.html`.

**A new deployment variable** — add it to `.env.example`, emit it in
`scripts/write-runtime-config.sh`, and read it through `value()` in
`config/app.config.js`. Nothing else needs to know where it came from.

## Deliberate constraints

- **Rule ordering uses arrow buttons, not drag-and-drop.** Order is meaningful
  in `first` counting mode, so reordering has to work on touch, with a keyboard,
  and with a screen reader.
- **Charts cap at eight categorical series.** Past that the tail folds into a
  neutral "Other". Generating a ninth hue would produce a colour indistinguishable
  from an existing one for colour-blind readers.
- **The whole dashboard body re-renders on change.** Diffing would cost more
  complexity than it saves; the charts are small and the data is already in
  memory.
- **The access token lives in `sessionStorage`, not `localStorage`.** A refresh
  keeps you signed in; closing the tab does not.

## Known limits

- Implicit-flow tokens last about an hour and cannot be refreshed silently
  forever. Scrubs attempts a silent re-issue and otherwise prompts.
- The *Everything* preset is bounded (`allTimeYearsBack`, default 5 years back
  and 12 months forward) because the Calendar API requires a window.
- The calendar heatmap renders at most the most recent 53 weeks of a range, and
  says so in its caption.
- All-day events contribute `defaultHoursPerShift` hours (0 by default), since
  a calendar cannot tell you how long an all-day shift actually was.
