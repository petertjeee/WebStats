# WebStats Plugin for FM-DX-Webserver

Visitor statistics plugin that monitors `serverlog.txt` and provides a dashboard with visitor analytics.

## Features

- **Automatic log monitoring** — parses new connections from serverlog.txt (configurable interval)
- **Persistent storage** — JSON database survives server restarts and log rotation
- **Configurable data retention** — automatically purges data older than X months
- **Dashboard with statistics per period** (year/month/day):
  - Total visitors per day
  - Unique visitors per day  
  - Peak concurrent visitors
  - Top locations
  - Top ISPs
  - Hourly visitor distribution per day (click on a day)
  - Average and maximum session duration
- **Monthly visitors chart** (Chart.js)
- **Heatmap** — weekday × hour activity heatmap
- **Month comparison** — compare current month with previous month (with % change)
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
3. Restart the fm-dx-webserver
4. Activate the WebStats plugin in the server settings
5. Reload the browser

## Configuration

Edit `plugins/WebStats/webstats-config.json` to customize the plugin:

```json
{
    "pollInterval": 60,
    "dataRetentionMonths": 12,
    "adminRetentionDays": 7,
    "updateCheck": true,
    "githubRepo": "YOUR_GITHUB_USERNAME/WebStats"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `pollInterval` | `60` | How often to check the log file for new entries (in seconds) |
| `dataRetentionMonths` | `12` | How many months of data to keep. Set to `0` to keep everything |
| `adminRetentionDays` | `7` | How many days of detailed IP data to keep for admin view |
| `updateCheck` | `true` | Check GitHub for plugin updates (once per day) |
| `githubRepo` | `""` | GitHub repository path for update checks (e.g. `user/WebStats`) |

## Usage

Click the **WEBSTATS** button in the web interface to open the statistics dashboard. Use the year and month selectors to browse historical data.

The dashboard shows:
- **Summary cards** — today's visitors, monthly total, peak concurrent, all-time total
- **Month comparison** — current month vs. previous month with percentage change
- **Monthly chart** — bar chart comparing visitors and unique visitors per month
- **Heatmap** — weekday × hour grid showing when the server is busiest
- **Top locations** — most common visitor locations
- **Top ISPs** — most common internet service providers
- **Daily breakdown** — detailed table per day with highlights for peak values
- **Hourly detail** — click any day to see visitors per hour as a bar chart
- **Session duration** — average and maximum time visitors stay connected, per day and month
- **Admin: IP overview** — today's visitor IPs with location, ISP, and visit count (admin only)
- **Admin: Top visitors** — all-time top IP addresses ranked by total visits (admin only)

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

It tracks the file read position (byte offset) and only processes new lines on each poll cycle. Log rotation is automatically detected when the file size decreases.

## Version History

### 1.4.0
- Theme-aware UI: all colors adapt to the active fm-dx-webserver theme
- Automatic re-render when the user switches themes
- Compatible button placement for both new (v2+) and legacy fm-dx-webserver
- English language UI
- Last 10 visitors table in admin overview (IP, location, ISP, connect time)

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
