package com.fylo.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.text.format.Formatter;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;

public class FyloServerModule extends ReactContextBaseJavaModule {
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
            intent.putExtra("port", port);
            intent.putExtra("readOnly", readOnly);
            if (authToken != null && !authToken.trim().isEmpty()) {
                intent.putExtra("authToken", authToken);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent);
            } else {
                reactContext.startService(intent);
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("START_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void setAuthToken(String authToken, Promise promise) {
        try {
            FyloHttpServer server = FyloForegroundService.getHttpServer();
            if (server != null) {
                server.setAuthToken(authToken);
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("CONFIG_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void stopServer(Promise promise) {
        try {
            Intent intent = new Intent(reactContext, FyloForegroundService.class);
            reactContext.stopService(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("STOP_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void setReadOnly(boolean readOnly, Promise promise) {
        try {
            FyloHttpServer server = FyloForegroundService.getHttpServer();
            if (server != null) {
                server.setReadOnly(readOnly);
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("CONFIG_ERROR", e.getMessage());
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

            try {
                File path = Environment.getExternalStorageDirectory();
                StatFs stat = new StatFs(path.getPath());
                long totalGB = (stat.getBlockCountLong() * stat.getBlockSizeLong()) / (1024 * 1024 * 1024);
                long freeGB = (stat.getAvailableBlocksLong() * stat.getBlockSizeLong()) / (1024 * 1024 * 1024);

                WritableMap storageMap = Arguments.createMap();
                storageMap.putString("totalGB", totalGB + " GB");
                storageMap.putString("freeGB", freeGB + " GB");
                map.putMap("storage", storageMap);
            } catch (Exception ignored) {}

            promise.resolve(map);
        } catch (Exception e) {
            promise.reject("INFO_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void listDirectory(String targetPath, Promise promise) {
        try {
            if (targetPath == null || targetPath.trim().isEmpty()) {
                targetPath = Environment.getExternalStorageDirectory().getAbsolutePath();
            }
            File folder = new File(targetPath);
            if (!folder.exists() || !folder.isDirectory()) {
                promise.reject("NOT_FOUND", "Folder not found or is not a directory");
                return;
            }

            File[] files = folder.listFiles();
            com.facebook.react.bridge.WritableArray items = Arguments.createArray();
            if (files != null) {
                java.util.Arrays.sort(files, (a, b) -> {
                    if (a.isDirectory() && !b.isDirectory()) return -1;
                    if (!a.isDirectory() && b.isDirectory()) return 1;
                    return a.getName().compareToIgnoreCase(b.getName());
                });

                for (File f : files) {
                    if (f.getName().startsWith(".")) continue;
                    WritableMap item = Arguments.createMap();
                    item.putString("name", f.getName());
                    item.putString("path", f.getAbsolutePath());
                    item.putBoolean("isDir", f.isDirectory());
                    item.putDouble("size", f.isDirectory() ? 0 : f.length());
                    item.putDouble("modified", f.lastModified());
                    
                    String ext = "";
                    int dotIdx = f.getName().lastIndexOf('.');
                    if (dotIdx > 0 && dotIdx < f.getName().length() - 1) {
                        ext = f.getName().substring(dotIdx + 1).toLowerCase();
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

            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("LIST_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void requestStoragePermission() {
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
        }
    }

    private boolean checkStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return true;
    }

    private String getDeviceIpAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                List<InetAddress> addrs = Collections.list(intf.getInetAddresses());
                for (InetAddress addr : addrs) {
                    if (!addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }
}
