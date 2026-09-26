const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const qrcode = require('qrcode');
const archiver = require('archiver');
const http = require('http');
const { app: electronApp, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');

const app = express();
const PORT = 3000;
let secretToken;
const tokenPath = path.join(os.homedir(), '.fylo-token');
try {
    if (fs.existsSync(tokenPath)) {
        secretToken = fs.readFileSync(tokenPath, 'utf8').trim();
    } else {
        secretToken = crypto.randomBytes(16).toString('hex');
        fs.writeFileSync(tokenPath, secretToken, 'utf8');
    }
} catch (e) {
    secretToken = crypto.randomBytes(16).toString('hex');
}

let adminPassword = "fylo";
const adminPassPath = path.join(os.homedir(), '.fylo-admin');
try {
    if (fs.existsSync(adminPassPath)) {
        adminPassword = fs.readFileSync(adminPassPath, 'utf8').trim();
    } else {
        fs.writeFileSync(adminPassPath, adminPassword, 'utf8');
    }
} catch (e) {}

app.use(express.json());

let clipboardText = "";
let clipboardUpdatedBy = "";
let maxFileSizeMB = 500;
let devices = {};
let blockedDevices = {};
let mobileDevices = {};
let fileRegistry = [];
let pendingDownloads = {};
let streamRequests = new Set();
let webrtcSessions = {};
let downloadFolder = path.join(os.homedir(), 'Downloads');

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    
    // Pass 1: Look specifically for Windows Mobile Hotspot signatures (e.g., standard IPs or Wi-Fi Direct names containing '*')
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const isHotspotIp = iface.address === '192.168.137.1' || iface.address === '192.168.173.1';
                const isVirtualAdapter = name.includes('*');
                if (isHotspotIp || isVirtualAdapter) {
                    return iface.address;
                }
            }
        }
    }

    // Pass 2: Fallback to the first non-internal IPv4 interface
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

let selectedIp = null;

function getActiveIp() {
    return selectedIp || getLocalIp();
}

function getSecureAccessUrl() {
    return `http://${getActiveIp()}:${PORT}/?auth=${secretToken}`;
}

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(cookie => {
        const [key, value] = cookie.split('=');
        if (key && value) cookies[key.trim()] = value.trim();
    });
    return cookies;
}

function isLocalHostIp(ip) {
    if (!ip) return false;
    let cleanIp = ip.trim();
    if (cleanIp.startsWith('::ffff:')) cleanIp = cleanIp.substring(7);
    if (cleanIp === '127.0.0.1' || cleanIp === 'localhost' || ip === '::1') return true;
    const activeIp = (getActiveIp() || '').trim();
    const baselineIp = (getLocalIp() || '').trim();
    if (cleanIp === activeIp || cleanIp === baselineIp) return true;
    return false;
}

function parseDeviceDetails(userAgent = '', customName = '') {
    if (customName && typeof customName === 'string' && customName.trim()) {
        const trimmed = customName.trim();
        const isIos = /iphone|ipad|ipod/i.test(userAgent);
        const isAndroid = /android/i.test(userAgent);
        const isMobile = isIos || isAndroid || /mobile|tablet/i.test(userAgent);
        return {
            name: trimmed,
            kind: isIos ? 'ios' : (isAndroid ? 'android' : (isMobile ? 'mobile' : 'desktop')),
            model: trimmed
        };
    }

    const ua = userAgent || '';
    let kind = 'desktop';
    let baseModel = '';

    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);
    const isMobile = isIos || isAndroid || /mobile|tablet/i.test(ua);

    if (isIos) {
        kind = 'ios';
        if (/iphone/i.test(ua)) baseModel = 'iPhone';
        else if (/ipad/i.test(ua)) baseModel = 'iPad';
        else if (/ipod/i.test(ua)) baseModel = 'iPod';
        else baseModel = 'Apple iOS Device';
    } else if (isAndroid) {
        kind = 'android';
        
        // Samsung SM- Model Code Lookup
        const smMatch = ua.match(/SM-([A-Z0-9]+)/i);
        if (smMatch) {
            const smCode = ('SM-' + smMatch[1]).toUpperCase();
            if (smCode.startsWith('SM-S928')) baseModel = 'Samsung Galaxy S24 Ultra';
            else if (smCode.startsWith('SM-S926')) baseModel = 'Samsung Galaxy S24+';
            else if (smCode.startsWith('SM-S921')) baseModel = 'Samsung Galaxy S24';
            else if (smCode.startsWith('SM-S918')) baseModel = 'Samsung Galaxy S23 Ultra';
            else if (smCode.startsWith('SM-S916')) baseModel = 'Samsung Galaxy S23+';
            else if (smCode.startsWith('SM-S911')) baseModel = 'Samsung Galaxy S23';
            else if (smCode.startsWith('SM-S908')) baseModel = 'Samsung Galaxy S22 Ultra';
            else if (smCode.startsWith('SM-S906')) baseModel = 'Samsung Galaxy S22+';
            else if (smCode.startsWith('SM-S901')) baseModel = 'Samsung Galaxy S22';
            else if (smCode.startsWith('SM-G998')) baseModel = 'Samsung Galaxy S21 Ultra';
            else if (smCode.startsWith('SM-G996')) baseModel = 'Samsung Galaxy S21+';
            else if (smCode.startsWith('SM-G991')) baseModel = 'Samsung Galaxy S21';
            else if (smCode.startsWith('SM-G990')) baseModel = 'Samsung Galaxy S21 FE';
            else if (smCode.startsWith('SM-G988')) baseModel = 'Samsung Galaxy S20 Ultra';
            else if (smCode.startsWith('SM-G986')) baseModel = 'Samsung Galaxy S20+';
            else if (smCode.startsWith('SM-G980') || smCode.startsWith('SM-G981')) baseModel = 'Samsung Galaxy S20';
            else if (smCode.startsWith('SM-G975')) baseModel = 'Samsung Galaxy S10+';
            else if (smCode.startsWith('SM-G973')) baseModel = 'Samsung Galaxy S10';
            else if (smCode.startsWith('SM-G970')) baseModel = 'Samsung Galaxy S10e';
            else if (smCode.startsWith('SM-F946')) baseModel = 'Samsung Galaxy Z Fold 5';
            else if (smCode.startsWith('SM-F936')) baseModel = 'Samsung Galaxy Z Fold 4';
            else if (smCode.startsWith('SM-F926')) baseModel = 'Samsung Galaxy Z Fold 3';
            else if (smCode.startsWith('SM-F731')) baseModel = 'Samsung Galaxy Z Flip 5';
            else if (smCode.startsWith('SM-F721')) baseModel = 'Samsung Galaxy Z Flip 4';
            else if (smCode.startsWith('SM-F711')) baseModel = 'Samsung Galaxy Z Flip 3';
            else if (smCode.startsWith('SM-N986')) baseModel = 'Samsung Galaxy Note 20 Ultra';
            else if (smCode.startsWith('SM-N98')) baseModel = 'Samsung Galaxy Note 20';
            else if (smCode.startsWith('SM-N97')) baseModel = 'Samsung Galaxy Note 10';
            else if (smCode.startsWith('SM-A546')) baseModel = 'Samsung Galaxy A54';
            else if (smCode.startsWith('SM-A536')) baseModel = 'Samsung Galaxy A53';
            else if (smCode.startsWith('SM-A52')) baseModel = 'Samsung Galaxy A52';
            else if (smCode.startsWith('SM-A51')) baseModel = 'Samsung Galaxy A51';
            else if (smCode.startsWith('SM-A34')) baseModel = 'Samsung Galaxy A34';
            else if (smCode.startsWith('SM-A33')) baseModel = 'Samsung Galaxy A33';
            else if (smCode.startsWith('SM-S')) baseModel = 'Samsung Galaxy S-Series';
            else if (smCode.startsWith('SM-A')) baseModel = 'Samsung Galaxy A-Series';
            else if (smCode.startsWith('SM-M')) baseModel = 'Samsung Galaxy M-Series';
            else if (smCode.startsWith('SM-F')) baseModel = 'Samsung Galaxy Z Series';
            else if (smCode.startsWith('SM-T')) baseModel = 'Samsung Galaxy Tab';
            else baseModel = `Samsung ${smCode}`;
        }

        // Google Pixel
        if (!baseModel) {
            const pixelMatch = ua.match(/Pixel\s*([0-9a-zA-Z\s]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
            if (pixelMatch) baseModel = `Google Pixel ${pixelMatch[1].trim()}`;
        }

        // OnePlus
        if (!baseModel) {
            const opMatch = ua.match(/(?:OnePlus|ONEPLUS)\s*([0-9a-zA-Z\s+]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
            if (opMatch) baseModel = `OnePlus ${opMatch[1].trim()}`;
            else if (/OnePlus/i.test(ua)) baseModel = 'OnePlus Phone';
        }

        // Xiaomi / Redmi / POCO
        if (!baseModel) {
            const redmiMatch = ua.match(/Redmi\s*([0-9a-zA-Z\s]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
            if (redmiMatch) baseModel = `Redmi ${redmiMatch[1].trim()}`;
            else {
                const pocoMatch = ua.match(/POCO\s*([0-9a-zA-Z\s]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
                if (pocoMatch) baseModel = `POCO ${pocoMatch[1].trim()}`;
                else {
                    const miMatch = ua.match(/(?:Xiaomi|Mi)\s*([0-9a-zA-Z\s]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
                    if (miMatch) baseModel = `Xiaomi ${miMatch[1].trim()}`;
                }
            }
        }

        // Motorola
        if (!baseModel) {
            const motoMatch = ua.match(/moto\s*([0-9a-zA-Z\s]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
            if (motoMatch) baseModel = `Motorola ${motoMatch[1].trim()}`;
        }

        // OPPO / Vivo / Realme
        if (!baseModel) {
            const realmeMatch = ua.match(/Realme\s*([0-9a-zA-Z\s]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
            if (realmeMatch) baseModel = `Realme ${realmeMatch[1].trim()}`;
            else {
                const oppoMatch = ua.match(/OPPO\s*([0-9a-zA-Z\s]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
                if (oppoMatch) baseModel = `OPPO ${oppoMatch[1].trim()}`;
                else {
                    const vivoMatch = ua.match(/vivo\s*([0-9a-zA-Z\s]+?)(?=\sBuild|\s*;\s*|\)|\/|$)/i);
                    if (vivoMatch) baseModel = `Vivo ${vivoMatch[1].trim()}`;
                }
            }
        }

        // Fallback Android model extraction
        if (!baseModel) {
            const uaMatch = ua.match(/Android[^;]+;\s*([^;\)]+)/i);
            if (uaMatch && uaMatch[1]) {
                const rawModel = uaMatch[1].replace(/Build\/.*$/i, '').trim();
                if (rawModel && rawModel.length < 35 && !rawModel.toLowerCase().startsWith('wv') && rawModel !== 'K') {
                    baseModel = rawModel;
                }
            }
        }

        if (!baseModel) baseModel = 'Android Phone';
    } else if (isMobile) {
        kind = 'mobile';
        baseModel = 'Mobile Device';
    } else {
        kind = 'desktop';
        baseModel = 'PC Browser';
    }

    const detectedModelName = `${baseModel} (Web Companion)`;
    return { name: detectedModelName, kind, model: baseModel };
}

app.use((req, res, next) => {
    if (req.socket) req.socket.setNoDelay(true);

    // High performance CORS headers for LAN/Mobile communication
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, X-Session-Id, X-Client-Name, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    const cookies = parseCookies(req.headers.cookie);
    let sessionId = req.headers['x-session-id'] ||
                    req.headers['session-id'] ||
                    (req.query && (req.query['x-session-id'] || req.query.sessionId || req.query.session || req.query.deviceId)) ||
                    (cookies && (cookies['x-session-id'] || cookies['fylo_session_id'] || cookies['sessionId'] || cookies['deviceId'])) ||
                    (req.body && (req.body.sessionId || req.body['x-session-id'] || req.body.deviceId)) ||
                    '';

    const isHost = isLocalHostIp(req.ip);

    if (!sessionId) {
        if (!isHost) {
            sessionId = 'client_' + req.ip.replace(/[^a-zA-Z0-9]/g, '_');
            res.setHeader('Set-Cookie', `fylo_session_id=${sessionId}; Path=/; SameSite=Lax`);
        } else {
            sessionId = 'host_pc';
        }
    }
    sessionId = String(sessionId).trim();
    req.sessionId = sessionId;

    // Device registration in middleware:
    // When ANY request arrives from a non-host IP with x-session-id (or query or cookie),
    // immediately record/update devices[sessionId]. Never skip this, even for public APIs!
    if (!isHost && sessionId) {
        if (blockedDevices[sessionId]) {
            return res.status(403).json({ error: 'kicked' });
        }

        const existingDev = devices[sessionId];
        const clientNameHeader = req.headers['x-client-name'];
        let customName = '';
        if (clientNameHeader) {
            try { customName = decodeURIComponent(clientNameHeader).trim(); } catch (e) {}
        } else if (existingDev && existingDev.name && !existingDev.name.includes('(Web Companion)') && existingDev.name !== 'Mobile Companion') {
            customName = existingDev.name;
        }

        const detected = parseDeviceDetails(req.headers['user-agent'] || '', customName);
        const detectedModelName = customName || detected.name;
        const detectedKind = detected.kind;
        const isNative = !!(mobileDevices[sessionId]);

        devices[sessionId] = {
            id: sessionId,
            ip: req.ip,
            name: isNative ? (mobileDevices[sessionId].name || detectedModelName) : (detectedModelName || 'Mobile Companion'),
            kind: isNative ? 'android' : detectedKind,
            isHost: false,
            lastActive: Date.now(),
            isWebClient: !isNative,
            model: isNative ? (mobileDevices[sessionId].model || detected.model) : (detected.model || 'Web Companion')
        };

        if (isNative && mobileDevices[sessionId]) {
            mobileDevices[sessionId].lastActive = Date.now();
        }
    }

    if (isHost) {
        return next();
    }

    // Admin Security Lockdown: Remote clients must NEVER be allowed to access admin management endpoints
    if (!isHost && req.path.startsWith('/api/admin')) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }

    // Public / Handshake API endpoints that must be reachable by mobile apps and clients without prior session cookie
    const isPublicApi = req.path.startsWith('/api/mobile/') ||
                        req.path.startsWith('/api/pc/explorer') ||
                        req.path.startsWith('/api/download') ||
                        req.path === '/api/files' ||
                        req.path.startsWith('/api/files/') ||
                        req.path === '/api/clipboard' ||
                        req.path === '/api/qrcode' ||
                        req.path === '/api/connection-info' ||
                        req.path === '/api/network-url' ||
                        req.path === '/api/network-interfaces' ||
                        req.path === '/api/heartbeat' ||
                        req.path === '/api/me' ||
                        req.path === '/fylo.apk' ||
                        req.path === '/api/apk/download';

    if (isPublicApi) {
        return next();
    }

    const urlToken = req.query.auth;
    const sessionToken = cookies['fylo_session'];
    const headerToken = req.headers['x-auth-token'] || req.headers['authorization'];

    if (urlToken === secretToken) {
        const newSessionId = sessionId || (crypto.randomBytes(8).toString('hex') + Date.now().toString(36));
        res.setHeader('Set-Cookie', [
            `fylo_session=${secretToken}; Path=/; HttpOnly; Max-Age=86400`,
            `fylo_session_id=${newSessionId}; Path=/; Max-Age=86400`
        ]);
        const detected = parseDeviceDetails(req.headers['user-agent'] || '');
        devices[newSessionId] = {
            id: newSessionId,
            ip: req.ip,
            name: detected.name || 'Mobile Companion',
            kind: detected.kind,
            isHost: false,
            lastActive: Date.now(),
            isWebClient: true,
            model: detected.model || 'Web Companion'
        };
        return res.redirect('/');
    }

    if (sessionToken === secretToken || headerToken === secretToken || (headerToken && headerToken.includes(secretToken))) {
        return next();
    }

    // Friendly, beautiful landing page if accessing web UI without token
    return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Fylo - Pair Device</title>
            <style>
                body { background: #090d16; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                .card { background: #0e1726; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 32px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
                h2 { color: #06b6d4; margin-top: 0; font-size: 24px; font-weight: 800; }
                p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
                .token-form { margin-top: 24px; display: flex; flex-direction: column; gap: 12px; }
                input { background: #090d16; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 12px 16px; color: #fff; font-size: 15px; outline: none; }
                input:focus { border-color: #06b6d4; }
                button { background: #06b6d4; color: #000; font-weight: 700; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1); }
                button:hover { transform: scale(1.02); }
                .tip { font-size: 12px; color: #64748b; margin-top: 16px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>⚡ Pair with Fylo PC</h2>
                <p>To connect this browser to your Fylo host, please scan the QR code displayed on your PC screen, or enter the connection token below:</p>
                <form class="token-form" method="GET" action="/">
                    <input type="text" name="auth" placeholder="Paste connection token" required autofocus />
                    <button type="submit">Connect to Host</button>
                </form>
                <div class="tip">💡 Tip: You can also use the Fylo Android App for seamless 1-tap connection.</div>
            </div>
        </body>
        </html>
    `);
});

app.get('/', (req, res) => {
    try {
        const htmlPath = path.join(electronApp.getAppPath(), 'public', 'index.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.send(html);
    } catch (err) {
        res.status(500).send('Internal Server Error: Missing interface payload asset.');
    }
});

app.get('/api/me', (req, res) => {
    const isHost = isLocalHostIp(req.ip);
    res.json({ isHost });
});

app.get('/api/qrcode', (req, res) => {
    qrcode.toString(getSecureAccessUrl(), { type: 'svg', margin: 1 }, (err, svg) => {
        if (err) return res.status(500).send('');
        res.type('image/svg+xml').send(svg);
    });
});

const { execSync } = require('child_process');

function getNetworkName(ip) {
    if (ip === '192.168.137.1' || ip === '192.168.173.1') {
        return 'Mobile Hotspot';
    }
    
    if (process.platform === 'win32') {
        try {
            const stdout = execSync('netsh wlan show interfaces', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const line = stdout.split('\n').find(l => l.includes('SSID') && !l.includes('BSSID'));
            if (line) {
                const parts = line.split(':');
                if (parts.length > 1) {
                    return `Wi-Fi (${parts[1].trim()})`;
                }
            }
        } catch (e) {
            // netsh command failed or not on Wi-Fi
        }
    }
    
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.address === ip) {
                if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wireless')) {
                    return 'Wi-Fi';
                }
                if (name.toLowerCase().includes('ethernet')) {
                    return 'Ethernet';
                }
                return name;
            }
        }
    }

    return 'Local Network';
}

app.get('/api/network-url', (req, res) => {
    const activeIp = getActiveIp();
    const networkName = getNetworkName(activeIp);
    const isHotspot = (activeIp === '192.168.137.1' || activeIp === '192.168.173.1' || activeIp.startsWith('192.168.137.'));
    res.json({ url: getSecureAccessUrl(), networkName, activeIp, isHotspot });
});

app.get('/api/connection-info', (req, res) => {
    const activeIp = getActiveIp();
    const isHotspot = (activeIp === '192.168.137.1' || activeIp === '192.168.173.1' || activeIp.startsWith('192.168.137.'));
    res.json({
        hostIp: activeIp,
        port: PORT,
        auth: secretToken,
        networkName: getNetworkName(activeIp),
        isHotspot,
        version: '4.0.0'
    });
});

app.get('/api/network-interfaces', (req, res) => {
    const interfaces = os.networkInterfaces();
    const list = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const nameLabel = getNetworkName(iface.address);
                list.push({
                    address: iface.address,
                    name: nameLabel,
                    adapter: name
                });
            }
        }
    }
    const activeIp = getActiveIp();
    const isHotspot = (activeIp === '192.168.137.1' || activeIp === '192.168.173.1' || activeIp.startsWith('192.168.137.'));
    res.json({ interfaces: list, selectedIp: activeIp, activeIp, networkName: getNetworkName(activeIp), isHotspot });
});

app.post('/api/select-interface', (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    const { ip } = req.body;
    if (ip) {
        const interfaces = os.networkInterfaces();
        let valid = false;
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && iface.address === ip) {
                    valid = true;
                    break;
                }
            }
        }
        if (valid) {
            selectedIp = ip;
            const activeIp = getActiveIp();
            const isHotspot = (activeIp === '192.168.137.1' || activeIp === '192.168.173.1' || activeIp.startsWith('192.168.137.'));
            return res.json({ success: true, url: getSecureAccessUrl(), networkName: getNetworkName(activeIp), activeIp, isHotspot });
        }
    }
    res.status(400).json({ error: 'Invalid IP address' });
});

app.post('/api/open-hotspot-settings', (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    try {
        if (shell && typeof shell.openExternal === 'function') {
            shell.openExternal('ms-settings:network-mobilehotspot');
            return res.json({ success: true, method: 'electron-shell' });
        }
        if (process.platform === 'win32') {
            const { exec } = require('child_process');
            exec('start ms-settings:network-mobilehotspot', (err) => {
                if (err) console.error('Failed to open hotspot settings:', err);
            });
            return res.json({ success: true, method: 'win32-cmd' });
        }
        res.json({ success: false, message: 'Not supported on this platform' });
    } catch (e) {
        console.error('Error opening hotspot settings:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/register-manifest', (req, res) => {
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    const incomingMap = new Map();
    files.forEach(f => {
        if (!f || !f.id) return;
        if (!f.ownerSessionId) {
            f.ownerSessionId = req.sessionId || 'host';
        }
        if (!f.sharedAt) {
            f.sharedAt = Date.now();
        }
        if (!f.downloadUrl) {
            f.downloadUrl = `/api/download/${f.id}`;
        }
        if (!f.uploadedBy) {
            f.uploadedBy = f.ownerSessionId === 'mobile' ? 'Mobile Phone' : 'Host PC';
        }
        if (!f.type) {
            f.type = 'file';
        }
        incomingMap.set(f.id, f);
    });

    const merged = [];
    const seenIds = new Set();
    files.forEach(f => {
        if (f && f.id && incomingMap.has(f.id)) {
            merged.push(incomingMap.get(f.id));
            seenIds.add(f.id);
        }
    });

    fileRegistry.forEach(f => {
        if (f && f.id && !seenIds.has(f.id)) {
            merged.push(f);
            seenIds.add(f.id);
        }
    });

    fileRegistry = merged;
    res.json({ success: true, count: fileRegistry.length });
});

// Register a folder for sharing (Electron host only)
app.post('/api/register-folder', (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Missing folderPath' });

    try {
        if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
            return res.status(400).json({ error: 'Path is not a valid directory' });
        }

        // Walk directory recursively to count files and total size
        let totalSize = 0;
        let fileCount = 0;
        function walkDir(dir) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath);
                } else if (entry.isFile()) {
                    try {
                        totalSize += fs.statSync(fullPath).size;
                        fileCount++;
                    } catch (e) { /* skip inaccessible files */ }
                }
            }
        }
        walkDir(folderPath);

        const folderName = path.basename(folderPath);
        const id = crypto.randomBytes(8).toString('hex') + Date.now().toString(36);

        let sizeLabel;
        if (totalSize >= 1024 * 1024 * 1024) {
            sizeLabel = (totalSize / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
        } else {
            sizeLabel = (totalSize / (1024 * 1024)).toFixed(1) + 'MB';
        }

        const folderEntry = {
            id: id,
            name: folderName,
            size: totalSize,
            sizeLabel: sizeLabel,
            ext: 'folder',
            type: 'folder',
            path: folderPath,
            fileCount: fileCount,
            sharedAt: Date.now(),
            downloadUrl: `/api/download/${id}`,
            ownerSessionId: req.sessionId || 'host'
        };

        fileRegistry.unshift(folderEntry);
        res.json({ success: true, entry: folderEntry });
    } catch (e) {
        console.error('Folder registration error:', e);
        res.status(500).json({ error: 'Failed to register folder' });
    }
});

app.get('/api/files', (req, res) => {
    const sorted = [...fileRegistry].sort((a, b) => {
        const timeA = Number(a.sharedAt || a.timestamp || a.modified || a.mtime || 0);
        const timeB = Number(b.sharedAt || b.timestamp || b.modified || b.mtime || 0);
        return timeB - timeA;
    });
    res.json(sorted);
});

app.delete('/api/files', (req, res) => {
    fileRegistry = [];
    res.json({ success: true });
});

app.get('/api/poll-streams', (req, res) => {
    const webrtcPending = Object.keys(webrtcSessions).filter(id => !webrtcSessions[id].answer);
    res.json({ 
        requestedIds: Array.from(streamRequests),
        webrtcPending: webrtcPending
    });
});

// WebRTC Signaling Endpoints
app.post('/api/webrtc/signal/:id/initiate', (req, res) => {
    const fileId = req.params.id;
    webrtcSessions[fileId] = {
        offer: req.body.offer,
        answer: null,
        receiverCandidates: [],
        senderCandidates: [],
        timestamp: Date.now()
    };
    res.json({ success: true });
});

app.get('/api/webrtc/signal/:id/offer', (req, res) => {
    const fileId = req.params.id;
    const session = webrtcSessions[fileId];
    if (session && session.offer) {
        return res.json({ offer: session.offer });
    }
    res.status(404).json({ error: 'No offer found' });
});

app.post('/api/webrtc/signal/:id/answer', (req, res) => {
    const fileId = req.params.id;
    const session = webrtcSessions[fileId];
    if (session) {
        session.answer = req.body.answer;
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Session not found' });
});

app.get('/api/webrtc/signal/:id/answer', (req, res) => {
    const fileId = req.params.id;
    const session = webrtcSessions[fileId];
    if (session && session.answer) {
        return res.json({ answer: session.answer });
    }
    res.json({ answer: null });
});

app.post('/api/webrtc/signal/:id/candidate', (req, res) => {
    const fileId = req.params.id;
    const { candidate, role } = req.body;
    const session = webrtcSessions[fileId];
    if (session) {
        if (candidate && typeof candidate.candidate === 'string') {
            const parts = candidate.candidate.split(' ');
            if (parts.length >= 5) {
                const ipOrHost = parts[4];
                if (ipOrHost.endsWith('.local')) {
                    if (role === 'sender') {
                        parts[4] = localIp;
                    } else {
                        let clientIp = req.ip || '127.0.0.1';
                        if (clientIp.startsWith('::ffff:')) {
                            clientIp = clientIp.substring(7);
                        }
                        if (clientIp === '::1' || clientIp === '127.0.0.1') {
                            clientIp = localIp;
                        }
                        parts[4] = clientIp;
                    }
                    candidate.candidate = parts.join(' ');
                }
            }
        }

        if (role === 'sender') {
            session.senderCandidates.push(candidate);
        } else {
            session.receiverCandidates.push(candidate);
        }
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Session not found' });
});

app.get('/api/webrtc/signal/:id/candidates', (req, res) => {
    const fileId = req.params.id;
    const role = req.query.role;
    const session = webrtcSessions[fileId];
    if (session) {
        const candidates = (role === 'sender') ? session.receiverCandidates : session.senderCandidates;
        return res.json({ candidates });
    }
    res.json({ candidates: [] });
});

app.delete('/api/webrtc/signal/:id', (req, res) => {
    delete webrtcSessions[req.params.id];
    res.json({ success: true });
});

app.get('/api/download/:id', (req, res) => {
    const fileId = req.params.id;
    const meta = fileRegistry.find(f => f.id === fileId);

    if (!meta) {
        return res.status(404).send('Resource metadata not registered.');
    }

    if (req.socket) {
        req.socket.setTimeout(0);
        req.socket.setKeepAlive(true, 10000);
        req.socket.setNoDelay(true);
    }

    // Handle folder downloads — zip on-the-fly
    if (meta.type === 'folder' && meta.path) {
        try {
            if (!fs.existsSync(meta.path) || !fs.statSync(meta.path).isDirectory()) {
                return res.status(404).send('Folder no longer exists on disk.');
            }

            const zipName = meta.name + '.zip';
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${encodeURIComponent(zipName)}`);
            res.setHeader('Cache-Control', 'no-cache, no-transform');

            const archive = archiver('zip', { zlib: { level: 5 } });

            archive.on('error', (err) => {
                console.error('Archive error:', err);
                if (!res.headersSent) {
                    res.status(500).send('Zip creation failed.');
                }
            });

            archive.pipe(res);
            archive.directory(meta.path, meta.name);
            archive.finalize();
            return;
        } catch (e) {
            console.error('Folder zip stream error:', e);
            return res.status(500).send('Failed to stream folder as zip.');
        }
    }

    if (meta.path) {
        try {
            if (fs.existsSync(meta.path)) {
                const stat = fs.statSync(meta.path);
                const fileSize = stat.size;
                const range = req.headers.range;

                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Cache-Control', 'no-cache, no-transform');

                if (range) {
                    const parts = range.replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                    if (start >= fileSize || end >= fileSize || start > end) {
                        res.setHeader('Content-Range', `bytes */${fileSize}`);
                        return res.status(416).send('Requested Range Not Satisfiable');
                    }

                    const chunksize = (end - start) + 1;
                    res.status(206);
                    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                    res.setHeader('Content-Length', chunksize);
                    res.setHeader('Content-Type', 'application/octet-stream');
                    res.setHeader('Content-Disposition', `attachment; filename="${meta.name}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`);

                    const readStream = fs.createReadStream(meta.path, { start, end });
                    readStream.pipe(res);
                    return;
                } else {
                    res.setHeader('Content-Type', 'application/octet-stream');
                    res.setHeader('Content-Length', fileSize);
                    res.setHeader('Content-Disposition', `attachment; filename="${meta.name}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
                    const readStream = fs.createReadStream(meta.path);
                    readStream.pipe(res);
                    return;
                }
            }
        } catch (e) {
            console.error("Local disk stream error:", e);
        }
    }

    pendingDownloads[fileId] = res;
    streamRequests.add(fileId);

    req.on('close', () => {
        streamRequests.delete(fileId);
        delete pendingDownloads[fileId];
    });
});

app.post('/api/stream-ingress/:id', (req, res) => {
    const fileId = req.params.id;
    const clientRes = pendingDownloads[fileId];
    const meta = fileRegistry.find(f => f.id === fileId);

    if (!clientRes || !meta) {
        return res.status(410).json({ error: 'Download pipe disconnected or timed out' });
    }

    streamRequests.delete(fileId);
    delete pendingDownloads[fileId];

    clientRes.setHeader('Content-Type', 'application/octet-stream');
    clientRes.setHeader('Content-Length', meta.size);
    clientRes.setHeader('Content-Disposition', `attachment; filename="${meta.name}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`);

    req.pipe(clientRes);

    req.on('end', () => {
        res.json({ success: true });
    });

    req.on('error', () => {
        if (!clientRes.writableEnded) {
            clientRes.end();
        }
    });
});

app.delete('/api/files/:id', (req, res) => {
    fileRegistry = fileRegistry.filter(f => f.id !== req.params.id);
    res.json({ success: true });
});

app.get('/api/clipboard', (req, res) => {
    res.json({ text: clipboardText, updatedBy: clipboardUpdatedBy });
});

app.post('/api/clipboard', (req, res) => {
    clipboardText = req.body.text || "";
    const sender = devices[req.sessionId];
    clipboardUpdatedBy = req.body.updatedBy || (sender ? sender.name : "Host Computer");
    
    // Always write to host system clipboard on explicit push from phone/web
    try {
        if (clipboard && typeof clipboard.writeText === 'function') {
            clipboard.writeText(clipboardText);
            lastSystemClipboardText = clipboardText;
        } else if (process.platform === 'win32') {
            const { spawn } = require('child_process');
            const clipProc = spawn('clip.exe');
            clipProc.stdin.end(clipboardText);
        }
    } catch(e) {
        console.warn("Failed to write to host clipboard:", e.message);
    }
    res.json({ success: true });
});

let clipboardSyncEnabled = false;
let lastSystemClipboardText = "";
try {
    lastSystemClipboardText = clipboard.readText();
    clipboardText = lastSystemClipboardText;
    clipboardUpdatedBy = "Host Computer";
} catch(e) {}

setInterval(() => {
    if (!clipboardSyncEnabled) return;
    try {
        const currentText = clipboard.readText();
        if (currentText !== lastSystemClipboardText) {
            lastSystemClipboardText = currentText;
            clipboardText = currentText;
            clipboardUpdatedBy = "Host Computer";
        }
    } catch(e) {}
}, 1000);

app.get('/api/devices', (req, res) => {
    const now = Date.now();
    const deviceMap = { ...devices };

    // Include native mobile devices if not already present
    Object.values(mobileDevices).forEach(m => {
        if (!deviceMap[m.id]) {
            deviceMap[m.id] = {
                id: m.id,
                name: m.name || m.model || 'Android Phone',
                kind: 'android',
                isHost: false,
                lastActive: m.lastActive
            };
        } else {
            deviceMap[m.id].lastActive = Math.max(deviceMap[m.id].lastActive || 0, m.lastActive || 0);
        }
    });

    const deviceList = Object.values(deviceMap).map(d => {
        const isOnline = (now - d.lastActive) <= 35000;
        return {
            id: d.id,
            name: d.name,
            kind: d.kind,
            online: isOnline,
            isHost: d.isHost,
            isSelf: d.id === req.sessionId
        };
    });

    const blockedList = Object.values(blockedDevices);
    res.json({ devices: deviceList, blocked: blockedList });
});

// Universal Heartbeat Endpoint (accepts { sessionId, name, kind })
app.post('/api/heartbeat', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = (req.body && (req.body.sessionId || req.body['x-session-id'])) ||
                      req.headers['x-session-id'] ||
                      req.headers['session-id'] ||
                      (req.query && (req.query['x-session-id'] || req.query.sessionId)) ||
                      (cookies && (cookies['x-session-id'] || cookies['sessionId'] || cookies['fylo_session_id'])) ||
                      req.sessionId;

    if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
    }

    const { name, kind, model } = req.body || {};
    const existing = devices[sessionId];
    const clientNameHeader = req.headers['x-client-name'];
    let customName = name || '';
    if (!customName && clientNameHeader) {
        try { customName = decodeURIComponent(clientNameHeader).trim(); } catch (e) {}
    } else if (!customName && existing && existing.name && !existing.name.includes('(Web Companion)') && existing.name !== 'Mobile Companion') {
        customName = existing.name;
    }

    const detected = parseDeviceDetails(req.headers['user-agent'] || '', customName);
    const detectedModelName = customName || detected.name;
    const detectedKind = kind || (existing ? existing.kind : detected.kind);
    const isHost = isLocalHostIp(req.ip);
    const isNative = !!(mobileDevices[sessionId]);

    devices[sessionId] = {
        id: sessionId,
        ip: req.ip,
        name: isNative ? (mobileDevices[sessionId].name || detectedModelName) : (detectedModelName || 'Mobile Companion'),
        kind: isNative ? 'android' : detectedKind,
        isHost: isHost,
        lastActive: Date.now(),
        isWebClient: !isNative,
        model: isNative ? (mobileDevices[sessionId].model || detected.model) : (model || detected.model || 'Web Companion')
    };

    if (isNative && mobileDevices[sessionId]) {
        mobileDevices[sessionId].lastActive = Date.now();
        if (name) mobileDevices[sessionId].name = name;
    }

    res.json({ success: true, lastActive: devices[sessionId].lastActive, device: devices[sessionId] });
});

app.post('/api/devices/:id/kick', (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    const targetId = req.params.id;
    if (targetId && targetId !== req.sessionId) {
        const targetDevice = devices[targetId];
        blockedDevices[targetId] = {
            id: targetId,
            name: targetDevice ? targetDevice.name : "Unknown Device"
        };
        delete devices[targetId];
        return res.json({ success: true });
    }
    res.status(400).json({ success: false });
});

app.post('/api/devices/:id/unblock', (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    const targetId = req.params.id;
    if (targetId) {
        delete blockedDevices[targetId];
        return res.json({ success: true });
    }
    res.status(400).json({ success: false });
});

app.get('/api/settings', (req, res) => {
    res.json({ maxFileSizeMB });
});

app.patch('/api/settings', (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    if (typeof req.body.maxFileSizeMB === 'number') {
        maxFileSizeMB = req.body.maxFileSizeMB;
    }
    res.json({ maxFileSizeMB });
});

// ==========================================
// Fylo v4: Mobile Device Manager & Proxy Endpoints
// ==========================================

// Register mobile device on QR scan handshake
app.post('/api/mobile/connect', (req, res) => {
    const { deviceId, deviceName, model, ip, port, authToken, readOnly, storage, battery, allowFullPhoneAccess } = req.body;

    // Validate token: allow if matched or on local network
    const isLocalReq = req.ip === '127.0.0.1' || req.ip === '::1' || 
                       req.ip.includes('192.168.') || req.ip.includes('10.') || req.ip.includes('172.') ||
                       req.ip.includes('::ffff:192.168.') || req.ip.includes('::ffff:10.');

    if (authToken && authToken !== secretToken && authToken !== 'lan' && !isLocalReq) {
        return res.status(403).json({ error: 'Invalid authentication token. Please scan the QR code on PC.' });
    }

    if (!deviceId) {
        return res.status(400).json({ error: 'Missing device information' });
    }

    // Resolve real client IP: if mobile provided a valid LAN IP, use it. Otherwise use socket remoteAddress.
    let resolvedIp = ip;
    const socketRemote = (req.socket.remoteAddress || req.ip || '').replace(/^::ffff:/, '');
    if (!resolvedIp || resolvedIp === '127.0.0.1' || resolvedIp === 'Detecting...' || resolvedIp.startsWith('127.')) {
        resolvedIp = socketRemote || '127.0.0.1';
    }

    const phonePort = port ? parseInt(port, 10) : 8080;
    const phoneName = deviceName || model || 'Android Phone';

    mobileDevices[deviceId] = {
        id: deviceId,
        name: phoneName,
        model: model || 'Android Device',
        ip: resolvedIp,
        port: phonePort,
        readOnly: readOnly !== undefined ? readOnly : true,
        allowFullPhoneAccess: allowFullPhoneAccess !== undefined ? !!allowFullPhoneAccess : true,
        storage: storage || { total: 0, free: 0 },
        battery: battery !== undefined ? battery : null,
        lastActive: Date.now()
    };

    // Mirror to general devices map for global dashboard & devices view
    devices[deviceId] = {
        id: deviceId,
        name: phoneName,
        kind: 'android',
        isHost: false,
        lastActive: Date.now()
    };

    console.log(`[Fylo v4] Mobile connected: ${phoneName} (${resolvedIp}:${phonePort}), Read-Only: ${readOnly}, Full Phone Access: ${mobileDevices[deviceId].allowFullPhoneAccess}`);
    res.json({ 
        success: true, 
        message: 'Paired with Fylo PC', 
        hostIp: getActiveIp(),
        hostName: os.hostname(),
        authToken: secretToken 
    });
});

// Get connected mobile devices
app.get('/api/mobile/devices', (req, res) => {
    const now = Date.now();
    // Active keepalive probe to phone if screen is locked and heartbeat hasn't arrived in > 6s
    Object.values(mobileDevices).forEach(d => {
        if ((now - d.lastActive) > 6000 && (now - d.lastActive) <= 60000 && d.ip && d.port) {
            const probeUrl = `http://${d.ip}:${d.port}/api/info?auth=${secretToken}`;
            const probeReq = http.get(probeUrl, (pRes) => {
                if (pRes.statusCode === 200) {
                    let pData = '';
                    pRes.on('data', c => pData += c);
                    pRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(pData);
                            d.lastActive = Date.now();
                            if (parsed.battery !== undefined && parsed.battery >= 0) d.battery = parsed.battery;
                            if (parsed.name) d.name = parsed.name;
                        } catch (e) {}
                    });
                }
            });
            probeReq.on('error', () => {});
            probeReq.setTimeout(2000, () => probeReq.destroy());
        }
    });

    const list = Object.values(mobileDevices).map(d => ({
        id: d.id,
        name: d.name,
        model: d.model,
        ip: (d.ip || '').replace(/^::ffff:/, ''),
        port: d.port,
        readOnly: d.readOnly,
        allowFullPhoneAccess: d.allowFullPhoneAccess !== false,
        storage: d.storage,
        battery: d.battery,
        online: (now - d.lastActive) <= 35000,
        isWebClient: false
    }));

    // Include active remote web companion clients (e.g. mobile Chrome / Safari)
    Object.values(devices).forEach(d => {
        if (!d.isHost && (d.isWebClient || d.kind === 'android' || d.kind === 'mobile' || d.kind === 'ios') && !list.some(m => m.id === d.id)) {
            const isOnline = (now - d.lastActive) <= 35000;
            list.push({
                id: d.id,
                name: d.name || 'Mobile Phone',
                model: d.model || 'Web Browser Companion',
                ip: (d.ip || '').replace(/^::ffff:/, ''),
                port: PORT,
                readOnly: true,
                allowFullPhoneAccess: false,
                storage: { total: 0, free: 0 },
                battery: null,
                online: isOnline,
                isWebClient: true
            });
        }
    });

    res.json(list);
});

// Update mobile device capabilities (e.g. storage access permission)
app.post(['/api/device/update-capabilities', '/api/mobile/update-capabilities'], (req, res) => {
    const { deviceId, allowFullPhoneAccess } = req.body;
    if (deviceId && mobileDevices[deviceId]) {
        if (allowFullPhoneAccess !== undefined) {
            mobileDevices[deviceId].allowFullPhoneAccess = !!allowFullPhoneAccess;
        }
        mobileDevices[deviceId].lastActive = Date.now();
        console.log(`[Fylo v4] Mobile capabilities updated for ${mobileDevices[deviceId].name}: allowFullPhoneAccess=${mobileDevices[deviceId].allowFullPhoneAccess}`);
        return res.json({ success: true, allowFullPhoneAccess: mobileDevices[deviceId].allowFullPhoneAccess });
    }
    res.json({ success: true });
});

// Mobile heartbeat
app.post('/api/mobile/heartbeat', (req, res) => {
    const { deviceId, battery, storage, readOnly, allowFullPhoneAccess } = req.body;
    if (deviceId && mobileDevices[deviceId]) {
        mobileDevices[deviceId].lastActive = Date.now();
        if (battery !== undefined) mobileDevices[deviceId].battery = battery;
        if (storage) mobileDevices[deviceId].storage = storage;
        if (readOnly !== undefined) mobileDevices[deviceId].readOnly = readOnly;
        if (allowFullPhoneAccess !== undefined) mobileDevices[deviceId].allowFullPhoneAccess = !!allowFullPhoneAccess;
        if (devices[deviceId]) {
            devices[deviceId].lastActive = Date.now();
        }
        return res.json({ success: true });
    }
    if (deviceId && devices[deviceId]) {
        devices[deviceId].lastActive = Date.now();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Device not found', needReconnect: true });
});

// Disconnect mobile device
app.post('/api/mobile/disconnect', (req, res) => {
    const { deviceId } = req.body;
    if (deviceId && mobileDevices[deviceId]) {
        delete mobileDevices[deviceId];
    }
    if (deviceId && devices[deviceId]) {
        delete devices[deviceId];
    }
    res.json({ success: true });
});

// Direct APK Download Endpoint
const apkCandidates = [
    path.join(__dirname, 'dist', 'fylo-4.0.0.apk'),
    path.join(__dirname, 'dist', 'fylo-v4.0.0.apk', 'app-release.apk'),
    path.join(__dirname, 'dist', 'fylo-v4.0.0.apk'),
    path.join(__dirname, 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
];

function getExistingApkPath() {
    for (const p of apkCandidates) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                return p;
            }
        } catch(e) {}
    }
    return null;
}

app.get(['/fylo.apk', '/api/apk/download'], (req, res) => {
    const apkPath = getExistingApkPath();
    if (apkPath) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', 'attachment; filename="fylo-v4.0.0.apk"');
        return res.sendFile(apkPath);
    }
    res.status(404).send('Fylo APK file not found on PC host.');
});

// Proxy directory listing from mobile
app.get('/api/mobile/fs/list', (req, res) => {
    const { deviceId, path: dirPath } = req.query;
    const device = mobileDevices[deviceId];
    if (!device) {
        const webDevice = devices[deviceId];
        if (webDevice) {
            const webFiles = fileRegistry.filter(f => f.uploadedBy === webDevice.name || f.sessionId === deviceId || f.uploadedBy === 'Mobile Companion');
            return res.json({
                isWebCompanion: true,
                path: dirPath || '/storage/emulated/0',
                message: 'Web Companion Mode: Showing files uploaded during this session.',
                items: webFiles.map(f => ({
                    name: f.name,
                    path: f.path || f.name,
                    isDir: false,
                    isDirectory: false,
                    size: f.size,
                    mtime: f.timestamp || Date.now(),
                    isUploaded: true
                }))
            });
        }
        return res.status(404).json({ error: 'Mobile device not connected' });
    }

    if (Date.now() - device.lastActive > 35000) {
        return res.status(503).json({ error: 'Mobile device is offline', offline: true, items: [] });
    }

    if (device.allowFullPhoneAccess === false) {
        return res.status(403).json({
            success: false,
            error: 'Full phone storage sharing is disabled by phone user. Only ShareHub is enabled.',
            storageAccessDisabled: true,
            items: []
        });
    }

    device.lastActive = Date.now();
    const targetUrl = `http://${device.ip}:${device.port}/api/fs/list?path=${encodeURIComponent(dirPath || '')}&auth=${secretToken}`;

    const request = http.get(targetUrl, (remoteRes) => {
        let data = '';
        remoteRes.on('data', chunk => data += chunk);
        remoteRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                res.status(remoteRes.statusCode).json(parsed);
            } catch (err) {
                res.status(502).json({ error: 'Invalid response from mobile device' });
            }
        });
    });

    request.on('error', (err) => {
        console.error('Mobile fs/list proxy error:', err.message);
        res.status(502).json({ error: 'Unable to reach mobile device. Verify phone is connected to the same network.' });
    });

    request.setTimeout(12000, () => {
        request.destroy();
        if (!res.headersSent) res.status(504).json({ error: 'Mobile device request timed out.' });
    });
});

// Proxy file stream from mobile (with Range support)
app.get('/api/mobile/fs/file', (req, res) => {
    const { deviceId, path: filePath, download } = req.query;
    let device = deviceId ? mobileDevices[deviceId] : null;
    if (!device) {
        const activeDevices = Object.values(mobileDevices).filter(d => (Date.now() - d.lastActive) <= 60000);
        if (activeDevices.length > 0) {
            device = activeDevices[0];
        }
    }
    if (!device) {
        return res.status(404).send('Mobile device not connected');
    }

    if (Date.now() - device.lastActive > 35000) {
        return res.status(503).send('Mobile device is offline');
    }

    if (device.allowFullPhoneAccess === false) {
        return res.status(403).send('Full phone storage sharing is disabled by phone user. Only ShareHub is enabled.');
    }

    device.lastActive = Date.now();
    const fileName = path.basename(filePath || 'file');
    const targetUrl = `http://${device.ip}:${device.port}/api/fs/file?path=${encodeURIComponent(filePath)}&auth=${secretToken}`;

    const headers = {};
    if (req.headers.range) {
        headers['range'] = req.headers.range;
    }

    const request = http.get(targetUrl, { headers }, (remoteRes) => {
        res.status(remoteRes.statusCode);

        ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(h => {
            if (remoteRes.headers[h]) {
                res.setHeader(h, remoteRes.headers[h]);
            }
        });

        if (download === '1') {
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        } else if (remoteRes.headers['content-disposition']) {
            res.setHeader('Content-Disposition', remoteRes.headers['content-disposition']);
        }

        remoteRes.pipe(res);
    });

    request.on('error', (err) => {
        console.error('Mobile fs/file proxy error:', err.message);
        if (!res.headersSent) {
            res.status(502).send('Error streaming file from mobile device.');
        }
    });

    req.on('close', () => {
        request.destroy();
    });
});

// Proxy thumbnail from mobile (Photos & Videos)
app.get('/api/mobile/fs/thumbnail', (req, res) => {
    let { deviceId, path: filePath } = req.query;
    let device = deviceId ? mobileDevices[deviceId] : null;
    if (!device) {
        const activeDevices = Object.values(mobileDevices).filter(d => (Date.now() - d.lastActive) <= 60000);
        if (activeDevices.length > 0) {
            device = activeDevices[0];
            deviceId = device.id;
        }
    }
    if (!device) {
        return res.status(404).send('Mobile device not connected');
    }

    if (Date.now() - device.lastActive > 25000) {
        return res.status(503).send('Mobile device is offline');
    }

    if (device.allowFullPhoneAccess === false) {
        return res.status(403).send('Full phone storage sharing is disabled by phone user.');
    }

    const targetUrl = `http://${device.ip}:${device.port}/api/fs/thumbnail?path=${encodeURIComponent(filePath)}&auth=${secretToken}`;
    const request = http.get(targetUrl, (remoteRes) => {
        res.status(remoteRes.statusCode);
        if (remoteRes.headers['content-type']) {
            res.setHeader('content-type', remoteRes.headers['content-type']);
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');
        remoteRes.pipe(res);
    });

    request.on('error', () => {
        if (!res.headersSent) res.status(404).end();
    });
});

// Direct download from phone into PC download directory (Electron Host feature)
app.post('/api/mobile/fs/download-direct', (req, res) => {
    let { deviceId, path: filePath } = req.body;
    let device = deviceId ? mobileDevices[deviceId] : null;
    if (!device) {
        // Fallback to active mobile device if single phone is linked
        const activeDevices = Object.values(mobileDevices).filter(d => (Date.now() - d.lastActive) <= 60000);
        if (activeDevices.length > 0) {
            device = activeDevices[0];
            deviceId = device.id;
        }
    }
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
    }

    if (Date.now() - device.lastActive > 20000) {
        return res.status(503).json({ error: 'Mobile device is offline' });
    }
    device.lastActive = Date.now();

    const fileName = path.basename(filePath);
    // Sanitize filename for Windows filesystem
    const cleanFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
    try {
        fs.mkdirSync(downloadFolder, { recursive: true });
    } catch (e) {}
    const saveDestination = path.join(downloadFolder, cleanFileName);
    const targetUrl = `http://${device.ip}:${device.port}/api/fs/file?path=${encodeURIComponent(filePath)}&auth=${secretToken}`;

    const fileStream = fs.createWriteStream(saveDestination);
    let entry = null;

    fileStream.on('error', (err) => {
        console.error('[Download-Direct] File write stream error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to write file: ' + err.message });
        }
    });

    const request = http.get(targetUrl, (remoteRes) => {
        if (remoteRes.statusCode !== 200) {
            try { fileStream.close(); } catch (e) {}
            fs.unlink(saveDestination, () => {});
            return res.status(remoteRes.statusCode).json({ error: 'Failed to download file from phone (HTTP ' + remoteRes.statusCode + ')' });
        }

        remoteRes.pipe(fileStream);

        fileStream.on('finish', () => {
            try { fileStream.close(); } catch (e) {}
            try {
                const stat = fs.existsSync(saveDestination) ? fs.statSync(saveDestination) : null;
                const size = stat ? stat.size : 0;
                let sizeLabel = size + ' B';
                if (size >= 1024 * 1024 * 1024) sizeLabel = (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                else if (size >= 1024 * 1024) sizeLabel = (size / (1024 * 1024)).toFixed(1) + ' MB';
                else if (size >= 1024) sizeLabel = (size / 1024).toFixed(1) + ' KB';
                const ext = cleanFileName.includes('.') ? cleanFileName.split('.').pop().toLowerCase() : '';
                const fileId = crypto.randomBytes(8).toString('hex') + Date.now().toString(36);
                entry = {
                    id: fileId,
                    name: cleanFileName,
                    size: size,
                    sizeLabel: sizeLabel,
                    ext: ext,
                    type: 'file',
                    path: saveDestination,
                    uploadedBy: (device && device.name) || 'Mobile Phone',
                    sharedAt: Date.now(),
                    downloadUrl: `/api/download/${fileId}`,
                    ownerSessionId: req.sessionId || 'mobile'
                };
                const existingIdx = fileRegistry.findIndex(x => (x.path && x.path === saveDestination) || (x.name === cleanFileName && x.size === size));
                if (existingIdx >= 0) {
                    fileRegistry[existingIdx] = entry;
                } else {
                    fileRegistry.unshift(entry);
                }
            } catch (err) {
                console.warn('download-direct registry error:', err);
            }
            if (!res.headersSent) {
                res.json({ success: true, savedPath: saveDestination, fileName: cleanFileName, entry });
            }
        });
    });

    request.on('error', (err) => {
        console.error('[Download-Direct] Request error:', err);
        try { fileStream.close(); } catch (e) {}
        fs.unlink(saveDestination, () => {});
        if (!res.headersSent) {
            res.status(502).json({ error: err.message });
        }
    });
});

// Share event notification from mobile (registers sent or direct shared files to Share Hub)
app.post('/api/files/share-event', (req, res) => {
    try {
        const { files, deviceName, savedPath } = req.body;
        const incoming = Array.isArray(files) ? files : (files ? [files] : (req.body.name ? [req.body] : []));
        for (const f of incoming) {
            if (!f || !f.name) continue;
            const ext = (f.name.lastIndexOf('.') > 0) ? f.name.substring(f.name.lastIndexOf('.') + 1).toLowerCase() : (f.ext || '');
            let size = typeof f.size === 'number' ? f.size : 0;
            const localFilePath = f.savedPath || (f.path && fs.existsSync(f.path) ? f.path : path.join(downloadFolder, f.name));
            if (!size && localFilePath && fs.existsSync(localFilePath)) {
                try { size = fs.statSync(localFilePath).size; } catch (e) {}
            }
            let sizeLabel = f.sizeLabel;
            if (!sizeLabel) {
                if (size >= 1024 * 1024 * 1024) sizeLabel = (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                else if (size >= 1024 * 1024) sizeLabel = (size / (1024 * 1024)).toFixed(1) + ' MB';
                else if (size >= 1024) sizeLabel = (size / 1024).toFixed(1) + ' KB';
                else sizeLabel = size + ' B';
            }

            const fileId = f.id || crypto.randomBytes(8).toString('hex') + Date.now().toString(36);
            const entry = {
                id: fileId,
                name: f.name,
                size: size,
                sizeLabel: sizeLabel,
                ext: ext,
                type: 'file',
                path: localFilePath,
                uploadedBy: f.uploadedBy || deviceName || (req.body.device ? req.body.device.name : 'Mobile Phone'),
                sharedAt: f.sharedAt || Date.now(),
                downloadUrl: f.downloadUrl || `/api/download/${fileId}`,
                ownerSessionId: f.ownerSessionId || req.sessionId || 'mobile'
            };
            const existingIdx = fileRegistry.findIndex(x => (localFilePath && x.path === localFilePath) || (x.name === f.name && x.size === size));
            if (existingIdx >= 0) {
                fileRegistry[existingIdx] = { ...fileRegistry[existingIdx], ...entry, sharedAt: Date.now() };
            } else {
                fileRegistry.unshift(entry);
            }
        }
        res.json({ success: true, count: fileRegistry.length });
    } catch (err) {
        console.error('share-event error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Direct upload/push from PC to Phone (Electron Host feature)
app.post('/api/mobile/fs/upload-direct', (req, res) => {
    const { deviceId, path: filePath, targetDir } = req.body;
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
    }
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'File does not exist on PC' });
    }

    try {
        const fileName = path.basename(filePath);
        const stat = fs.statSync(filePath);
        const targetUrl = `http://${device.ip}:${device.port}/api/fs/upload?name=${encodeURIComponent(fileName)}&dir=${encodeURIComponent(targetDir || '')}&auth=${secretToken}`;

        const reqOptions = {
            method: 'POST',
            headers: {
                'Content-Length': stat.size,
                'Content-Type': 'application/octet-stream'
            }
        };

        const uploadReq = http.request(targetUrl, reqOptions, (remoteRes) => {
            let body = '';
            remoteRes.on('data', chunk => body += chunk);
            remoteRes.on('end', () => {
                // Register transferred file in fileRegistry
                try {
                    const fileId = crypto.randomBytes(8).toString('hex') + Date.now().toString(36);
                    let sizeLabel = stat.size + ' B';
                    if (stat.size >= 1024 * 1024 * 1024) sizeLabel = (stat.size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                    else if (stat.size >= 1024 * 1024) sizeLabel = (stat.size / (1024 * 1024)).toFixed(1) + ' MB';
                    else if (stat.size >= 1024) sizeLabel = (stat.size / 1024).toFixed(1) + ' KB';
                    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
                    const entry = {
                        id: fileId,
                        name: fileName,
                        size: stat.size,
                        sizeLabel: sizeLabel,
                        ext: ext,
                        type: 'file',
                        path: filePath,
                        uploadedBy: 'My PC',
                        sharedAt: Date.now(),
                        downloadUrl: `/api/download/${fileId}`,
                        ownerSessionId: req.sessionId || 'host'
                    };
                    const existingIdx = fileRegistry.findIndex(x => (x.path && x.path === filePath) || (x.name === fileName && x.size === stat.size));
                    if (existingIdx >= 0) {
                        fileRegistry[existingIdx].sharedAt = Date.now();
                    } else {
                        fileRegistry.unshift(entry);
                    }
                } catch (regErr) {
                    console.warn('upload-direct registry error:', regErr);
                }

                try {
                    const parsed = JSON.parse(body);
                    res.json(parsed);
                } catch (e) {
                    res.json({ success: remoteRes.statusCode === 200, fileName });
                }
            });
        });

        uploadReq.on('error', (err) => {
            res.status(502).json({ error: 'Failed to push file to phone: ' + err.message });
        });

        fs.createReadStream(filePath).pipe(uploadReq);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stream upload for browser-based drag and drop to Phone
app.post('/api/mobile/fs/upload-stream', (req, res) => {
    const deviceId = req.query.deviceId;
    const fileName = req.query.name || 'uploaded_file';
    const targetDir = req.query.targetDir || '';
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
    }

    const targetUrl = `http://${device.ip}:${device.port}/api/fs/upload?name=${encodeURIComponent(fileName)}&dir=${encodeURIComponent(targetDir)}&auth=${secretToken}`;
    const uploadReq = http.request(targetUrl, {
        method: 'POST',
        headers: {
            'Content-Length': req.headers['content-length'] || 0,
            'Content-Type': 'application/octet-stream'
        }
    }, (remoteRes) => {
        let body = '';
        remoteRes.on('data', chunk => body += chunk);
        remoteRes.on('end', () => {
            // Register in fileRegistry
            try {
                const fileSize = parseInt(req.headers['content-length'] || 0, 10);
                const fileId = crypto.randomBytes(8).toString('hex') + Date.now().toString(36);
                let sizeLabel = fileSize + ' B';
                if (fileSize >= 1024 * 1024 * 1024) sizeLabel = (fileSize / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                else if (fileSize >= 1024 * 1024) sizeLabel = (fileSize / (1024 * 1024)).toFixed(1) + ' MB';
                else if (fileSize >= 1024) sizeLabel = (fileSize / 1024).toFixed(1) + ' KB';
                const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
                const entry = {
                    id: fileId,
                    name: fileName,
                    size: fileSize,
                    sizeLabel: sizeLabel,
                    ext: ext,
                    type: 'file',
                    path: null,
                    uploadedBy: 'My PC',
                    sharedAt: Date.now(),
                    downloadUrl: `/api/download/${fileId}`,
                    ownerSessionId: req.sessionId || 'host'
                };
                fileRegistry.unshift(entry);
            } catch (streamErr) {
                console.warn('upload-stream registry error:', streamErr);
            }

            try {
                res.json(JSON.parse(body));
            } catch (e) {
                res.json({ success: remoteRes.statusCode === 200, fileName });
            }
        });
    });

    uploadReq.on('error', (err) => {
        res.status(502).json({ error: 'Failed to stream to phone: ' + err.message });
    });

    req.pipe(uploadReq);
});

// Toggle mobile readOnly mode
app.post('/api/mobile/toggle-readonly', (req, res) => {
    const { deviceId, readOnly } = req.body;
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
    }

    const postData = JSON.stringify({ readOnly: !!readOnly });
    const reqOptions = {
        hostname: device.ip,
        port: device.port,
        path: `/api/set-readonly?auth=${secretToken}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const request = http.request(reqOptions, (remoteRes) => {
        device.readOnly = !!readOnly;
        res.json({ success: true, readOnly: device.readOnly });
    });

    request.on('error', (err) => {
        res.status(502).json({ error: 'Could not contact mobile to toggle permission: ' + err.message });
    });

    request.write(postData);
    request.end();
});// ==========================================
// Fylo v4: PC File Explorer Endpoints (for Mobile Companion & Host)
// ==========================================

let cachedDriveMetrics = null;
let lastDriveMetricsTime = 0;

function getWindowsDrives() {
    const drives = [];
    const now = Date.now();
    if (cachedDriveMetrics && (now - lastDriveMetricsTime < 20000)) {
        return cachedDriveMetrics;
    }

    let psDrives = {};
    if (process.platform === 'win32') {
        try {
            const stdout = execSync('powershell.exe -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Root, Free, Used | ConvertTo-Json -Compress"', {
                encoding: 'utf8',
                timeout: 3000,
                stdio: ['pipe', 'pipe', 'ignore']
            });
            const parsed = JSON.parse(stdout.trim());
            const list = Array.isArray(parsed) ? parsed : [parsed];
            for (const d of list) {
                if (d && d.Root) {
                    const rootKey = d.Root.toUpperCase();
                    const free = Number(d.Free) || 0;
                    const used = Number(d.Used) || 0;
                    psDrives[rootKey] = {
                        free: free,
                        used: used,
                        total: free + used
                    };
                }
            }
        } catch (e) {}
    }

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const letter of letters) {
        const root = `${letter}:\\`;
        try {
            if (fs.existsSync(root)) {
                const rootKey = root.toUpperCase();
                const metrics = psDrives[rootKey] || { free: 0, used: 0, total: 0 };
                drives.push({
                    name: `Local Disk (${letter}:)`,
                    label: `Local Disk (${letter}:)`,
                    mount: `${letter}:`,
                    path: root,
                    free: metrics.free,
                    used: metrics.used,
                    total: metrics.total
                });
            }
        } catch (e) {}
    }

    cachedDriveMetrics = drives;
    lastDriveMetricsTime = now;
    return drives;
}

function getQuickAccessShortcuts() {
    const home = os.homedir();
    const candidates = [
        { name: 'Downloads', paths: [path.join(home, 'Downloads')], icon: 'download' },
        { name: 'Pictures', paths: [path.join(home, 'Pictures'), path.join(home, 'OneDrive', 'Pictures')], icon: 'image' },
        { name: 'Screenshots', paths: [
            path.join(home, 'Pictures', 'Screenshots'),
            path.join(home, 'OneDrive', 'Pictures', 'Screenshots'),
            path.join(home, 'Screenshots')
        ], icon: 'camera' },
        { name: 'Desktop', paths: [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop')], icon: 'desktop' },
        { name: 'Documents', paths: [path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents')], icon: 'file' },
        { name: 'Videos', paths: [path.join(home, 'Videos')], icon: 'video' },
        { name: 'Music', paths: [path.join(home, 'Music')], icon: 'music' }
    ];

    const shortcuts = [];
    for (const item of candidates) {
        for (const p of item.paths) {
            try {
                if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                    shortcuts.push({ name: item.name, path: p, icon: item.icon });
                    break;
                }
            } catch (e) {}
        }
    }
    return shortcuts;
}

app.get('/api/pc/explorer/quick-access', (req, res) => {
    res.json({
        drives: getWindowsDrives(),
        shortcuts: getQuickAccessShortcuts()
    });
});

app.get('/api/pc/explorer/list', (req, res) => {
    let targetPath = req.query.path;
    if (!targetPath || targetPath === 'undefined' || targetPath === 'undefined\\') {
        targetPath = path.join(os.homedir(), 'Downloads');
    }

    // Normalize Windows drive paths like "C:" -> "C:\"
    targetPath = path.normalize(targetPath);
    if (targetPath.length === 2 && targetPath[1] === ':') {
        targetPath += '\\';
    }
    // Remove trailing slash for subdirectories so path.dirname resolves the actual parent
    if (targetPath.length > 3 && (targetPath.endsWith('\\') || targetPath.endsWith('/'))) {
        targetPath = targetPath.slice(0, -1);
    }

    try {
        if (!fs.existsSync(targetPath)) {
            // Fallback to user home directory if target path not found
            targetPath = os.homedir();
        }

        const stat = fs.statSync(targetPath);
        if (!stat.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }

        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        const items = [];

        for (const entry of entries) {
            if (entry.name.startsWith('$') || entry.name.startsWith('.')) continue;
            const fullPath = path.join(targetPath, entry.name);
            let size = 0;
            let mtime = 0;
            try {
                const s = fs.statSync(fullPath);
                size = s.size;
                mtime = s.mtimeMs;
            } catch (err) {
                // Inaccessible file / folder
                continue;
            }

            const isDir = entry.isDirectory();
            const ext = isDir ? '' : path.extname(entry.name).replace('.', '').toLowerCase();

            items.push({
                name: entry.name,
                path: fullPath,
                isDir: isDir,
                size: isDir ? 0 : size,
                ext: ext,
                modified: mtime
            });
        }

        items.sort((a, b) => {
            const timeA = Number(a.modified || 0);
            const timeB = Number(b.modified || 0);
            if (timeA !== timeB) return timeB - timeA;
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        const isRootDrive = (targetPath.length === 3 && targetPath[1] === ':' && targetPath[2] === '\\');
        const parent = isRootDrive ? '' : path.dirname(targetPath);

        res.json({
            path: targetPath,
            parent: (parent && parent !== targetPath) ? parent : '',
            items: items
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/pc/explorer/file', (req, res) => {
    const filePath = req.query.path;
    const download = req.query.download === '1';

    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            return res.status(400).send('Path is a directory');
        }

        const fileName = path.basename(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
            '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
            '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
            '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
            '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
            '.zip': 'application/zip'
        };
        if (mimeMap[ext]) {
            res.setHeader('Content-Type', mimeMap[ext]);
        }

        res.setHeader('Accept-Ranges', 'bytes');
        if (download) {
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        }

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize || end >= fileSize || start > end) {
                res.setHeader('Content-Range', `bytes */${fileSize}`);
                return res.status(416).send('Requested Range Not Satisfiable');
            }

            const chunksize = (end - start) + 1;
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Content-Length', chunksize);

            const stream = fs.createReadStream(filePath, { start, end });
            stream.pipe(res);
        } else {
            res.setHeader('Content-Length', fileSize);
            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
        }
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Download batch of mobile files (Zip stream or direct Electron save)
app.post('/api/mobile/fs/download-batch', async (req, res) => {
    let { deviceId, paths } = req.body;
    let device = deviceId ? mobileDevices[deviceId] : null;
    if (!device) {
        const activeDevices = Object.values(mobileDevices).filter(d => (Date.now() - d.lastActive) <= 60000);
        if (activeDevices.length > 0) {
            device = activeDevices[0];
            deviceId = device.id;
        }
    }
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
    }
    if (device.allowFullPhoneAccess === false) {
        return res.status(403).json({ error: 'Full phone storage sharing is disabled by phone user. Only ShareHub is enabled.' });
    }
    if (!Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: 'No files specified' });
    }

    const zipName = `fylo-batch-${Date.now().toString(36)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', err => {
        if (!res.headersSent) res.status(500).send('Zip failed');
    });
    archive.pipe(res);

    for (const filePath of paths) {
        const fileName = path.basename(filePath);
        const targetUrl = `http://${device.ip}:${device.port}/api/fs/file?path=${encodeURIComponent(filePath)}&auth=${secretToken}`;

        await new Promise((resolve) => {
            const getReq = http.get(targetUrl, (fileRes) => {
                if (fileRes.statusCode === 200) {
                    archive.append(fileRes, { name: fileName });
                    fileRes.on('end', resolve);
                    fileRes.on('error', resolve);
                } else {
                    resolve();
                }
            });
            getReq.on('error', resolve);
            getReq.setTimeout(15000, () => {
                getReq.destroy();
                resolve();
            });
        });
    }

    archive.finalize();
});

// Admin Security Lockdown: Host-only access for all /api/admin/* management endpoints
app.use('/api/admin', (req, res, next) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    next();
});

// Admin Password Verification
app.post('/api/admin/verify', (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    const { password } = req.body;
    if (password && password === adminPassword) {
        return res.json({ valid: true });
    }
    return res.status(401).json({ valid: false, error: 'Incorrect admin password' });
});

// Change Admin Password
app.post('/api/admin/change-password', (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    const { currentPassword, newPassword } = req.body;
    if (currentPassword !== adminPassword) {
        return res.status(401).json({ error: 'Current admin password is incorrect' });
    }
    if (!newPassword || newPassword.trim().length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long' });
    }
    adminPassword = newPassword.trim();
    try {
        fs.writeFileSync(adminPassPath, adminPassword, 'utf8');
    } catch (e) {}
    res.json({ success: true, message: 'Admin password updated successfully' });
});

// Safely move PC file to Windows Recycle Bin (HOST ONLY, NO PASSWORD NEEDED)
app.post('/api/pc/trash-file', async (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Remote clients are strictly read-only and cannot delete or modify host PC files.' });
    }
    const { filePath } = req.body;
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File or directory not found' });
    }
    try {
        await shell.trashItem(filePath);
        res.json({ success: true, trashed: true, message: 'File moved to Recycle Bin' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to move item to Recycle Bin: ' + err.message });
    }
});

// Safely move Phone file to Mobile .trash Recycle Bin (HOST ONLY)
app.post('/api/mobile/fs/trash-file', (req, res) => {
    if (!isLocalHostIp(req.ip)) {
        return res.status(403).json({ error: '403 Forbidden: Host Only' });
    }
    const { deviceId, path: filePath } = req.body;
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
    }
    if (device.allowFullPhoneAccess === false) {
        return res.status(403).json({ error: 'Full phone storage sharing is disabled by phone user. Only ShareHub is enabled.' });
    }

    const postData = JSON.stringify({ path: filePath });
    const reqOptions = {
        hostname: device.ip,
        port: device.port,
        path: `/api/fs/trash?auth=${secretToken}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const request = http.request(reqOptions, (remoteRes) => {
        let data = '';
        remoteRes.on('data', chunk => data += chunk);
        remoteRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                res.status(remoteRes.statusCode).json(parsed);
            } catch (e) {
                res.status(remoteRes.statusCode).json({ success: remoteRes.statusCode === 200 });
            }
        });
    });

    request.on('error', (err) => {
        res.status(502).json({ error: 'Could not contact mobile to trash file: ' + err.message });
    });

    request.write(postData);
    request.end();
});


setInterval(() => {
    const now = Date.now();
    for (const id in devices) {
        if (now - devices[id].lastActive > 60000) {
            delete devices[id];
        }
    }
    for (const id in mobileDevices) {
        if (now - mobileDevices[id].lastActive > 60000) {
            delete mobileDevices[id];
        }
    }
}, 10000);

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(electronApp.getAppPath(), 'icon.ico'),
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[RENDERER] (${level}) ${message} [${sourceId}:${line}]`);
    });

    win.loadURL(`http://localhost:${PORT}`);

    // Mouse back & forward button navigation in Windows Electron
    win.on('app-command', (event, cmd) => {
        if (cmd === 'browser-backward') {
            win.webContents.send('mouse-back');
        } else if (cmd === 'browser-forward') {
            win.webContents.send('mouse-forward');
        }
    });

    let activeDownloads = {};

    ipcMain.on('cancel-download', (event, id) => {
        const item = activeDownloads[id];
        if (item) {
            item.cancel();
            delete activeDownloads[id];
        }
    });

    ipcMain.on('trigger-electron-download', (event, url) => {
        win.webContents.session.downloadURL(url);
    });

    ipcMain.on('toggle-clipboard-sync', (event, enabled) => {
        clipboardSyncEnabled = enabled;
    });

    win.webContents.session.on('will-download', (event, item, webContents) => {
        const urlParts = item.getURL().split('/');
        let fileIdRaw = urlParts[urlParts.length - 1];
        if (fileIdRaw.includes('?')) {
            fileIdRaw = fileIdRaw.split('?')[0];
        }
        let fileId = decodeURIComponent(fileIdRaw);
        activeDownloads[fileId] = item;
        item.setSavePath(path.join(downloadFolder, item.getFilename()));

        item.on('updated', (event, state) => {
            if (state === 'progressing') {
                win.webContents.send('download-progress', {
                    id: fileId,
                    received: item.getReceivedBytes(),
                    total: item.getTotalBytes()
                });
            }
        });

        item.once('done', (event, state) => {
            delete activeDownloads[fileId];
            win.webContents.send('download-done', {
                id: fileId,
                success: state === 'completed',
                savePath: item.getSavePath()
            });
        });
    });

    ipcMain.handle('select-folder', async () => {
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory']
        });
        if (!result.canceled && result.filePaths.length > 0) {
            downloadFolder = result.filePaths[0];
            return downloadFolder;
        }
        return downloadFolder;
    });

    ipcMain.handle('get-folder', () => {
        return downloadFolder;
    });

    // Select folders to share
    ipcMain.handle('select-folders-to-share', async () => {
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory', 'multiSelections'],
            title: 'Select Folders to Share'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths;
        }
        return [];
    });

    ipcMain.handle('show-in-folder', (event, filePath) => {
        if (filePath && fs.existsSync(filePath)) {
            shell.showItemInFolder(filePath);
            return true;
        }
        return false;
    });

    ipcMain.handle('open-path', (event, filePath) => {
        if (filePath && fs.existsSync(filePath)) {
            shell.openPath(filePath);
            return true;
        }
        return false;
    });
}

if (electronApp && typeof electronApp.whenReady === 'function') {
    electronApp.whenReady().then(() => {
        app.listen(PORT, () => {
            createWindow();
        });
        electronApp.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    electronApp.on('before-quit', () => {
        teardownConnections();
    });

    electronApp.on('window-all-closed', () => {
        teardownConnections();
        if (process.platform !== 'darwin') electronApp.quit();
    });
} else if (!module.parent) {
    app.listen(PORT, () => {
        console.log(`Fylo server running on http://127.0.0.1:${PORT}`);
    });
}

function teardownConnections() {
    for (const id in mobileDevices) {
        const device = mobileDevices[id];
        try {
            const req = http.request({
                hostname: device.ip,
                port: device.port,
                path: `/api/host-disconnect?auth=${secretToken}`,
                method: 'POST',
                timeout: 800
            });
            req.on('error', () => {});
            req.end();
        } catch (e) {}
    }
    mobileDevices = {};
    devices = {};
}

process.on('SIGINT', () => {
    teardownConnections();
    process.exit(0);
});

process.on('SIGTERM', () => {
    teardownConnections();
    process.exit(0);
});

module.exports = app;