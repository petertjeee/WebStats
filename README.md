# WebStats Plugin for FM-DX-Webserver

Visitor statistics plugin that monitors `serverlog.txt` and provides a dashboard with visitor analytics.

## Project Status / Experiment

This repository is an active experiment in AI-assisted software development.

## Features

- **Automatic log monitoring** — parses new connections from serverlog.txt (configurable interval)
- **Persistent storage** — JSON database survives server restarts and log rotation
- **Configurable data retention** — automatically purges data older than X months
- **Dashboard with statistics per period** (year/month/day):
  - Total visitors per day
  - Unique visitors per day
  - New vs. returning visitors
  - Peak concurrent visitors
  - Top locations (with country flags)
  - Top ISPs
  - Hourly visitor distribution per day (click on a day)
  - Average and maximum session duration
- **Monthly visitors chart** (Chart.js)
- **Visitors by country** — horizontal bar chart with flag emojis
- **Heatmap** — weekday × hour activity heatmap (selectable color scheme)
- **Visitor trends** — day-over-day and week-over-week percentage change
- **Month comparison** — compare current month with previous month (with % change)
- **Export** — download stats as CSV or JSON
- **Backup & restore** — admin can download/upload full data backups
- **IP ignore list** — exclude specific IP addresses from stats (e.g. your own)
- **Peak alerts** — webhook notification when concurrent visitors exceed a threshold
- **Multi-server dashboard** — compare stats across multiple fm-dx-webserver instances
- **Update checker** — checks GitHub for new versions (once per day)
- **Admin mode** — when logged in as admin, see IP addresses, visit counts, and top visitors
- **Lightweight** — no external dependencies, minimal CPU/memory usage (ideal for Raspberry Pi)

## Installation

1. Download or clone this repository
2. Copy `WebStats.js` and the `WebStats/` folder into your fm-dx-webserver plugins directory:
   ```
   fm-dx-webserver/plugins/WebStats.js
   fm-dx-webserver/plugins/WebStats/webstats-plugin.js
   fm-dx-webserver/plugins/WebStats/webstats-config.json
   ```
3. Ensure the plugin files are owned by the user running fm-dx-webserver (on Linux):
   ```
   sudo chown -R $(whoami):$(whoami) WebStats*
   ```
   Replace `$(whoami)` with the actual user that runs the Node.js process if different.
4. Restart the fm-dx-webserver
5. Activate the WebStats plugin in the server settings
6. Reload the browser

## First-time Setup Note

> **Important:** When you first enable the plugin, the `webstats-data.json` file does not exist yet. The plugin processes `serverlog.txt` on a timer (default: every 60 seconds). If you open WebStats immediately after activation, you may see a **404 Not Found** error. This is normal — simply wait up to 10 minutes for the first processing cycle to complete, then refresh the page.

## Configuration

Edit `plugins/WebStats/webstats-config.json` to customize the plugin:

```json
{
    "pollInterval": 60,
    "dataRetentionMonths": 12,
    "adminRetentionDays": 7,
    "adminOnly": false,
    "ignoreIPs": ["192.168.1.100", "10.0.0.1"],
    "peakAlertThreshold": 10,
    "webhookUrl": "https://hooks.slack.com/services/...",
    "updateCheck": true,
    "githubRepo": "YOUR_GITHUB_USERNAME/WebStats",
    "remoteServers": [
        { "name": "Server 2", "url": "https://server2.example.com" },
        { "name": "Server 3", "url": "https://server3.example.com" },
        { "name": "Server 4", "url": "https://server4.example.com" }
    ],
    "debug": false
}
```

> **Important:** This file must be valid JSON. Common mistakes that will break the config (causing `ignoreIPs` and `remoteServers` to be ignored):
> - Missing commas between entries in arrays or objects
> - Trailing commas after the last entry
> - Unquoted keys or values
>
> If the config fails to load, the plugin will log an error message in `serverlog.txt` starting with `[WebStats] ERROR: webstats-config.json contains invalid JSON`. Use a JSON validator (e.g. [jsonlint.com](https://jsonlint.com)) to find the problem.

| Option | Default | Description |
|--------|---------|-------------|
| `pollInterval` | `60` | How often to check the log file for new entries (in seconds) |
| `dataRetentionMonths` | `12` | How many months of data to keep. Set to `0` to keep everything |
| `adminRetentionDays` | `7` | How many days of detailed IP data to keep for admin view |
| `adminOnly` | `false` | When `true`, statistics are only visible to logged-in admins |
| `ignoreIPs` | `[]` | Array of IP addresses to exclude from statistics |
| `peakAlertThreshold` | `0` | Send alert when concurrent visitors reach this number (0 = disabled) |
| `webhookUrl` | `""` | Webhook URL for peak alerts (Slack, Discord, etc.) |
| `updateCheck` | `true` | Check GitHub for plugin updates (once per day) |
| `githubRepo` | `""` | GitHub repository path for update checks (e.g. `user/WebStats`) |
| `remoteServers` | `[]` | Array of `{name, url}` objects for multi-server comparison |
| `debug` | `false` | Enable verbose logging (log poll stats every cycle) |

## Usage

Click the **WEBSTATS** button in the web interface to open the statistics dashboard. Use the year and month selectors to browse historical data.

The dashboard shows:
- **Summary cards** — today's visitors, monthly total, peak concurrent, session duration, all-time total
- **Month comparison** — current month vs. previous month with percentage change
- **Monthly chart** — bar chart comparing visitors and unique visitors per month
- **Heatmap** — weekday × hour grid showing when the server is busiest (with color scheme picker)
- **Visitors by country** — horizontal bar chart with flag emojis, aggregated from location data
- **Visitor trends** — day-over-day and week-over-week change indicators
- **Top locations** — most common visitor locations with country flags
- **Top ISPs** — most common internet service providers
- **Daily breakdown** — table per day showing visitors, unique, new, returning, peak, session, top location
- **Hourly detail** — click any day to see visitors per hour as a bar chart
- **Multi-server comparison** — side-by-side stats from configured remote servers
- **Export buttons** — download all stats as CSV or JSON at any time
- **Admin: IP overview** — today's visitor IPs with location, ISP, and visit count (admin only)
- **Admin: Top visitors** — all-time top IP addresses ranked by total visits (admin only)
- **Admin: Backup/Restore** — download or upload full data backup (admin only)

## Data Storage

Statistics are stored in `plugins/WebStats/webstats-data.json`. This file contains aggregated daily data and is automatically created and updated. 

The file stays small: approximately 100KB per year of data, even with many visitors. Data older than the configured retention period is automatically removed.

Admin data (IP addresses) is stored separately in `webstats-admin.json` and is **not** accessible via the web. It is only served to authenticated admin users via WebSocket.

**Tip:** Back up `webstats-data.json` before updating the plugin to preserve your historical data.

## How It Works

The plugin monitors `serverlog.txt` for lines matching the pattern:
```
[timestamp] [INFO] Web client connected (IP) [N] Location: Place (ISP)
```

It uses timestamp-based deduplication to track which lines have already been processed, so it handles fm-dx-webserver's log truncation (5000 line limit) correctly without double-counting. Localhost connections (127.0.0.1) are ignored.

## Troubleshooting

### Unknown locations showing "Unknown" or missing country flags

If visitor locations show as "Unknown" instead of city/country names, you need to install the **geoip-lite** package for your fm-dx-webserver:

```bash
cd /path/to/fm-dx-webserver
npm install geoip-lite
systemctl restart fm-dx-webserver  # or restart manually
```

The geoip-lite package resolves IP addresses to geographic locations. Without it, the server cannot determine visitor locations, and the WebStats dashboard will show "Unknown" for all entries.

### 404 Not Found on first use

See the [First-time Setup Note](#first-time-setup-note) above.

## Version History

### 2.0.0
- Country flag emojis on locations (top table, daily breakdown, country chart)
- Visitors by country horizontal bar chart
- New vs. returning visitors tracking per day
- Day-over-day and week-over-week visitor trends
- Export stats as CSV or JSON
- IP ignore list (`ignoreIPs` config option)
- Peak concurrent visitor alerts via webhook (`peakAlertThreshold`, `webhookUrl`)
- Heatmap color scheme picker (Theme, Green, Blue, Purple, Orange)
- Admin backup/restore buttons
- Multi-server dashboard (`remoteServers` config option)

### 1.5.1
- Fixed timestamp parsing on US-locale servers (DD/MM/YYYY was misread as MM/DD/YYYY)
- Fixed new log lines being skipped due to minute-resolution timestamp deduplication
- Fixed `adminOnly` mode: config file is now properly symlinked for frontend access
- Added diagnostic logging for log poll cycles

### 1.5.0
- Admin-only mode: set `"adminOnly": true` to restrict stats to logged-in admins only
- When admin-only, stats data is served via authenticated WebSocket (not public HTTP)
- Non-admin users see no button or dashboard

### 1.4.0
- Theme-aware UI: all colors adapt to the active fm-dx-webserver theme
- Automatic re-render when the user switches themes
- Compatible button placement for both new (v2+) and legacy fm-dx-webserver
- English language UI
- Last 10 visitors table in admin overview (IP, location, ISP, connect time)
- Fixed admin detection for IP address panel
- Fixed double-counting: replaced byte-offset tracking with timestamp-based deduplication
- Handles fm-dx-webserver log truncation (5000 line limit) correctly
- Localhost connections (127.0.0.1) are excluded from stats
- Heatmap: improved text readability on bright cells

### 1.3.0
- Session duration tracking: average and max time visitors are connected
- Session stats shown in summary cards, daily breakdown, and month comparison
- Uses connect/disconnect log events to calculate precise session times

### 1.2.0
- Admin mode: IP address overview for today's visitors (admin only)
- Admin mode: all-time top visitors by IP (admin only)
- Admin data stored separately in `webstats-admin.json` (not web-accessible)
- Configurable admin data retention (`adminRetentionDays`)
- Secure: admin data only served via authenticated WebSocket

### 1.1.0
- Configurable settings via `webstats-config.json`
- Data retention with automatic cleanup
- Hourly visitor chart (click on a day)
- Weekday × hour heatmap
- Month-over-month comparison with percentage change
- Update checker (GitHub)
- Version display in header and footer

### 1.0.0
- Initial release
- Log file parsing with offset tracking
- JSON data storage with daily aggregation
- Dashboard with summary cards, monthly chart, top tables, and daily breakdown

## License

GPL-3.0
