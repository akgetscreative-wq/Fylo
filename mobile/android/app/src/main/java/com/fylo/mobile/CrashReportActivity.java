package com.fylo.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

public class CrashReportActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final String crashReport = getIntent().getStringExtra("crash_report") != null
                ? getIntent().getStringExtra("crash_report")
                : "No crash report details available.";
        final String exceptionClass = getIntent().getStringExtra("exception_class") != null
                ? getIntent().getStringExtra("exception_class")
                : "Fatal Exception";
        final String exceptionMsg = getIntent().getStringExtra("exception_message") != null
                ? getIntent().getStringExtra("exception_message")
                : "";

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#090A0F"));
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        // Header
        TextView title = new TextView(this);
        title.setText("⚠️ Fylo Startup Crash");
        title.setTextColor(Color.parseColor("#FF5555"));
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setPadding(0, 0, 0, pad / 2);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Error: " + exceptionClass + (exceptionMsg.isEmpty() ? "" : "\n" + exceptionMsg));
        subtitle.setTextColor(Color.parseColor("#FFB86C"));
        subtitle.setTextSize(14);
        subtitle.setTypeface(Typeface.DEFAULT_BOLD);
        subtitle.setPadding(0, 0, 0, pad / 2);
        root.addView(subtitle);

        // Action buttons bar
        LinearLayout btnBar = new LinearLayout(this);
        btnBar.setOrientation(LinearLayout.HORIZONTAL);
        btnBar.setGravity(Gravity.CENTER_VERTICAL);
        btnBar.setPadding(0, 0, 0, pad / 2);

        Button copyBtn = new Button(this);
        copyBtn.setText("📋 Copy Error");
        copyBtn.setBackgroundColor(Color.parseColor("#6366F1"));
        copyBtn.setTextColor(Color.WHITE);
        copyBtn.setPadding(pad, pad / 2, pad, pad / 2);
        copyBtn.setOnClickListener(v -> {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    ClipData clip = ClipData.newPlainText("Fylo Crash Log", crashReport);
                    cm.setPrimaryClip(clip);
                    Toast.makeText(CrashReportActivity.this, "Copied error to clipboard! Send this to the developer.", Toast.LENGTH_LONG).show();
                }
            } catch (Throwable t) {
                Toast.makeText(CrashReportActivity.this, "Failed to copy: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
        btnBar.addView(copyBtn);

        Button saveBtn = new Button(this);
        saveBtn.setText("💾 Save Log");
        saveBtn.setBackgroundColor(Color.parseColor("#22C55E"));
        saveBtn.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams saveLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        saveLp.setMarginStart(pad / 2);
        saveBtn.setLayoutParams(saveLp);
        saveBtn.setPadding(pad, pad / 2, pad, pad / 2);
        saveBtn.setOnClickListener(v -> {
            try {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null || !dir.exists()) {
                    dir = getExternalFilesDir(null);
                }
                File out = new File(dir, "fylo_crash.log");
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(crashReport.getBytes(StandardCharsets.UTF_8));
                }
                Toast.makeText(CrashReportActivity.this, "Saved to " + out.getAbsolutePath(), Toast.LENGTH_LONG).show();
            } catch (Throwable t) {
                Toast.makeText(CrashReportActivity.this, "Save error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
        btnBar.addView(saveBtn);

        Button closeBtn = new Button(this);
        closeBtn.setText("✕ Exit");
        closeBtn.setBackgroundColor(Color.parseColor("#374151"));
        closeBtn.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams closeLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        closeLp.setMarginStart(pad / 2);
        closeBtn.setLayoutParams(closeLp);
        closeBtn.setOnClickListener(v -> finishAffinity());
        btnBar.addView(closeBtn);

        root.addView(btnBar);

        // Scrollable Log
        ScrollView sv = new ScrollView(this);
        LinearLayout.LayoutParams svLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1.0f
        );
        sv.setLayoutParams(svLp);

        TextView logView = new TextView(this);
        logView.setText(crashReport);
        logView.setTextColor(Color.parseColor("#E5E7EB"));
        logView.setTextSize(12);
        logView.setTypeface(Typeface.MONOSPACE);
        logView.setTextIsSelectable(true);
        logView.setBackgroundColor(Color.parseColor("#111827"));
        logView.setPadding(pad / 2, pad / 2, pad / 2, pad / 2);
        sv.addView(logView);

        root.addView(sv);

        setContentView(root);
    }
}
