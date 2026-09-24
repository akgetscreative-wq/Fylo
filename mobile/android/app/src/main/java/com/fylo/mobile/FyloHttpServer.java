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

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.Executors;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

public class FyloHttpServer {
    private static final String TAG = "FyloHttpServer";
    private HttpServer server;
    private int port;
    private boolean readOnly = true;
    private String authToken = null;
    private Context context;

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

    private boolean isAuthorized(HttpExchange exchange) {
        if (authToken == null || authToken.trim().isEmpty()) {
            return true;
        }
        String query = exchange.getRequestURI().getQuery();
        if (query != null) {
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
        String authHeader = exchange.getRequestHeaders().getFirst("Authorization");
        if (authHeader != null) {
            if (authHeader.startsWith("Bearer ")) {
                authHeader = authHeader.substring(7).trim();
            }
            if (authToken.equals(authHeader)) return true;
        }
        String xAuth = exchange.getRequestHeaders().getFirst("X-Auth-Token");
        if (xAuth != null && authToken.equals(xAuth)) {
            return true;
        }
        return false;
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(port), 0);
        server.setExecutor(Executors.newFixedThreadPool(8));

        // Info endpoint
        server.createContext("/api/info", new InfoHandler());

        // File system list endpoint
        server.createContext("/api/fs/list", new ListHandler());

        // File stream endpoint (Supports HTTP Range / 206 Partial Content)
        server.createContext("/api/fs/file", new FileHandler());

        // Image thumbnail generator
        server.createContext("/api/fs/thumbnail", new ThumbnailHandler());

        // Set read-only mode endpoint
        server.createContext("/api/set-readonly", new SetReadOnlyHandler());

        // Safe Trash / Recycle Bin endpoint (Moves file to .trash, never permanently deletes)
        server.createContext("/api/fs/trash", new TrashHandler());

        server.start();
        Log.i(TAG, "Fylo HTTP Server started on port " + port);
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
            server = null;
            Log.i(TAG, "Fylo HTTP Server stopped");
        }
    }

    private class InfoHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            try {
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

                byte[] response = json.toString().getBytes("UTF-8");
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                exchange.sendResponseHeaders(200, response.length);
                OutputStream os = exchange.getResponseBody();
                os.write(response);
                os.close();
            } catch (Exception e) {
                sendError(exchange, 500, e.getMessage());
            }
        }
    }

    private class ListHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendError(exchange, 401, "Unauthorized: Invalid or missing auth token");
                return;
            }
            try {
                String query = exchange.getRequestURI().getQuery();
                String targetPath = Environment.getExternalStorageDirectory().getAbsolutePath();

                if (query != null) {
                    for (String param : query.split("&")) {
                        String[] pair = param.split("=");
                        if (pair.length > 1 && "path".equals(pair[0])) {
                            targetPath = URLDecoder.decode(pair[1], "UTF-8");
                        }
                    }
                }

                File dir = new File(targetPath);
                if (!dir.exists() || !dir.isDirectory()) {
                    sendError(exchange, 404, "Directory not found: " + targetPath);
                    return;
                }

                JSONObject res = new JSONObject();
                res.put("path", dir.getAbsolutePath());
                res.put("parent", dir.getParent() != null ? dir.getParent() : "");
                res.put("isRoot", dir.getAbsolutePath().equals(Environment.getExternalStorageDirectory().getAbsolutePath()));
                res.put("readOnly", readOnly);

                JSONArray items = new JSONArray();
                File[] files = dir.listFiles();
                if (files != null) {
                    Arrays.sort(files, new Comparator<File>() {
                        @Override
                        public int compare(File f1, File f2) {
                            if (f1.isDirectory() && !f2.isDirectory()) return -1;
                            if (!f1.isDirectory() && f2.isDirectory()) return 1;
                            return f1.getName().compareToIgnoreCase(f2.getName());
                        }
                    });

                    for (File f : files) {
                        if (f.getName().startsWith(".")) continue; // Skip hidden files

                        JSONObject item = new JSONObject();
                        item.put("name", f.getName());
                        item.put("path", f.getAbsolutePath());
                        item.put("isDir", f.isDirectory());
                        item.put("size", f.isDirectory() ? 0 : f.length());
                        item.put("modified", f.lastModified());

                        String ext = "";
                        int idx = f.getName().lastIndexOf('.');
                        if (idx > 0) {
                            ext = f.getName().substring(idx + 1).toLowerCase();
                        }
                        item.put("ext", ext);

                        items.put(item);
                    }
                }
                res.put("items", items);

                byte[] response = res.toString().getBytes("UTF-8");
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                exchange.sendResponseHeaders(200, response.length);
                OutputStream os = exchange.getResponseBody();
                os.write(response);
                os.close();
            } catch (Exception e) {
                sendError(exchange, 500, e.getMessage());
            }
        }
    }

    private class FileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendError(exchange, 401, "Unauthorized: Invalid or missing auth token");
                return;
            }
            try {
                String query = exchange.getRequestURI().getQuery();
                String targetPath = null;

                if (query != null) {
                    for (String param : query.split("&")) {
                        String[] pair = param.split("=");
                        if (pair.length > 1 && "path".equals(pair[0])) {
                            targetPath = URLDecoder.decode(pair[1], "UTF-8");
                        }
                    }
                }

                if (targetPath == null) {
                    sendError(exchange, 400, "Missing path parameter");
                    return;
                }

                File file = new File(targetPath);
                if (!file.exists() || file.isDirectory()) {
                    sendError(exchange, 404, "File not found: " + targetPath);
                    return;
                }

                long fileLength = file.length();
                String rangeHeader = exchange.getRequestHeaders().getFirst("Range");

                String mimeType = getMimeType(file.getName());
                exchange.getResponseHeaders().set("Content-Type", mimeType);
                exchange.getResponseHeaders().set("Accept-Ranges", "bytes");
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");

                if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                    String[] ranges = rangeHeader.substring(6).split("-");
                    long start = Long.parseLong(ranges[0]);
                    long end = ranges.length > 1 && !ranges[1].isEmpty() ? Long.parseLong(ranges[1]) : fileLength - 1;

                    if (start >= fileLength || end >= fileLength || start > end) {
                        exchange.getResponseHeaders().set("Content-Range", "bytes */" + fileLength);
                        exchange.sendResponseHeaders(416, -1);
                        return;
                    }

                    long contentLength = end - start + 1;
                    exchange.getResponseHeaders().set("Content-Range", "bytes " + start + "-" + end + "/" + fileLength);
                    exchange.sendResponseHeaders(206, contentLength);

                    FileInputStream fis = new FileInputStream(file);
                    fis.skip(start);
                    OutputStream os = exchange.getResponseBody();
                    byte[] buffer = new byte[64 * 1024];
                    long bytesRemaining = contentLength;

                    while (bytesRemaining > 0) {
                        int toRead = (int) Math.min(buffer.length, bytesRemaining);
                        int read = fis.read(buffer, 0, toRead);
                        if (read == -1) break;
                        os.write(buffer, 0, read);
                        bytesRemaining -= read;
                    }

                    fis.close();
                    os.close();
                } else {
                    exchange.sendResponseHeaders(200, fileLength);
                    FileInputStream fis = new FileInputStream(file);
                    OutputStream os = exchange.getResponseBody();
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = fis.read(buffer)) != -1) {
                        os.write(buffer, 0, read);
                    }
                    fis.close();
                    os.close();
                }
            } catch (Exception e) {
                Log.e(TAG, "FileHandler error", e);
                sendError(exchange, 500, e.getMessage());
            }
        }
    }

    private class ThumbnailHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendError(exchange, 401, "Unauthorized: Invalid or missing auth token");
                return;
            }
            try {
                String query = exchange.getRequestURI().getQuery();
                String targetPath = null;
                if (query != null) {
                    for (String param : query.split("&")) {
                        String[] pair = param.split("=");
                        if (pair.length > 1 && "path".equals(pair[0])) {
                            targetPath = URLDecoder.decode(pair[1], "UTF-8");
                        }
                    }
                }

                if (targetPath == null || !new File(targetPath).exists()) {
                    sendError(exchange, 404, "File not found");
                    return;
                }

                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = 4; // Downsample for fast thumbnail transfer
                Bitmap bitmap = BitmapFactory.decodeFile(targetPath, options);

                if (bitmap == null) {
                    sendError(exchange, 404, "Could not generate thumbnail");
                    return;
                }

                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 75, baos);
                byte[] bytes = baos.toByteArray();
                bitmap.recycle();

                exchange.getResponseHeaders().set("Content-Type", "image/jpeg");
                exchange.getResponseHeaders().set("Cache-Control", "public, max-age=86400");
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                exchange.sendResponseHeaders(200, bytes.length);

                OutputStream os = exchange.getResponseBody();
                os.write(bytes);
                os.close();
            } catch (Exception e) {
                sendError(exchange, 500, e.getMessage());
            }
        }
    }

    private class SetReadOnlyHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendError(exchange, 401, "Unauthorized: Invalid or missing auth token");
                return;
            }
            try {
                if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                    InputStream is = exchange.getRequestBody();
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[1024];
                    int r;
                    while ((r = is.read(buf)) != -1) baos.write(buf, 0, r);
                    JSONObject req = new JSONObject(baos.toString("UTF-8"));
                    readOnly = req.optBoolean("readOnly", true);

                    JSONObject res = new JSONObject();
                    res.put("success", true);
                    res.put("readOnly", readOnly);

                    byte[] respBytes = res.toString().getBytes("UTF-8");
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                    exchange.sendResponseHeaders(200, respBytes.length);
                    OutputStream os = exchange.getResponseBody();
                    os.write(respBytes);
                    os.close();
                } else {
                    sendError(exchange, 405, "Method Not Allowed");
                }
            } catch (Exception e) {
                sendError(exchange, 500, e.getMessage());
            }
        }
    }

    private class TrashHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendError(exchange, 401, "Unauthorized: Invalid or missing auth token");
                return;
            }
            if (readOnly) {
                sendError(exchange, 403, "Forbidden: Phone is in Read-Only Mode. Turn off Read-Only on the phone to allow file management.");
                return;
            }

            try {
                if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                    InputStream is = exchange.getRequestBody();
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[1024];
                    int r;
                    while ((r = is.read(buf)) != -1) baos.write(buf, 0, r);
                    JSONObject req = new JSONObject(baos.toString("UTF-8"));
                    String targetPath = req.optString("path", null);

                    if (targetPath == null || targetPath.trim().isEmpty()) {
                        sendError(exchange, 400, "Missing path");
                        return;
                    }

                    File file = new File(targetPath);
                    if (!file.exists()) {
                        sendError(exchange, 404, "File not found");
                        return;
                    }

                    // Move to Recycle Bin (.trash folder on device) - NEVER permanent delete
                    File trashDir = new File(Environment.getExternalStorageDirectory(), ".trash");
                    if (!trashDir.exists()) {
                        trashDir.mkdirs();
                    }

                    File destFile = new File(trashDir, System.currentTimeMillis() + "_" + file.getName());
                    boolean success = file.renameTo(destFile);

                    if (success) {
                        JSONObject res = new JSONObject();
                        res.put("success", true);
                        res.put("message", "File moved to Phone Recycle Bin");
                        res.put("trashPath", destFile.getAbsolutePath());

                        byte[] respBytes = res.toString().getBytes("UTF-8");
                        exchange.getResponseHeaders().set("Content-Type", "application/json");
                        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                        exchange.sendResponseHeaders(200, respBytes.length);
                        OutputStream os = exchange.getResponseBody();
                        os.write(respBytes);
                        os.close();
                    } else {
                        sendError(exchange, 500, "Failed to move file to phone trash");
                    }
                } else {
                    sendError(exchange, 405, "Method Not Allowed");
                }
            } catch (Exception e) {
                sendError(exchange, 500, e.getMessage());
            }
        }
    }

    private void sendError(HttpExchange exchange, int code, String msg) throws IOException {
        byte[] response = (msg != null ? msg : "Error").getBytes("UTF-8");
        exchange.getResponseHeaders().set("Content-Type", "text/plain");
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(code, response.length);
        OutputStream os = exchange.getResponseBody();
        os.write(response);
        os.close();
    }

    private String getMimeType(String fileName) {
        int idx = fileName.lastIndexOf('.');
        if (idx < 0) return "application/octet-stream";
        String ext = fileName.substring(idx + 1).toLowerCase();

        switch (ext) {
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "mp4": return "video/mp4";
            case "mkv": return "video/x-matroska";
            case "mov": return "video/quicktime";
            case "mp3": return "audio/mpeg";
            case "wav": return "audio/wav";
            case "m4a": return "audio/mp4";
            case "pdf": return "application/pdf";
            case "txt": return "text/plain";
            case "json": return "application/json";
            case "apk": return "application/vnd.android.package-archive";
            default: return "application/octet-stream";
        }
    }
}
