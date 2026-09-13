# The configuration sheet

Scrubs reads two tabs from one Google Sheet. Both are optional — a missing tab
falls back to defaults rather than failing — and parsing is deliberately
forgiving, because this is a file people edit by hand.

- Headers are matched ignoring case, spaces and punctuation, so `Match type`,
  `match_type` and `MatchType` are the same column.
- Column **order does not matter**, and extra columns are ignored. Add your own
  notes column if it helps.
- Booleans accept `TRUE/FALSE`, `yes/no`, `y/n`, `1/0`, `on/off`.
- Blank rows are skipped.

---

## Tab: `Settings`

Two columns, `Key` and `Value`. Unknown keys are ignored; missing keys fall back
to `APP_CONFIG.fallbackSettings`, which is itself seeded from the `SCRUBS_*`
environment variables (see [.env.example](../.env.example)).

| Key | Values | Default | What it does |
|---|---|---|---|
| `defaultRange` | a preset id (below) or `custom` | `last12months` | **The default view preference.** Which date range the dashboard opens on. |
| `defaultRangeStart` | `YYYY-MM-DD` | — | Only read when `defaultRange` is `custom`. |
| `defaultRangeEnd` | `YYYY-MM-DD` | — | Only read when `defaultRange` is `custom`. |
| `calendarIds` | comma-separated calendar IDs, or `primary` | `primary` | Which calendars to count by default. Users can change this in the toolbar. |
| `countMode` | `first` or `all` | `first` | `first`: an event is counted once, by the first matching counter (order matters). `all`: counted by every counter it matches. |
| `weekStart` | `monday` or `sunday` | `monday` | Affects weekly buckets, the weekday chart and the heatmap rows. |
| `defaultHoursPerShift` | number | `0` | Hours credited to an **all-day** event. Timed events always use their real duration. |
| `allTimeYearsBack` | number | `5` | How far back the *Everything* preset reaches. |

### Preset ids for `defaultRange`

`last30` · `last90` · `mtd` · `ytd` · `last12months` · `thisYear` · `lastYear` ·
`thisMonth` · `next30` · `next90` · `all` · `custom`

A user's last-used range is remembered in their browser and takes precedence
over `defaultRange` on their next visit. Choosing **Make this my default view**
in the date picker writes `defaultRange` back to this sheet for everybody.

### Example

| Key | Value |
|---|---|
| defaultRange | ytd |
| calendarIds | primary, rota@hospital.example |
| countMode | first |
| weekStart | monday |
| defaultHoursPerShift | 0 |

---

## Tab: `Rules`

One header row, then one row per counter. Rows are evaluated **top to bottom**,
which is what makes `countMode: first` predictable.

| Column | Required | Values | Notes |
|---|---|---|---|
| `Label` | yes | text | The counter's name on the dashboard and in the legend. |
| `Field` | no | `title`, `description`, `location`, `any` | Which part of the event to look at. Default `title`. |
| `Match type` | no | see below | Default `contains`. |
| `Value` | yes | text | What to match. For the "any of" types, separate with commas, pipes or newlines. |
| `Case sensitive` | no | boolean | Default `FALSE`. |
| `Whole word` | no | boolean | Default `FALSE`. `HP6` then will not match `HP60`. |
| `Enabled` | no | boolean | Default `TRUE`. A disabled counter is kept but not counted. |
| `Colour` | no | `1`–`8` | Which categorical colour slot. Reused slots are allowed but harder to read. |
| `ID` | no | text | Stable identity across saves. Generated if blank — leave it alone once written. |

### Match types

| Write this | Also accepted | Matches |
|---|---|---|
| `Is exactly` | `exact`, `equals`, `is` | the whole field equals the value |
| `Contains` | `includes`, `has` | the value appears anywhere |
| `Starts with` | `beginsWith`, `prefix` | the field begins with the value |
| `Ends with` | `suffix` | the field ends with the value |
| `Is any of` | `oneOf`, `in` | the field exactly equals one of the listed values |
| `Contains any of` | `containsAny` | any listed value appears anywhere |
| `Does not contain` | `excludes`, `not` | the value does **not** appear |
| `Matches pattern` | `regex`, `regexp`, `advanced` | the value is used as a regular expression verbatim |

An unrecognised match type is treated as `Contains` and reported as a warning in
the app rather than failing the load.

### Example

| Label | Field | Match type | Value | Case sensitive | Whole word | Enabled | Colour | ID |
|---|---|---|---|---|---|---|---|---|
| HP6 mornings | title | Is exactly | HP6 AM | FALSE | FALSE | TRUE | 1 | r-hp6am |
| HP6 afternoons | title | Is exactly | HP6 PM | FALSE | FALSE | TRUE | 2 | r-hp6pm |
| All HP6 cover | title | Contains | HP6 | FALSE | TRUE | TRUE | 3 | r-hp6all |
| Nights | title | Contains any of | Night, Nocte, 22:00 | FALSE | FALSE | TRUE | 4 | r-nights |
| Anything but leave | title | Does not contain | Leave | FALSE | FALSE | FALSE | 5 | r-notleave |

With `countMode: first`, "All HP6 cover" would never count anything here — the
two exact counters above it claim those events first. Move it above them, or
switch to `countMode: all`, depending on what you want.

---

## Writing back

**Save to sheet** on the *Shift counters* page rewrites both tabs, creating them
if they do not exist. It requests the spreadsheet write scope at that moment —
not at sign-in — so a read-only user is never asked for edit permission.

Anything in the tabs beyond the columns above is cleared on save, so keep notes
on a third tab.
