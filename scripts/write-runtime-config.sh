#!/bin/sh
# Generate config/runtime-config.js from environment variables.
#
# Shared by the Docker entrypoint and by scripts/generate-config.sh, so the file
# a developer gets locally is byte-for-byte the one the container produces.
#
# Usage: write-runtime-config.sh <output-path>
set -eu

OUT="${1:?usage: write-runtime-config.sh <output-path>}"

# Escape backslashes and double quotes so any value is safe inside a JS string.
esc() {
  printf '%s' "${1:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\r\n'
}

cat > "$OUT" <<EOF
/* Generated at $(date -u '+%Y-%m-%dT%H:%M:%SZ') — do not edit. Source: environment / .env */
window.__SCRUBS_CONFIG__ = {
  "googleClientId": "$(esc "${SCRUBS_GOOGLE_CLIENT_ID:-}")",
  "defaultSpreadsheetId": "$(esc "${SCRUBS_DEFAULT_SPREADSHEET_ID:-}")",
  "calendarAccess": "$(esc "${SCRUBS_CALENDAR_ACCESS:-events}")",
  "calendarPicker": "$(esc "${SCRUBS_CALENDAR_PICKER:-on}")",
  "settingsTab": "$(esc "${SCRUBS_SETTINGS_TAB:-Settings}")",
  "rulesTab": "$(esc "${SCRUBS_RULES_TAB:-Rules}")",
  "defaultRange": "$(esc "${SCRUBS_DEFAULT_RANGE:-last12months}")",
  "defaultCalendarIds": "$(esc "${SCRUBS_DEFAULT_CALENDAR_IDS:-primary}")",
  "countMode": "$(esc "${SCRUBS_COUNT_MODE:-first}")",
  "weekStart": "$(esc "${SCRUBS_WEEK_START:-monday}")",
  "defaultHoursPerShift": "$(esc "${SCRUBS_DEFAULT_HOURS_PER_SHIFT:-0}")",
  "allTimeYearsBack": "$(esc "${SCRUBS_ALL_TIME_YEARS_BACK:-5}")"
};
EOF

if [ -z "${SCRUBS_GOOGLE_CLIENT_ID:-}" ]; then
  echo "scrubs: warning — SCRUBS_GOOGLE_CLIENT_ID is not set; sign-in will be disabled." >&2
fi

echo "scrubs: wrote $OUT"
