///////////////////////////////////////////////////////////////
///                                                         ///
///  WEBSTATS FRONTEND FOR FM-DX-WEBSERVER (V1.4.0)        ///
///                                                         ///
///  Visitor statistics dashboard                            ///
///                                                         ///
///////////////////////////////////////////////////////////////

(() => {
    'use strict';

    const PLUGIN_VERSION = '1.4.0';
    const DATA_URL = '/js/plugins/WebStats/webstats-data.json';
    const CONFIG_URL = '/js/plugins/WebStats/webstats-config.json';
    const REFRESH_INTERVAL = 60000;

    let statsData = null;
    let monthChartInstance = null;
    let hourlyChartInstance = null;
    let selectedYear = new Date().getFullYear();
    let selectedMonth = new Date().getMonth() + 1;
    let selectedDay = null;
    let refreshTimer = null;
    let modalOpen = false;
    let pluginConfig = {
        pollInterval: 60,
        dataRetentionMonths: 12,
        updateCheck: true,
        githubRepo: ''
    };

    // Admin state
    let isAdmin = false;
    let pluginsWs = null;
    let adminDataCache = null;

    // ========== Chart.js Loading ==========
    function loadChartJS() {
        return new Promise((resolve, reject) => {
            if (window.Chart) { resolve(); return; }
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load Chart.js'));
            document.head.appendChild(script);
        });
    }

    // ========== Config Loading ==========
    async function loadPluginConfig() {
        try {
            const res = await fetch(CONFIG_URL + '?t=' + Date.now());
            if (res.ok) {
                const cfg = await res.json();
                Object.assign(pluginConfig, cfg);
            }
        } catch (e) {
            console.warn('[WebStats] Config not found, using defaults');
        }
    }

    // ========== Admin Detection & WebSocket ==========
    function detectAdmin() {
        // fm-dx-webserver injects isAdminAuthenticated via EJS template
        if (typeof isAdminAuthenticated !== 'undefined' && isAdminAuthenticated === true) {
            isAdmin = true;
            console.log('[WebStats] Admin mode detected');
            connectAdminWebSocket();
        }
    }

    function connectAdminWebSocket() {
        try {
            const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            pluginsWs = new WebSocket(`${wsProtocol}//${location.host}/data_plugins`);

            pluginsWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'webstats-admin-data' && data.value) {
                        adminDataCache = data.value;
                        if (modalOpen) {
                            renderAdminSections();
                        }
                    }
                } catch (e) {}
            };

            pluginsWs.onclose = () => {
                pluginsWs = null;
                // Reconnect after 10s
                setTimeout(() => {
                    if (isAdmin) connectAdminWebSocket();
                }, 10000);
            };

            pluginsWs.onerror = () => {};
        } catch (e) {
            console.warn('[WebStats] Could not connect admin WebSocket');
        }
    }

    function requestAdminData() {
        if (!isAdmin || !pluginsWs || pluginsWs.readyState !== WebSocket.OPEN) return;
        pluginsWs.send(JSON.stringify({ type: 'webstats-admin-request' }));
    }

    // ========== CSS Injection ==========
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* WebStats Button — legacy mode only (outside plugin panel) */
            #button-wrapper #webstats-btn,
            body > #webstats-btn {
                border-radius: 0px;
                width: 100px;
                height: 22px;
                position: relative;
                margin-top: 16px;
                margin-left: 5px;
                right: 0px;
            }
            #webstats-btn:hover {
                color: var(--color-5);
                filter: brightness(120%);
            }

            /* Modal Overlay */
            #webstats-overlay {
                display: none;
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.85);
                z-index: 10000;
                overflow-y: auto;
                padding: 20px;
                box-sizing: border-box;
            }
            #webstats-overlay.active {
                display: flex;
                justify-content: center;
                align-items: flex-start;
            }

            /* Modal Container */
            #webstats-modal {
                background: var(--color-1);
                border-radius: 12px;
                width: 100%;
                max-width: 960px;
                margin: 10px auto;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                border: 1px solid var(--color-2);
                color: var(--color-text);
                font-family: 'Titillium Web', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
            }

            /* Header */
            .ws-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 24px;
                border-bottom: 1px solid var(--color-2);
                flex-wrap: wrap;
                gap: 10px;
            }
            .ws-header h2 {
                margin: 0;
                font-size: 20px;
                font-weight: 700;
                color: var(--color-text);
            }
            .ws-header-controls {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .ws-select {
                background: var(--color-2);
                color: var(--color-text);
                border: 1px solid var(--color-3);
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 13px;
                cursor: pointer;
                font-family: inherit;
            }
            .ws-select:focus {
                outline: none;
                border-color: var(--color-main-bright);
            }
            .ws-close {
                background: none;
                border: none;
                color: var(--color-3);
                font-size: 24px;
                cursor: pointer;
                padding: 0 4px;
                line-height: 1;
                transition: color 0.2s;
            }
            .ws-close:hover {
                color: #e74c3c;
            }

            /* Content */
            .ws-content {
                padding: 20px 24px;
            }

            /* Summary Cards */
            .ws-cards {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 12px;
                margin-bottom: 24px;
            }
            .ws-card {
                background: var(--color-2);
                border-radius: 10px;
                padding: 16px;
                border: 1px solid var(--color-2);
            }
            .ws-card-label {
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 1px;
                color: var(--color-3);
                margin-bottom: 6px;
            }
            .ws-card-value {
                font-size: 28px;
                font-weight: 700;
                color: var(--color-text);
            }
            .ws-card-sub {
                font-size: 11px;
                color: var(--color-3);
                margin-top: 4px;
            }

            /* Chart Section */
            .ws-chart-container {
                background: var(--color-2);
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 24px;
                border: 1px solid var(--color-2);
            }
            .ws-chart-container h3 {
                margin: 0 0 16px 0;
                font-size: 15px;
                font-weight: 600;
                color: var(--color-4);
            }
            .ws-chart-container canvas {
                max-height: 250px;
            }

            /* Tables */
            .ws-tables-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-bottom: 24px;
            }
            @media (max-width: 700px) {
                .ws-tables-row {
                    grid-template-columns: 1fr;
                }
            }
            .ws-table-box {
                background: var(--color-2);
                border-radius: 10px;
                padding: 16px;
                border: 1px solid var(--color-2);
            }
            .ws-table-box h3 {
                margin: 0 0 12px 0;
                font-size: 14px;
                font-weight: 600;
                color: var(--color-4);
            }
            .ws-table {
                width: 100%;
                border-collapse: collapse;
            }
            .ws-table th {
                text-align: left;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--color-3);
                padding: 6px 8px;
                border-bottom: 1px solid var(--color-2);
            }
            .ws-table th:last-child {
                text-align: right;
            }
            .ws-table td {
                padding: 7px 8px;
                font-size: 13px;
                border-bottom: 1px solid var(--color-1);
            }
            .ws-table td:last-child {
                text-align: right;
                font-weight: 600;
                color: var(--color-main-bright);
            }
            .ws-table tr:last-child td {
                border-bottom: none;
            }
            .ws-table .ws-rank {
                color: var(--color-3);
                font-size: 12px;
                width: 28px;
            }

            /* Daily Breakdown */
            .ws-daily-box {
                background: var(--color-2);
                border-radius: 10px;
                padding: 16px;
                border: 1px solid var(--color-2);
                margin-bottom: 24px;
            }
            .ws-daily-box h3 {
                margin: 0 0 12px 0;
                font-size: 14px;
                font-weight: 600;
                color: var(--color-4);
            }
            .ws-daily-table {
                width: 100%;
                border-collapse: collapse;
            }
            .ws-daily-table th {
                text-align: left;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--color-3);
                padding: 8px;
                border-bottom: 1px solid var(--color-2);
            }
            .ws-daily-table td {
                padding: 8px;
                font-size: 13px;
                border-bottom: 1px solid var(--color-1);
            }
            .ws-daily-table tr:last-child td {
                border-bottom: none;
            }
            .ws-daily-table tr.ws-clickable {
                cursor: pointer;
                transition: background 0.15s;
            }
            .ws-daily-table tr.ws-clickable:hover td {
                background: var(--color-1-transparent);
            }
            .ws-daily-table tr.ws-selected td {
                background: var(--color-2-transparent);
            }
            .ws-daily-table .ws-highlight {
                color: var(--color-main-bright);
                font-weight: 600;
            }

            /* Hourly Detail */
            .ws-hourly-detail {
                background: var(--color-2);
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 24px;
                border: 1px solid var(--color-3);
            }
            .ws-hourly-detail h3 {
                margin: 0 0 16px 0;
                font-size: 15px;
                font-weight: 600;
                color: var(--color-4);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .ws-hourly-detail canvas {
                max-height: 200px;
            }
            .ws-hourly-close {
                background: none;
                border: none;
                color: var(--color-3);
                font-size: 18px;
                cursor: pointer;
                padding: 0 4px;
                transition: color 0.2s;
            }
            .ws-hourly-close:hover {
                color: #e74c3c;
            }

            /* Heatmap */
            .ws-heatmap-box {
                background: var(--color-2);
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 24px;
                border: 1px solid var(--color-2);
            }
            .ws-heatmap-box h3 {
                margin: 0 0 16px 0;
                font-size: 15px;
                font-weight: 600;
                color: var(--color-4);
            }
            .ws-heatmap {
                display: grid;
                grid-template-columns: 50px repeat(24, 1fr);
                gap: 2px;
                font-size: 11px;
            }
            .ws-heatmap-label {
                color: var(--color-3);
                display: flex;
                align-items: center;
                padding-right: 6px;
                justify-content: flex-end;
                font-size: 11px;
            }
            .ws-heatmap-hour {
                color: var(--color-3);
                text-align: center;
                font-size: 10px;
                padding-bottom: 4px;
            }
            .ws-heatmap-cell {
                border-radius: 3px;
                min-height: 22px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: 600;
                transition: transform 0.1s;
            }
            .ws-heatmap-cell:hover {
                transform: scale(1.15);
                z-index: 1;
            }

            /* Comparison */
            .ws-comparison-box {
                background: var(--color-2);
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 24px;
                border: 1px solid var(--color-2);
            }
            .ws-comparison-box h3 {
                margin: 0 0 16px 0;
                font-size: 15px;
                font-weight: 600;
                color: var(--color-4);
            }
            .ws-comparison-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 12px;
            }
            @media (max-width: 700px) {
                .ws-comparison-grid {
                    grid-template-columns: 1fr 1fr;
                }
            }
            @media (max-width: 450px) {
                .ws-comparison-grid {
                    grid-template-columns: 1fr;
                }
            }
            .ws-comp-item {
                text-align: center;
                padding: 12px;
                background: var(--color-1);
                border-radius: 8px;
            }
            .ws-comp-label {
                font-size: 11px;
                color: var(--color-3);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 8px;
            }
            .ws-comp-values {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
            }
            .ws-comp-current {
                font-size: 22px;
                font-weight: 700;
                color: var(--color-text);
            }
            .ws-comp-prev {
                font-size: 14px;
                color: var(--color-3);
            }
            .ws-comp-change {
                font-size: 12px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 10px;
            }
            .ws-comp-up {
                color: var(--color-main-bright);
                background: var(--color-1-transparent);
            }
            .ws-comp-down {
                color: #e74c3c;
                background: rgba(231, 76, 60, 0.12);
            }
            .ws-comp-neutral {
                color: var(--color-3);
                background: var(--color-1);
            }

            /* Admin Section */
            .ws-admin-section {
                border-top: 2px solid rgba(231, 76, 60, 0.3);
                padding-top: 20px;
                margin-top: 8px;
            }
            .ws-admin-badge {
                display: inline-block;
                background: rgba(231, 76, 60, 0.15);
                color: #e74c3c;
                font-size: 10px;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 4px;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-left: 8px;
                vertical-align: middle;
            }
            .ws-admin-box {
                background: var(--color-2);
                border-radius: 10px;
                padding: 16px;
                border: 1px solid rgba(231, 76, 60, 0.15);
                margin-bottom: 16px;
            }
            .ws-admin-box h3 {
                margin: 0 0 12px 0;
                font-size: 14px;
                font-weight: 600;
                color: var(--color-4);
            }
            .ws-ip-table {
                width: 100%;
                border-collapse: collapse;
            }
            .ws-ip-table th {
                text-align: left;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--color-3);
                padding: 6px 8px;
                border-bottom: 1px solid var(--color-2);
            }
            .ws-ip-table td {
                padding: 6px 8px;
                font-size: 12px;
                border-bottom: 1px solid var(--color-1);
                font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            }
            .ws-ip-table td.ws-ip-name {
                font-family: inherit;
            }
            .ws-ip-table tr:last-child td {
                border-bottom: none;
            }
            .ws-ip-table .ws-ip-count {
                text-align: right;
                font-weight: 600;
                color: var(--color-main-bright);
                font-family: inherit;
            }

            /* Update toast */
            .ws-update-badge {
                display: inline-block;
                background: var(--color-4);
                color: var(--color-main);
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 8px;
                margin-left: 8px;
                font-weight: 600;
                animation: ws-pulse 2s infinite;
            }
            @keyframes ws-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }

            /* Footer */
            .ws-footer {
                padding: 12px 24px;
                border-top: 1px solid var(--color-2);
                text-align: center;
                font-size: 11px;
                color: var(--color-3);
            }

            /* Loading & Error */
            .ws-loading {
                text-align: center;
                padding: 40px;
                color: var(--color-3);
            }
            .ws-error {
                text-align: center;
                padding: 40px;
                color: #e74c3c;
            }
            .ws-empty {
                text-align: center;
                padding: 20px;
                color: var(--color-3);
                font-style: italic;
            }
        `;
        document.head.appendChild(style);
    }

    // ========== Data Fetching ==========
    async function fetchData() {
        const res = await fetch(DATA_URL + '?t=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    // ========== Utility Functions ==========
    function getDateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function formatNumber(n) {
        return n.toLocaleString();
    }

    function getMonthName(m) {
        const names = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
        return names[m - 1] || '';
    }

    function getShortMonthName(m) {
        const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return names[m - 1] || '';
    }

    function getDayName(dayIndex) {
        const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return names[dayIndex] || '';
    }

    function getShortDayName(dayIndex) {
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return names[dayIndex] || '';
    }

    function sortedEntries(obj, limit) {
        return Object.entries(obj || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit || 10);
    }

    function sortedEntriesObj(obj, sortKey, limit) {
        return Object.entries(obj || {})
            .sort((a, b) => (b[1][sortKey] || 0) - (a[1][sortKey] || 0))
            .slice(0, limit || 20);
    }

    function getAvailableYears(days) {
        const years = new Set();
        Object.keys(days).forEach(key => {
            const y = parseInt(key.split('-')[0]);
            if (!isNaN(y)) years.add(y);
        });
        return Array.from(years).sort((a, b) => b - a);
    }

    function getAvailableMonths(days, year) {
        const months = new Set();
        Object.keys(days).forEach(key => {
            if (key.startsWith(`${year}-`)) {
                const m = parseInt(key.split('-')[1]);
                if (!isNaN(m)) months.add(m);
            }
        });
        return Array.from(months).sort((a, b) => a - b);
    }

    function getPrevMonthKey(year, month) {
        if (month === 1) return { year: year - 1, month: 12 };
        return { year, month: month - 1 };
    }

    function calcChange(current, previous) {
        if (previous === 0 && current === 0) return { pct: 0, dir: 'neutral' };
        if (previous === 0) return { pct: 100, dir: 'up' };
        const pct = Math.round(((current - previous) / previous) * 100);
        if (pct > 0) return { pct, dir: 'up' };
        if (pct < 0) return { pct: Math.abs(pct), dir: 'down' };
        return { pct: 0, dir: 'neutral' };
    }

    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '-';
        if (seconds < 60) return seconds + 's';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return h + 'h ' + m + 'm';
        return m + 'm ' + s + 's';
    }

    // ========== Theme Color Helper ==========
    function getThemeColor(varName, fallback) {
        const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        return val || fallback || '#888';
    }

    function getThemeColorRgb(varName) {
        const el = document.createElement('div');
        el.style.color = `var(${varName})`;
        el.style.display = 'none';
        document.body.appendChild(el);
        const computed = getComputedStyle(el).color;
        document.body.removeChild(el);
        const match = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
        if (match) return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
        return { r: 0, g: 184, b: 148 };
    }

    // ========== Statistics Calculation ==========
    function calcStats(days) {
        const today = getDateKey(new Date());
        const monthPrefix = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

        const todayData = days[today] || null;

        let monthVisits = 0, monthUnique = 0, monthPeakConcurrent = 0;
        let monthLocations = {}, monthISPs = {};
        let monthDays = [];
        let monthSessionCount = 0, monthTotalSeconds = 0, monthMaxSession = 0;

        Object.keys(days).forEach(key => {
            if (key.startsWith(monthPrefix)) {
                const d = days[key];
                monthVisits += d.total_visits || 0;
                monthUnique += d.unique_visitors || 0;
                if ((d.peak_concurrent || 0) > monthPeakConcurrent) {
                    monthPeakConcurrent = d.peak_concurrent;
                }
                monthSessionCount += d.session_count || 0;
                monthTotalSeconds += d.total_session_seconds || 0;
                if ((d.max_session_seconds || 0) > monthMaxSession) monthMaxSession = d.max_session_seconds || 0;
                Object.entries(d.locations || {}).forEach(([loc, count]) => {
                    monthLocations[loc] = (monthLocations[loc] || 0) + count;
                });
                Object.entries(d.isps || {}).forEach(([isp, count]) => {
                    monthISPs[isp] = (monthISPs[isp] || 0) + count;
                });
                monthDays.push({ date: key, ...d });
            }
        });

        monthDays.sort((a, b) => a.date.localeCompare(b.date));

        // All-time stats
        let allTimeVisits = 0, allTimePeakConcurrent = 0, totalDays = 0;
        Object.values(days).forEach(d => {
            allTimeVisits += d.total_visits || 0;
            totalDays++;
            if ((d.peak_concurrent || 0) > allTimePeakConcurrent) {
                allTimePeakConcurrent = d.peak_concurrent;
            }
        });

        // Monthly totals for chart (selected year)
        const monthlyTotals = new Array(12).fill(0);
        const monthlyUniques = new Array(12).fill(0);
        Object.keys(days).forEach(key => {
            if (key.startsWith(`${selectedYear}-`)) {
                const m = parseInt(key.split('-')[1]) - 1;
                monthlyTotals[m] += days[key].total_visits || 0;
                monthlyUniques[m] += days[key].unique_visitors || 0;
            }
        });

        // Previous month comparison
        const prev = getPrevMonthKey(selectedYear, selectedMonth);
        const prevPrefix = `${prev.year}-${String(prev.month).padStart(2, '0')}`;
        const monthAvgSession = monthSessionCount > 0 ? Math.round(monthTotalSeconds / monthSessionCount) : 0;

        let prevVisits = 0, prevUnique = 0, prevPeakConcurrent = 0;
        let prevSessionCount = 0, prevTotalSeconds = 0;
        Object.keys(days).forEach(key => {
            if (key.startsWith(prevPrefix)) {
                const d = days[key];
                prevVisits += d.total_visits || 0;
                prevUnique += d.unique_visitors || 0;
                if ((d.peak_concurrent || 0) > prevPeakConcurrent) {
                    prevPeakConcurrent = d.peak_concurrent;
                }
                prevSessionCount += d.session_count || 0;
                prevTotalSeconds += d.total_session_seconds || 0;
            }
        });

        // Heatmap data: weekday (0-6) x hour (0-23)
        const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
        Object.keys(days).forEach(key => {
            if (key.startsWith(monthPrefix)) {
                const d = days[key];
                const dateObj = new Date(key + 'T00:00:00');
                const dow = dateObj.getDay();
                (d.hourly_visits || []).forEach((count, hour) => {
                    heatmap[dow][hour] += count;
                });
            }
        });

        const prevAvgSession = prevSessionCount > 0 ? Math.round(prevTotalSeconds / prevSessionCount) : 0;

        return {
            today: todayData,
            monthVisits, monthUnique, monthPeakConcurrent,
            monthLocations, monthISPs, monthDays,
            monthAvgSession, monthMaxSession, monthSessionCount,
            allTimeVisits, allTimePeakConcurrent, totalDays,
            monthlyTotals, monthlyUniques,
            comparison: {
                prevMonth: getMonthName(prev.month),
                prevYear: prev.year,
                visits: calcChange(monthVisits, prevVisits), prevVisits,
                unique: calcChange(monthUnique, prevUnique), prevUnique,
                peak: calcChange(monthPeakConcurrent, prevPeakConcurrent), prevPeak: prevPeakConcurrent,
                avgSession: calcChange(monthAvgSession, prevAvgSession), prevAvgSession
            },
            heatmap
        };
    }

    // ========== Create Button ==========
    function createButton() {
        // New fm-dx-webserver with plugin panel (.dashboard-panel-plugin-list)
        // Use MutationObserver to wait for addIconToPluginPanel to become available
        if (document.querySelector('.dashboard-panel-plugin-list')) {
            if (typeof addIconToPluginPanel === 'function') {
                addPluginButton();
            } else {
                const observer = new MutationObserver(() => {
                    if (typeof addIconToPluginPanel === 'function') {
                        observer.disconnect();
                        addPluginButton();
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => observer.disconnect(), 30000);
            }
            return;
        }

        // Legacy fm-dx-webserver: add button to #button-wrapper or create it inside .tuner-info
        const btn = document.createElement('button');
        btn.id = 'webstats-btn';
        btn.className = 'hide-phone bg-color-2';
        btn.innerHTML = '<strong>WEBSTATS</strong>';
        btn.title = 'Visitor Statistics';
        btn.addEventListener('click', openModal);

        let buttonWrapper = document.getElementById('button-wrapper');
        if (!buttonWrapper) {
            const tunerInfo = document.querySelector('.tuner-info');
            if (tunerInfo) {
                buttonWrapper = document.createElement('div');
                buttonWrapper.id = 'button-wrapper';
                buttonWrapper.className = 'button-wrapper';
                tunerInfo.appendChild(buttonWrapper);
            }
        }

        if (buttonWrapper) {
            buttonWrapper.appendChild(btn);
        } else {
            btn.style.position = 'fixed';
            btn.style.bottom = '10px';
            btn.style.right = '10px';
            btn.style.zIndex = '9999';
            document.body.appendChild(btn);
        }
    }

    function addPluginButton() {
        addIconToPluginPanel('webstats-btn', 'WebStats', 'solid', 'chart-simple', 'Visitor Statistics');
        const btn = document.getElementById('webstats-btn');
        if (btn) btn.addEventListener('click', openModal);
    }

    // ========== Create Modal ==========
    function createModal() {
        const overlay = document.createElement('div');
        overlay.id = 'webstats-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        const adminBadge = isAdmin ? ' <span class="ws-admin-badge">Admin</span>' : '';

        overlay.innerHTML = `
            <div id="webstats-modal">
                <div class="ws-header">
                    <h2>WebStats${adminBadge} <span style="font-size:11px;color:var(--color-3);font-weight:400">v${PLUGIN_VERSION}</span></h2>
                    <div class="ws-header-controls">
                        <select id="ws-year-select" class="ws-select"></select>
                        <select id="ws-month-select" class="ws-select"></select>
                        <button class="ws-close" title="Close">&times;</button>
                    </div>
                </div>
                <div class="ws-content" id="ws-content">
                    <div class="ws-loading">Loading...</div>
                </div>
                <div class="ws-footer">
                    WebStats Plugin v${PLUGIN_VERSION}
                    <span id="ws-update-indicator"></span>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('.ws-close').addEventListener('click', closeModal);
        document.getElementById('ws-year-select').addEventListener('change', onYearChange);
        document.getElementById('ws-month-select').addEventListener('change', onMonthChange);
    }

    // ========== Modal Open/Close ==========
    function openModal() {
        const overlay = document.getElementById('webstats-overlay');
        overlay.classList.add('active');
        modalOpen = true;
        selectedDay = null;
        loadAndRender();
        requestAdminData();
        refreshTimer = setInterval(() => {
            loadAndRender();
            requestAdminData();
        }, REFRESH_INTERVAL);
    }

    function closeModal() {
        const overlay = document.getElementById('webstats-overlay');
        overlay.classList.remove('active');
        modalOpen = false;
        selectedDay = null;
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    // ========== Period Selection ==========
    function onYearChange(e) {
        selectedYear = parseInt(e.target.value);
        selectedDay = null;
        updateMonthSelect();
        loadAndRender();
    }

    function onMonthChange(e) {
        selectedMonth = parseInt(e.target.value);
        selectedDay = null;
        loadAndRender();
    }

    function updateYearSelect(days) {
        const select = document.getElementById('ws-year-select');
        const years = getAvailableYears(days);
        if (years.length === 0) years.push(new Date().getFullYear());
        if (!years.includes(selectedYear)) selectedYear = years[0];

        select.innerHTML = years.map(y =>
            `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`
        ).join('');
    }

    function updateMonthSelect() {
        const select = document.getElementById('ws-month-select');
        const days = statsData ? statsData.days || {} : {};
        const months = getAvailableMonths(days, selectedYear);
        if (months.length === 0) months.push(new Date().getMonth() + 1);
        if (!months.includes(selectedMonth)) selectedMonth = months[months.length - 1];

        select.innerHTML = months.map(m =>
            `<option value="${m}" ${m === selectedMonth ? 'selected' : ''}>${getMonthName(m)}</option>`
        ).join('');
    }

    // ========== Load & Render ==========
    async function loadAndRender() {
        const content = document.getElementById('ws-content');
        try {
            statsData = await fetchData();
            const days = statsData.days || {};

            updateYearSelect(days);
            updateMonthSelect();

            const stats = calcStats(days);
            renderDashboard(content, stats);
        } catch (err) {
            content.innerHTML = `<div class="ws-error">Could not load statistics.<br><small>${err.message}</small></div>`;
        }
    }

    // ========== Render Dashboard ==========
    function renderDashboard(container, stats) {
        const todayVisits = stats.today ? stats.today.total_visits : 0;
        const todayUnique = stats.today ? stats.today.unique_visitors : 0;
        const todayPeak = stats.today ? stats.today.peak_concurrent : 0;
        const todayAvgSession = stats.today && stats.today.session_count > 0
            ? Math.round(stats.today.total_session_seconds / stats.today.session_count) : 0;
        const todayMaxSession = stats.today ? (stats.today.max_session_seconds || 0) : 0;

        container.innerHTML = `
            <!-- Summary Cards -->
            <div class="ws-cards">
                <div class="ws-card">
                    <div class="ws-card-label">Today</div>
                    <div class="ws-card-value">${formatNumber(todayVisits)}</div>
                    <div class="ws-card-sub">${formatNumber(todayUnique)} unique &middot; peak ${todayPeak} &middot; avg. ${formatDuration(todayAvgSession)}</div>
                </div>
                <div class="ws-card">
                    <div class="ws-card-label">${getMonthName(selectedMonth)} ${selectedYear}</div>
                    <div class="ws-card-value">${formatNumber(stats.monthVisits)}</div>
                    <div class="ws-card-sub">${formatNumber(stats.monthUnique)} unique &middot; ${stats.monthDays.length} days</div>
                </div>
                <div class="ws-card">
                    <div class="ws-card-label">Peak concurrent</div>
                    <div class="ws-card-value">${stats.monthPeakConcurrent}</div>
                    <div class="ws-card-sub">this month</div>
                </div>
                <div class="ws-card">
                    <div class="ws-card-label">Session duration</div>
                    <div class="ws-card-value">${formatDuration(stats.monthAvgSession)}</div>
                    <div class="ws-card-sub">average &middot; max ${formatDuration(stats.monthMaxSession)}</div>
                </div>
                <div class="ws-card">
                    <div class="ws-card-label">Total</div>
                    <div class="ws-card-value">${formatNumber(stats.allTimeVisits)}</div>
                    <div class="ws-card-sub">${stats.totalDays} days tracked</div>
                </div>
            </div>

            <!-- Month Comparison -->
            <div id="ws-comparison"></div>

            <!-- Monthly Chart -->
            <div class="ws-chart-container">
                <h3>Visitors per month — ${selectedYear}</h3>
                <canvas id="ws-chart"></canvas>
            </div>

            <!-- Heatmap -->
            <div id="ws-heatmap"></div>

            <!-- Top Locations & ISPs -->
            <div class="ws-tables-row">
                <div class="ws-table-box">
                    <h3>Top locations — ${getMonthName(selectedMonth)}</h3>
                    ${renderTopTable(stats.monthLocations)}
                </div>
                <div class="ws-table-box">
                    <h3>Top ISPs — ${getMonthName(selectedMonth)}</h3>
                    ${renderTopTable(stats.monthISPs)}
                </div>
            </div>

            <!-- Daily Breakdown -->
            <div class="ws-daily-box">
                <h3>Daily overview — ${getMonthName(selectedMonth)} ${selectedYear}</h3>
                <div style="font-size:11px;color:var(--color-3);margin-bottom:10px;">Click a day for hourly breakdown</div>
                ${renderDailyTable(stats.monthDays)}
            </div>

            <!-- Hourly Detail (shown when a day is selected) -->
            <div id="ws-hourly-detail"></div>

            <!-- Admin Section (only for authenticated admins) -->
            <div id="ws-admin-area"></div>
        `;

        // Render dynamic components
        renderMonthChart(stats);
        renderComparison(document.getElementById('ws-comparison'), stats.comparison, stats);
        renderHeatmap(document.getElementById('ws-heatmap'), stats.heatmap);

        // Restore hourly detail if a day was selected
        if (selectedDay) {
            const dayData = stats.monthDays.find(d => d.date === selectedDay);
            if (dayData) {
                renderHourlyDetail(document.getElementById('ws-hourly-detail'), dayData);
            }
        }

        // Attach click handlers to daily rows
        document.querySelectorAll('.ws-day-row').forEach(row => {
            row.addEventListener('click', () => {
                const dateKey = row.dataset.date;
                selectedDay = (selectedDay === dateKey) ? null : dateKey;

                document.querySelectorAll('.ws-day-row').forEach(r => r.classList.remove('ws-selected'));
                if (selectedDay) row.classList.add('ws-selected');

                const detailContainer = document.getElementById('ws-hourly-detail');
                if (selectedDay) {
                    const dayData = stats.monthDays.find(d => d.date === selectedDay);
                    if (dayData) renderHourlyDetail(detailContainer, dayData);
                } else {
                    detailContainer.innerHTML = '';
                    if (hourlyChartInstance) { hourlyChartInstance.destroy(); hourlyChartInstance = null; }
                }
            });
        });

        // Render admin section if data is available
        renderAdminSections();
    }

    // ========== Top Table Renderer ==========
    function renderTopTable(data) {
        const entries = sortedEntries(data, 10);
        if (entries.length === 0) {
            return '<div class="ws-empty">No data available</div>';
        }

        let html = `<table class="ws-table">
            <thead><tr><th>#</th><th>Name</th><th>Count</th></tr></thead><tbody>`;

        entries.forEach(([name, count], i) => {
            html += `<tr>
                <td class="ws-rank">${i + 1}</td>
                <td>${escapeHtml(name)}</td>
                <td>${formatNumber(count)}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        return html;
    }

    // ========== Daily Table Renderer ==========
    function renderDailyTable(days) {
        if (days.length === 0) {
            return '<div class="ws-empty">No data available for this month</div>';
        }

        let html = `<table class="ws-daily-table">
            <thead><tr>
                <th>Date</th>
                <th>Visitors</th>
                <th>Unique</th>
                <th>Peak concurrent</th>
                <th>&#8960; Session</th>
                <th>Max session</th>
                <th>Top location</th>
                <th>Top ISP</th>
            </tr></thead><tbody>`;

        const maxVisits = Math.max(...days.map(d => d.total_visits || 0));
        const maxPeak = Math.max(...days.map(d => d.peak_concurrent || 0));

        days.forEach(d => {
            const topLoc = sortedEntries(d.locations, 1);
            const topISP = sortedEntries(d.isps, 1);
            const isMaxVisits = d.total_visits === maxVisits && maxVisits > 0;
            const isMaxPeak = d.peak_concurrent === maxPeak && maxPeak > 0;
            const isSelected = selectedDay === d.date;

            const parts = d.date.split('-');
            const dayNum = parseInt(parts[2]);
            const monthName = getShortMonthName(parseInt(parts[1]));
            const dateObj = new Date(d.date + 'T00:00:00');
            const dayName = getShortDayName(dateObj.getDay());

            const avgSess = d.session_count > 0 ? Math.round(d.total_session_seconds / d.session_count) : 0;
            const maxSess = d.max_session_seconds || 0;

            html += `<tr class="ws-clickable ws-day-row ${isSelected ? 'ws-selected' : ''}" data-date="${d.date}">
                <td>${dayName} ${dayNum} ${monthName}</td>
                <td class="${isMaxVisits ? 'ws-highlight' : ''}">${formatNumber(d.total_visits || 0)}</td>
                <td>${formatNumber(d.unique_visitors || 0)}</td>
                <td class="${isMaxPeak ? 'ws-highlight' : ''}">${d.peak_concurrent || 0}</td>
                <td>${formatDuration(avgSess)}</td>
                <td>${formatDuration(maxSess)}</td>
                <td>${topLoc.length ? escapeHtml(topLoc[0][0]) : '-'}</td>
                <td>${topISP.length ? escapeHtml(topISP[0][0]) : '-'}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        return html;
    }

    // ========== Hourly Detail Renderer ==========
    function renderHourlyDetail(container, dayData) {
        const parts = dayData.date.split('-');
        const dayNum = parseInt(parts[2]);
        const monthName = getMonthName(parseInt(parts[1]));
        const dateObj = new Date(dayData.date + 'T00:00:00');
        const dayName = getDayName(dateObj.getDay());

        container.innerHTML = `
            <div class="ws-hourly-detail">
                <h3>
                    <span>Visitors per hour — ${dayName} ${dayNum} ${monthName} ${parts[0]}</span>
                    <button class="ws-hourly-close" title="Close">&times;</button>
                </h3>
                <canvas id="ws-hourly-chart"></canvas>
            </div>
        `;

        container.querySelector('.ws-hourly-close').addEventListener('click', () => {
            selectedDay = null;
            container.innerHTML = '';
            document.querySelectorAll('.ws-day-row').forEach(r => r.classList.remove('ws-selected'));
            if (hourlyChartInstance) { hourlyChartInstance.destroy(); hourlyChartInstance = null; }
        });

        const canvas = document.getElementById('ws-hourly-chart');
        if (!canvas || !window.Chart) return;

        if (hourlyChartInstance) { hourlyChartInstance.destroy(); hourlyChartInstance = null; }

        const hourlyData = dayData.hourly_visits || new Array(24).fill(0);
        const ctx = canvas.getContext('2d');

        hourlyChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`),
                datasets: [{
                    label: 'Visitors',
                    data: hourlyData,
                    backgroundColor: (() => { const c = getThemeColorRgb('--color-main-bright'); return `rgba(${c.r},${c.g},${c.b},0.7)`; })(),
                    borderColor: (() => { const c = getThemeColorRgb('--color-main-bright'); return `rgba(${c.r},${c.g},${c.b},1)`; })(),
                    borderWidth: 1,
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: getThemeColor('--color-2'),
                        titleColor: getThemeColor('--color-text'),
                        bodyColor: getThemeColor('--color-text'),
                        borderColor: getThemeColor('--color-3'),
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        ticks: { color: getThemeColor('--color-3'), font: { size: 10 } },
                        grid: { color: getThemeColor('--color-1') }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: getThemeColor('--color-3'), precision: 0 },
                        grid: { color: getThemeColor('--color-1') }
                    }
                }
            }
        });

        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ========== Heatmap Renderer ==========
    function renderHeatmap(container, heatmap) {
        let maxVal = 0;
        heatmap.forEach(row => row.forEach(v => { if (v > maxVal) maxVal = v; }));

        if (maxVal === 0) {
            container.innerHTML = '';
            return;
        }

        const dayOrder = [1, 2, 3, 4, 5, 6, 0];

        let html = `<div class="ws-heatmap-box">
            <h3>Activity heatmap — ${getMonthName(selectedMonth)} ${selectedYear}</h3>
            <div class="ws-heatmap">`;

        html += '<div class="ws-heatmap-label"></div>';
        for (let h = 0; h < 24; h++) {
            html += `<div class="ws-heatmap-hour">${h}</div>`;
        }

        dayOrder.forEach(dow => {
            html += `<div class="ws-heatmap-label">${getShortDayName(dow)}</div>`;
            for (let h = 0; h < 24; h++) {
                const val = heatmap[dow][h];
                const intensity = val / maxVal;
                const tc = getThemeColorRgb('--color-main-bright');
                const r = Math.round(tc.r * intensity);
                const g = Math.round(tc.g * intensity);
                const b = Math.round(tc.b * intensity);
                const bg = val > 0
                    ? `rgba(${r}, ${g}, ${b}, ${0.3 + intensity * 0.7})`
                    : 'var(--color-1)';
                const text = val > 0 ? val : '';
                const textColor = intensity > 0.6 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)';
                html += `<div class="ws-heatmap-cell" style="background:${bg};color:${textColor}" title="${getDayName(dow)} ${h}:00 — ${val} visitors">${text}</div>`;
            }
        });

        html += '</div></div>';
        container.innerHTML = html;
    }

    // ========== Comparison Renderer ==========
    function renderComparison(container, comp, stats) {
        if (comp.prevVisits === 0 && comp.prevUnique === 0 && comp.prevPeak === 0) {
            container.innerHTML = '';
            return;
        }

        function changeHtml(change) {
            const cls = `ws-comp-${change.dir}`;
            const arrow = change.dir === 'up' ? '&#9650;' : change.dir === 'down' ? '&#9660;' : '&#8212;';
            return `<span class="ws-comp-change ${cls}">${arrow} ${change.pct}%</span>`;
        }

        container.innerHTML = `
            <div class="ws-comparison-box">
                <h3>Comparison with ${comp.prevMonth} ${comp.prevYear}</h3>
                <div class="ws-comparison-grid">
                    <div class="ws-comp-item">
                        <div class="ws-comp-label">Visitors</div>
                        <div class="ws-comp-values">
                            <span class="ws-comp-current">${formatNumber(stats.monthVisits)}</span>
                            <span class="ws-comp-prev">vs ${formatNumber(comp.prevVisits)}</span>
                        </div>
                        <div style="margin-top:6px">${changeHtml(comp.visits)}</div>
                    </div>
                    <div class="ws-comp-item">
                        <div class="ws-comp-label">Unique visitors</div>
                        <div class="ws-comp-values">
                            <span class="ws-comp-current">${formatNumber(stats.monthUnique)}</span>
                            <span class="ws-comp-prev">vs ${formatNumber(comp.prevUnique)}</span>
                        </div>
                        <div style="margin-top:6px">${changeHtml(comp.unique)}</div>
                    </div>
                    <div class="ws-comp-item">
                        <div class="ws-comp-label">Peak concurrent</div>
                        <div class="ws-comp-values">
                            <span class="ws-comp-current">${stats.monthPeakConcurrent}</span>
                            <span class="ws-comp-prev">vs ${comp.prevPeak}</span>
                        </div>
                        <div style="margin-top:6px">${changeHtml(comp.peak)}</div>
                    </div>
                    <div class="ws-comp-item">
                        <div class="ws-comp-label">Avg. session</div>
                        <div class="ws-comp-values">
                            <span class="ws-comp-current">${formatDuration(stats.monthAvgSession)}</span>
                            <span class="ws-comp-prev">vs ${formatDuration(comp.prevAvgSession)}</span>
                        </div>
                        <div style="margin-top:6px">${changeHtml(comp.avgSession)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    // ========== Monthly Chart ==========
    function renderMonthChart(stats) {
        const canvas = document.getElementById('ws-chart');
        if (!canvas || !window.Chart) return;

        if (monthChartInstance) {
            monthChartInstance.destroy();
            monthChartInstance = null;
        }

        const ctx = canvas.getContext('2d');
        monthChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Array.from({length: 12}, (_, i) => getShortMonthName(i + 1)),
                datasets: [
                    {
                        label: 'Visitors',
                        data: stats.monthlyTotals,
                        backgroundColor: (() => { const c = getThemeColorRgb('--color-main-bright'); return `rgba(${c.r},${c.g},${c.b},0.7)`; })(),
                        borderColor: (() => { const c = getThemeColorRgb('--color-main-bright'); return `rgba(${c.r},${c.g},${c.b},1)`; })(),
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Unique',
                        data: stats.monthlyUniques,
                        backgroundColor: (() => { const c = getThemeColorRgb('--color-4'); return `rgba(${c.r},${c.g},${c.b},0.5)`; })(),
                        borderColor: (() => { const c = getThemeColorRgb('--color-4'); return `rgba(${c.r},${c.g},${c.b},1)`; })(),
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: getThemeColor('--color-3'), font: { size: 12 } }
                    },
                    tooltip: {
                        backgroundColor: getThemeColor('--color-2'),
                        titleColor: getThemeColor('--color-text'),
                        bodyColor: getThemeColor('--color-text'),
                        borderColor: getThemeColor('--color-3'),
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        ticks: { color: getThemeColor('--color-3') },
                        grid: { color: getThemeColor('--color-1') }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: getThemeColor('--color-3'), precision: 0 },
                        grid: { color: getThemeColor('--color-1') }
                    }
                }
            }
        });
    }

    // ========== Admin Sections ==========
    function renderAdminSections() {
        const area = document.getElementById('ws-admin-area');
        if (!area || !isAdmin || !adminDataCache) return;

        const todayIps = adminDataCache.todayIps || {};
        const topIps = adminDataCache.topIps || {};
        const lastVisitors = adminDataCache.lastVisitors || [];

        const todaySorted = sortedEntriesObj(todayIps, 'count', 50);
        const topSorted = sortedEntriesObj(topIps, 'total', 20);

        let html = `<div class="ws-admin-section">
            <h3 style="color:#e74c3c;font-size:14px;margin-bottom:16px;">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="#e74c3c" style="vertical-align:middle;margin-right:4px">
                    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
                </svg>
                Admin — IP Addresses
            </h3>`;

        // Last 10 visitors
        html += `<div class="ws-admin-box">
            <h3>Recent visitors</h3>`;

        if (lastVisitors.length === 0) {
            html += '<div class="ws-empty">No recent visitors yet</div>';
        } else {
            html += `<table class="ws-ip-table">
                <thead><tr>
                    <th>Time</th>
                    <th>IP address</th>
                    <th>Location</th>
                    <th>ISP</th>
                </tr></thead><tbody>`;

            lastVisitors.forEach(v => {
                html += `<tr>
                    <td class="ws-ip-name">${escapeHtml(v.time || '-')}</td>
                    <td>${escapeHtml(v.ip || '-')}</td>
                    <td class="ws-ip-name">${escapeHtml(v.location || '-')}</td>
                    <td class="ws-ip-name">${escapeHtml(v.isp || '-')}</td>
                </tr>`;
            });

            html += '</tbody></table>';
        }
        html += '</div>';

        // Today's IPs
        html += `<div class="ws-admin-box">
            <h3>Today's visitors (${todaySorted.length} IPs)</h3>`;

        if (todaySorted.length === 0) {
            html += '<div class="ws-empty">No visitors today yet</div>';
        } else {
            html += `<table class="ws-ip-table">
                <thead><tr>
                    <th>IP address</th>
                    <th>Location</th>
                    <th>ISP</th>
                    <th>Last seen</th>
                    <th style="text-align:right">Visits</th>
                </tr></thead><tbody>`;

            todaySorted.forEach(([ip, info]) => {
                html += `<tr>
                    <td>${escapeHtml(ip)}</td>
                    <td class="ws-ip-name">${escapeHtml(info.location || '-')}</td>
                    <td class="ws-ip-name">${escapeHtml(info.isp || '-')}</td>
                    <td>${escapeHtml(info.last_seen || '-')}</td>
                    <td class="ws-ip-count">${info.count || 0}</td>
                </tr>`;
            });

            html += '</tbody></table>';
        }
        html += '</div>';

        // Top IPs all-time
        html += `<div class="ws-admin-box">
            <h3>Top visitors (all time)</h3>`;

        if (topSorted.length === 0) {
            html += '<div class="ws-empty">No data yet</div>';
        } else {
            html += `<table class="ws-ip-table">
                <thead><tr>
                    <th>IP address</th>
                    <th>Location</th>
                    <th>ISP</th>
                    <th>Last seen</th>
                    <th style="text-align:right">Total</th>
                </tr></thead><tbody>`;

            topSorted.forEach(([ip, info]) => {
                html += `<tr>
                    <td>${escapeHtml(ip)}</td>
                    <td class="ws-ip-name">${escapeHtml(info.location || '-')}</td>
                    <td class="ws-ip-name">${escapeHtml(info.isp || '-')}</td>
                    <td class="ws-ip-name">${escapeHtml(info.last_seen || '-')}</td>
                    <td class="ws-ip-count">${info.total || 0}</td>
                </tr>`;
            });

            html += '</tbody></table>';
        }
        html += '</div></div>';

        area.innerHTML = html;
    }

    // ========== Update Checker ==========
    function checkForUpdate() {
        if (!pluginConfig.updateCheck || !pluginConfig.githubRepo) return;

        const repo = pluginConfig.githubRepo;
        const url = `https://raw.githubusercontent.com/${repo}/main/WebStats/webstats-plugin.js`;

        fetch(url)
            .then(res => res.text())
            .then(script => {
                const match = script.match(/const PLUGIN_VERSION = '([^']+)'/);
                if (!match) return;

                const remoteVersion = match[1];
                if (remoteVersion === PLUGIN_VERSION) return;

                const local = PLUGIN_VERSION.split('.').map(Number);
                const remote = remoteVersion.split('.').map(Number);
                let isNewer = false;
                for (let i = 0; i < Math.max(local.length, remote.length); i++) {
                    const l = local[i] || 0;
                    const r = remote[i] || 0;
                    if (r > l) { isNewer = true; break; }
                    if (l > r) break;
                }

                if (isNewer) {
                    const storageKey = 'webstats_update_check';
                    const today = new Date().toISOString().split('T')[0];
                    if (localStorage.getItem(storageKey) === today) return;
                    localStorage.setItem(storageKey, today);

                    const indicator = document.getElementById('ws-update-indicator');
                    if (indicator) {
                        indicator.innerHTML = `<span class="ws-update-badge">Update: ${PLUGIN_VERSION} → ${remoteVersion}</span>`;
                    }

                    console.log(`[WebStats] Update available: ${PLUGIN_VERSION} → ${remoteVersion}`);
                    if (typeof sendToast === 'function') {
                        sendToast('warning important', 'WebStats', `Update available: ${PLUGIN_VERSION} → ${remoteVersion}`, false, false);
                    }
                }
            })
            .catch(() => {});
    }

    // ========== Escape HTML ==========
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ========== Keyboard ==========
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOpen) {
            closeModal();
        }
    });

    // ========== Theme Change Observer ==========
    function observeThemeChanges() {
        let lastBright = '';

        function checkTheme() {
            const bright = getComputedStyle(document.documentElement).getPropertyValue('--color-main-bright').trim();
            if (bright && bright !== lastBright) {
                lastBright = bright;
                if (modalOpen && statsData) {
                    const content = document.getElementById('ws-content');
                    if (content) {
                        const stats = calcStats(statsData.days || {});
                        renderDashboard(content, stats);
                    }
                }
            }
        }

        const observer = new MutationObserver(() => checkTheme());
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

        // Also poll periodically in case theme is applied via JS without attribute change
        setInterval(checkTheme, 2000);
    }

    // ========== Initialize ==========
    async function init() {
        detectAdmin();
        injectStyles();
        createModal();
        createButton();

        try {
            await loadChartJS();
        } catch (e) {
            console.warn('[WebStats] Could not load Chart.js:', e.message);
        }

        await loadPluginConfig();
        checkForUpdate();
        observeThemeChanges();

        console.log('[WebStats] Frontend plugin v' + PLUGIN_VERSION + ' loaded' + (isAdmin ? ' (admin)' : ''));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
