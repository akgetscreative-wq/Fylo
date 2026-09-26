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
import android.util.Log;

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

            // Authorization check
            if (!isLoopback && !isAuthorized(queryParams, headers)) {
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
            } else if ("/api/fs/list".equals(path)) {
                handleList(out, queryParams);
            } else if ("/api/fs/file".equals(path)) {
                handleFile(out, queryParams, headers);
            } else if ("/api/fs/thumbnail".equals(path)) {
                handleThumbnail(out, queryParams, isLoopback);
            } else if ("/api/set-readonly".equals(path) && "POST".equals(method)) {
                handleSetReadOnly(out, bodyBytes);
            } else if ("/api/fs/trash".equals(path) && "POST".equals(method)) {
                handleTrash(out, bodyBytes);
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
                            end = fileLength - 1;
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

        File dest = new File(dir, name);
        if (dest.exists()) {
            String base = name;
            String ext = "";
            int dot = name.lastIndexOf('.');
            if (dot > 0) {
                base = name.substring(0, dot);
                ext = name.substring(dot);
            }
            dest = new File(dir, base + "_" + System.currentTimeMillis() + ext);
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

