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
    const cleanIp = ip.replace(/^.*:/, '');
    if (cleanIp === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
    const activeIp = getActiveIp();
    const baselineIp = getLocalIp();
    if ((activeIp && ip.includes(activeIp)) || (baselineIp && ip.includes(baselineIp))) return true;
    return false;
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

    const isHost = isLocalHostIp(req.ip);
    if (isHost) {
        return next();
    }

    // Public / Handshake API endpoints that must be reachable by mobile apps and clients without prior session cookie
    const isPublicApi = req.path.startsWith('/api/mobile/') ||
                        req.path.startsWith('/api/pc/explorer') ||
                        req.path === '/api/qrcode' ||
                        req.path === '/api/connection-info' ||
                        req.path === '/api/network-url' ||
                        req.path === '/api/network-interfaces' ||
                        req.path === '/api/me';

    if (isPublicApi) {
        return next();
    }

    const urlToken = req.query.auth;
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['fylo_session'];
    const headerToken = req.headers['x-auth-token'] || req.headers['authorization'];

    if (urlToken === secretToken) {
        res.setHeader('Set-Cookie', `fylo_session=${secretToken}; Path=/; HttpOnly; Max-Age=86400`);
        return res.redirect('/');
    }

    if (sessionToken === secretToken || headerToken === secretToken || (headerToken && headerToken.includes(secretToken))) {
        let sessionId = req.headers['x-session-id'] || req.query['x-session-id'];
        if (!sessionId) return next();
        req.sessionId = sessionId;

        if (blockedDevices[sessionId]) {
            return res.status(403).json({ error: 'kicked' });
        }

        const userAgent = req.headers['user-agent'] || '';
        let kind = 'desktop';
        let name = 'PC Browser';

        if (/android/i.test(userAgent)) {
            kind = 'android';
            name = 'Android Phone';
        } else if (/iphone|ipad|ipod/i.test(userAgent)) {
            kind = 'ios';
            name = 'iPhone / iPad';
        } else if (/mobile/i.test(userAgent)) {
            kind = 'mobile';
            name = 'Mobile Device';
        }

        const customNameHeader = req.headers['x-client-name'];
        if (customNameHeader) {
            try {
                name = decodeURIComponent(customNameHeader);
            } catch(e) {}
        }

        devices[sessionId] = {
            id: sessionId,
            name: name,
            kind: kind,
            isHost: false,
            lastActive: Date.now()
        };

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
    fileRegistry = files.map(f => {
        if (!f.ownerSessionId) {
            f.ownerSessionId = req.sessionId || 'host';
        }
        return f;
    });
    res.json({ success: true });
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
            ownerSessionId: req.sessionId || 'host'
        };

        fileRegistry.push(folderEntry);
        res.json({ success: true, entry: folderEntry });
    } catch (e) {
        console.error('Folder registration error:', e);
        res.status(500).json({ error: 'Failed to register folder' });
    }
});

app.get('/api/files', (req, res) => {
    res.json(fileRegistry);
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
    clipboardUpdatedBy = sender ? sender.name : "Host Computer";
    if (clipboardSyncEnabled) {
        try {
            if (clipboardText !== clipboard.readText()) {
                clipboard.writeText(clipboardText);
                lastSystemClipboardText = clipboardText;
            }
        } catch(e) {}
    }
    res.json({ success: true });
});

let clipboardSyncEnabled = true;
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
    const deviceList = Object.values(devices).map(d => {
        const isOnline = (now - d.lastActive) < 15000;
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

app.post('/api/devices/:id/kick', (req, res) => {
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
    const { deviceId, deviceName, model, ip, port, authToken, readOnly, storage, battery } = req.body;

    // Validate token: allow if matched or on local network
    const isLocalReq = req.ip === '127.0.0.1' || req.ip === '::1' || 
                       req.ip.includes('192.168.') || req.ip.includes('10.') || req.ip.includes('172.') ||
                       req.ip.includes('::ffff:192.168.') || req.ip.includes('::ffff:10.');

    if (authToken && authToken !== secretToken && authToken !== 'lan') {
        return res.status(403).json({ error: 'Invalid authentication token. Please scan the QR code on PC.' });
    }

    if (!deviceId || !ip || !port) {
        return res.status(400).json({ error: 'Missing device information' });
    }

    mobileDevices[deviceId] = {
        id: deviceId,
        name: deviceName || 'Android Phone',
        model: model || 'Android Device',
        ip: ip,
        port: port,
        readOnly: readOnly !== undefined ? readOnly : true,
        storage: storage || { total: 0, free: 0 },
        battery: battery !== undefined ? battery : null,
        lastActive: Date.now()
    };

    console.log(`[Fylo v4] Mobile connected: ${deviceName} (${ip}:${port}), Read-Only: ${readOnly}`);
    res.json({ 
        success: true, 
        message: 'Paired with Fylo PC', 
        hostIp: getActiveIp(),
        authToken: secretToken 
    });
});

// Get connected mobile devices
app.get('/api/mobile/devices', (req, res) => {
    const now = Date.now();
    const list = Object.values(mobileDevices).map(d => ({
        id: d.id,
        name: d.name,
        model: d.model,
        ip: d.ip,
        port: d.port,
        readOnly: d.readOnly,
        storage: d.storage,
        battery: d.battery,
        online: (now - d.lastActive) < 30000
    }));
    res.json(list);
});

// Mobile heartbeat
app.post('/api/mobile/heartbeat', (req, res) => {
    const { deviceId, battery, storage, readOnly } = req.body;
    if (deviceId && mobileDevices[deviceId]) {
        mobileDevices[deviceId].lastActive = Date.now();
        if (battery !== undefined) mobileDevices[deviceId].battery = battery;
        if (storage) mobileDevices[deviceId].storage = storage;
        if (readOnly !== undefined) mobileDevices[deviceId].readOnly = readOnly;
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Device not found' });
});

// Disconnect mobile device
app.post('/api/mobile/disconnect', (req, res) => {
    const { deviceId } = req.body;
    if (deviceId && mobileDevices[deviceId]) {
        delete mobileDevices[deviceId];
    }
    res.json({ success: true });
});

// Proxy directory listing from mobile
app.get('/api/mobile/fs/list', (req, res) => {
    const { deviceId, path: dirPath } = req.query;
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
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
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).send('Mobile device not connected');
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

// Proxy thumbnail from mobile
app.get('/api/mobile/fs/thumbnail', (req, res) => {
    const { deviceId, path: filePath } = req.query;
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).send('Mobile device not connected');
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
    const { deviceId, path: filePath } = req.body;
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
    }

    const fileName = path.basename(filePath);
    const saveDestination = path.join(downloadFolder, fileName);
    const targetUrl = `http://${device.ip}:${device.port}/api/fs/file?path=${encodeURIComponent(filePath)}&auth=${secretToken}`;

    const fileStream = fs.createWriteStream(saveDestination);
    const request = http.get(targetUrl, (remoteRes) => {
        if (remoteRes.statusCode !== 200) {
            fileStream.close();
            fs.unlink(saveDestination, () => {});
            return res.status(remoteRes.statusCode).json({ error: 'Failed to download file from phone' });
        }

        remoteRes.pipe(fileStream);

        fileStream.on('finish', () => {
            fileStream.close();
            res.json({ success: true, savedPath: saveDestination, fileName });
        });
    });

    request.on('error', (err) => {
        fileStream.close();
        fs.unlink(saveDestination, () => {});
        res.status(502).json({ error: err.message });
    });
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
    const { deviceId, paths } = req.body;
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
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

// Admin Password Verification
app.post('/api/admin/verify', (req, res) => {
    const { password } = req.body;
    if (password && password === adminPassword) {
        return res.json({ valid: true });
    }
    return res.status(401).json({ valid: false, error: 'Incorrect admin password' });
});

// Change Admin Password
app.post('/api/admin/change-password', (req, res) => {
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

// Safely move PC file to Windows Recycle Bin (Requires Admin Password)
app.post('/api/pc/trash-file', async (req, res) => {
    const { filePath, adminPassword: pass } = req.body;
    if (pass !== adminPassword) {
        return res.status(401).json({ error: 'Admin security password required or incorrect' });
    }
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

// Safely move Phone file to Mobile .trash Recycle Bin (Requires Admin Password)
app.post('/api/mobile/fs/trash-file', (req, res) => {
    const { deviceId, path: filePath, adminPassword: pass } = req.body;
    if (pass !== adminPassword) {
        return res.status(401).json({ error: 'Admin security password required or incorrect' });
    }
    const device = mobileDevices[deviceId];
    if (!device) {
        return res.status(404).json({ error: 'Mobile device not connected' });
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
        if (now - devices[id].lastActive > 25000) {
            delete devices[id];
        }
    }
    for (const id in mobileDevices) {
        if (now - mobileDevices[id].lastActive > 35000) {
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