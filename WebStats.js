///////////////////////////////////////////////////////////////
///                                                         ///
///  WEBSTATS PLUGIN FOR FM-DX-WEBSERVER (V2.0.0)          ///
///                                                         ///
///  Visitor statistics from serverlog.txt                   ///
///                                                         ///
///////////////////////////////////////////////////////////////

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Plugin configuration
var pluginConfig = {
    name: 'WebStats',
    version: '2.0.0',
    author: 'Peter',
    frontEndPath: 'WebStats/webstats-plugin.js'
};

// --- Paths ---
const PLUGIN_DIR = path.join(__dirname, 'WebStats');
const DATA_FILE = path.join(PLUGIN_DIR, 'webstats-data.json');
const CONFIG_FILE = path.join(PLUGIN_DIR, 'webstats-config.json');
const ADMIN_DATA_FILE = path.join(PLUGIN_DIR, 'webstats-admin.json');
const LOG_FILE = path.resolve(__dirname, '..',
    process.argv.includes('--config') && process.argv[process.argv.indexOf('--config') + 1]
        ? `serverlog_${process.argv[process.argv.indexOf('--config') + 1]}.txt`
        : 'serverlog.txt'
);

// --- Configuration (defaults, overridden by webstats-config.json) ---
let config = {
    pollInterval: 60,
    dataRetentionMonths: 12,
    updateCheck: true,
    githubRepo: '',
    adminRetentionDays: 7,
    adminOnly: false,
    ignoreIPs: [],
    peakAlertThreshold: 0,
    webhookUrl: ''
};

// --- Load configuration ---
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            const userConfig = JSON.parse(raw);
            Object.assign(config, userConfig);
            // Normalize ignoreIPs: accept string or comma-separated string
            if (config.ignoreIPs && !Array.isArray(config.ignoreIPs)) {
                config.ignoreIPs = String(config.ignoreIPs).split(',').map(s => s.trim()).filter(Boolean);
            }
            logMsg('Config loaded: poll=' + config.pollInterval + 's, retention=' + config.dataRetentionMonths + ' months' +
                (config.ignoreIPs.length ? ', ignoring ' + config.ignoreIPs.length + ' IP(s)' : ''));
        } else {
            logMsg('No webstats-config.json found, using defaults');
        }
    } catch (err) {
        logMsg('Error loading config: ' + err.message);
    }
}

// --- Regex to match connection log lines ---
// [timestamp] [INFO] Web client connected (IP) [N] Location: Place (ISP)
const CONNECTION_REGEX = /^\[([^\]]+)\]\s+\[INFO\]\s+Web client connected \(([^)]+)\)\s+\[(\d+)\]\s+Location:\s+(.+?)\s+\(([^)]+)\)\s*$/;

// --- Regex to match disconnection log lines ---
// [timestamp] [INFO] Web client disconnected (IP) [N]
const DISCONNECT_REGEX = /^\[([^\]]+)\]\s+\[INFO\]\s+Web client disconnected \(([^)]+)\)\s+\[(\d+)\]/;

// --- Stats data ---
let statsData = {
    days: {},
    _current_day: null,
    _current_day_ips: [],
    _last_timestamp: 0,
    _processed_hashes: [],
    _known_ips: []
};

// --- Admin data (IP details, NOT web-accessible) ---
let adminData = {
    recent_ips: {},
    top_ips: {},
    last_visitors: []
};

// --- Active sessions (in-memory, for session duration tracking) ---
const activeSessions = {};

// --- Logging helper ---
function logMsg(msg) {
    console.log(`[WebStats] ${msg}`);
}

// --- Load existing data from JSON ---
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            statsData = JSON.parse(raw);
            if (!statsData.days) statsData.days = {};
            if (!statsData._current_day_ips) statsData._current_day_ips = [];
            // Ensure hourly_visits arrays and session fields exist
            Object.keys(statsData.days).forEach(key => {
                const day = statsData.days[key];
                if (!day.hourly_visits || !Array.isArray(day.hourly_visits)) {
                    day.hourly_visits = new Array(24).fill(0);
                }
                if (typeof day.session_count === 'undefined') day.session_count = 0;
                if (typeof day.total_session_seconds === 'undefined') day.total_session_seconds = 0;
                if (typeof day.max_session_seconds === 'undefined') day.max_session_seconds = 0;
            });
            logMsg('Loaded existing data with ' + Object.keys(statsData.days).length + ' days of history');
        }
    } catch (err) {
        logMsg('Error loading data file, starting fresh: ' + err.message);
        statsData = { days: {}, _current_day: null, _current_day_ips: [], _last_timestamp: 0, _processed_hashes: [], _known_ips: [] };
    }
}

// --- Load admin data ---
function loadAdminData() {
    try {
        if (fs.existsSync(ADMIN_DATA_FILE)) {
            const raw = fs.readFileSync(ADMIN_DATA_FILE, 'utf8');
            adminData = JSON.parse(raw);
            if (!adminData.recent_ips) adminData.recent_ips = {};
            if (!adminData.top_ips) adminData.top_ips = {};
            if (!Array.isArray(adminData.last_visitors)) adminData.last_visitors = [];
            logMsg('Loaded admin data with ' + Object.keys(adminData.top_ips).length + ' tracked IPs');
        }
    } catch (err) {
        logMsg('Error loading admin data, starting fresh: ' + err.message);
        adminData = { recent_ips: {}, top_ips: {}, last_visitors: [] };
    }
}

// --- Save admin data ---
function saveAdminData() {
    try {
        fs.writeFileSync(ADMIN_DATA_FILE, JSON.stringify(adminData, null, 2), 'utf8');
    } catch (err) {
        logMsg('Error saving admin data: ' + err.message);
    }
}

// --- Record IP visit for admin view ---
function recordAdminVisit(dateKey, ip, location, isp, hour, minute) {
    // Recent IPs per day
    if (!adminData.recent_ips[dateKey]) adminData.recent_ips[dateKey] = {};
    const dayIps = adminData.recent_ips[dateKey];
    if (!dayIps[ip]) dayIps[ip] = { count: 0, location: location, isp: isp, last_seen: '' };
    dayIps[ip].count++;
    dayIps[ip].last_seen = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    dayIps[ip].location = location;
    dayIps[ip].isp = isp;

    // Top IPs all-time
    if (!adminData.top_ips[ip]) adminData.top_ips[ip] = { total: 0, last_seen: dateKey, location: location, isp: isp };
    adminData.top_ips[ip].total++;
    adminData.top_ips[ip].last_seen = dateKey;
    adminData.top_ips[ip].location = location;
    adminData.top_ips[ip].isp = isp;

    // Last 10 visitors (most recent first)
    adminData.last_visitors.unshift({
        ip: ip,
        location: location,
        isp: isp,
        time: `${dateKey} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    });
    if (adminData.last_visitors.length > 10) adminData.last_visitors.length = 10;
}

// --- Save data to JSON ---
function saveData() {
    try {
        if (!fs.existsSync(PLUGIN_DIR)) {
            fs.mkdirSync(PLUGIN_DIR, { recursive: true });
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(statsData, null, 2), 'utf8');
        if (!config.adminOnly) {
            ensureWebAccessible();
        }
    } catch (err) {
        logMsg('Error saving data: ' + err.message);
    }
}

// --- Make data file accessible via HTTP on Linux ---
function ensureWebAccessible() {
    if (process.platform !== 'win32') {
        const webDir = path.join(__dirname, '..', 'web', 'js', 'plugins', 'WebStats');
        const webDataFile = path.join(webDir, 'webstats-data.json');
        try {
            if (!fs.existsSync(webDir)) {
                fs.mkdirSync(webDir, { recursive: true });
            }
            if (fs.existsSync(webDataFile)) {
                const stat = fs.lstatSync(webDataFile);
                if (stat.isSymbolicLink() || stat.isFile()) {
                    fs.unlinkSync(webDataFile);
                }
            }
            fs.symlinkSync(DATA_FILE, webDataFile);
        } catch (e) {
            try {
                fs.copyFileSync(DATA_FILE, webDataFile);
            } catch (e2) {
                // Silent fail - data might still be accessible via junction on Windows
            }
        }
    }
}

// --- Make config file accessible via HTTP ---
function ensureConfigAccessible() {
    if (process.platform !== 'win32') {
        const webDir = path.join(__dirname, '..', 'web', 'js', 'plugins', 'WebStats');
        const webConfigFile = path.join(webDir, 'webstats-config.json');
        try {
            if (!fs.existsSync(webDir)) {
                fs.mkdirSync(webDir, { recursive: true });
            }
            if (fs.existsSync(webConfigFile)) {
                const stat = fs.lstatSync(webConfigFile);
                if (stat.isSymbolicLink() || stat.isFile()) {
                    fs.unlinkSync(webConfigFile);
                }
            }
            fs.symlinkSync(CONFIG_FILE, webConfigFile);
        } catch (e) {
            try {
                fs.copyFileSync(CONFIG_FILE, webConfigFile);
            } catch (e2) {}
        }
    }
}

// --- Remove public data file when adminOnly is enabled ---
function removeWebAccessible() {
    const webDir = path.join(__dirname, '..', 'web', 'js', 'plugins', 'WebStats');
    const webDataFile = path.join(webDir, 'webstats-data.json');
    try {
        if (fs.existsSync(webDataFile)) {
            const stat = fs.lstatSync(webDataFile);
            if (stat.isSymbolicLink() || stat.isFile()) {
                fs.unlinkSync(webDataFile);
                logMsg('Removed public data file (adminOnly mode)');
            }
        }
    } catch (e) {
        // Ignore errors
    }
}

// --- Parse timestamp from log line ---
// fm-dx-webserver always uses DD/MM/YYYY HH:MM format (from toLocaleDateString + toLocaleTimeString)
function parseTimestamp(tsString) {
    const match = tsString.match(/(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})\s+(\d{1,2}):(\d{2})/);
    if (match) {
        const [, day, month, year, hour, minute] = match;
        const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
        if (!isNaN(d.getTime())) return d;
    }

    return new Date();
}

// --- Format date as YYYY-MM-DD ---
function getDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- Ensure a day entry exists ---
function ensureDayEntry(dateKey) {
    if (!statsData.days[dateKey]) {
        statsData.days[dateKey] = {
            total_visits: 0,
            unique_visitors: 0,
            peak_concurrent: 0,
            locations: {},
            isps: {},
            hourly_visits: new Array(24).fill(0),
            session_count: 0,
            total_session_seconds: 0,
            max_session_seconds: 0
        };
    }
    return statsData.days[dateKey];
}

// --- Process a single log line ---
function processLine(line) {
    const match = line.match(CONNECTION_REGEX);
    if (!match) return false;

    const [, timestamp, ip, concurrent, location, isp] = match;

    // Ignore localhost connections
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return false;

    // Ignore user-configured IPs
    if (Array.isArray(config.ignoreIPs) && config.ignoreIPs.length > 0) {
        if (config.ignoreIPs.includes(ip)) return false;
    }

    const date = parseTimestamp(timestamp);
    const dateKey = getDateKey(date);
    const hour = date.getHours();

    // Handle day rollover
    if (statsData._current_day && statsData._current_day !== dateKey) {
        const prevDay = statsData.days[statsData._current_day];
        if (prevDay) {
            prevDay.unique_visitors = (statsData._current_day_ips || []).length;
        }
        statsData._current_day_ips = [];
    }
    statsData._current_day = dateKey;

    const day = ensureDayEntry(dateKey);

    // Total visits
    day.total_visits++;

    // Hourly visits
    if (hour >= 0 && hour < 24) {
        day.hourly_visits[hour]++;
    }

    // Peak concurrent
    const concurrentNum = parseInt(concurrent);
    if (concurrentNum > day.peak_concurrent) {
        day.peak_concurrent = concurrentNum;
    }

    // Unique visitors
    if (!statsData._current_day_ips) statsData._current_day_ips = [];
    const isFirstVisitToday = !statsData._current_day_ips.includes(ip);
    if (isFirstVisitToday) {
        statsData._current_day_ips.push(ip);
    }
    day.unique_visitors = statsData._current_day_ips.length;

    // Returning vs new visitors (only count once per day per unique IP)
    if (!statsData._known_ips) statsData._known_ips = [];
    if (!day.new_visitors) day.new_visitors = 0;
    if (!day.returning_visitors) day.returning_visitors = 0;
    if (isFirstVisitToday) {
        if (!statsData._known_ips.includes(ip)) {
            statsData._known_ips.push(ip);
            day.new_visitors++;
        } else {
            day.returning_visitors++;
        }
    }

    // Location
    const loc = location.trim();
    day.locations[loc] = (day.locations[loc] || 0) + 1;

    // ISP
    const ispName = isp.trim();
    day.isps[ispName] = (day.isps[ispName] || 0) + 1;

    // Peak concurrent alert
    const concurrentNum2 = parseInt(concurrent);
    if (config.peakAlertThreshold > 0 && concurrentNum2 >= config.peakAlertThreshold) {
        triggerPeakAlert(concurrentNum2, dateKey, hour);
    }

    // Admin: record IP details
    recordAdminVisit(dateKey, ip, loc, ispName, hour, date.getMinutes());

    // Track active session for duration calculation
    if (!activeSessions[ip]) activeSessions[ip] = [];
    activeSessions[ip].push({ connectTime: date, dateKey: dateKey });

    return true;
}

// --- Process a disconnect log line ---
function processDisconnectLine(line) {
    const match = line.match(DISCONNECT_REGEX);
    if (!match) return false;

    const [, timestamp, ip] = match;
    const disconnectTime = parseTimestamp(timestamp);

    // Find matching connect for this IP (FIFO)
    if (!activeSessions[ip] || activeSessions[ip].length === 0) return false;

    const session = activeSessions[ip].shift();
    const durationMs = disconnectTime.getTime() - session.connectTime.getTime();
    const durationSeconds = Math.max(0, Math.round(durationMs / 1000));

    // Sanity check: skip negative or unreasonably long sessions (>24h)
    if (durationSeconds <= 0 || durationSeconds > 86400) {
        if (activeSessions[ip].length === 0) delete activeSessions[ip];
        return false;
    }

    // Update the connect day's session stats
    const day = ensureDayEntry(session.dateKey);
    day.session_count = (day.session_count || 0) + 1;
    day.total_session_seconds = (day.total_session_seconds || 0) + durationSeconds;
    if (durationSeconds > (day.max_session_seconds || 0)) {
        day.max_session_seconds = durationSeconds;
    }

    // Clean up empty arrays
    if (activeSessions[ip].length === 0) delete activeSessions[ip];

    return true;
}

// --- Peak alert webhook ---
let lastAlertTime = 0;
function triggerPeakAlert(concurrent, dateKey, hour) {
    const now = Date.now();
    // Don't spam: max one alert per 5 minutes
    if (now - lastAlertTime < 300000) return;
    lastAlertTime = now;

    logMsg('Peak alert! ' + concurrent + ' concurrent visitors at ' + dateKey + ' ' + String(hour).padStart(2, '0') + ':00');

    if (config.webhookUrl) {
        const payload = JSON.stringify({
            text: `[WebStats] Peak alert: ${concurrent} concurrent visitors (${dateKey} ${String(hour).padStart(2, '0')}:00)`,
            concurrent: concurrent,
            date: dateKey,
            hour: hour
        });

        const url = new URL(config.webhookUrl);
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        };

        const lib = url.protocol === 'https:' ? require('https') : require('http');
        const req = lib.request(options, () => {});
        req.on('error', (e) => logMsg('Webhook error: ' + e.message));
        req.write(payload);
        req.end();
    }
}

// --- Fetch a URL (for remote server data) ---
function fetchUrl(url, callback, redirects) {
    if (!redirects) redirects = 0;
    if (redirects > 3) return callback(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { timeout: 5000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return fetchUrl(res.headers.location, callback, redirects + 1);
        }
        if (res.statusCode !== 200) {
            res.resume();
            return callback(new Error('HTTP ' + res.statusCode));
        }
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => callback(null, body));
    }).on('error', callback);
}

// --- Read and process new lines from the log file ---
// Note: fm-dx-webserver truncates serverlog.txt to 5000 lines every 60s,
// rewriting the entire file. Byte offsets are unreliable, so we use
// timestamp-based deduplication: only process lines newer than _last_timestamp.
function processLogFile() {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            logMsg('Log file not found: ' + LOG_FILE);
            return;
        }

        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = content.split('\n');
        // _last_timestamp is stored as epoch ms for reliable comparison
        const lastEpoch = statsData._last_timestamp || 0;
        let latestEpoch = lastEpoch;
        let processed = 0;
        let skipped = 0;
        let totalLines = 0;

        // To handle minute-resolution timestamps, we track which lines at the
        // exact lastEpoch minute were already processed using a line hash set.
        // Lines with the same timestamp are deduplicated by their full content.
        const processedHashes = statsData._processed_hashes || [];

        lines.forEach(line => {
            line = line.trim();
            if (!line) return;

            // Extract timestamp from log line to check if we already processed it
            const tsMatch = line.match(/^\[([^\]]+)\]/);
            if (!tsMatch) return;

            totalLines++;
            const lineDate = parseTimestamp(tsMatch[1]);
            const lineEpoch = lineDate.getTime();

            // Skip lines older than the last processed timestamp
            if (lineEpoch < lastEpoch) {
                skipped++;
                return;
            }

            // For lines at the exact same timestamp, check if already processed
            if (lineEpoch === lastEpoch) {
                const lineHash = line.substring(0, 120);
                if (processedHashes.includes(lineHash)) {
                    skipped++;
                    return;
                }
            }

            if (processLine(line)) {
                processed++;
                if (lineEpoch > latestEpoch) latestEpoch = lineEpoch;
            } else if (processDisconnectLine(line)) {
                processed++;
                if (lineEpoch > latestEpoch) latestEpoch = lineEpoch;
            }
        });

        // Build hash set for lines at the latest timestamp (for next cycle dedup)
        if (latestEpoch !== lastEpoch || processed > 0) {
            const newHashes = [];
            lines.forEach(line => {
                line = line.trim();
                if (!line) return;
                const tsMatch = line.match(/^\[([^\]]+)\]/);
                if (!tsMatch) return;
                const d = parseTimestamp(tsMatch[1]);
                if (d.getTime() === latestEpoch) {
                    newHashes.push(line.substring(0, 120));
                }
            });
            statsData._processed_hashes = newHashes;
            statsData._last_timestamp = latestEpoch;
        }

        logMsg('Log poll: ' + totalLines + ' lines, ' + skipped + ' skipped, ' + processed + ' new, lastTs=' + (lastEpoch ? new Date(lastEpoch).toISOString() : 'none'));

        if (processed > 0) {
            saveData();
            saveAdminData();
        }
    } catch (err) {
        logMsg('Error processing log file: ' + err.message);
    }
}

// --- Data retention: purge old entries ---
function purgeOldData() {
    if (!config.dataRetentionMonths || config.dataRetentionMonths <= 0) return;

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - config.dataRetentionMonths);
    const cutoffKey = getDateKey(cutoff);
    let purged = 0;

    Object.keys(statsData.days).forEach(key => {
        if (key < cutoffKey) {
            delete statsData.days[key];
            purged++;
        }
    });

    if (purged > 0) {
        logMsg('Purged ' + purged + ' day(s) older than ' + config.dataRetentionMonths + ' months');
        saveData();
    }
}

// --- Admin data retention: purge old IP records ---
function purgeAdminData() {
    const retentionDays = config.adminRetentionDays || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffKey = getDateKey(cutoff);
    let purged = 0;

    Object.keys(adminData.recent_ips).forEach(key => {
        if (key < cutoffKey) {
            delete adminData.recent_ips[key];
            purged++;
        }
    });

    // Trim top_ips to 200 entries
    const topEntries = Object.entries(adminData.top_ips)
        .sort((a, b) => b[1].total - a[1].total);
    if (topEntries.length > 200) {
        adminData.top_ips = Object.fromEntries(topEntries.slice(0, 200));
        purged += topEntries.length - 200;
    }

    if (purged > 0) {
        saveAdminData();
        logMsg('Purged ' + purged + ' admin data entries');
    }
}

// --- WebSocket handler for admin data requests ---
function initWebSocket() {
    try {
        const pluginsApi = require(path.join(__dirname, '..', 'server', 'plugins_api'));
        const pluginsWss = pluginsApi.getPluginsWss();
        if (!pluginsWss) {
            setTimeout(initWebSocket, 2000);
            return;
        }

        pluginsWss.on('connection', (ws, request) => {
            const isAdmin = request.session && request.session.isAdminAuthenticated === true;

            ws.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg.toString());
                    if (data.type === 'webstats-admin-request' && isAdmin) {
                        const today = getDateKey(new Date());
                        ws.send(JSON.stringify({
                            type: 'webstats-admin-data',
                            value: {
                                todayIps: adminData.recent_ips[today] || {},
                                recentIps: adminData.recent_ips,
                                topIps: adminData.top_ips,
                                lastVisitors: adminData.last_visitors || [],
                                isAdmin: true
                            }
                        }));
                    }
                    // Serve stats data via WebSocket when adminOnly is enabled
                    if (data.type === 'webstats-data-request' && isAdmin) {
                        ws.send(JSON.stringify({
                            type: 'webstats-data',
                            value: statsData
                        }));
                    }
                    // Backup: send full data to admin
                    if (data.type === 'webstats-backup-request' && isAdmin) {
                        ws.send(JSON.stringify({
                            type: 'webstats-backup',
                            value: {
                                statsData: statsData,
                                adminData: adminData,
                                exportDate: new Date().toISOString(),
                                version: pluginConfig.version
                            }
                        }));
                    }
                    // Remote server data: fetch from configured servers (avoids CORS)
                    if (data.type === 'webstats-remote-request') {
                        const servers = config.remoteServers;
                        if (!servers || !Array.isArray(servers) || servers.length === 0) {
                            ws.send(JSON.stringify({ type: 'webstats-remote-data', value: {} }));
                        } else {
                            const results = {};
                            let pending = servers.length;
                            servers.forEach(server => {
                                const url = server.url.replace(/\/$/, '') + '/js/plugins/WebStats/webstats-data.json';
                                fetchUrl(url, (err, body) => {
                                    if (!err && body) {
                                        try { results[server.name] = JSON.parse(body); } catch (e) { /* skip */ }
                                    }
                                    pending--;
                                    if (pending <= 0) {
                                        ws.send(JSON.stringify({ type: 'webstats-remote-data', value: results }));
                                    }
                                });
                            });
                        }
                    }
                    // Restore: load data from admin upload
                    if (data.type === 'webstats-restore' && isAdmin && data.value) {
                        try {
                            if (data.value.statsData) {
                                statsData = data.value.statsData;
                                saveData();
                            }
                            if (data.value.adminData) {
                                adminData = data.value.adminData;
                                saveAdminData();
                            }
                            ws.send(JSON.stringify({ type: 'webstats-restore-result', value: { success: true } }));
                            logMsg('Data restored by admin');
                        } catch (e) {
                            ws.send(JSON.stringify({ type: 'webstats-restore-result', value: { success: false, error: e.message } }));
                        }
                    }
                } catch (e) {
                    // Ignore non-JSON or irrelevant messages
                }
            });
        });

        logMsg('WebSocket admin handler initialized');
    } catch (e) {
        logMsg('WebSocket init postponed: ' + e.message);
        setTimeout(initWebSocket, 5000);
    }
}

// --- Initialize ---
loadConfig();
ensureConfigAccessible();
logMsg('Initializing, monitoring ' + LOG_FILE + (config.adminOnly ? ' (admin-only mode)' : ''));
loadData();
loadAdminData();
if (config.adminOnly) {
    removeWebAccessible();
}
purgeOldData();
purgeAdminData();
processLogFile();
setInterval(processLogFile, config.pollInterval * 1000);
setInterval(purgeOldData, 86400000);
setInterval(purgeAdminData, 86400000);
setTimeout(initWebSocket, 5000);

// Don't change anything below here
module.exports = { pluginConfig };
