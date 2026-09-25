package com.fylo.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.content.SharedPreferences;
import android.os.BatteryManager;
import android.content.IntentFilter;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class FyloForegroundService extends Service {
    private static final String TAG = "FyloForegroundService";
    private static final String CHANNEL_ID = "fylo_foreground_channel";
    private static final int NOTIFICATION_ID = 4040;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private static final Object SERVER_LOCK = new Object();
    private static FyloHttpServer httpServer;
    private ScheduledExecutorService heartbeatExecutor;

    private void startNativeHeartbeat() {
        if (heartbeatExecutor != null && !heartbeatExecutor.isShutdown()) return;
        heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();
        heartbeatExecutor.scheduleWithFixedDelay(() -> {
            try {
                SharedPreferences prefs = getSharedPreferences("fylo_prefs", Context.MODE_PRIVATE);
                String pairedPc = prefs.getString("paired_pc", "");
                if (pairedPc == null || pairedPc.trim().isEmpty()) return;

                String token = prefs.getString("pc_token", "");
                String deviceId = prefs.getString("device_id", "");
                if (deviceId.isEmpty()) {
                    deviceId = Build.MANUFACTURER + "_" + Build.MODEL;
                }

                String urlStr = "http://" + pairedPc.trim() + "/api/mobile/heartbeat";
                URL url = new URL(urlStr);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                if (token != null && !token.isEmpty()) {
                    conn.setRequestProperty("X-Auth-Token", token.trim());
                }
                conn.setConnectTimeout(3000);
                conn.setReadTimeout(3000);
                conn.setDoOutput(true);

                JSONObject body = new JSONObject();
                body.put("deviceId", deviceId);
                body.put("model", Build.MODEL);
                body.put("brand", Build.MANUFACTURER);
                body.put("screenLocked", true);

                int batteryPct = -1;
                try {
                    IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                    Intent batteryStatus = registerReceiver(null, ifilter);
                    if (batteryStatus != null) {
                        int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                        int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                        if (level >= 0 && scale > 0) batteryPct = Math.round((level / (float) scale) * 100);
                    }
                } catch (Throwable ignored) {}
                body.put("battery", batteryPct);

                byte[] out = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(out);
                }
                int code = conn.getResponseCode();
                conn.disconnect();
            } catch (Throwable ignored) {}
        }, 1, 4, TimeUnit.SECONDS);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        // Safely acquire WakeLock (PARTIAL_WAKE_LOCK) for background & screen lock persistence
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Fylo:ServerWakeLock");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
                Log.i(TAG, "WakeLock (PARTIAL_WAKE_LOCK) acquired successfully");
            } catch (SecurityException se) {
                Log.w(TAG, "WakeLock permission denied: " + se.getMessage());
                wakeLock = null;
            } catch (Throwable t) {
                Log.w(TAG, "WakeLock acquire error: " + t.getMessage());
                wakeLock = null;
            }
        }

        // Safely acquire WifiLock (WIFI_MODE_FULL_HIGH_PERF) for background network persistence
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            try {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Fylo:WifiLock");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
                Log.i(TAG, "WifiLock (WIFI_MODE_FULL_HIGH_PERF) acquired successfully");
            } catch (SecurityException se) {
                Log.w(TAG, "WifiLock permission denied: " + se.getMessage());
                wifiLock = null;
            } catch (Throwable t) {
                Log.w(TAG, "WifiLock acquire error: " + t.getMessage());
                wifiLock = null;
            }
        }

        Log.i(TAG, "FyloForegroundService created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Ensure locks are actively held on each start command invocation
        if (wakeLock != null && !wakeLock.isHeld()) {
            try {
                wakeLock.acquire();
            } catch (Throwable ignored) {}
        }
        if (wifiLock != null && !wifiLock.isHeld()) {
            try {
                wifiLock.acquire();
            } catch (Throwable ignored) {}
        }

        int port = intent != null ? intent.getIntExtra("port", 8080) : 8080;
        boolean readOnly = intent != null ? intent.getBooleanExtra("readOnly", true) : true;
        boolean allowFullPhoneAccess = intent != null ? intent.getBooleanExtra("allowFullPhoneAccess", true) : true;
        String authToken = intent != null ? intent.getStringExtra("authToken") : null;

        Notification notification = createNotification(port);
        boolean foregroundStarted = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            foregroundStarted = true;
        } catch (Throwable t) {
            Log.e(TAG, "startForeground with DATA_SYNC failed (API " + Build.VERSION.SDK_INT + "): " + t.getMessage());
            try {
                // Secondary fallback attempt without specific type in case DATA_SYNC type was rejected
                startForeground(NOTIFICATION_ID, notification);
                foregroundStarted = true;
            } catch (Throwable t2) {
                Log.e(TAG, "Fallback startForeground also failed: " + t2.getMessage());
                // Avoid fatal ForegroundServiceDidNotStartInTimeException ANR crash by terminating service cleanly
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        synchronized (SERVER_LOCK) {
            if (httpServer == null) {
                try {
                    httpServer = new FyloHttpServer(this, port, readOnly);
                    httpServer.setAllowFullPhoneAccess(allowFullPhoneAccess);
                    if (authToken != null && !authToken.trim().isEmpty()) {
                        httpServer.setAuthToken(authToken.trim());
                    }
                    httpServer.start();
                    Log.i(TAG, "Fylo HTTP Server started inside Foreground Service on port " + port);
                } catch (Throwable e) {
                    Log.e(TAG, "Failed to start HTTP server", e);
                }
            } else {
                httpServer.setReadOnly(readOnly);
                httpServer.setAllowFullPhoneAccess(allowFullPhoneAccess);
                if (authToken != null && !authToken.trim().isEmpty()) {
                    httpServer.setAuthToken(authToken.trim());
                }
            }
        }

        startNativeHeartbeat();

        return START_STICKY;
    }

    public static FyloHttpServer getHttpServer() {
        synchronized (SERVER_LOCK) {
            return httpServer;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Fylo Background Service",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Keeps Fylo server running when phone is locked");
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                NotificationManager manager = getSystemService(NotificationManager.class);
                if (manager != null) {
                    manager.createNotificationChannel(channel);
                }
            } catch (Throwable t) {
                Log.w(TAG, "Failed to create notification channel: " + t.getMessage());
            }
        }
    }

    private Notification createNotification(int port) {
        PendingIntent pendingIntent = null;
        try {
            Intent notificationIntent = new Intent(this, MainActivity.class);
            notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int pFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, pFlags);
        } catch (Throwable t) {
            Log.w(TAG, "Could not create PendingIntent: " + t.getMessage());
        }

        // Crucial: Notification small icon MUST be a standard non-adaptive flat drawable.
        // Using getApplicationInfo().icon points to an <adaptive-icon> XML which throws
        // BadNotificationException / RemoteServiceException crash on Android 8+!
        int iconRes = android.R.drawable.stat_sys_upload;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Fylo Mobile Server Active")
                .setContentText("Listening on port " + port + " • Screen can be locked")
                .setSmallIcon(iconRes)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_SERVICE);

        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent);
        }

        return builder.build();
    }

    @Override
    public void onDestroy() {
        if (heartbeatExecutor != null) {
            try {
                heartbeatExecutor.shutdownNow();
            } catch (Throwable ignored) {}
            heartbeatExecutor = null;
        }

        synchronized (SERVER_LOCK) {
            if (httpServer != null) {
                try {
                    httpServer.stop();
                } catch (Throwable ignored) {}
                httpServer = null;
            }
        }

        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) {
                    wakeLock.release();
                }
            } catch (Throwable t) {
                Log.w(TAG, "WakeLock release error: " + t.getMessage());
            } finally {
                wakeLock = null;
            }
        }

        if (wifiLock != null) {
            try {
                if (wifiLock.isHeld()) {
                    wifiLock.release();
                }
            } catch (Throwable t) {
                Log.w(TAG, "WifiLock release error: " + t.getMessage());
            } finally {
                wifiLock = null;
            }
        }

        super.onDestroy();
        Log.i(TAG, "FyloForegroundService destroyed and locks released");
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "Fylo app removed from recent apps / background. Stopping service.");
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

