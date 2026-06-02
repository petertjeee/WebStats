## Bug Fix

**Fixed missing visitors for dates 1–12 of each month**

When both day and month are ≤ 12 (e.g., June 1st = `01/06/2026`), both DD/MM and MM/DD interpretations appear "valid" to the parser. The previous logic incorrectly preferred MM/DD (US format) in these ambiguous cases, causing visitors from June 1–12 to be recorded as January 6–12 instead.

Changed the heuristic to prefer DD/MM (more common internationally):
- If d2 > 12, use MM/DD (d2 must be the day)
- Otherwise, use DD/MM (the more common format)

## Who Is Affected

Any server using DD/MM/YYYY format (day first) will have been missing visitors from the 1st–12th day of each month. These visitors were incorrectly recorded in the wrong month (e.g., June 1st → January 6th).

## Upgrade Notes

Delete `webstats-data.json` and restart to reprocess the log with the corrected parser. This will restore the missing visitors from dates 1–12 of each month.
