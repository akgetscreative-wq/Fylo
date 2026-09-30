package com.fylo.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.util.Log;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.media.ThumbnailUtils;
import android.provider.MediaStore;
import java.util.Map;
import java.util.HashMap;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import android.os.StrictMode;
import android.content.ActivityNotFoundException;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.media.MediaScannerConnection;
import android.webkit.MimeTypeMap;
import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import com.journeyapps.barcodescanner.CaptureActivity;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import android.net.wifi.WifiManager;
import android.os.PowerManager;

public class FyloServerModule extends ReactContextBaseJavaModule implements ActivityEventListener {
    private static final String TAG = "FyloServerModule";
    private static volatile FyloServerModule sInstance;
    private static final List<WritableMap> sPendingSharedFiles = Collections.synchronizedList(new ArrayList<>());
    private final ReactApplicationContext reactContext;
    private SafePromise mScanPromise;

    private static final int UDP_DISCOVERY_PORT = 41234;
    private DatagramSocket mDiscoverySocket;
    private Thread mDiscoveryThread;
    private volatile boolean mIsDiscovering = false;
    private WifiManager.MulticastLock mMulticastLock;

    /**
     * Safe wrapper around React Native Promise to guarantee resolve() or reject()
     * is called at most once, preventing bridge crashes.
     */
    private static class SafePromise {
        private final Promise promise;
        private final AtomicBoolean resolved = new AtomicBoolean(false);

        public SafePromise(Promise promise) {
            this.promise = promise;
        }

        public void resolve(Object value) {
            if (promise != null && resolved.compareAndSet(false, true)) {
                try {
                    promise.resolve(value);
                } catch (Throwable t) {
                    Log.w(TAG, "SafePromise resolve error: " + t.getMessage());
                }
            }
        }

        public void reject(String code, String message) {
            if (promise != null && resolved.compareAndSet(false, true)) {
                try {
                    promise.reject(code, message != null ? message : "Unknown error");
                } catch (Throwable t) {
                    Log.w(TAG, "SafePromise reject error: " + t.getMessage());
                }
            }
        }
    }

    public FyloServerModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.reactContext.addActivityEventListener(this);
        sInstance = this;
    }

    @NonNull
    @Override
    public String getName() {
        return "FyloModule";
    }

    @ReactMethod
    public void startServer(int port, boolean readOnly, String authToken, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            boolean allowFull = prefs.getBoolean("allow_full_phone_access", true);

            Intent intent = new Intent(reactContext, FyloForegroundService.class);
            intent.putExtra("port", port > 0 ? port : 8080);
            intent.putExtra("readOnly", readOnly);
            intent.putExtra("allowFullPhoneAccess", allowFull);
            if (authToken != null && !authToken.trim().isEmpty()) {
                intent.putExtra("authToken", authToken.trim());
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent);
            } else {
                reactContext.startService(intent);
            }
            safePromise.resolve(true);
        } catch (Throwable e) {
            Log.e(TAG, "startServer error: " + e.getMessage(), e);
            safePromise.reject("START_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void setAuthToken(String authToken, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            FyloHttpServer server = FyloForegroundService.getHttpServer();
            if (server != null) {
                server.setAuthToken(authToken != null ? authToken.trim() : null);
            }
            safePromise.resolve(true);
        } catch (Throwable e) {
            Log.e(TAG, "setAuthToken error: " + e.getMessage(), e);
            safePromise.reject("CONFIG_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void stopServer(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            Intent intent = new Intent(reactContext, FyloForegroundService.class);
            reactContext.stopService(intent);
            safePromise.resolve(true);
        } catch (Throwable e) {
            Log.e(TAG, "stopServer error: " + e.getMessage(), e);
            safePromise.reject("STOP_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void setReadOnly(boolean readOnly, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            FyloHttpServer server = FyloForegroundService.getHttpServer();
            if (server != null) {
                server.setReadOnly(readOnly);
            }
            safePromise.resolve(true);
        } catch (Throwable e) {
            Log.e(TAG, "setReadOnly error: " + e.getMessage(), e);
            safePromise.reject("CONFIG_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void setAllowFullPhoneAccess(boolean allow, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            prefs.edit().putBoolean("allow_full_phone_access", allow).apply();
            FyloHttpServer server = FyloForegroundService.getHttpServer();
            if (server != null) {
                server.setAllowFullPhoneAccess(allow);
            }
            safePromise.resolve(true);
        } catch (Throwable e) {
            Log.e(TAG, "setAllowFullPhoneAccess error: " + e.getMessage(), e);
            safePromise.reject("CONFIG_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void getAllowFullPhoneAccess(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            if (!prefs.contains("allow_full_phone_access")) {
                safePromise.resolve(null);
            } else {
                safePromise.resolve(prefs.getBoolean("allow_full_phone_access", true));
            }
        } catch (Throwable e) {
            Log.e(TAG, "getAllowFullPhoneAccess error: " + e.getMessage(), e);
            safePromise.reject("CONFIG_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void setSetting(String key, String value, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            if (value == null) {
                prefs.edit().remove(key).apply();
            } else {
                prefs.edit().putString(key, value).apply();
            }
            safePromise.resolve(true);
        } catch (Throwable e) {
            safePromise.reject("PREF_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getSetting(String key, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            if (!prefs.contains(key)) {
                safePromise.resolve(null);
            } else {
                safePromise.resolve(prefs.getString(key, null));
            }
        } catch (Throwable e) {
            safePromise.reject("PREF_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void removeSetting(String key, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            prefs.edit().remove(key).apply();
            safePromise.resolve(true);
        } catch (Throwable e) {
            safePromise.reject("PREF_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getClipboardText(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            reactContext.runOnUiQueueThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) reactContext.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                        CharSequence text = cm.getPrimaryClip().getItemAt(0).getText();
                        safePromise.resolve(text != null ? text.toString() : "");
                    } else {
                        safePromise.resolve("");
                    }
                } catch (Throwable e) {
                    safePromise.resolve("");
                }
            });
        } catch (Throwable e) {
            safePromise.resolve("");
        }
    }

    @ReactMethod
    public void setClipboardText(String text, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            reactContext.runOnUiQueueThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) reactContext.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        ClipData clip = ClipData.newPlainText("fylo", text != null ? text : "");
                        cm.setPrimaryClip(clip);
                    }
                    safePromise.resolve(true);
                } catch (Throwable e) {
                    safePromise.reject("CLIP_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        } catch (Throwable e) {
            safePromise.reject("CLIP_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void savePairedDevice(String hostPort, String hostName, String authToken, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            editor.putString("paired_pc", hostPort != null ? hostPort.trim() : "");
            editor.putString("pc_hostname", hostName != null ? hostName.trim() : "");
            editor.putString("pc_token", authToken != null ? authToken.trim() : "");
            editor.apply();
            safePromise.resolve(true);
        } catch (Throwable e) {
            Log.e(TAG, "savePairedDevice error: " + e.getMessage(), e);
            safePromise.reject("PREF_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void setDeviceId(String id, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            prefs.edit().putString("device_id", id != null ? id.trim() : "").apply();
            safePromise.resolve(true);
        } catch (Throwable e) {
            safePromise.reject("PREF_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getSavedPairedDevice(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            WritableMap map = Arguments.createMap();
            map.putString("paired_pc", prefs.getString("paired_pc", ""));
            map.putString("pc_hostname", prefs.getString("pc_hostname", ""));
            map.putString("pc_token", prefs.getString("pc_token", ""));
            safePromise.resolve(map);
        } catch (Throwable e) {
            Log.e(TAG, "getSavedPairedDevice error: " + e.getMessage(), e);
            safePromise.reject("PREF_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void clearSavedPairedDevice(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
            prefs.edit().clear().apply();
            safePromise.resolve(true);
        } catch (Throwable e) {
            Log.e(TAG, "clearSavedPairedDevice error: " + e.getMessage(), e);
            safePromise.reject("PREF_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void getServerInfo(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            WritableMap map = Arguments.createMap();
            FyloHttpServer server = FyloForegroundService.getHttpServer();
            map.putBoolean("running", server != null);
            map.putString("ip", getDeviceIpAddress());
            map.putInt("port", 8080);
            map.putBoolean("hasStoragePermission", checkStoragePermission());

            // Friendly device name and model
            String brand = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
            String model = Build.MODEL != null ? Build.MODEL : "Android";
            String deviceName = (!brand.isEmpty() && !model.toLowerCase().contains(brand.toLowerCase()))
                ? (brand.substring(0, 1).toUpperCase() + brand.substring(1) + " " + model)
                : model;
            map.putString("deviceName", deviceName);
            map.putString("model", model);

            // Battery percentage query
            int batteryPct = -1;
            try {
                IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                Intent batteryStatus = reactContext.registerReceiver(null, ifilter);
                if (batteryStatus != null) {
                    int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                    if (level >= 0 && scale > 0) {
                        batteryPct = Math.round((level / (float) scale) * 100);
                    }
                }
            } catch (Throwable ignored) {}
            map.putInt("battery", batteryPct);

            long totalGB = 0;
            long freeGB = 0;
            long totalBytes = 0;
            long freeBytes = 0;
            try {
                File path = Environment.getExternalStorageDirectory();
                if (path != null && path.exists()) {
                    StatFs stat = new StatFs(path.getPath());
                    long blockSize = stat.getBlockSizeLong();
                    totalBytes = stat.getBlockCountLong() * blockSize;
                    freeBytes = stat.getAvailableBlocksLong() * blockSize;
                    totalGB = totalBytes / (1024 * 1024 * 1024);
                    freeGB = freeBytes / (1024 * 1024 * 1024);
                }
            } catch (Throwable ignored) {}

            WritableMap storageMap = Arguments.createMap();
            storageMap.putString("totalGB", totalGB > 0 ? (totalGB + " GB") : "--");
            storageMap.putString("freeGB", freeGB > 0 ? (freeGB + " GB") : "--");
            storageMap.putDouble("totalBytes", (double) totalBytes);
            storageMap.putDouble("freeBytes", (double) freeBytes);
            map.putMap("storage", storageMap);

            safePromise.resolve(map);
        } catch (Throwable e) {
            Log.e(TAG, "getServerInfo error: " + e.getMessage(), e);
            safePromise.reject("INFO_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void listDirectory(String targetPath, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            if (targetPath == null || targetPath.trim().isEmpty() ||
                "undefined".equalsIgnoreCase(targetPath.trim()) || "null".equalsIgnoreCase(targetPath.trim())) {
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
                safePromise.reject("NOT_FOUND", "Folder not found or is not a directory");
                return;
            }

            File[] files = null;
            try {
                files = folder.listFiles();
            } catch (SecurityException se) {
                safePromise.reject("PERMISSION_DENIED", "Access to folder denied by security policy");
                return;
            }

            WritableArray items = Arguments.createArray();
            if (files != null) {
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

                    WritableMap item = Arguments.createMap();
                    item.putString("name", fName);
                    item.putString("path", f.getAbsolutePath());

                    boolean isDir = false;
                    try { isDir = f.isDirectory(); } catch (Exception ignored) {}
                    item.putBoolean("isDir", isDir);
                    item.putDouble("size", isDir ? 0 : (double) f.length());
                    item.putDouble("modified", (double) f.lastModified());

                    String ext = "";
                    int dotIdx = fName.lastIndexOf('.');
                    if (dotIdx > 0 && dotIdx < fName.length() - 1) {
                        ext = fName.substring(dotIdx + 1).toLowerCase();
                    }
                    item.putString("ext", ext);
                    items.pushMap(item);
                }
            }

            WritableMap result = Arguments.createMap();
            result.putString("path", folder.getAbsolutePath());
            File parent = folder.getParentFile();
            result.putString("parent", parent != null ? parent.getAbsolutePath() : "");
            result.putArray("items", items);

            safePromise.resolve(result);
        } catch (Throwable e) {
            Log.e(TAG, "listDirectory error: " + e.getMessage(), e);
            safePromise.reject("LIST_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void trashFile(String filePath, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            if (filePath == null || filePath.trim().isEmpty() ||
                "undefined".equalsIgnoreCase(filePath.trim()) || "null".equalsIgnoreCase(filePath.trim())) {
                safePromise.reject("INVALID_PATH", "Path cannot be empty");
                return;
            }

            File file = new File(filePath);
            if (!file.exists()) {
                safePromise.reject("NOT_FOUND", "File not found: " + filePath);
                return;
            }

            File extStorage = Environment.getExternalStorageDirectory();
            File parentDir = file.getParentFile();
            File baseDir = extStorage != null ? extStorage : (parentDir != null ? parentDir : reactContext.getFilesDir());
            File trashDir = new File(baseDir, ".trash");
            if (!trashDir.exists()) {
                trashDir.mkdirs();
            }

            File destination = new File(trashDir, System.currentTimeMillis() + "_" + file.getName());
            boolean success = file.renameTo(destination);
            if (!success) {
                // Cross-volume or permissions fallback: copy and delete
                try (FileInputStream in = new FileInputStream(file);
                     FileOutputStream out = new FileOutputStream(destination)) {
                    byte[] buf = new byte[65536];
                    int len;
                    while ((len = in.read(buf)) > 0) {
                        out.write(buf, 0, len);
                    }
                    success = file.delete();
                } catch (Throwable t) {
                    Log.w(TAG, "Fallback trash copy error: " + t.getMessage());
                }
            }

            if (success) {
                safePromise.resolve(destination.getAbsolutePath());
            } else {
                safePromise.reject("TRASH_FAILED", "Could not move file to .trash directory");
            }
        } catch (Throwable e) {
            Log.e(TAG, "trashFile error: " + e.getMessage(), e);
            safePromise.reject("TRASH_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void requestStoragePermission() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                    intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    reactContext.startActivity(intent);
                } catch (Throwable e) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    reactContext.startActivity(intent);
                }
            } else {
                Activity currentActivity = getCurrentActivity();
                if (currentActivity != null) {
                    ActivityCompat.requestPermissions(
                        currentActivity,
                        new String[]{
                            android.Manifest.permission.READ_EXTERNAL_STORAGE,
                            android.Manifest.permission.WRITE_EXTERNAL_STORAGE
                        },
                        1001
                    );
                } else {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    reactContext.startActivity(intent);
                }
            }
        } catch (Throwable e) {
            Log.e(TAG, "requestStoragePermission error: " + e.getMessage(), e);
        }
    }

    private boolean checkStoragePermission() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                return Environment.isExternalStorageManager();
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                int readPerm = ContextCompat.checkSelfPermission(
                    reactContext, android.Manifest.permission.READ_EXTERNAL_STORAGE
                );
                return readPerm == PackageManager.PERMISSION_GRANTED;
            } else {
                return true;
            }
        } catch (Throwable e) {
            Log.w(TAG, "checkStoragePermission error: " + e.getMessage());
            return false;
        }
    }

    @ReactMethod
    public void scanQrCode(Promise promise) {
        Activity currentActivity = getCurrentActivity();
        if (currentActivity == null) {
            SafePromise safePromise = new SafePromise(promise);
            safePromise.reject("NO_ACTIVITY", "Current Android activity is unavailable.");
            return;
        }

        if (this.mScanPromise != null) {
            this.mScanPromise.resolve("");
            this.mScanPromise = null;
        }
        this.mScanPromise = new SafePromise(promise);

        try {
            IntentIntegrator integrator = new IntentIntegrator(currentActivity);
            integrator.setPrompt("Scan Fylo QR Code on your PC screen");
            integrator.setBeepEnabled(true);
            integrator.setOrientationLocked(true);
            integrator.setDesiredBarcodeFormats(IntentIntegrator.QR_CODE);
            integrator.setCaptureActivity(CaptureActivity.class);
            integrator.initiateScan();
        } catch (Throwable t) {
            Log.e(TAG, "scanQrCode error: " + t.getMessage(), t);
            if (this.mScanPromise != null) {
                this.mScanPromise.reject("SCAN_ERROR", t.getMessage() != null ? t.getMessage() : t.toString());
                this.mScanPromise = null;
            }
        }
    }

    @ReactMethod
    public void openAppSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
        } catch (Throwable e) {
            Log.e(TAG, "openAppSettings error: " + e.getMessage(), e);
        }
    }

    private static final int REQUEST_CODE_FILE_PICKER = 8842;
    private SafePromise mPickerPromise;

    @ReactMethod
    public void openNativeFilePicker(boolean allowMultiple, Promise promise) {
        Activity currentActivity = getCurrentActivity();
        if (currentActivity == null) {
            SafePromise safePromise = new SafePromise(promise);
            safePromise.reject("NO_ACTIVITY", "Current activity is unavailable");
            return;
        }

        if (this.mPickerPromise != null) {
            this.mPickerPromise.resolve(Arguments.createArray());
            this.mPickerPromise = null;
        }
        this.mPickerPromise = new SafePromise(promise);

        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            if (allowMultiple) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            currentActivity.startActivityForResult(intent, REQUEST_CODE_FILE_PICKER);
        } catch (Throwable t) {
            try {
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                if (allowMultiple) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                currentActivity.startActivityForResult(intent, REQUEST_CODE_FILE_PICKER);
            } catch (Throwable t2) {
                Log.e(TAG, "openNativeFilePicker error: " + t2.getMessage(), t2);
                if (this.mPickerPromise != null) {
                    this.mPickerPromise.reject("PICKER_ERROR", t2.getMessage());
                    this.mPickerPromise = null;
                }
            }
        }
    }

    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_CODE_FILE_PICKER) {
            if (mPickerPromise != null) {
                if (resultCode == Activity.RESULT_OK && data != null) {
                    final Intent finalData = data;
                    new Thread(() -> {
                        WritableArray result = Arguments.createArray();
                        try {
                            List<Uri> uris = new ArrayList<>();
                            if (finalData.getClipData() != null) {
                                ClipData clipData = finalData.getClipData();
                                for (int i = 0; i < clipData.getItemCount(); i++) {
                                    Uri uri = clipData.getItemAt(i).getUri();
                                    if (uri != null) uris.add(uri);
                                }
                            } else if (finalData.getData() != null) {
                                uris.add(finalData.getData());
                            }

                            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                            File sharedDir = new File(downloadsDir, "FyloShared");
                            if (!sharedDir.exists()) sharedDir.mkdirs();
                            if (!sharedDir.canWrite()) {
                                File externalFiles = reactContext.getExternalFilesDir(null);
                                sharedDir = new File(externalFiles != null ? externalFiles : reactContext.getFilesDir(), "FyloShared");
                                sharedDir.mkdirs();
                            }

                            for (Uri uri : uris) {
                                WritableMap map = copySingleUri(uri, reactContext, sharedDir);
                                if (map != null) {
                                    result.pushMap(map);
                                }
                            }
                        } catch (Throwable e) {
                            Log.e(TAG, "Native file picker processing error: " + e.getMessage(), e);
                        }
                        if (mPickerPromise != null) {
                            mPickerPromise.resolve(result);
                            mPickerPromise = null;
                        }
                    }).start();
                } else {
                    mPickerPromise.resolve(Arguments.createArray());
                    mPickerPromise = null;
                }
            }
            return;
        }

        try {
            IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
            if (result != null) {
                if (mScanPromise != null) {
                    String contents = result.getContents();
                    if (contents != null && !contents.trim().isEmpty()) {
                        mScanPromise.resolve(contents.trim());
                    } else {
                        // User cancelled scan (e.g. pressed back button)
                        mScanPromise.resolve("");
                    }
                    mScanPromise = null;
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "onActivityResult QR parse error: " + t.getMessage(), t);
            if (mScanPromise != null) {
                mScanPromise.resolve("");
                mScanPromise = null;
            }
        }
    }

    @ReactMethod
    public void getPendingSharedFiles(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            WritableArray array = Arguments.createArray();
            synchronized (sPendingSharedFiles) {
                for (WritableMap item : sPendingSharedFiles) {
                    WritableMap copy = Arguments.createMap();
                    copy.merge(item);
                    array.pushMap(copy);
                }
                sPendingSharedFiles.clear();
            }
            safePromise.resolve(array);
        } catch (Throwable e) {
            safePromise.reject("GET_SHARED_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void clearPendingSharedFiles(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            sPendingSharedFiles.clear();
            safePromise.resolve(true);
        } catch (Throwable e) {
            safePromise.reject("CLEAR_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        processShareIntent(intent, reactContext);
    }

    @Override
    public void invalidate() {
        super.invalidate();
        if (sInstance == this) {
            sInstance = null;
        }
        try {
            reactContext.removeActivityEventListener(this);
        } catch (Throwable ignored) {}
    }

    @ReactMethod
    public void openVideoPlayer(String urlOrPath, String mimeType, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            if (urlOrPath == null || urlOrPath.trim().isEmpty()) {
                safePromise.reject("INVALID_URL", "Video URL or path is empty");
                return;
            }

            Intent intent = new Intent(reactContext, FyloPlayerActivity.class);
            intent.putExtra("url", urlOrPath.trim());
            intent.putExtra("mimeType", mimeType);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Activity currentActivity = getCurrentActivity();
            if (currentActivity != null) {
                currentActivity.startActivity(intent);
            } else {
                reactContext.startActivity(intent);
            }
            safePromise.resolve(true);
        } catch (Throwable e) {
            Log.e(TAG, "openVideoPlayer error: " + e.getMessage(), e);
            safePromise.reject("PLAYER_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    public static String resolveMimeType(String pathOrName, String fallbackMime) {
        if (fallbackMime != null && !fallbackMime.trim().isEmpty() && !"*/*".equals(fallbackMime.trim())) {
            return fallbackMime.trim();
        }
        if (pathOrName == null) return "*/*";
        String clean = pathOrName;

        // If it's a URL with path= query param, extract the real target path
        if (clean.contains("path=")) {
            try {
                int pIdx = clean.indexOf("path=");
                String sub = clean.substring(pIdx + 5);
                int amp = sub.indexOf('&');
                if (amp >= 0) sub = sub.substring(0, amp);
                clean = java.net.URLDecoder.decode(sub, "UTF-8");
            } catch (Throwable ignored) {}
        } else {
            int q = clean.indexOf('?');
            if (q >= 0) clean = clean.substring(0, q);
        }

        int dot = clean.lastIndexOf('.');
        if (dot >= 0 && dot < clean.length() - 1) {
            String ext = clean.substring(dot + 1).toLowerCase();
            try {
                String mimeFromMap = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                if (mimeFromMap != null && !mimeFromMap.trim().isEmpty()) {
                    return mimeFromMap.trim();
                }
            } catch (Throwable ignored) {}

            switch (ext) {
                case "pdf": return "application/pdf";
                case "doc": return "application/msword";
                case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                case "xls": return "application/vnd.ms-excel";
                case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                case "ppt": return "application/vnd.ms-powerpoint";
                case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
                case "txt": return "text/plain";
                case "csv": return "text/csv";
                case "json": return "application/json";
                case "xml": return "application/xml";
                case "html":
                case "htm": return "text/html";
                case "mp3": return "audio/mpeg";
                case "wav": return "audio/wav";
                case "ogg": return "audio/ogg";
                case "m4a": return "audio/mp4";
                case "flac": return "audio/flac";
                case "aac": return "audio/aac";
                case "opus": return "audio/opus";
                case "wma": return "audio/x-ms-wma";
                case "mp4": return "video/mp4";
                case "mkv": return "video/x-matroska";
                case "webm": return "video/webm";
                case "avi": return "video/avi";
                case "mov": return "video/quicktime";
                case "3gp": return "video/3gpp";
                case "ts": return "video/mp2t";
                case "wmv": return "video/x-ms-wmv";
                case "flv": return "video/x-flv";
                case "m4v": return "video/mp4";
                case "zip": return "application/zip";
                case "rar": return "application/x-rar-compressed";
                case "7z": return "application/x-7z-compressed";
                case "tar": return "application/x-tar";
                case "gz": return "application/gzip";
                case "apk": return "application/vnd.android.package-archive";
                case "epub": return "application/epub+zip";
            }
        }
        return "*/*";
    }

    @ReactMethod
    public void openFileWithChooser(String filePath, String mimeType, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            if (filePath == null || filePath.trim().isEmpty()) {
                safePromise.reject("INVALID_PATH", "File path is empty");
                return;
            }

            File file = new File(filePath.trim());
            if (!file.exists()) {
                safePromise.reject("FILE_NOT_FOUND", "File does not exist: " + filePath);
                return;
            }

            String finalMimeType = resolveMimeType(file.getName(), mimeType);
            Context ctx = getCurrentActivity() != null ? getCurrentActivity() : reactContext;

            Uri uri = null;
            String[] authorities = new String[] {
                "com.fylo.mobile.fileprovider",
                ctx.getPackageName() + ".fileprovider",
                ctx.getPackageName() + ".provider",
                "com.fylo.mobile.provider"
            };

            for (String auth : authorities) {
                try {
                    uri = FileProvider.getUriForFile(ctx, auth, file);
                    if (uri != null) break;
                } catch (Throwable ignored) {}
            }

            if (uri == null) {
                try {
                    StrictMode.VmPolicy.Builder builder = new StrictMode.VmPolicy.Builder();
                    StrictMode.setVmPolicy(builder.build());
                    uri = Uri.fromFile(file);
                } catch (Throwable t) {
                    safePromise.reject("URI_ERROR", "Could not create content URI for file: " + t.getMessage());
                    return;
                }
            }

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, finalMimeType);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Intent chooser = Intent.createChooser(intent, "Open with...");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Activity currentActivity = getCurrentActivity();
            if (currentActivity != null) {
                currentActivity.startActivity(chooser);
            } else {
                reactContext.startActivity(chooser);
            }
            safePromise.resolve(true);
        } catch (ActivityNotFoundException anf) {
            Log.w(TAG, "No app found to open file: " + anf.getMessage());
            safePromise.reject("NO_APP", "No application found on your phone to open this file format");
        } catch (Throwable e) {
            Log.e(TAG, "openFileWithChooser error: " + e.getMessage(), e);
            safePromise.reject("OPEN_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void openUrlWithChooser(String urlString, String mimeType, String title, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            if (urlString == null || urlString.trim().isEmpty()) {
                safePromise.reject("INVALID_URL", "URL is empty");
                return;
            }

            String trimmedUrl = urlString.trim();
            Uri uri = Uri.parse(trimmedUrl);
            String finalMimeType = resolveMimeType(trimmedUrl, mimeType);

            // If it's video or audio, ensure we have video/* or audio/* so all installed players (VLC, MX Player, etc.) match
            if (finalMimeType != null && finalMimeType.startsWith("video/")) {
                finalMimeType = "video/*";
            } else if (finalMimeType != null && finalMimeType.startsWith("audio/")) {
                finalMimeType = "audio/*";
            }

            Intent intent = new Intent(Intent.ACTION_VIEW);
            if (finalMimeType != null && !finalMimeType.trim().isEmpty() && !"*/*".equals(finalMimeType.trim())) {
                intent.setDataAndType(uri, finalMimeType.trim());
            } else {
                intent.setData(uri);
            }
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            String chooserTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "Stream / Open with...";
            Intent chooser = Intent.createChooser(intent, chooserTitle);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Activity currentActivity = getCurrentActivity();
            if (currentActivity != null) {
                currentActivity.startActivity(chooser);
            } else {
                reactContext.startActivity(chooser);
            }
            safePromise.resolve(true);
        } catch (ActivityNotFoundException anf) {
            Log.w(TAG, "No app found to open URL: " + anf.getMessage());
            safePromise.reject("NO_APP", "No application found on your phone to open this file/link");
        } catch (Throwable e) {
            Log.e(TAG, "openUrlWithChooser error: " + e.getMessage(), e);
            safePromise.reject("OPEN_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void startDiscovery(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        try {
            if (mIsDiscovering) {
                safePromise.resolve(true);
                return;
            }
            mIsDiscovering = true;

            try {
                WifiManager wm = (WifiManager) reactContext.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    mMulticastLock = wm.createMulticastLock("FyloDiscoveryLock");
                    mMulticastLock.setReferenceCounted(true);
                    mMulticastLock.acquire();
                }
            } catch (Throwable ignored) {}

            mDiscoveryThread = new Thread(() -> {
                try {
                    mDiscoverySocket = new DatagramSocket(null);
                    mDiscoverySocket.setReuseAddress(true);
                    mDiscoverySocket.setBroadcast(true);
                    mDiscoverySocket.bind(new InetSocketAddress(UDP_DISCOVERY_PORT));
                    mDiscoverySocket.setSoTimeout(3000);

                    // Send initial ping broadcast
                    sendDiscoveryPing();

                    byte[] buffer = new byte[2048];
                    while (mIsDiscovering && !Thread.currentThread().isInterrupted()) {
                        try {
                            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                            mDiscoverySocket.receive(packet);
                            String data = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                            if (data.contains("FYLO_PC_BEACON")) {
                                org.json.JSONObject obj = new org.json.JSONObject(data);
                                WritableMap map = Arguments.createMap();
                                map.putString("name", obj.optString("name", "Windows PC"));
                                String ip = obj.optString("ip", packet.getAddress().getHostAddress());
                                if (ip == null || ip.isEmpty() || ip.equals("127.0.0.1")) {
                                    ip = packet.getAddress().getHostAddress();
                                }
                                map.putString("ip", ip);
                                map.putInt("port", obj.optInt("port", 3000));
                                map.putString("token", obj.optString("token", ""));
                                map.putString("version", obj.optString("version", "4.0.0"));

                                if (reactContext != null) {
                                    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                        .emit("onDeviceDiscovered", map);
                                }
                            }
                        } catch (java.net.SocketTimeoutException ste) {
                            if (mIsDiscovering) {
                                sendDiscoveryPing();
                            }
                        } catch (Throwable e) {
                            if (!mIsDiscovering) break;
                        }
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "Discovery socket error: " + t.getMessage());
                } finally {
                    closeDiscoverySocket();
                }
            });
            mDiscoveryThread.start();
            safePromise.resolve(true);
        } catch (Throwable t) {
            safePromise.reject("DISCOVERY_ERROR", t.getMessage());
        }
    }

    private void sendDiscoveryPing() {
        try {
            if (mDiscoverySocket != null && !mDiscoverySocket.isClosed()) {
                String ping = "{\"type\":\"FYLO_DISCOVERY_PING\"}";
                byte[] pingBytes = ping.getBytes(StandardCharsets.UTF_8);
                DatagramPacket pingPacket = new DatagramPacket(
                    pingBytes,
                    pingBytes.length,
                    InetAddress.getByName("255.255.255.255"),
                    UDP_DISCOVERY_PORT
                );
                mDiscoverySocket.send(pingPacket);
            }
        } catch (Throwable ignored) {}
    }

    @ReactMethod
    public void stopDiscovery(Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        mIsDiscovering = false;
        closeDiscoverySocket();
        safePromise.resolve(true);
    }

    private void closeDiscoverySocket() {
        try {
            if (mDiscoverySocket != null && !mDiscoverySocket.isClosed()) {
                mDiscoverySocket.close();
            }
        } catch (Throwable ignored) {}
        try {
            if (mMulticastLock != null && mMulticastLock.isHeld()) {
                mMulticastLock.release();
            }
        } catch (Throwable ignored) {}
    }

    @ReactMethod
    public void downloadFileFromUrl(String fileUrl, String fileName, Promise promise) {
        SafePromise safePromise = new SafePromise(promise);
        new Thread(() -> {
            PowerManager.WakeLock wakeLock = null;
            WifiManager.WifiLock wifiLock = null;
            try {
                // Keep CPU and Wi-Fi active in background / screen locked mode
                PowerManager pm = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Fylo:TransferWakeLock");
                    wakeLock.acquire(15 * 60 * 1000L); // 15 min safety timeout
                }
                WifiManager wm = (WifiManager) reactContext.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Fylo:TransferWifiLock");
                    wifiLock.acquire();
                }

                if (fileUrl == null || fileUrl.trim().isEmpty()) {
                    safePromise.reject("INVALID_URL", "File URL is empty");
                    return;
                }
                String cleanName = (fileName != null && !fileName.trim().isEmpty()) ? fileName.trim() : "downloaded_file";
                cleanName = cleanName.replaceAll("[\\\\/:*?\"<>|]", "_");

                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File fyloDir = new File(downloadsDir, "Fylo");
                if (!fyloDir.exists()) fyloDir.mkdirs();
                if (!fyloDir.canWrite()) {
                    File ext = reactContext.getExternalFilesDir(null);
                    fyloDir = new File(ext != null ? ext : reactContext.getFilesDir(), "Fylo");
                    fyloDir.mkdirs();
                }

                File destFile = new File(fyloDir, cleanName);
                File partFile = new File(fyloDir, cleanName + ".part");

                if (destFile.exists() && destFile.length() > 0) {
                    safePromise.resolve(destFile.getAbsolutePath());
                    return;
                }

                long existingBytes = partFile.exists() ? partFile.length() : 0;

                java.net.URL url = new java.net.URL(fileUrl);
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(60000);

                if (existingBytes > 0) {
                    conn.setRequestProperty("Range", "bytes=" + existingBytes + "-");
                }

                conn.connect();
                int responseCode = conn.getResponseCode();

                boolean isPartial = (responseCode == 206);
                boolean append = isPartial && existingBytes > 0;

                if (responseCode != 200 && responseCode != 206) {
                    if (responseCode == 416) {
                        // Range not satisfiable, file might have changed or finished
                        partFile.delete();
                        existingBytes = 0;
                        conn.disconnect();
                        conn = (java.net.HttpURLConnection) url.openConnection();
                        conn.setConnectTimeout(10000);
                        conn.setReadTimeout(60000);
                        conn.connect();
                        responseCode = conn.getResponseCode();
                    } else {
                        safePromise.reject("HTTP_ERR", "Server responded with HTTP " + responseCode);
                        return;
                    }
                }

                long contentLength = conn.getContentLengthLong();
                long totalExpected = isPartial ? (existingBytes + (contentLength > 0 ? contentLength : 0)) : (contentLength > 0 ? contentLength : 0);

                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(partFile, append)) {
                    byte[] buf = new byte[65536];
                    int len;
                    long bytesTransferred = append ? existingBytes : 0;
                    long lastEmitTime = 0;

                    while ((len = in.read(buf)) > 0) {
                        out.write(buf, 0, len);
                        bytesTransferred += len;

                        long now = System.currentTimeMillis();
                        if (now - lastEmitTime > 300) {
                            lastEmitTime = now;
                            WritableMap progressMap = Arguments.createMap();
                            progressMap.putString("fileName", cleanName);
                            progressMap.putDouble("transferred", (double) bytesTransferred);
                            progressMap.putDouble("total", (double) totalExpected);
                            int pct = totalExpected > 0 ? (int) ((bytesTransferred * 100) / totalExpected) : 0;
                            progressMap.putInt("percent", Math.min(100, Math.max(0, pct)));
                            if (reactContext != null) {
                                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                    .emit("onTransferProgress", progressMap);
                            }
                        }
                    }
                    out.flush();
                }

                // If folder archive (streamed zip from folder download), extract folder maintaining structure
                if (cleanName.toLowerCase().endsWith(".zip") && (cleanName.startsWith("folder_") || fileUrl.contains("/api/download/"))) {
                    String folderBase = cleanName.substring(0, cleanName.length() - 4).replaceFirst("^folder_", "");
                    File folderDest = new File(fyloDir, folderBase);
                    folderDest.mkdirs();
                    unzipArchive(partFile, folderDest);
                    partFile.delete();
                    destFile = folderDest;
                } else {
                    if (destFile.exists()) destFile.delete();
                    partFile.renameTo(destFile);
                }

                try {
                    MediaScannerConnection.scanFile(
                        reactContext,
                        new String[]{ destFile.getAbsolutePath() },
                        null,
                        null
                    );
                } catch (Throwable ignored) {}

                safePromise.resolve(destFile.getAbsolutePath());
            } catch (Throwable t) {
                Log.e(TAG, "downloadFileFromUrl error: " + t.getMessage(), t);
                safePromise.reject("DL_ERROR", t.getMessage() != null ? t.getMessage() : t.toString());
            } finally {
                if (wakeLock != null && wakeLock.isHeld()) {
                    try { wakeLock.release(); } catch (Throwable ignored) {}
                }
                if (wifiLock != null && wifiLock.isHeld()) {
                    try { wifiLock.release(); } catch (Throwable ignored) {}
                }
            }
        }).start();
    }

    private void unzipArchive(File zipFile, File targetDir) {
        try (ZipInputStream zis = new ZipInputStream(new FileInputStream(zipFile))) {
            ZipEntry entry;
            byte[] buffer = new byte[65536];
            while ((entry = zis.getNextEntry()) != null) {
                File file = new File(targetDir, entry.getName());
                // Protect against Zip Slip directory traversal
                if (!file.getCanonicalPath().startsWith(targetDir.getCanonicalPath())) {
                    continue;
                }
                if (entry.isDirectory()) {
                    file.mkdirs();
                } else {
                    file.getParentFile().mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(file)) {
                        int count;
                        while ((count = zis.read(buffer)) > 0) {
                            fos.write(buffer, 0, count);
                        }
                    }
                }
                zis.closeEntry();
            }
        } catch (Throwable e) {
            Log.e(TAG, "unzipArchive error: " + e.getMessage(), e);
        }
    }

    public static WritableMap copySingleUri(Uri uri, Context context, File sharedDir) {
        if (uri == null || context == null || sharedDir == null) return null;
        try {
            String displayName = null;
            long fileSize = 0;

            try (Cursor cursor = context.getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                    if (nameIndex >= 0) displayName = cursor.getString(nameIndex);
                    if (sizeIndex >= 0) fileSize = cursor.getLong(sizeIndex);
                }
            } catch (Throwable ignored) {}

            if (displayName == null || displayName.trim().isEmpty()) {
                displayName = uri.getLastPathSegment();
            }
            if (displayName == null || displayName.trim().isEmpty()) {
                displayName = "shared_file_" + System.currentTimeMillis();
            }
            // Sanitize file name
            displayName = displayName.replaceAll("[\\\\/:*?\"<>|]", "_");

            File targetFile = new File(sharedDir, displayName);
            // Avoid overwriting existing files with same name
            if (targetFile.exists()) {
                String nameWithoutExt = displayName;
                String ext = "";
                int dot = displayName.lastIndexOf('.');
                if (dot > 0) {
                    nameWithoutExt = displayName.substring(0, dot);
                    ext = displayName.substring(dot);
                }
                targetFile = new File(sharedDir, nameWithoutExt + "_" + System.currentTimeMillis() + ext);
            }

            try (InputStream in = context.getContentResolver().openInputStream(uri);
                 FileOutputStream out = new FileOutputStream(targetFile)) {
                if (in != null) {
                    byte[] buf = new byte[65536];
                    int len;
                    while ((len = in.read(buf)) > 0) {
                        out.write(buf, 0, len);
                    }
                    out.flush();
                }
            }

            if (fileSize <= 0) {
                fileSize = targetFile.length();
            }

            String mimeType = context.getContentResolver().getType(uri);
            if (mimeType == null) {
                mimeType = "application/octet-stream";
            }

            WritableMap map = Arguments.createMap();
            map.putString("name", targetFile.getName());
            map.putString("path", targetFile.getAbsolutePath());
            map.putDouble("size", (double) fileSize);
            map.putString("mimeType", mimeType);
            map.putString("uri", uri.toString());
            return map;
        } catch (Throwable t) {
            Log.e(TAG, "copySingleUri error: " + uri, t);
            return null;
        }
    }

    /**
     * Process incoming Android SEND and SEND_MULTIPLE share intents from any app
     */
    public static void processShareIntent(Intent intent, Context context) {
        if (intent == null || context == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }

        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri streamUri = null;
            try {
                streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            } catch (Throwable ignored) {}
            if (streamUri != null) {
                uris.add(streamUri);
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            try {
                ArrayList<Uri> streamUris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (streamUris != null) {
                    uris.addAll(streamUris);
                }
            } catch (Throwable ignored) {}
        }

        ClipData clipData = intent.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                ClipData.Item item = clipData.getItemAt(i);
                if (item != null && item.getUri() != null && !uris.contains(item.getUri())) {
                    uris.add(item.getUri());
                }
            }
        }

        // Shared text fallback (e.g. sharing URL or note)
        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);

        // Process files in a background worker thread to prevent UI freezing
        new Thread(() -> {
            try {
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File sharedDir = new File(downloadsDir, "FyloShared");
                if (!sharedDir.exists()) {
                    sharedDir.mkdirs();
                }
                if (!sharedDir.canWrite()) {
                    File externalFiles = context.getExternalFilesDir(null);
                    sharedDir = new File(externalFiles != null ? externalFiles : context.getFilesDir(), "FyloShared");
                    sharedDir.mkdirs();
                }

                List<WritableMap> processedFiles = new ArrayList<>();

                for (Uri uri : uris) {
                    if (uri == null) continue;
                    WritableMap map = copySingleUri(uri, context, sharedDir);
                    if (map != null) {
                        processedFiles.add(map);
                    }
                }

                // If no file URIs but shared text was provided, create a text file or text item
                if (processedFiles.isEmpty() && sharedText != null && !sharedText.trim().isEmpty()) {
                    try {
                        String txtName = "shared_text_" + System.currentTimeMillis() + ".txt";
                        File txtFile = new File(sharedDir, txtName);
                        try (FileOutputStream fos = new FileOutputStream(txtFile)) {
                            fos.write(sharedText.getBytes(StandardCharsets.UTF_8));
                        }
                        WritableMap map = Arguments.createMap();
                        map.putString("name", txtName);
                        map.putString("path", txtFile.getAbsolutePath());
                        map.putDouble("size", (double) txtFile.length());
                        map.putString("mimeType", "text/plain");
                        map.putString("text", sharedText);
                        processedFiles.add(map);
                    } catch (Throwable t) {
                        Log.e(TAG, "Error saving shared text", t);
                    }
                }

                if (!processedFiles.isEmpty()) {
                    sPendingSharedFiles.addAll(processedFiles);

                    // Emit event to React Native JS if instance is active
                    if (sInstance != null && sInstance.reactContext != null) {
                        WritableArray eventArray = Arguments.createArray();
                        for (WritableMap item : processedFiles) {
                            WritableMap copy = Arguments.createMap();
                            copy.merge(item);
                            eventArray.pushMap(copy);
                        }
                        try {
                            sInstance.reactContext
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("onFilesShared", eventArray);
                        } catch (Throwable t) {
                            Log.w(TAG, "Error emitting onFilesShared: " + t.getMessage());
                        }
                        try {
                            WritableArray eventArray2 = Arguments.createArray();
                            for (WritableMap item : processedFiles) {
                                WritableMap copy = Arguments.createMap();
                                copy.merge(item);
                                eventArray2.pushMap(copy);
                            }
                            sInstance.reactContext
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("onDirectShare", eventArray2);
                        } catch (Throwable ignored) {}
                    }
                }
            } catch (Throwable t) {
                Log.e(TAG, "processShareIntent error", t);
            }
        }).start();
    }

    private String getDeviceIpAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                if (intf == null || !intf.isUp() || intf.isLoopback()) continue;
                List<InetAddress> addrs = Collections.list(intf.getInetAddresses());
                for (InetAddress addr : addrs) {
                    if (addr != null && !addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                        String ip = addr.getHostAddress();
                        if (ip != null && !ip.startsWith("127.")) {
                            return ip;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}
        return "127.0.0.1";
    }

    @ReactMethod
    public void getVideoThumbnail(String uriOrPath, String authToken, Promise promise) {
        if (uriOrPath == null || uriOrPath.trim().isEmpty()) {
            promise.resolve(null);
            return;
        }

        new Thread(() -> {
            try {
                Context context = getReactApplicationContext();
                File cacheDir = new File(context.getCacheDir(), "thumbs");
                if (!cacheDir.exists()) cacheDir.mkdirs();

                String cleanKey = "vt_" + Math.abs(uriOrPath.hashCode()) + ".jpg";
                File cacheFile = new File(cacheDir, cleanKey);
                if (cacheFile.exists() && cacheFile.length() > 0) {
                    promise.resolve("file://" + cacheFile.getAbsolutePath());
                    return;
                }

                Bitmap bitmap = null;
                if (uriOrPath.startsWith("http://") || uriOrPath.startsWith("https://")) {
                    MediaMetadataRetriever mmr = null;
                    try {
                        mmr = new MediaMetadataRetriever();
                        Map<String, String> headers = new HashMap<>();
                        if (authToken != null && !authToken.trim().isEmpty()) {
                            headers.put("X-Auth-Token", authToken.trim());
                        }
                        mmr.setDataSource(uriOrPath, headers);
                        bitmap = mmr.getFrameAtTime(1000000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                        if (bitmap == null) {
                            bitmap = mmr.getFrameAtTime(-1);
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "Remote video thumb error for " + uriOrPath + ": " + t.getMessage());
                    } finally {
                        if (mmr != null) {
                            try { mmr.release(); } catch (Throwable ignored) {}
                        }
                    }
                } else {
                    File file = new File(uriOrPath);
                    if (file.exists()) {
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
                }

                if (bitmap != null) {
                    try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, fos);
                    }
                    if (!bitmap.isRecycled()) {
                        bitmap.recycle();
                    }
                    promise.resolve("file://" + cacheFile.getAbsolutePath());
                } else {
                    promise.resolve(null);
                }
            } catch (Throwable t) {
                Log.w(TAG, "Error in getVideoThumbnail: " + t.getMessage());
                promise.resolve(null);
            }
        }).start();
    }
}
