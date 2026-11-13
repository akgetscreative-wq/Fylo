package com.fylo.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.media.ThumbnailUtils;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.MediaStore;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

public class FyloHttpServer {
    private static final String TAG = "FyloHttpServer";
    private static final int MAX_HEADER_SIZE = 65536; // 64 KB header limit to prevent OOM
    private static final int MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB maximum POST body
    private static final int SOCKET_TIMEOUT_MS = 30000; // 30 seconds socket read timeout

    private final Context context;
    private final int port;
    private volatile boolean readOnly = true;
    private volatile boolean allowFullPhoneAccess = true;
    private volatile String authToken = null;
    private volatile boolean isRunning = false;
    private ServerSocket serverSocket;
    private ExecutorService executor;

    public FyloHttpServer(Context context, int port, boolean readOnly) {
        this.context = context;
        this.port = port;
        this.readOnly = readOnly;
    }

    public void setReadOnly(boolean readOnly) {
        this.readOnly = readOnly;
    }

    public boolean isReadOnly() {
        return readOnly;
    }

    public void setAllowFullPhoneAccess(boolean allowFullPhoneAccess) {
        this.allowFullPhoneAccess = allowFullPhoneAccess;
    }

    public boolean isAllowFullPhoneAccess() {
        return allowFullPhoneAccess;
    }

    public void setAuthToken(String token) {
        this.authToken = token;
    }

    public String getAuthToken() {
        return authToken;
    }

    public synchronized void start() throws IOException {
        if (isRunning) return;

        ServerSocket ss = null;
        try {
            ss = new ServerSocket();
            ss.setReuseAddress(true);
            ss.bind(new java.net.InetSocketAddress(port));
            serverSocket = ss;
            executor = Executors.newCachedThreadPool();
            isRunning = true;
        } catch (IOException e) {
            if (ss != null && !ss.isClosed()) {
                try { ss.close(); } catch (IOException ignored) {}
            }
            serverSocket = null;
            isRunning = false;
            throw e;
        }

        executor.execute(() -> {
            Log.i(TAG, "Fylo HTTP Server listening on port " + port);
            while (isRunning) {
                ServerSocket sSocket = serverSocket;
                if (sSocket == null || sSocket.isClosed()) break;

                Socket clientSocket = null;
                try {
                    clientSocket = sSocket.accept();
                    clientSocket.setTcpNoDelay(true);
                    clientSocket.setSoTimeout(SOCKET_TIMEOUT_MS);

                    final Socket finalClient = clientSocket;
                    ExecutorService exec = executor;
                    if (exec != null && !exec.isShutdown() && !exec.isTerminated()) {
                        exec.execute(() -> handleClient(finalClient));
                    } else {
                        try { finalClient.close(); } catch (IOException ignored) {}
                    }
                } catch (SocketException e) {
                    if (!isRunning) break;
                    Log.w(TAG, "Socket accept error: " + e.getMessage());
                } catch (RejectedExecutionException e) {
                    if (clientSocket != null) {
                        try { clientSocket.close(); } catch (IOException ignored) {}
                    }
                    if (!isRunning) break;
                    Log.w(TAG, "Task rejected by executor: " + e.getMessage());
                } catch (Throwable t) {
                    if (clientSocket != null) {
                        try { clientSocket.close(); } catch (IOException ignored) {}
                    }
                    if (!isRunning) break;
                    Log.w(TAG, "Unexpected error in accept loop: " + t.getMessage());
                }
            }
        });
    }

    public synchronized void stop() {
        isRunning = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {}
            serverSocket = null;
        }
        if (executor != null) {
            try {
                executor.shutdownNow();
            } catch (Exception ignored) {}
            executor = null;
        }
        Log.i(TAG, "Fylo HTTP Server stopped");
    }

    private void handleClient(Socket socket) {
        try (InputStream in = new BufferedInputStream(socket.getInputStream());
             OutputStream out = new BufferedOutputStream(socket.getOutputStream())) {

            // Read HTTP request line and headers with bounded buffer
            ByteArrayOutputStream headerBuffer = new ByteArrayOutputStream();
            int b;
            int consecutiveLf = 0;
            while (headerBuffer.size() < MAX_HEADER_SIZE && (b = in.read()) != -1) {
                headerBuffer.write(b);
                if (b == '\n') {
                    consecutiveLf++;
                    int size = headerBuffer.size();
                    byte[] raw = headerBuffer.toByteArray();
                    if (consecutiveLf == 2 ||
                        (size >= 4 && raw[size - 4] == '\r' && raw[size - 3] == '\n' && raw[size - 2] == '\r' && raw[size - 1] == '\n') ||
                        (size >= 2 && raw[size - 2] == '\n' && raw[size - 1] == '\n')) {
                        break;
                    }
                } else if (b != '\r') {
                    consecutiveLf = 0;
                }
            }

            if (headerBuffer.size() >= MAX_HEADER_SIZE) {
                sendJsonResponse(out, 431, "{\"error\":\"Request Header Fields Too Large\"}");
                return;
            }

            String headerText = headerBuffer.toString(StandardCharsets.UTF_8.name());
            String[] headerLines = headerText.split("\r?\n");
            if (headerLines.length == 0 || headerLines[0].trim().isEmpty()) {
                return;
            }

            String[] requestTokens = headerLines[0].split("\\s+");
            if (requestTokens.length < 2) return;
            String method = requestTokens[0].toUpperCase();
            String fullUri = requestTokens[1];

            // Parse headers
            Map<String, String> headers = new HashMap<>();
            int contentLength = 0;
            for (int i = 1; i < headerLines.length; i++) {
                String line = headerLines[i];
                int colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                    String key = line.substring(0, colonIdx).trim().toLowerCase();
                    String val = line.substring(colonIdx + 1).trim();
                    headers.put(key, val);
                    if ("content-length".equals(key)) {
                        try {
                            contentLength = Math.max(0, Integer.parseInt(val));
                        } catch (Exception ignored) {}
                    }
                }
            }

            // CORS preflight
            if ("OPTIONS".equals(method)) {
                sendResponseHeaders(out, 204, "No Content", "text/plain", 0, null);
                out.flush();
                return;
            }

            // Parse path and query
            String path = fullUri;
            String query = "";
            int questionIdx = fullUri.indexOf('?');
            if (questionIdx != -1) {
                path = fullUri.substring(0, questionIdx);
                query = fullUri.substring(questionIdx + 1);
            }

            Map<String, String> queryParams = parseQueryParams(query);

            boolean isLoopback = socket != null && socket.getInetAddress() != null && socket.getInetAddress().isLoopbackAddress();

            boolean isHandshakeOrPublic = "/".equals(path)
                    || "/web".equals(path)
                    || "/api/mobile/connect".equals(path)
                    || "/api/mobile/heartbeat".equals(path)
                    || "/api/mobile/disconnect".equals(path);

            // Authorization check
            if (!isLoopback && !isHandshakeOrPublic && !isAuthorized(queryParams, headers)) {
                sendJsonResponse(out, 401, "{\"error\":\"Unauthorized: Invalid or missing auth token\"}");
                return;
            }

            // Streaming file upload from PC directly into Phone storage (bypasses memory buffer)
            if ("/api/fs/upload".equals(path) && "POST".equals(method)) {
                handleUploadStream(out, queryParams, in, contentLength);
                return;
            }

            if (contentLength > MAX_BODY_SIZE) {
                sendJsonResponse(out, 413, "{\"error\":\"Payload Too Large\"}");
                return;
            }

            // Read request body if present
            byte[] bodyBytes = new byte[0];
            if (contentLength > 0) {
                bodyBytes = new byte[contentLength];
                int totalRead = 0;
                while (totalRead < contentLength) {
                    int r = in.read(bodyBytes, totalRead, contentLength - totalRead);
                    if (r == -1) break;
                    totalRead += r;
                }
            }

            // Routing
            if ("/api/info".equals(path)) {
                handleInfo(out);
            } else if ("/api/mobile/connect".equals(path) && "POST".equals(method)) {
                handleMobileConnect(socket, out, bodyBytes);
            } else if ("/api/mobile/heartbeat".equals(path) && "POST".equals(method)) {
                handleMobileHeartbeat(out);
            } else if ("/api/mobile/disconnect".equals(path) && "POST".equals(method)) {
                handleMobileDisconnect(socket, out, bodyBytes);
            } else if ("/api/pc/explorer/quick-access".equals(path)) {
                handlePhoneQuickAccess(out);
            } else if ("/api/pc/explorer/list".equals(path) || "/api/fs/list".equals(path)) {
                handleList(out, queryParams);
            } else if ("/api/pc/explorer/download".equals(path) || "/api/fs/file".equals(path)) {
                handleFile(out, queryParams, headers);
            } else if ("/api/fs/recent".equals(path)) {
                handleRecent(out, queryParams);
            } else if ("/api/fs/thumbnail".equals(path)) {
                handleThumbnail(out, queryParams, isLoopback);
            } else if ("/api/set-readonly".equals(path) && "POST".equals(method)) {
                handleSetReadOnly(out, bodyBytes);
            } else if ("/api/fs/trash".equals(path) && "POST".equals(method)) {
                handleTrash(out, bodyBytes);
            } else if ("/".equals(path) || "/web".equals(path)) {
                handleWebSharePage(out, isLoopback);
            } else {
                sendJsonResponse(out, 404, "{\"error\":\"Endpoint not found\"}");
            }

        } catch (SocketTimeoutException e) {
            Log.d(TAG, "Client socket timed out");
        } catch (SocketException e) {
            // Normal client disconnection or aborted connection
            Log.d(TAG, "Client connection reset or closed: " + e.getMessage());
        } catch (Throwable e) {
            Log.w(TAG, "Request handling error: " + e.getMessage());
        } finally {
            try {
                if (!socket.isClosed()) {
                    socket.close();
                }
            } catch (IOException ignored) {}
        }
    }

    private Map<String, String> parseQueryParams(String query) {
        Map<String, String> params = new HashMap<>();
        if (query == null || query.isEmpty()) return params;
        String[] pairs = query.split("&");
        for (String pair : pairs) {
            if (pair.isEmpty()) continue;
            int eq = pair.indexOf('=');
            String key = eq >= 0 ? pair.substring(0, eq) : pair;
            String val = eq >= 0 ? pair.substring(eq + 1) : "";
            try {
                key = URLDecoder.decode(key, StandardCharsets.UTF_8.name());
                val = URLDecoder.decode(val, StandardCharsets.UTF_8.name());
            } catch (Exception ignored) {}
            params.put(key, val);
        }
        return params;
    }

    private boolean isAuthorized(Map<String, String> queryParams, Map<String, String> headers) {
        String token = this.authToken;
        if (token == null || token.trim().isEmpty()) {
            return true;
        }

        String queryToken = queryParams.get("auth");
        if (queryToken != null && token.equals(queryToken)) {
            return true;
        }

        String authHeader = headers.get("authorization");
        if (authHeader != null) {
            if (authHeader.regionMatches(true, 0, "Bearer ", 0, 7)) {
                authHeader = authHeader.substring(7).trim();
            }
            if (token.equals(authHeader)) return true;
        }

        String xAuth = headers.get("x-auth-token");
        return xAuth != null && token.equals(xAuth);
    }

    private String getHostDeviceName() {
        String brand = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
        String model = Build.MODEL != null ? Build.MODEL : "Android";
        return (!brand.isEmpty() && !model.toLowerCase().contains(brand.toLowerCase()))
            ? (brand.substring(0, 1).toUpperCase() + brand.substring(1) + " " + model)
            : model;
    }

    private void handleMobileConnect(Socket socket, OutputStream out, byte[] body) throws Exception {
        JSONObject json = new JSONObject();
        if (body != null && body.length > 0) {
            try {
                json = new JSONObject(new String(body, StandardCharsets.UTF_8));
            } catch (Throwable ignored) {}
        }

        String clientIp = json.optString("ip", "");
        if ((clientIp.isEmpty() || clientIp.equals("127.0.0.1")) && socket != null && socket.getInetAddress() != null) {
            clientIp = socket.getInetAddress().getHostAddress();
        }

        WritableMap map = Arguments.createMap();
        map.putString("deviceId", json.optString("deviceId", ""));
        map.putString("deviceName", json.optString("deviceName", json.optString("model", "Remote Phone")));
        map.putString("model", json.optString("model", ""));
        map.putString("ip", clientIp != null ? clientIp : "");
        map.putInt("port", json.optInt("port", 8080));
        map.putString("authToken", json.optString("authToken", ""));
        map.putString("type", json.optString("type", "phone"));
        map.putString("kind", "phone");

        FyloServerModule.emitToJs("onPhoneDeviceConnected", map);

        JSONObject resp = new JSONObject();
        resp.put("success", true);
        resp.put("hostName", getHostDeviceName());
        resp.put("authToken", this.authToken != null ? this.authToken : "");
        resp.put("kind", "phone");
        sendJsonResponse(out, 200, resp.toString());
    }

    private void handleMobileHeartbeat(OutputStream out) throws Exception {
        JSONObject resp = new JSONObject();
        resp.put("success", true);
        resp.put("hostName", getHostDeviceName());
        sendJsonResponse(out, 200, resp.toString());
    }

    private void handleMobileDisconnect(Socket socket, OutputStream out, byte[] body) throws Exception {
        JSONObject json = new JSONObject();
        if (body != null && body.length > 0) {
            try {
                json = new JSONObject(new String(body, StandardCharsets.UTF_8));
            } catch (Throwable ignored) {}
        }

        String clientIp = json.optString("ip", "");
        if ((clientIp.isEmpty() || clientIp.equals("127.0.0.1")) && socket != null && socket.getInetAddress() != null) {
            clientIp = socket.getInetAddress().getHostAddress();
        }

        WritableMap map = Arguments.createMap();
        map.putString("deviceId", json.optString("deviceId", ""));
        map.putString("ip", clientIp != null ? clientIp : "");
        map.putString("kind", "phone");

        FyloServerModule.emitToJs("onPhoneDeviceDisconnected", map);

        JSONObject resp = new JSONObject();
        resp.put("success", true);
        sendJsonResponse(out, 200, resp.toString());
    }

    private void handlePhoneQuickAccess(OutputStream out) throws Exception {
        JSONObject resp = new JSONObject();
        JSONArray drives = new JSONArray();

        File ext = Environment.getExternalStorageDirectory();
        String rootPath = ext != null ? ext.getAbsolutePath() : "/storage/emulated/0";

        long totalBytes = 0;
        long freeBytes = 0;
        try {
            StatFs stat = new StatFs(rootPath);
            long blockSize = stat.getBlockSizeLong();
            totalBytes = stat.getBlockCountLong() * blockSize;
            freeBytes = stat.getAvailableBlocksLong() * blockSize;
        } catch (Throwable ignored) {}
        long usedBytes = Math.max(0, totalBytes - freeBytes);

        JSONObject drive = new JSONObject();
        drive.put("name", "Internal Storage");
        drive.put("label", "Internal Storage");
        drive.put("mount", "/");
        drive.put("path", rootPath);
        drive.put("free", freeBytes);
        drive.put("used", usedBytes);
        drive.put("total", totalBytes);
        drives.put(drive);

        // Removable SD card if available
        try {
            File[] extDirs = context.getExternalFilesDirs(null);
            if (extDirs != null && extDirs.length > 1) {
                for (int i = 1; i < extDirs.length; i++) {
                    File d = extDirs[i];
                    if (d != null) {
                        String path = d.getAbsolutePath();
                        int androidIdx = path.indexOf("/Android");
                        if (androidIdx > 0) {
                            path = path.substring(0, androidIdx);
                        }
                        File sdRoot = new File(path);
                        if (sdRoot.exists() && sdRoot.canRead()) {
                            long sdTotal = 0, sdFree = 0;
                            try {
                                StatFs sdStat = new StatFs(sdRoot.getAbsolutePath());
                                long bs = sdStat.getBlockSizeLong();
                                sdTotal = sdStat.getBlockCountLong() * bs;
                                sdFree = sdStat.getAvailableBlocksLong() * bs;
                            } catch (Throwable ignored) {}
                            JSONObject sdDrive = new JSONObject();
                            sdDrive.put("name", "SD Card");
                            sdDrive.put("label", "SD Card");
                            sdDrive.put("mount", "/sdcard");
                            sdDrive.put("path", sdRoot.getAbsolutePath());
                            sdDrive.put("free", sdFree);
                            sdDrive.put("used", Math.max(0, sdTotal - sdFree));
                            sdDrive.put("total", sdTotal);
                            drives.put(sdDrive);
                            break;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}

        JSONArray shortcuts = new JSONArray();
        String[][] scDefs = new String[][] {
            {"Camera (DCIM)", rootPath + "/DCIM", "camera"},
            {"Downloads", rootPath + "/Download", "download"},
            {"Pictures", rootPath + "/Pictures", "image"},
            {"Movies", rootPath + "/Movies", "video"},
            {"Documents", rootPath + "/Documents", "file"}
        };

        for (String[] def : scDefs) {
            File scFile = new File(def[1]);
            if (!scFile.exists()) {
                if (def[1].endsWith("/Download") && new File(rootPath + "/Downloads").exists()) {
                    scFile = new File(rootPath + "/Downloads");
                } else if (def[1].endsWith("/Documents") && new File(rootPath + "/Document").exists()) {
                    scFile = new File(rootPath + "/Document");
                } else if (def[1].endsWith("/Movies") && new File(rootPath + "/Video").exists()) {
                    scFile = new File(rootPath + "/Video");
                }
            }
            JSONObject sc = new JSONObject();
            sc.put("name", def[0]);
            sc.put("path", scFile.getAbsolutePath());
            sc.put("icon", def[2]);
            shortcuts.put(sc);
        }

        resp.put("drives", drives);
        resp.put("shortcuts", shortcuts);
        sendJsonResponse(out, 200, resp.toString());
    }

    private void handleWebSharePage(OutputStream out, boolean isLoopback) throws Exception {
        String deviceName = getHostDeviceName();
        String token = this.authToken != null ? this.authToken : "";
        String html = "<!DOCTYPE html>\n" +
            "<html lang=\"en\">\n" +
            "<head>\n" +
            "  <meta charset=\"UTF-8\">\n" +
            "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\">\n" +
            "  <title>Fylo Share - " + escapeHtml(deviceName) + "</title>\n" +
            "  <style>\n" +
            "    :root {\n" +
            "      --bg: #0c0f17;\n" +
            "      --card-bg: rgba(22, 27, 40, 0.85);\n" +
            "      --border: rgba(255, 255, 255, 0.1);\n" +
            "      --primary: #6366f1;\n" +
            "      --primary-hover: #4f46e5;\n" +
            "      --primary-glow: rgba(99, 102, 241, 0.35);\n" +
            "      --success: #10b981;\n" +
            "      --text: #f3f4f6;\n" +
            "      --text-muted: #9ca3af;\n" +
            "    }\n" +
            "    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }\n" +
            "    body {\n" +
            "      background: var(--bg);\n" +
            "      background-image: radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 60%);\n" +
            "      color: var(--text);\n" +
            "      min-height: 100vh;\n" +
            "      display: flex;\n" +
            "      flex-direction: column;\n" +
            "      align-items: center;\n" +
            "      padding: 24px 16px;\n" +
            "    }\n" +
            "    .container { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 20px; }\n" +
            "    .header { text-align: center; padding: 10px 0; }\n" +
            "    .logo-badge {\n" +
            "      display: inline-flex; align-items: center; gap: 8px;\n" +
            "      background: rgba(99, 102, 241, 0.15); border: 1px solid var(--primary-glow);\n" +
            "      padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; color: #818cf8; margin-bottom: 12px;\n" +
            "    }\n" +
            "    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); box-shadow: 0 0 8px var(--success); }\n" +
            "    h1 { font-size: 24px; font-weight: 700; color: #fff; margin-bottom: 6px; }\n" +
            "    .subtitle { font-size: 14px; color: var(--text-muted); }\n" +
            "    .card {\n" +
            "      background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px;\n" +
            "      padding: 24px; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);\n" +
            "      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);\n" +
            "    }\n" +
            "    .dropzone {\n" +
            "      border: 2px dashed rgba(99, 102, 241, 0.4); border-radius: 12px; padding: 36px 20px;\n" +
            "      text-align: center; cursor: pointer; transition: all 0.2s ease; background: rgba(99, 102, 241, 0.04);\n" +
            "    }\n" +
            "    .dropzone.dragover { border-color: var(--primary); background: rgba(99, 102, 241, 0.15); transform: scale(1.01); }\n" +
            "    .dropzone-icon { width: 48px; height: 48px; margin: 0 auto 12px; stroke: #818cf8; display: block; }\n" +
            "    .dropzone-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }\n" +
            "    .dropzone-hint { font-size: 13px; color: var(--text-muted); }\n" +
            "    #fileInput { display: none; }\n" +
            "    .btn {\n" +
            "      display: inline-block; margin-top: 16px; background: var(--primary); color: #fff;\n" +
            "      font-weight: 600; font-size: 14px; padding: 10px 22px; border-radius: 10px; border: none; cursor: pointer;\n" +
            "      box-shadow: 0 4px 14px var(--primary-glow); transition: background 0.2s;\n" +
            "    }\n" +
            "    .btn:active { background: var(--primary-hover); transform: translateY(1px); }\n" +
            "    .progress-section { display: none; margin-top: 20px; }\n" +
            "    .progress-info { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; color: var(--text-muted); }\n" +
            "    .progress-filename { color: var(--text); font-weight: 500; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n" +
            "    .progress-bar-bg { width: 100%; height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 9999px; overflow: hidden; }\n" +
            "    .progress-bar-fill { width: 0%; height: 100%; background: linear-gradient(90deg, #6366f1, #10b981); transition: width 0.2s ease; }\n" +
            "    .file-list { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }\n" +
            "    .file-item { display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.04); padding: 12px 16px; border-radius: 10px; font-size: 14px; }\n" +
            "    .file-item-name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n" +
            "    .file-item-badge { font-size: 12px; color: var(--success); font-weight: 600; }\n" +
            "    .footer { text-align: center; font-size: 12px; color: var(--text-muted); margin-top: 20px; }\n" +
            "  </style>\n" +
            "</head>\n" +
            "<body>\n" +
            "  <div class=\"container\">\n" +
            "    <div class=\"header\">\n" +
            "      <div class=\"logo-badge\"><span class=\"status-dot\"></span><span>Fylo Direct Wireless Share</span></div>\n" +
            "      <h1>" + escapeHtml(deviceName) + "</h1>\n" +
            "      <p class=\"subtitle\">Direct Network Upload &bull; No Internet Needed</p>\n" +
            "    </div>\n" +
            "    <div class=\"card\">\n" +
            "      <div class=\"dropzone\" id=\"dropzone\" onclick=\"document.getElementById('fileInput').click()\">\n" +
            "        <svg class=\"dropzone-icon\" fill=\"none\" viewBox=\"0 0 24 24\" stroke-width=\"1.8\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z\"/></svg>\n" +
            "        <div class=\"dropzone-title\">Send Files to " + escapeHtml(deviceName) + "</div>\n" +
            "        <div class=\"dropzone-hint\">Tap to select or drop files here</div>\n" +
            "        <button class=\"btn\" type=\"button\" onclick=\"event.stopPropagation(); document.getElementById('fileInput').click();\">Choose Files</button>\n" +
            "        <input type=\"file\" id=\"fileInput\" multiple />\n" +
            "      </div>\n" +
            "      <div class=\"progress-section\" id=\"progressSection\">\n" +
            "        <div class=\"progress-info\"><span class=\"progress-filename\" id=\"progressFilename\">Uploading...</span><span id=\"progressPercent\">0%</span></div>\n" +
            "        <div class=\"progress-bar-bg\"><div class=\"progress-bar-fill\" id=\"progressBar\"></div></div>\n" +
            "      </div>\n" +
            "      <div class=\"file-list\" id=\"fileList\"></div>\n" +
            "    </div>\n" +
            "    <div class=\"footer\">Powered by Fylo Local Engine &bull; Private & Encrypted Direct Transfer</div>\n" +
            "  </div>\n" +
            "  <script>\n" +
            "    const AUTH_TOKEN = \"" + escapeJs(token) + "\";\n" +
            "    const dropzone = document.getElementById('dropzone');\n" +
            "    const fileInput = document.getElementById('fileInput');\n" +
            "    const progressSection = document.getElementById('progressSection');\n" +
            "    const progressFilename = document.getElementById('progressFilename');\n" +
            "    const progressPercent = document.getElementById('progressPercent');\n" +
            "    const progressBar = document.getElementById('progressBar');\n" +
            "    const fileList = document.getElementById('fileList');\n" +
            "    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });\n" +
            "    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));\n" +
            "    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer && e.dataTransfer.files) { uploadFiles(Array.from(e.dataTransfer.files)); } });\n" +
            "    fileInput.addEventListener('change', () => { if (fileInput.files) { uploadFiles(Array.from(fileInput.files)); } });\n" +
            "    async function uploadFiles(files) {\n" +
            "      if (!files || files.length === 0) return;\n" +
            "      progressSection.style.display = 'block';\n" +
            "      for (let i = 0; i < files.length; i++) {\n" +
            "        const file = files[i];\n" +
            "        progressFilename.textContent = '(' + (i + 1) + '/' + files.length + ') ' + file.name;\n" +
            "        progressPercent.textContent = '0%';\n" +
            "        progressBar.style.width = '0%';\n" +
            "        await new Promise((resolve) => {\n" +
            "          const xhr = new XMLHttpRequest();\n" +
            "          let target = '/api/fs/upload?name=' + encodeURIComponent(file.name);\n" +
            "          if (AUTH_TOKEN) { target += '&auth=' + encodeURIComponent(AUTH_TOKEN); }\n" +
            "          xhr.open('POST', target, true);\n" +
            "          if (AUTH_TOKEN) { xhr.setRequestHeader('X-Auth-Token', AUTH_TOKEN); }\n" +
            "          xhr.upload.onprogress = (evt) => { if (evt.lengthComputable) { const pct = Math.round((evt.loaded / evt.total) * 100); progressPercent.textContent = pct + '%'; progressBar.style.width = pct + '%'; } };\n" +
            "          xhr.onload = () => { addFileItem(file.name, xhr.status >= 200 && xhr.status < 300); resolve(); };\n" +
            "          xhr.onerror = () => { addFileItem(file.name, false); resolve(); };\n" +
            "          xhr.send(file);\n" +
            "        });\n" +
            "      }\n" +
            "      progressFilename.textContent = 'All transfers complete!';\n" +
            "      progressPercent.textContent = '100%';\n" +
            "      progressBar.style.width = '100%';\n" +
            "      fileInput.value = '';\n" +
            "    }\n" +
            "    function addFileItem(name, success) {\n" +
            "      const item = document.createElement('div');\n" +
            "      item.className = 'file-item';\n" +
            "      item.innerHTML = '<span class=\"file-item-name\">' + name + '</span><span class=\"file-item-badge\" style=\"color: ' + (success ? 'var(--success)' : '#ef4444') + '\">' + (success ? '✓ Saved to Phone' : '✗ Failed') + '</span>';\n" +
            "      fileList.prepend(item);\n" +
            "    }\n" +
            "  </script>\n" +
            "</body>\n" +
            "</html>";

        byte[] htmlBytes = html.getBytes(StandardCharsets.UTF_8);
        Map<String, String> extraHeaders = new HashMap<>();
        sendResponseHeaders(out, 200, "OK", "text/html; charset=utf-8", htmlBytes.length, extraHeaders);
        out.write(htmlBytes);
        out.flush();
    }

    private String escapeHtml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace(""", "&quot;");
    }

    private String escapeJs(String text) {
        if (text == null) return "";
        return text.replace("\\", "\\\\").replace(""", "\\"").replace("'", "\\'").replace("\n", "");
    }


    private void handleInfo(OutputStream out) throws Exception {
        JSONObject json = new JSONObject();
        json.put("appName", "Fylo Mobile");
        json.put("version", "4.0.0");
        json.put("readOnly", readOnly);
        json.put("allowFullPhoneAccess", allowFullPhoneAccess);
        String brand = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
        String model = Build.MODEL != null ? Build.MODEL : "Android";
        String deviceName = (!brand.isEmpty() && !model.toLowerCase().contains(brand.toLowerCase()))
            ? (brand.substring(0, 1).toUpperCase() + brand.substring(1) + " " + model)
            : model;
        json.put("name", deviceName);
        json.put("model", model);
        json.put("device", Build.DEVICE != null ? Build.DEVICE : "Generic");

        int batteryPct = -1;
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = context.registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0) {
                    batteryPct = Math.round((level / (float) scale) * 100);
                }
            }
        } catch (Throwable ignored) {}
        json.put("battery", batteryPct);

        long totalBytes = 0;
        long freeBytes = 0;
        try {
            File path = Environment.getExternalStorageDirectory();
            if (path != null && path.exists()) {
                StatFs stat = new StatFs(path.getPath());
                long blockSize = stat.getBlockSizeLong();
                long totalBlocks = stat.getBlockCountLong();
                long availableBlocks = stat.getAvailableBlocksLong();
                totalBytes = totalBlocks * blockSize;
                freeBytes = availableBlocks * blockSize;
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not query StatFs: " + e.getMessage());
        }

        JSONObject storage = new JSONObject();
        storage.put("total", totalBytes);
        storage.put("free", freeBytes);
        json.put("storage", storage);

        sendJsonResponse(out, 200, json.toString());
    }

    private void handleRecent(OutputStream out, Map<String, String> queryParams) throws Exception {
        if (!allowFullPhoneAccess) {
            sendJsonResponse(out, 403, "{\"success\":false,\"error\":\"Full phone storage sharing is disabled by phone user.\",\"items\":[]}");
            return;
        }

        int limit = 30;
        try {
            if (queryParams.containsKey("limit")) {
                limit = Math.min(100, Math.max(1, Integer.parseInt(queryParams.get("limit"))));
            }
        } catch (Exception ignored) {}

        JSONArray items = new JSONArray();
        try {
            Uri queryUri = MediaStore.Files.getContentUri("external");
            String[] projection = {
                MediaStore.Files.FileColumns._ID,
                MediaStore.Files.FileColumns.DATA,
                MediaStore.Files.FileColumns.DISPLAY_NAME,
                MediaStore.Files.FileColumns.DATE_MODIFIED,
                MediaStore.Files.FileColumns.SIZE,
                MediaStore.Files.FileColumns.MEDIA_TYPE
            };
            String selection = MediaStore.Files.FileColumns.MEDIA_TYPE + "=" + MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE
                    + " OR " + MediaStore.Files.FileColumns.MEDIA_TYPE + "=" + MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
            String sortOrder = MediaStore.MediaColumns.DATE_MODIFIED + " DESC";

            try (Cursor cursor = context.getContentResolver().query(queryUri, projection, selection, null, sortOrder)) {
                if (cursor != null) {
                    int pathCol = cursor.getColumnIndex(MediaStore.Files.FileColumns.DATA);
                    int nameCol = cursor.getColumnIndex(MediaStore.Files.FileColumns.DISPLAY_NAME);
                    int dateCol = cursor.getColumnIndex(MediaStore.Files.FileColumns.DATE_MODIFIED);
                    int sizeCol = cursor.getColumnIndex(MediaStore.Files.FileColumns.SIZE);
                    int typeCol = cursor.getColumnIndex(MediaStore.Files.FileColumns.MEDIA_TYPE);

                    int count = 0;
                    while (cursor.moveToNext() && count < limit) {
                        String path = pathCol != -1 ? cursor.getString(pathCol) : null;
                        if (path == null) continue;
                        File f = new File(path);
                        if (!f.exists()) continue;

                        String name = nameCol != -1 ? cursor.getString(nameCol) : f.getName();
                        long dateModified = dateCol != -1 ? cursor.getLong(dateCol) : 0;
                        long size = sizeCol != -1 ? cursor.getLong(sizeCol) : f.length();
                        int mediaType = typeCol != -1 ? cursor.getInt(typeCol) : 0;

                        JSONObject item = new JSONObject();
                        item.put("name", name != null ? name : f.getName());
                        item.put("path", path);
                        item.put("isDir", false);
                        item.put("isDirectory", false);
                        item.put("size", size);
                        item.put("modified", dateModified > 0 ? dateModified * 1000L : f.lastModified());
                        item.put("mtime", dateModified > 0 ? dateModified * 1000L : f.lastModified());

                        String ext = "";
                        int dotIdx = (name != null ? name : path).lastIndexOf('.');
                        if (dotIdx > 0 && dotIdx < (name != null ? name : path).length() - 1) {
                            ext = (name != null ? name : path).substring(dotIdx + 1).toLowerCase();
                        }
                        item.put("ext", ext);
                        item.put("isVideo", mediaType == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO);
                        item.put("isMedia", true);
                        items.put(item);
                        count++;
                    }
                }
            }
        } catch (Throwable e) {
            Log.w(TAG, "handleRecent error: " + e.getMessage());
        }

        if (items.length() == 0) {
            try {
                String[] scanDirs = {
                    "/storage/emulated/0/DCIM/Camera",
                    "/storage/emulated/0/DCIM",
                    "/storage/emulated/0/Pictures",
                    "/storage/emulated/0/Download"
                };
                List<File> mediaFiles = new ArrayList<>();
                for (String dirPath : scanDirs) {
                    File d = new File(dirPath);
                    if (d.isDirectory()) {
                        File[] files = d.listFiles();
                        if (files != null) {
                            for (File f : files) {
                                if (f.isFile() && f.length() > 0) {
                                    String n = f.getName().toLowerCase();
                                    if (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") ||
                                        n.endsWith(".webp") || n.endsWith(".mp4") || n.endsWith(".mkv") ||
                                        n.endsWith(".mov")) {
                                        mediaFiles.add(f);
                                    }
                                }
                            }
                        }
                    }
                }
                Collections.sort(mediaFiles, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                int added = 0;
                for (File f : mediaFiles) {
                    if (added >= limit) break;
                    String name = f.getName();
                    String path = f.getAbsolutePath();
                    long dateModified = f.lastModified();
                    long size = f.length();
                    String lower = name.toLowerCase();
                    boolean isVideo = lower.endsWith(".mp4") || lower.endsWith(".mkv") || lower.endsWith(".mov");

                    JSONObject item = new JSONObject();
                    item.put("name", name);
                    item.put("path", path);
                    item.put("isDir", false);
                    item.put("isDirectory", false);
                    item.put("size", size);
                    item.put("modified", dateModified);
                    item.put("mtime", dateModified);

                    String ext = "";
                    int dotIdx = name.lastIndexOf('.');
                    if (dotIdx > 0 && dotIdx < name.length() - 1) {
                        ext = name.substring(dotIdx + 1).toLowerCase();
                    }
                    item.put("ext", ext);
                    item.put("isVideo", isVideo);
                    item.put("isMedia", true);
                    items.put(item);
                    added++;
                }
            } catch (Throwable e) {
                Log.w(TAG, "handleRecent directory fallback error: " + e.getMessage());
            }
        }

        JSONObject resp = new JSONObject();
        resp.put("success", true);
        resp.put("items", items);
        sendJsonResponse(out, 200, resp.toString());
    }

    private void handleList(OutputStream out, Map<String, String> queryParams) throws Exception {
        if (!allowFullPhoneAccess) {
            sendJsonResponse(out, 403, "{\"success\":false,\"error\":\"Full phone storage sharing is disabled by phone user. Only ShareHub is enabled.\",\"storageAccessDisabled\":true,\"items\":[]}");
            return;
        }

        String targetPath = queryParams.get("path");
        if (targetPath == null || targetPath.trim().isEmpty()) {
            File ext = Environment.getExternalStorageDirectory();
            targetPath = ext != null ? ext.getAbsolutePath() : "/storage/emulated/0";
        }

        File folder = new File(targetPath);
        if (!folder.exists() || !folder.isDirectory()) {
            // Intelligent fallback for common Android folder variations across OEMs
            if (targetPath.endsWith("/DCIM/Camera") && new File("/storage/emulated/0/DCIM").isDirectory()) {
                folder = new File("/storage/emulated/0/DCIM");
            } else if (targetPath.endsWith("/Download") && new File("/storage/emulated/0/Downloads").isDirectory()) {
                folder = new File("/storage/emulated/0/Downloads");
            } else if (targetPath.endsWith("/Downloads") && new File("/storage/emulated/0/Download").isDirectory()) {
                folder = new File("/storage/emulated/0/Download");
            } else if (targetPath.endsWith("/Movies") && new File("/storage/emulated/0/Video").isDirectory()) {
                folder = new File("/storage/emulated/0/Video");
            } else if (targetPath.endsWith("/Documents") && new File("/storage/emulated/0/Document").isDirectory()) {
                folder = new File("/storage/emulated/0/Document");
            }
        }

        if (!folder.exists() || !folder.isDirectory()) {
            sendJsonResponse(out, 404, "{\"error\":\"Folder not found\",\"path\":\"" + targetPath + "\"}");
            return;
        }

        if (!isPathSafe(folder)) {
            sendJsonResponse(out, 403, "{\"error\":\"Access denied to requested path\"}");
            return;
        }

        File[] files = null;
        try {
            files = folder.listFiles();
        } catch (SecurityException se) {
            sendJsonResponse(out, 403, "{\"error\":\"Access denied to folder\",\"permissionRequired\":true}");
            return;
        }

        if (files == null && !folder.canRead()) {
            sendJsonResponse(out, 403, "{\"error\":\"Storage permission required on phone\",\"permissionRequired\":true}");
            return;
        }

        JSONArray items = new JSONArray();
        if (files != null) {
            // Robust TimSort comparator preventing general contract violation
            Arrays.sort(files, (a, b) -> {
                if (a == null && b == null) return 0;
                if (a == null) return 1;
                if (b == null) return -1;
                boolean aDir = false;
                boolean bDir = false;
                try { aDir = a.isDirectory(); } catch (Exception ignored) {}
                try { bDir = b.isDirectory(); } catch (Exception ignored) {}
                if (aDir != bDir) {
                    return aDir ? -1 : 1;
                }
                String aName = a.getName() != null ? a.getName() : "";
                String bName = b.getName() != null ? b.getName() : "";
                return aName.compareToIgnoreCase(bName);
            });

            for (File f : files) {
                if (f == null) continue;
                String fName = f.getName();
                if (fName == null || fName.startsWith(".")) continue;

                JSONObject item = new JSONObject();
                item.put("name", fName);
                item.put("path", f.getAbsolutePath());

                boolean isDir = false;
                try { isDir = f.isDirectory(); } catch (Exception ignored) {}
                item.put("isDir", isDir);
                item.put("size", isDir ? 0 : f.length());
                item.put("modified", f.lastModified());

                String ext = "";
                int dotIdx = fName.lastIndexOf('.');
                if (dotIdx > 0 && dotIdx < fName.length() - 1) {
                    ext = fName.substring(dotIdx + 1).toLowerCase();
                }
                item.put("ext", ext);
                items.put(item);
            }
        }

        JSONObject resp = new JSONObject();
        resp.put("path", folder.getAbsolutePath());
        File parent = folder.getParentFile();
        resp.put("parent", parent != null ? parent.getAbsolutePath() : "");
        resp.put("items", items);

        sendJsonResponse(out, 200, resp.toString());
    }

    private void handleFile(OutputStream out, Map<String, String> queryParams, Map<String, String> headers) throws Exception {
        String targetPath = queryParams.get("path");
        if (targetPath == null || targetPath.trim().isEmpty()) {
            sendJsonResponse(out, 400, "{\"error\":\"Missing path parameter\"}");
            return;
        }

        boolean download = "1".equals(queryParams.get("download")) || "true".equalsIgnoreCase(queryParams.get("download"));

        File file = new File(targetPath);
        if (!file.exists() || file.isDirectory()) {
            sendJsonResponse(out, 404, "{\"error\":\"File not found\"}");
            return;
        }

        if (!isPathSafe(file)) {
            sendJsonResponse(out, 403, "{\"error\":\"Access denied to requested path\"}");
            return;
        }

        long fileLength = file.length();
        String contentType = getMimeType(file.getName());

        if (fileLength == 0) {
            sendResponseHeaders(out, 200, "OK", contentType, 0, null);
            out.flush();
            return;
        }

        // Full RFC 7233 compliant Range header parsing
        String rangeHeader = headers.get("range");
        long start = 0;
        long end = fileLength - 1;
        boolean isPartial = false;

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            String rangeValue = rangeHeader.substring(6).trim();
            if (rangeValue.contains(",")) {
                rangeValue = rangeValue.substring(0, rangeValue.indexOf(',')).trim();
            }
            int dashIdx = rangeValue.indexOf('-');
            if (dashIdx != -1) {
                try {
                    String startStr = rangeValue.substring(0, dashIdx).trim();
                    String endStr = rangeValue.substring(dashIdx + 1).trim();
                    if (startStr.isEmpty()) {
                        // Suffix byte range: bytes=-500 -> last 500 bytes
                        if (!endStr.isEmpty()) {
                            long suffixLen = Long.parseLong(endStr);
                            if (suffixLen > 0) {
                                start = Math.max(0, fileLength - suffixLen);
                                end = fileLength - 1;
                                isPartial = true;
                            }
                        }
                    } else {
                        start = Long.parseLong(startStr);
                        if (!endStr.isEmpty()) {
                            end = Long.parseLong(endStr);
                        } else {
                            // Bounded 16MB chunk for open-ended media streaming so seeking responds instantly over Wi-Fi
                            boolean isMedia = (contentType != null) && (contentType.startsWith("video/") || contentType.startsWith("audio/"));
                            if (isMedia && !download) {
                                long maxChunk = 16L * 1024 * 1024;
                                end = Math.min(start + maxChunk - 1, fileLength - 1);
                            } else {
                                end = fileLength - 1;
                            }
                        }
                        if (start >= 0 && end >= start) {
                            isPartial = true;
                        }
                    }
                } catch (Throwable ignored) {
                    isPartial = false;
                    start = 0;
                    end = fileLength - 1;
                }
            }
        }

        // Validate range bounds
        if (start > end || start >= fileLength || start < 0) {
            Map<String, String> rangeErrHeaders = new HashMap<>();
            rangeErrHeaders.put("Content-Range", "bytes */" + fileLength);
            sendResponseHeaders(out, 416, "Range Not Satisfiable", "text/plain", 0, rangeErrHeaders);
            out.flush();
            return;
        }

        if (end >= fileLength) {
            end = fileLength - 1;
        }

        long contentLength = end - start + 1;
        Map<String, String> extraHeaders = new HashMap<>();
        extraHeaders.put("Accept-Ranges", "bytes");
        if (download) {
            extraHeaders.put("Content-Disposition", "attachment; filename=\"" + file.getName().replace("\"", "\\\"") + "\"");
        }

        if (isPartial) {
            extraHeaders.put("Content-Range", "bytes " + start + "-" + end + "/" + fileLength);
            sendResponseHeaders(out, 206, "Partial Content", contentType, contentLength, extraHeaders);
        } else {
            sendResponseHeaders(out, 200, "OK", contentType, contentLength, extraHeaders);
        }

        // Stream via FileChannel for fast, seekable, non-blocking transfer
        try (FileInputStream fis = new FileInputStream(file)) {
            FileChannel channel = fis.getChannel();
            if (start > 0) {
                channel.position(start);
            }
            byte[] buf = new byte[65536];
            ByteBuffer byteBuffer = ByteBuffer.wrap(buf);
            long remaining = contentLength;
            while (remaining > 0) {
                int toRead = (int) Math.min(buf.length, remaining);
                byteBuffer.limit(toRead);
                byteBuffer.position(0);
                int r = channel.read(byteBuffer);
                if (r == -1) break;
                out.write(buf, 0, r);
                remaining -= r;
            }
            out.flush();
        }
    }

    private void handleThumbnail(OutputStream out, Map<String, String> queryParams, boolean isLoopback) throws Exception {
        if (!isLoopback && !allowFullPhoneAccess) {
            sendJsonResponse(out, 403, "{\"error\":\"Full phone storage sharing is disabled by phone user.\"}");
            return;
        }

        String targetPath = queryParams.get("path");
        if (targetPath == null || targetPath.trim().isEmpty()) {
            sendJsonResponse(out, 400, "{\"error\":\"Missing path\"}");
            return;
        }

        File file = new File(targetPath);
        if (!file.exists() || file.isDirectory()) {
            sendJsonResponse(out, 404, "{\"error\":\"File not found\"}");
            return;
        }

        if (!isPathSafe(file)) {
            sendJsonResponse(out, 403, "{\"error\":\"Access denied to requested path\"}");
            return;
        }

        File cacheDir = new File(context.getCacheDir(), "thumbs");
        if (!cacheDir.exists()) cacheDir.mkdirs();
        String cacheKey = "th_" + Math.abs(file.getAbsolutePath().hashCode()) + "_" + file.lastModified() + ".jpg";
        File cacheFile = new File(cacheDir, cacheKey);
        if (cacheFile.exists() && cacheFile.length() > 0) {
            byte[] cachedBytes = new byte[(int) cacheFile.length()];
            try (FileInputStream fis = new FileInputStream(cacheFile)) {
                int read = fis.read(cachedBytes);
                if (read > 0) {
                    sendResponseHeaders(out, 200, "OK", "image/jpeg", read, null);
                    out.write(cachedBytes, 0, read);
                    out.flush();
                    return;
                }
            } catch (Throwable ignored) {}
        }

        Bitmap bitmap = null;
        try {
            String name = file.getName().toLowerCase();
            if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp") || name.endsWith(".bmp")) {
                BitmapFactory.Options boundsOpts = new BitmapFactory.Options();
                boundsOpts.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(file.getAbsolutePath(), boundsOpts);

                BitmapFactory.Options opts = new BitmapFactory.Options();
                int maxDim = Math.max(boundsOpts.outWidth, boundsOpts.outHeight);
                opts.inSampleSize = Math.max(1, maxDim / 180);
                opts.inPreferredConfig = Bitmap.Config.RGB_565; // Minimizes memory footprint
                bitmap = BitmapFactory.decodeFile(file.getAbsolutePath(), opts);
            } else if (name.endsWith(".mp4") || name.endsWith(".mkv") || name.endsWith(".mov") || name.endsWith(".webm") || name.endsWith(".3gp") || name.endsWith(".avi") || name.endsWith(".ts") || name.endsWith(".flv") || name.endsWith(".wmv")) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        bitmap = ThumbnailUtils.createVideoThumbnail(file, new android.util.Size(320, 320), null);
                    } catch (Throwable ignored) {}
                }
                if (bitmap == null) {
                    MediaMetadataRetriever mmr = null;
                    try {
                        mmr = new MediaMetadataRetriever();
                        mmr.setDataSource(file.getAbsolutePath());
                        bitmap = mmr.getFrameAtTime(1000000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                        if (bitmap == null) {
                            bitmap = mmr.getFrameAtTime(-1);
                        }
                    } catch (Throwable ignored) {
                    } finally {
                        if (mmr != null) {
                            try { mmr.release(); } catch (Throwable ignored) {}
                        }
                    }
                }
                if (bitmap == null) {
                    try {
                        bitmap = ThumbnailUtils.createVideoThumbnail(file.getAbsolutePath(), MediaStore.Video.Thumbnails.MINI_KIND);
                    } catch (Throwable ignored) {}
                }
            }
        } catch (OutOfMemoryError oom) {
            Log.w(TAG, "OOM during thumbnail creation for " + file.getName());
            bitmap = null;
        } catch (Throwable t) {
            Log.w(TAG, "Error generating thumbnail: " + t.getMessage());
            bitmap = null;
        }

        if (bitmap == null) {
            sendJsonResponse(out, 404, "{\"error\":\"Thumbnail not supported or could not be generated\"}");
            return;
        }

        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 75, baos);
            byte[] thumbBytes = baos.toByteArray();

            try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
                fos.write(thumbBytes);
            } catch (Throwable ignored) {}

            sendResponseHeaders(out, 200, "OK", "image/jpeg", thumbBytes.length, null);
            out.write(thumbBytes);
            out.flush();
        } finally {
            if (!bitmap.isRecycled()) {
                bitmap.recycle();
            }
        }
    }

    private void handleSetReadOnly(OutputStream out, byte[] body) throws Exception {
        if (body != null && body.length > 0) {
            try {
                String bodyStr = new String(body, StandardCharsets.UTF_8);
                JSONObject json = new JSONObject(bodyStr);
                if (json.has("readOnly")) {
                    this.readOnly = json.getBoolean("readOnly");
                    Log.i(TAG, "Server readOnly mode updated to: " + this.readOnly);
                }
            } catch (Exception e) {
                Log.w(TAG, "Invalid setReadOnly JSON payload: " + e.getMessage());
            }
        }
        JSONObject resp = new JSONObject();
        resp.put("success", true);
        resp.put("readOnly", this.readOnly);
        sendJsonResponse(out, 200, resp.toString());
    }

    private void handleTrash(OutputStream out, byte[] body) throws Exception {
        if (!allowFullPhoneAccess) {
            sendJsonResponse(out, 403, "{\"error\":\"Full phone storage sharing is disabled by phone user.\"}");
            return;
        }

        if (this.readOnly) {
            sendJsonResponse(out, 403, "{\"error\":\"Host is in Read-Only Safe Mode. Modifications disabled.\"}");
            return;
        }

        if (body == null || body.length == 0) {
            sendJsonResponse(out, 400, "{\"error\":\"Missing request payload\"}");
            return;
        }

        String bodyStr = new String(body, StandardCharsets.UTF_8);
        JSONObject json;
        try {
            json = new JSONObject(bodyStr);
        } catch (Exception e) {
            sendJsonResponse(out, 400, "{\"error\":\"Invalid JSON payload\"}");
            return;
        }

        String filePath = json.optString("path", "");
        if (filePath.isEmpty()) {
            sendJsonResponse(out, 400, "{\"error\":\"Missing path in payload\"}");
            return;
        }

        File file = new File(filePath);
        if (!file.exists()) {
            sendJsonResponse(out, 404, "{\"error\":\"File not found\"}");
            return;
        }

        if (!isPathSafe(file)) {
            sendJsonResponse(out, 403, "{\"error\":\"Access denied to requested path\"}");
            return;
        }

        File extStorage = Environment.getExternalStorageDirectory();
        File parentDir = file.getParentFile();
        File baseDir = extStorage != null ? extStorage : (parentDir != null ? parentDir : context.getFilesDir());
        File trashDir = new File(baseDir, ".trash");
        if (!trashDir.exists()) {
            trashDir.mkdirs();
        }

        File destination = new File(trashDir, System.currentTimeMillis() + "_" + file.getName());
        boolean success = file.renameTo(destination);
        if (!success) {
            try (FileInputStream in = new FileInputStream(file);
                 java.io.FileOutputStream fos = new java.io.FileOutputStream(destination)) {
                byte[] b = new byte[65536];
                int n;
                while ((n = in.read(b)) > 0) {
                    fos.write(b, 0, n);
                }
                success = file.delete();
            } catch (Throwable ignored) {}
        }

        JSONObject resp = new JSONObject();
        resp.put("success", success);
        resp.put("trashPath", destination.getAbsolutePath());
        sendJsonResponse(out, success ? 200 : 500, resp.toString());
    }

    private void handleUploadStream(OutputStream out, Map<String, String> queryParams, InputStream in, int contentLength) throws Exception {
        String name = queryParams.get("name");
        if (name == null || name.trim().isEmpty()) {
            name = "fylo_upload_" + System.currentTimeMillis();
        }
        name = new File(name).getName().replaceAll("[\\\\/:*?\"<>|]", "_");

        String dirPath = queryParams.get("dir");
        File dir = null;
        if (dirPath != null && !dirPath.trim().isEmpty()) {
            File customDir = new File(dirPath.trim());
            if (customDir.exists() && customDir.isDirectory() && customDir.canWrite()) {
                dir = customDir;
            }
        }
        if (dir == null) {
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            dir = new File(downloadsDir, "Fylo");
        }
        if (!dir.exists()) {
            dir.mkdirs();
        }

        String relPath = queryParams.get("relPath");
        File dest;
        if (relPath != null && !relPath.trim().isEmpty()) {
            String safeRel = relPath.replace("\\", "/").replaceAll("^(/|\\.\\./)+", "");
            dest = new File(dir, safeRel);
            try {
                if (!dest.getCanonicalPath().startsWith(dir.getCanonicalPath())) {
                    dest = new File(dir, name);
                }
            } catch (Throwable ignored) {
                dest = new File(dir, name);
            }
        } else {
            dest = new File(dir, name);
        }

        if (dest.getParentFile() != null && !dest.getParentFile().exists()) {
            dest.getParentFile().mkdirs();
        }

        if (dest.exists()) {
            String base = dest.getName();
            String ext = "";
            int dot = base.lastIndexOf('.');
            if (dot > 0) {
                base = base.substring(0, dot);
                ext = dest.getName().substring(dot);
            }
            dest = new File(dest.getParentFile(), base + "_" + System.currentTimeMillis() + ext);
        }

        try (FileOutputStream fos = new FileOutputStream(dest)) {
            byte[] buf = new byte[65536];
            int remaining = contentLength;
            if (remaining > 0) {
                while (remaining > 0) {
                    int toRead = Math.min(buf.length, remaining);
                    int r = in.read(buf, 0, toRead);
                    if (r == -1) break;
                    fos.write(buf, 0, r);
                    remaining -= r;
                }
            } else {
                int r;
                while ((r = in.read(buf)) != -1) {
                    fos.write(buf, 0, r);
                }
            }
            fos.flush();
        }

        // Notify media scanner so photos/audio appear in Gallery immediately
        try {
            android.media.MediaScannerConnection.scanFile(context, new String[]{dest.getAbsolutePath()}, null, null);
        } catch (Throwable ignored) {}

        JSONObject resp = new JSONObject();
        resp.put("success", true);
        resp.put("name", dest.getName());
        resp.put("path", dest.getAbsolutePath());
        resp.put("size", dest.length());
        sendJsonResponse(out, 200, resp.toString());
    }

    private void sendJsonResponse(OutputStream out, int status, String json) throws IOException {
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        sendResponseHeaders(out, status, status == 200 ? "OK" : "Error", "application/json; charset=utf-8", data.length, null);
        out.write(data);
        out.flush();
    }

    private void sendResponseHeaders(OutputStream out, int statusCode, String statusText,
                                    String contentType, long contentLength, Map<String, String> extraHeaders) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(statusCode).append(" ").append(statusText).append("\r\n");
        sb.append("Content-Type: ").append(contentType != null ? contentType : "application/octet-stream").append("\r\n");
        sb.append("Content-Length: ").append(contentLength).append("\r\n");
        sb.append("Access-Control-Allow-Origin: *\r\n");
        sb.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        sb.append("Access-Control-Allow-Headers: *\r\n");
        sb.append("Connection: close\r\n");

        if (extraHeaders != null) {
            for (Map.Entry<String, String> e : extraHeaders.entrySet()) {
                sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            }
        }
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private String getMimeType(String fileName) {
        if (fileName == null) return "application/octet-stream";
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        if (lower.endsWith(".mov")) return "video/quicktime";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
        if (lower.endsWith(".zip")) return "application/zip";
        return "application/octet-stream";
    }

    private boolean isPathSafe(File file) {
        if (file == null) return false;
        try {
            String path = file.getPath();
            if (path == null || path.contains("\0")) return false;
            String canonical = file.getCanonicalPath();
            if (canonical.contains("\0")) return false;

            // Explicitly allow FyloShared direct transfers
            if (canonical.contains("FyloShared")) {
                return true;
            }

            // Disallow access to app private internal data directories
            if (context != null && context.getApplicationInfo() != null) {
                String privateDataDir = context.getApplicationInfo().dataDir;
                if (privateDataDir != null) {
                    String privateCanonical = new File(privateDataDir).getCanonicalPath();
                    if (canonical.equals(privateCanonical) || canonical.startsWith(privateCanonical + File.separator)) {
                        return false;
                    }
                }
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}

