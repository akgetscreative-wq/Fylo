package com.fylo.mobile;

import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class CrashHandler implements Thread.UncaughtExceptionHandler {
    private static final String TAG = "CrashHandler";
    private final Context context;
    private final Thread.UncaughtExceptionHandler defaultHandler;

    public CrashHandler(Context context) {
        this.context = context.getApplicationContext();
        this.defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
    }

    public static void install(Application app) {
        Thread.setDefaultUncaughtExceptionHandler(new CrashHandler(app));
    }

    @Override
    public void uncaughtException(Thread thread, Throwable throwable) {
        try {
            StringWriter sw = new StringWriter();
            PrintWriter pw = new PrintWriter(sw);
            throwable.printStackTrace(pw);
            String stackTrace = sw.toString();

            String timeStamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date());
            String report = "=== FYLO CRASH REPORT ===\n"
                    + "Time: " + timeStamp + "\n"
                    + "Device: " + Build.MANUFACTURER + " " + Build.MODEL + "\n"
                    + "Android SDK: " + Build.VERSION.SDK_INT + " (Release: " + Build.VERSION.RELEASE + ")\n"
                    + "Thread: " + thread.getName() + " (ID: " + thread.getId() + ")\n"
                    + "Exception: " + throwable.getClass().getName() + "\n"
                    + "Message: " + throwable.getMessage() + "\n\n"
                    + "STACK TRACE:\n" + stackTrace;

            Log.e(TAG, report);

            // Attempt to write to internal files dir
            try {
                File internalFile = new File(context.getFilesDir(), "fylo_crash.log");
                try (FileOutputStream fos = new FileOutputStream(internalFile)) {
                    fos.write(report.getBytes(StandardCharsets.UTF_8));
                }
            } catch (Throwable ignored) {}

            // Attempt to write to external downloads
            try {
                File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (downloadDir != null && downloadDir.exists()) {
                    File crashFile = new File(downloadDir, "fylo_crash.log");
                    try (FileOutputStream fos = new FileOutputStream(crashFile)) {
                        fos.write(report.getBytes(StandardCharsets.UTF_8));
                    }
                }
            } catch (Throwable ignored) {}

            // Launch CrashReportActivity in separate process
            Intent intent = new Intent(context, CrashReportActivity.class);
            intent.putExtra("crash_report", report);
            intent.putExtra("exception_class", throwable.getClass().getSimpleName());
            intent.putExtra("exception_message", String.valueOf(throwable.getMessage()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            context.startActivity(intent);

            // Terminate the crashing process cleanly
            android.os.Process.killProcess(android.os.Process.myPid());
            System.exit(10);
        } catch (Throwable t) {
            Log.e(TAG, "Error in crash handler: " + t.getMessage(), t);
            if (defaultHandler != null) {
                defaultHandler.uncaughtException(thread, throwable);
            }
        }
    }
}
