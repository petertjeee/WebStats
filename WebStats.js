///////////////////////////////////////////////////////////////
///                                                         ///
///  WEBSTATS PLUGIN FOR FM-DX-WEBSERVER (V1.4.0)          ///
///                                                         ///
///  Visitor statistics from serverlog.txt                   ///
///                                                         ///
///////////////////////////////////////////////////////////////

const fs = require('fs');
const path = require('path');

// Plugin configuration
var pluginConfig = {
    name: 'WebStats',
    version: '1.4.0',
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
    adminRetentionDays: 7
};

// --- Load configuration ---
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            const userConfig = JSON.parse(raw);
            Object.assign(config, userConfig);
            logMsg('Config loaded: poll=' + config.pollInterval + 's, retention=' + config.dataRetentionMonths + ' months');
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
    _last_timestamp: 0
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
        statsData = { days: {}, _current_day: null, _current_day_ips: [], _last_timestamp: 0 };
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
        ensureWebAccessible();
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

// --- Parse timestamp from log line ---
function parseTimestamp(tsString) {
    // Try native Date parsing first
    try {
        const d = new Date(tsString);
        if (!isNaN(d.getTime())) return d;
    } catch (e) {}

    // Manual extraction for various locale formats
    const match = tsString.match(/(\d{1,4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
    if (match) {
        let [, a, b, c, hour, minute, ampm] = match;
        hour = parseInt(hour);
        if (ampm) {
            if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
            if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
        }

        let year, month, day;
        if (parseInt(a) > 31) {
            year = parseInt(a); month = parseInt(b); day = parseInt(c);
        } else if (parseInt(c) > 31) {
            year = parseInt(c);
            if (parseInt(a) <= 12) {
                month = parseInt(a); day = parseInt(b);
            } else {
                day = parseInt(a); month = parseInt(b);
            }
        } else {
            year = parseInt(c) < 100 ? 2000 + parseInt(c) : parseInt(c);
            month = parseInt(a); day = parseInt(b);
        }

        const d = new Date(year, month - 1, day, hour, parseInt(minute));
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
    if (!statsData._current_day_ips.includes(ip)) {
        statsData._current_day_ips.push(ip);
    }
    day.unique_visitors = statsData._current_day_ips.length;

    // Location
    const loc = location.trim();
    day.locations[loc] = (day.locations[loc] || 0) + 1;

    // ISP
    const ispName = isp.trim();
    day.isps[ispName] = (day.isps[ispName] || 0) + 1;

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

// --- Read and process new lines from the log file ---
// Note: fm-dx-webserver truncates serverlog.txt to 5000 lines every 60s,
// rewriting the entire file. Byte offsets are unreliable, so we use
// timestamp-based deduplication: only process lines newer than _last_timestamp.
function processLogFile() {
    try {
        if (!fs.existsSync(LOG_FILE)) return;

        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = content.split('\n');
        // _last_timestamp is stored as epoch ms for reliable comparison
        const lastEpoch = statsData._last_timestamp || 0;
        let latestEpoch = lastEpoch;
        let processed = 0;

        lines.forEach(line => {
            line = line.trim();
            if (!line) return;

            // Extract timestamp from log line to check if we already processed it
            const tsMatch = line.match(/^\[([^\]]+)\]/);
            if (!tsMatch) return;

            const lineDate = parseTimestamp(tsMatch[1]);
            const lineEpoch = lineDate.getTime();

            // Skip lines we've already processed
            if (lineEpoch <= lastEpoch) return;

            if (processLine(line)) {
                processed++;
                if (lineEpoch > latestEpoch) latestEpoch = lineEpoch;
            } else if (processDisconnectLine(line)) {
                processed++;
                if (lineEpoch > latestEpoch) latestEpoch = lineEpoch;
            }
        });

        if (latestEpoch !== lastEpoch) {
            statsData._last_timestamp = latestEpoch;
        }

        if (processed > 0) {
            saveData();
            saveAdminData();
            logMsg('Processed ' + processed + ' new connection(s)');
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
logMsg('Initializing, monitoring ' + LOG_FILE);
loadData();
loadAdminData();
purgeOldData();
purgeAdminData();
processLogFile();
setInterval(processLogFile, config.pollInterval * 1000);
setInterval(purgeOldData, 86400000);
setInterval(purgeAdminData, 86400000);
setTimeout(initWebSocket, 5000);

// Don't change anything below here
module.exports = { pluginConfig };
