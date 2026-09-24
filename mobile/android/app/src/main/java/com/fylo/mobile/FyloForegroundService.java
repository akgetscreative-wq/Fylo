package com.fylo.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class FyloForegroundService extends Service {
    private static final String TAG = "FyloForegroundService";
    private static final String CHANNEL_ID = "fylo_foreground_channel";
    private static final int NOTIFICATION_ID = 4040;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private static FyloHttpServer httpServer;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        // Acquire WakeLock to prevent CPU sleep when phone screen is locked
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Fylo:ServerWakeLock");
            wakeLock.acquire();
        }

        // Acquire WifiLock to prevent Wi-Fi chip from sleeping
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Fylo:WifiLock");
            wifiLock.acquire();
        }

        Log.i(TAG, "FyloForegroundService created with WakeLock & WifiLock");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int port = intent != null ? intent.getIntExtra("port", 8080) : 8080;
        boolean readOnly = intent != null ? intent.getBooleanExtra("readOnly", true) : true;
        String authToken = intent != null ? intent.getStringExtra("authToken") : null;

        Notification notification = createNotification(port);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (httpServer == null) {
            try {
                httpServer = new FyloHttpServer(this, port, readOnly);
                if (authToken != null && !authToken.trim().isEmpty()) {
                    httpServer.setAuthToken(authToken);
                }
                httpServer.start();
                Log.i(TAG, "Fylo HTTP Server started inside Foreground Service");
            } catch (Exception e) {
                Log.e(TAG, "Failed to start HTTP server", e);
            }
        } else if (authToken != null && !authToken.trim().isEmpty()) {
            httpServer.setAuthToken(authToken);
        }

        return START_STICKY;
    }

    public static FyloHttpServer getHttpServer() {
        return httpServer;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Fylo Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps Fylo server running when phone is locked");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification createNotification(int port) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Fylo Mobile Server Active")
                .setContentText("Listening on port " + port + " • Screen can be locked")
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        if (httpServer != null) {
            httpServer.stop();
            httpServer = null;
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }

        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
            wifiLock = null;
        }

        super.onDestroy();
        Log.i(TAG, "FyloForegroundService destroyed and locks released");
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "Fylo app removed from recent apps / background. Stopping server.");
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
