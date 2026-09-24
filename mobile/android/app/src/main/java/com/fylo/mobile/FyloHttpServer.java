package com.fylo.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ThumbnailUtils;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.MediaStore;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class FyloHttpServer {
    private static final String TAG = "FyloHttpServer";
    private final Context context;
    private final int port;
    private volatile boolean readOnly = true;
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

    public void setAuthToken(String token) {
        this.authToken = token;
    }

    public String getAuthToken() {
        return authToken;
    }

    public synchronized void start() throws IOException {
        if (isRunning) return;
        serverSocket = new ServerSocket(port);
        serverSocket.setReuseAddress(true);
        executor = Executors.newCachedThreadPool();
        isRunning = true;

        executor.execute(() -> {
            Log.i(TAG, "Fylo HTTP Server listening on port " + port);
            while (isRunning && !serverSocket.isClosed()) {
                try {
                    Socket clientSocket = serverSocket.accept();
                    clientSocket.setTcpNoDelay(true);
                    executor.execute(() -> handleClient(clientSocket));
                } catch (IOException e) {
                    if (!isRunning) break;
                    Log.w(TAG, "Socket accept error: " + e.getMessage());
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
            executor.shutdownNow();
            executor = null;
        }
        Log.i(TAG, "Fylo HTTP Server stopped");
    }

    private void handleClient(Socket socket) {
        try (InputStream in = new BufferedInputStream(socket.getInputStream());
             OutputStream out = new BufferedOutputStream(socket.getOutputStream())) {

            // Read HTTP request line and headers
            ByteArrayOutputStream headerBuffer = new ByteArrayOutputStream();
            int b;
            int consecutiveLf = 0;
            while ((b = in.read()) != -1) {
                headerBuffer.write(b);
                if (b == '\n') {
                    consecutiveLf++;
                    if (consecutiveLf == 2 || headerBuffer.toString().endsWith("\r\n\r\n")) {
                        break;
                    }
                } else if (b != '\r') {
                    consecutiveLf = 0;
                }
            }

            String headerText = headerBuffer.toString("UTF-8");
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
                        try { contentLength = Integer.parseInt(val); } catch (Exception ignored) {}
                    }
                }
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

            // Authorization check
            if (!isAuthorized(query, headers)) {
                sendJsonResponse(out, 401, "{\"error\":\"Unauthorized: Invalid or missing auth token\"}");
                return;
            }

            // Routing
            if ("/api/info".equals(path)) {
                handleInfo(out);
            } else if ("/api/fs/list".equals(path)) {
                handleList(out, query);
            } else if ("/api/fs/file".equals(path)) {
                handleFile(out, query, headers);
            } else if ("/api/fs/thumbnail".equals(path)) {
                handleThumbnail(out, query);
            } else if ("/api/set-readonly".equals(path) && "POST".equals(method)) {
                handleSetReadOnly(out, bodyBytes);
            } else if ("/api/fs/trash".equals(path) && "POST".equals(method)) {
                handleTrash(out, bodyBytes);
            } else {
                sendJsonResponse(out, 404, "{\"error\":\"Endpoint not found\"}");
            }

        } catch (Exception e) {
            Log.w(TAG, "Request handling error: " + e.getMessage());
        } finally {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private boolean isAuthorized(String query, Map<String, String> headers) {
        if (authToken == null || authToken.trim().isEmpty()) {
            return true;
        }
        if (query != null && !query.isEmpty()) {
            for (String param : query.split("&")) {
                String[] pair = param.split("=");
                if (pair.length > 1 && "auth".equals(pair[0])) {
                    try {
                        String queryToken = URLDecoder.decode(pair[1], "UTF-8");
                        if (authToken.equals(queryToken)) return true;
                    } catch (Exception ignored) {}
                }
            }
        }
        String authHeader = headers.get("authorization");
        if (authHeader != null) {
            if (authHeader.startsWith("Bearer ") || authHeader.startsWith("bearer ")) {
                authHeader = authHeader.substring(7).trim();
            }
            if (authToken.equals(authHeader)) return true;
        }
        String xAuth = headers.get("x-auth-token");
        return xAuth != null && authToken.equals(xAuth);
    }

    private void handleInfo(OutputStream out) throws Exception {
        JSONObject json = new JSONObject();
        json.put("appName", "Fylo Mobile");
        json.put("version", "4.0.0");
        json.put("readOnly", readOnly);
        json.put("model", Build.MODEL);
        json.put("device", Build.DEVICE);

        File path = Environment.getExternalStorageDirectory();
        StatFs stat = new StatFs(path.getPath());
        long blockSize = stat.getBlockSizeLong();
        long totalBlocks = stat.getBlockCountLong();
        long availableBlocks = stat.getAvailableBlocksLong();

        JSONObject storage = new JSONObject();
        storage.put("total", totalBlocks * blockSize);
        storage.put("free", availableBlocks * blockSize);
        json.put("storage", storage);

        sendJsonResponse(out, 200, json.toString());
    }

    private void handleList(OutputStream out, String query) throws Exception {
        String targetPath = Environment.getExternalStorageDirectory().getAbsolutePath();
        if (query != null && !query.isEmpty()) {
            for (String param : query.split("&")) {
                String[] pair = param.split("=");
                if (pair.length > 1 && "path".equals(pair[0])) {
                    targetPath = URLDecoder.decode(pair[1], "UTF-8");
                }
            }
        }

        File folder = new File(targetPath);
        if (!folder.exists() || !folder.isDirectory()) {
            sendJsonResponse(out, 404, "{\"error\":\"Folder not found\"}");
            return;
        }

        File[] files = folder.listFiles();
        JSONArray items = new JSONArray();
        if (files != null) {
            Arrays.sort(files, (a, b) -> {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.getName().compareToIgnoreCase(b.getName());
            });

            for (File f : files) {
                if (f.getName().startsWith(".")) continue;
                JSONObject item = new JSONObject();
                item.put("name", f.getName());
                item.put("path", f.getAbsolutePath());
                item.put("isDir", f.isDirectory());
                item.put("size", f.isDirectory() ? 0 : f.length());
                item.put("modified", f.lastModified());
                String ext = "";
                int dotIdx = f.getName().lastIndexOf('.');
                if (dotIdx > 0 && dotIdx < f.getName().length() - 1) {
                    ext = f.getName().substring(dotIdx + 1).toLowerCase();
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

    private void handleFile(OutputStream out, String query, Map<String, String> headers) throws Exception {
        String targetPath = null;
        boolean download = false;
        if (query != null && !query.isEmpty()) {
            for (String param : query.split("&")) {
                String[] pair = param.split("=");
                if (pair.length > 1) {
                    if ("path".equals(pair[0])) {
                        targetPath = URLDecoder.decode(pair[1], "UTF-8");
                    } else if ("download".equals(pair[0])) {
                        download = "1".equals(pair[1]) || "true".equalsIgnoreCase(pair[1]);
                    }
                }
            }
        }

        if (targetPath == null) {
            sendJsonResponse(out, 400, "{\"error\":\"Missing path parameter\"}");
            return;
        }

        File file = new File(targetPath);
        if (!file.exists() || file.isDirectory()) {
            sendJsonResponse(out, 404, "{\"error\":\"File not found\"}");
            return;
        }

        long fileLength = file.length();
        String contentType = getMimeType(file.getName());

        // Range support
        String rangeHeader = headers.get("range");
        long start = 0;
        long end = fileLength - 1;
        boolean isPartial = false;

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            String rangeValue = rangeHeader.substring(6).trim();
            int dashIdx = rangeValue.indexOf('-');
            if (dashIdx != -1) {
                try {
                    String startStr = rangeValue.substring(0, dashIdx).trim();
                    String endStr = rangeValue.substring(dashIdx + 1).trim();
                    if (!startStr.isEmpty()) start = Long.parseLong(startStr);
                    if (!endStr.isEmpty()) end = Long.parseLong(endStr);
                    isPartial = true;
                } catch (Exception ignored) {}
            }
        }

        long contentLength = end - start + 1;
        Map<String, String> extraHeaders = new HashMap<>();
        extraHeaders.put("Accept-Ranges", "bytes");
        if (download) {
            extraHeaders.put("Content-Disposition", "attachment; filename=\"" + file.getName() + "\"");
        }

        if (isPartial) {
            extraHeaders.put("Content-Range", "bytes " + start + "-" + end + "/" + fileLength);
            sendResponseHeaders(out, 206, "Partial Content", contentType, contentLength, extraHeaders);
        } else {
            sendResponseHeaders(out, 200, "OK", contentType, contentLength, extraHeaders);
        }

        try (FileInputStream fis = new FileInputStream(file)) {
            if (start > 0) fis.skip(start);
            byte[] buf = new byte[65536];
            long remaining = contentLength;
            while (remaining > 0) {
                int toRead = (int) Math.min(buf.length, remaining);
                int r = fis.read(buf, 0, toRead);
                if (r == -1) break;
                out.write(buf, 0, r);
                remaining -= r;
            }
            out.flush();
        }
    }

    private void handleThumbnail(OutputStream out, String query) throws Exception {
        String targetPath = null;
        if (query != null && !query.isEmpty()) {
            for (String param : query.split("&")) {
                String[] pair = param.split("=");
                if (pair.length > 1 && "path".equals(pair[0])) {
                    targetPath = URLDecoder.decode(pair[1], "UTF-8");
                }
            }
        }

        if (targetPath == null) {
            sendJsonResponse(out, 400, "{\"error\":\"Missing path\"}");
            return;
        }

        File file = new File(targetPath);
        if (!file.exists() || file.isDirectory()) {
            sendJsonResponse(out, 404, "{\"error\":\"File not found\"}");
            return;
        }

        Bitmap bitmap = null;
        String name = file.getName().toLowerCase();
        if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp")) {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = 4;
            bitmap = BitmapFactory.decodeFile(file.getAbsolutePath(), opts);
        } else if (name.endsWith(".mp4") || name.endsWith(".mkv") || name.endsWith(".mov")) {
            bitmap = ThumbnailUtils.createVideoThumbnail(file.getAbsolutePath(), MediaStore.Video.Thumbnails.MICRO_KIND);
        }

        if (bitmap == null) {
            sendJsonResponse(out, 404, "{\"error\":\"Thumbnail not supported\"}");
            return;
        }

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 75, baos);
        byte[] thumbBytes = baos.toByteArray();
        bitmap.recycle();

        sendResponseHeaders(out, 200, "OK", "image/jpeg", thumbBytes.length, null);
        out.write(thumbBytes);
        out.flush();
    }

    private void handleSetReadOnly(OutputStream out, byte[] body) throws Exception {
        String bodyStr = new String(body, StandardCharsets.UTF_8);
        JSONObject json = new JSONObject(bodyStr);
        if (json.has("readOnly")) {
            this.readOnly = json.getBoolean("readOnly");
            Log.i(TAG, "Server readOnly mode updated to: " + this.readOnly);
        }
        JSONObject resp = new JSONObject();
        resp.put("success", true);
        resp.put("readOnly", this.readOnly);
        sendJsonResponse(out, 200, resp.toString());
    }

    private void handleTrash(OutputStream out, byte[] body) throws Exception {
        if (this.readOnly) {
            sendJsonResponse(out, 403, "{\"error\":\"Host is in Read-Only Safe Mode. Modifications disabled.\"}");
            return;
        }

        String bodyStr = new String(body, StandardCharsets.UTF_8);
        JSONObject json = new JSONObject(bodyStr);
        String filePath = json.optString("path", "");
        File file = new File(filePath);

        if (!file.exists()) {
            sendJsonResponse(out, 404, "{\"error\":\"File not found\"}");
            return;
        }

        File trashDir = new File(Environment.getExternalStorageDirectory(), ".trash");
        if (!trashDir.exists()) trashDir.mkdirs();

        File destination = new File(trashDir, System.currentTimeMillis() + "_" + file.getName());
        boolean success = file.renameTo(destination);

        JSONObject resp = new JSONObject();
        resp.put("success", success);
        resp.put("trashPath", destination.getAbsolutePath());
        sendJsonResponse(out, success ? 200 : 500, resp.toString());
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
        sb.append("Content-Type: ").append(contentType).append("\r\n");
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
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
        if (lower.endsWith(".zip")) return "application/zip";
        return "application/octet-stream";
    }
}
