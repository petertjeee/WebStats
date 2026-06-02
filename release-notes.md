## Bug Fix

**Fixed "Cannot read properties of undefined (reading 'trim')" error**

When a log line has no ISP (e.g. `Location: Minsk, HM, BY` without parentheses), the regex capture group for ISP is `undefined`. Calling `.trim()` on undefined caused this error.

Changed:
```javascript
const ispName = isp.trim();
```
to:
```javascript
const ispName = isp ? isp.trim() : 'Unknown';
```

Visitors from lines without an ISP are now correctly recorded with ISP "Unknown".

## Upgrade Notes

If you saw this error after updating to v2.1.2, delete `webstats-data.json` and restart to ensure all valid visitor data is reprocessed correctly.
