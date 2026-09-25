package com.fylo.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class FyloServerModule extends ReactContextBaseJavaModule {
    private static final String TAG = "FyloServerModule";
    private final ReactApplicationContext reactContext;

    public FyloServerModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "FyloModule";
    }

    @ReactMethod
    public void startServer(int port, boolean readOnly, String authToken, Promise promise) {
        try {
            Intent intent = new Intent(reactContext, FyloForegroundService.class);
            intent.putExtra("port", port > 0 ? port : 8080);
            intent.putExtra("readOnly", readOnly);
            if (authToken != null && !authToken.trim().isEmpty()) {
                intent.putExtra("authToken", authToken.trim());
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent);
            } else {
                reactContext.startService(intent);
            }
            if (promise != null) {
                promise.resolve(true);
            }
        } catch (Throwable e) {
            Log.e(TAG, "startServer error: " + e.getMessage(), e);
            if (promise != null) {
                promise.reject("START_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }
    }

    @ReactMethod
    public void setAuthToken(String authToken, Promise promise) {
        try {
            FyloHttpServer server = FyloForegroundService.getHttpServer();
            if (server != null) {
                server.setAuthToken(authToken != null ? authToken.trim() : null);
            }
            if (promise != null) {
                promise.resolve(true);
            }
        } catch (Throwable e) {
            Log.e(TAG, "setAuthToken error: " + e.getMessage(), e);
            if (promise != null) {
                promise.reject("CONFIG_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }
    }

    @ReactMethod
    public void stopServer(Promise promise) {
        try {
            Intent intent = new Intent(reactContext, FyloForegroundService.class);
            reactContext.stopService(intent);
            if (promise != null) {
                promise.resolve(true);
            }
        } catch (Throwable e) {
            Log.e(TAG, "stopServer error: " + e.getMessage(), e);
            if (promise != null) {
                promise.reject("STOP_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }
    }

    @ReactMethod
    public void setReadOnly(boolean readOnly, Promise promise) {
        try {
            FyloHttpServer server = FyloForegroundService.getHttpServer();
            if (server != null) {
                server.setReadOnly(readOnly);
            }
            if (promise != null) {
                promise.resolve(true);
            }
        } catch (Throwable e) {
            Log.e(TAG, "setReadOnly error: " + e.getMessage(), e);
            if (promise != null) {
                promise.reject("CONFIG_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }
    }

    @ReactMethod
    public void getClipboardText(Promise promise) {
        try {
            reactContext.runOnUiQueueThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) reactContext.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                        CharSequence text = cm.getPrimaryClip().getItemAt(0).getText();
                        if (promise != null) promise.resolve(text != null ? text.toString() : "");
                    } else {
                        if (promise != null) promise.resolve("");
                    }
                } catch (Throwable e) {
                    if (promise != null) promise.resolve("");
                }
            });
        } catch (Throwable e) {
            if (promise != null) promise.resolve("");
        }
    }

    @ReactMethod
    public void setClipboardText(String text, Promise promise) {
        try {
            reactContext.runOnUiQueueThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) reactContext.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        ClipData clip = ClipData.newPlainText("fylo", text != null ? text : "");
                        cm.setPrimaryClip(clip);
                    }
                    if (promise != null) promise.resolve(true);
                } catch (Throwable e) {
                    if (promise != null) promise.reject("CLIP_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        } catch (Throwable e) {
            if (promise != null) promise.reject("CLIP_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @ReactMethod
    public void getServerInfo(Promise promise) {
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

            if (promise != null) {
                promise.resolve(map);
            }
        } catch (Throwable e) {
            Log.e(TAG, "getServerInfo error: " + e.getMessage(), e);
            if (promise != null) {
                promise.reject("INFO_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }
    }

    @ReactMethod
    public void listDirectory(String targetPath, Promise promise) {
        try {
            if (targetPath == null || targetPath.trim().isEmpty() ||
                "undefined".equalsIgnoreCase(targetPath.trim()) || "null".equalsIgnoreCase(targetPath.trim())) {
                File ext = Environment.getExternalStorageDirectory();
                targetPath = ext != null ? ext.getAbsolutePath() : "/storage/emulated/0";
            }

            File folder = new File(targetPath);
            if (!folder.exists() || !folder.isDirectory()) {
                if (promise != null) {
                    promise.reject("NOT_FOUND", "Folder not found or is not a directory");
                }
                return;
            }

            File[] files = null;
            try {
                files = folder.listFiles();
            } catch (SecurityException se) {
                if (promise != null) {
                    promise.reject("PERMISSION_DENIED", "Access to folder denied by security policy");
                }
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

            if (promise != null) {
                promise.resolve(result);
            }
        } catch (Throwable e) {
            Log.e(TAG, "listDirectory error: " + e.getMessage(), e);
            if (promise != null) {
                promise.reject("LIST_ERROR", e.getMessage() != null ? e.getMessage() : e.toString());
            }
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
                } catch (Exception e) {
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
            } else {
                int readPerm = ContextCompat.checkSelfPermission(
                    reactContext, android.Manifest.permission.READ_EXTERNAL_STORAGE
                );
                return readPerm == PackageManager.PERMISSION_GRANTED;
            }
        } catch (Throwable e) {
            Log.w(TAG, "checkStoragePermission error: " + e.getMessage());
            return false;
        }
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
}

