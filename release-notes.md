## What's New in v2.2.0

### Robust date format detection

This release overhauls how timestamps are parsed to fix visitors going missing or being recorded on the wrong date, especially around the 1st–12th of each month.

fm-dx-webserver writes log timestamps using the operating system's locale (via `toLocaleDateString()`), so the day/month order varies per server (DD/MM, MM/DD, or YYYY-MM-DD). A single line like `01/06/2026` is ambiguous on its own.

WebStats now resolves this deterministically:

- **OS locale detection** — since the plugin runs on the same machine as fm-dx-webserver, it asks the OS directly which date order it uses (`Intl.DateTimeFormat`), matching exactly how the log was written. This works for all locales, not a fixed list.
- **Content-based override** — if the log contains an unambiguous line (a day greater than 12), the actual data overrides the OS guess. This protects against logs copied from a machine with a different locale.

### Bug Fixes

- Fixed visitors from days 1–12 of a month being misparsed into the wrong month (e.g. June 1st recorded as January 6th, or silently skipped entirely).
- ISO timestamps (`YYYY-MM-DD HH:MM`) now tolerate single-digit month/day and are range-validated.

### Other

- Debug log now reports the detected date format (`dateFormat=DMY`).

## Upgrade Notes

If you have noticed missing visitors or visitors on the wrong dates, delete `webstats-data.json` and restart the server to reprocess the log with the corrected parser.
