package com.fylo.mobile;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.MediaController;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;

import java.io.File;

public class FyloPlayerActivity extends Activity {
    private static final String TAG = "FyloPlayerActivity";

    private VideoView mVideoView;
    private ProgressBar mProgressBar;
    private LinearLayout mHeaderLayout;
    private MediaController mMediaController;
    private final Handler mHideHandler = new Handler(Looper.getMainLooper());
    private boolean mControlsVisible = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Standalone full-screen immersive video player
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setImmersiveMode();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        // Video View
        mVideoView = new VideoView(this);
        FrameLayout.LayoutParams videoParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        );
        root.addView(mVideoView, videoParams);

        // Progress Bar
        mProgressBar = new ProgressBar(this);
        mProgressBar.setIndeterminate(true);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        root.addView(mProgressBar, progressParams);

        // Top Overlay Header
        mHeaderLayout = new LinearLayout(this);
        mHeaderLayout.setOrientation(LinearLayout.HORIZONTAL);
        mHeaderLayout.setGravity(Gravity.CENTER_VERTICAL);
        int paddingH = dpToPx(16);
        int paddingV = dpToPx(14);
        mHeaderLayout.setPadding(paddingH, paddingV, paddingH, paddingV);

        GradientDrawable headerBg = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{ Color.argb(200, 0, 0, 0), Color.argb(0, 0, 0, 0) }
        );
        mHeaderLayout.setBackground(headerBg);

        // Back Button
        TextView backBtn = new TextView(this);
        backBtn.setText("‹ Back");
        backBtn.setTextColor(Color.WHITE);
        backBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        backBtn.setPadding(0, 0, dpToPx(16), 0);
        backBtn.setOnClickListener(v -> finish());
        mHeaderLayout.addView(backBtn);

        // Title TextView
        String urlOrPath = getIntent().getStringExtra("url");
        if (urlOrPath == null || urlOrPath.isEmpty()) {
            urlOrPath = getIntent().getStringExtra("path");
        }
        String title = getIntent().getStringExtra("title");
        if (TextUtils.isEmpty(title) && !TextUtils.isEmpty(urlOrPath)) {
            try {
                Uri parsed = Uri.parse(urlOrPath);
                String lastSeg = parsed.getLastPathSegment();
                title = lastSeg != null ? lastSeg : "Video Player";
            } catch (Throwable ignored) {
                title = "Video Player";
            }
        }

        TextView titleView = new TextView(this);
        titleView.setText(title != null ? title : "Video Player");
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        titleView.setLayoutParams(new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f
        ));
        mHeaderLayout.addView(titleView);

        FrameLayout.LayoutParams headerParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        );
        root.addView(mHeaderLayout, headerParams);

        setContentView(root);

        // Media Controller
        mMediaController = new MediaController(this) {
            @Override
            public void hide() {
                super.hide();
                hideHeader();
            }

            @Override
            public void show(int timeout) {
                super.show(timeout);
                showHeader(timeout);
            }
        };
        mMediaController.setAnchorView(root);
        mVideoView.setMediaController(mMediaController);

        // Toggle HUD on tap
        root.setOnClickListener(v -> {
            if (mControlsVisible) {
                if (mMediaController != null) mMediaController.hide();
                hideHeader();
            } else {
                if (mMediaController != null) mMediaController.show(3500);
                showHeader(3500);
            }
        });

        // Set video source & playback listeners
        mProgressBar.setVisibility(View.VISIBLE);
        mVideoView.setOnPreparedListener(mp -> {
            mProgressBar.setVisibility(View.GONE);
            mVideoView.start();
            if (mMediaController != null) {
                mMediaController.show(3000);
            }
            showHeader(3000);
        });

        mVideoView.setOnCompletionListener(mp -> {
            if (mMediaController != null) {
                mMediaController.show(0);
            }
            showHeader(0);
        });

        mVideoView.setOnErrorListener((mp, what, extra) -> {
            mProgressBar.setVisibility(View.GONE);
            Log.e(TAG, "Video playback error: what=" + what + ", extra=" + extra);
            Toast.makeText(FyloPlayerActivity.this, "Cannot play video (error " + what + ")", Toast.LENGTH_SHORT).show();
            return true;
        });

        if (!TextUtils.isEmpty(urlOrPath)) {
            try {
                if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://") || urlOrPath.startsWith("content://")) {
                    mVideoView.setVideoURI(Uri.parse(urlOrPath));
                } else if (urlOrPath.startsWith("file://")) {
                    mVideoView.setVideoURI(Uri.parse(urlOrPath));
                } else {
                    File f = new File(urlOrPath);
                    if (f.exists()) {
                        mVideoView.setVideoPath(f.getAbsolutePath());
                    } else {
                        mVideoView.setVideoURI(Uri.parse(urlOrPath));
                    }
                }
            } catch (Throwable t) {
                Log.e(TAG, "Failed to load video: " + t.getMessage(), t);
                Toast.makeText(this, "Failed to load video", Toast.LENGTH_SHORT).show();
            }
        } else {
            Toast.makeText(this, "Video source is empty", Toast.LENGTH_SHORT).show();
            finish();
        }
    }

    private void showHeader(int timeoutMs) {
        mControlsVisible = true;
        mHeaderLayout.setVisibility(View.VISIBLE);
        mHideHandler.removeCallbacksAndMessages(null);
        if (timeoutMs > 0) {
            mHideHandler.postDelayed(this::hideHeader, timeoutMs);
        }
    }

    private void hideHeader() {
        mControlsVisible = false;
        mHeaderLayout.setVisibility(View.GONE);
        setImmersiveMode();
    }

    private void setImmersiveMode() {
        try {
            View decorView = getWindow().getDecorView();
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
            );
        } catch (Throwable ignored) {}
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (mVideoView != null && mVideoView.isPlaying()) {
            mVideoView.pause();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        mHideHandler.removeCallbacksAndMessages(null);
        if (mVideoView != null) {
            mVideoView.stopPlayback();
        }
    }

    private int dpToPx(int dp) {
        return (int) TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, dp, getResources().getDisplayMetrics()
        );
    }
}
