const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const qrcode = require('qrcode');
const { app: electronApp, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');

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

app.use(express.json());

let clipboardText = "";
let clipboardUpdatedBy = "";
let maxFileSizeMB = 500;
let devices = {};
let blockedDevices = {};
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

app.use((req, res, next) => {
    if (req.socket) req.socket.setNoDelay(true);
    const activeIp = getActiveIp();
    const baselineIp = getLocalIp();
    const isHost = (req.ip === '127.0.0.1' || req.ip === '::1' || 
                    (req.ip && (req.ip.includes(activeIp) || req.ip.includes(baselineIp))));
    
    if (isHost) {
        return next();
    }

    const urlToken = req.query.auth;
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['fylo_session'];

    if (urlToken === secretToken) {
        res.setHeader('Set-Cookie', `fylo_session=${secretToken}; Path=/; HttpOnly; Max-Age=86400`);
        return res.redirect('/');
    }

    if (sessionToken !== secretToken) {
        return res.status(403).send('<h1>403 Forbidden</h1><p>Access denied. Scan the QR code on the host machine dashboard to connect.</p>');
    }

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

    next();
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
    const activeIp = getActiveIp();
    const baselineIp = getLocalIp();
    const isHost = (req.ip === '127.0.0.1' || req.ip === '::1' || 
                    (req.ip && (req.ip.includes(activeIp) || req.ip.includes(baselineIp))));
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
    res.json({ url: getSecureAccessUrl(), networkName });
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
                    name: nameLabel
                });
            }
        }
    }
    res.json({ interfaces: list, selectedIp: getActiveIp() });
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
            return res.json({ success: true, url: getSecureAccessUrl(), networkName: getNetworkName(activeIp) });
        }
    }
    res.status(400).json({ error: 'Invalid IP address' });
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

    if (meta.path) {
        try {
            if (fs.existsSync(meta.path)) {
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Length', meta.size);
                res.setHeader('Content-Disposition', `attachment; filename="${meta.name}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
                const readStream = fs.createReadStream(meta.path);
                readStream.pipe(res);
                return;
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

setInterval(() => {
    const now = Date.now();
    for (const id in devices) {
        if (now - devices[id].lastActive > 25000) {
            delete devices[id];
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
}

electronApp.whenReady().then(() => {
    app.listen(PORT, () => {
        createWindow();
    });
    electronApp.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

electronApp.on('window-all-closed', () => {
    if (process.platform !== 'darwin') electronApp.quit();
});