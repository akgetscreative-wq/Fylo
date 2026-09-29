package com.fylo.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;

import java.io.File;
import java.util.Locale;

public class FyloPlayerActivity extends Activity {
    private static final String TAG = "FyloPlayerActivity";

    // Playback Components
    private VideoView mVideoView;
    private ProgressBar mProgressBar;
    private MediaPlayer mMediaPlayer;

    // UI Overlays
    private LinearLayout mHeaderLayout;
    private LinearLayout mCenterControlsLayout;
    private LinearLayout mFooterLayout;
    private FrameLayout mHudOverlay;
    private TextView mHudText;
    private TextView mDoubleTapLeftHud;
    private TextView mDoubleTapRightHud;

    // Controls Views
    private TextView mPlayPauseBtn;
    private TextView mCurrentTimeText;
    private TextView mDurationText;
    private SeekBar mSeekBar;
    private TextView mSpeedBtn;
    private TextView mAspectBtn;
    private TextView mLockBtn;

    // State Variables
    private boolean mControlsVisible = true;
    private boolean mIsLocked = false;
    private boolean mIsPrepared = false;
    private boolean mIsUserScrubbing = false;
    private String mUrlOrPath;
    private String mMimeType = "video/*";

    // Speed options: 0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x
    private final float[] SPEED_PRESETS = { 0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f };
    private int mSpeedIndex = 2; // Default 1.0x

    // Aspect Modes: 0 = FIT (contain), 1 = ZOOM (crop/cover), 2 = STRETCH (16:9)
    private int mAspectMode = 0;

    // System Services
    private AudioManager mAudioManager;
    private int mMaxVolume = 15;

    // Gesture Tracking
    private GestureDetector mGestureDetector;
    private float mTouchStartX = 0;
    private float mTouchStartY = 0;
    private boolean mIsHorizontalSeek = false;
    private boolean mIsVerticalVolume = false;
    private boolean mIsVerticalBrightness = false;
    private int mSeekInitialPosition = 0;
    private int mSeekTargetPosition = 0;
    private float mInitialBrightness = 0.5f;
    private int mInitialVolume = 5;

    private final Handler mMainHandler = new Handler(Looper.getMainLooper());
    private final Runnable mHideControlsRunnable = this::hideControls;

    private final Runnable mProgressUpdateRunnable = new Runnable() {
        @Override
        public void run() {
            if (mIsPrepared && mVideoView != null && !mIsUserScrubbing) {
                try {
                    int pos = mVideoView.getCurrentPosition();
                    int dur = mVideoView.getDuration();
                    if (dur > 0) {
                        mSeekBar.setMax(dur);
                        mSeekBar.setProgress(pos);
                        mCurrentTimeText.setText(formatTime(pos));
                        mDurationText.setText(formatTime(dur));
                    }
                } catch (Throwable ignored) {}
            }
            mMainHandler.postDelayed(this, 250);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen & Keep Screen On
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setImmersiveMode();

        mAudioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (mAudioManager != null) {
            mMaxVolume = mAudioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        }

        mUrlOrPath = getIntent().getStringExtra("url");
        if (TextUtils.isEmpty(mUrlOrPath)) {
            mUrlOrPath = getIntent().getStringExtra("path");
        }
        if (getIntent().hasExtra("mimeType")) {
            mMimeType = getIntent().getStringExtra("mimeType");
        }

        buildUI();
        initGestureDetector();

        if (!TextUtils.isEmpty(mUrlOrPath)) {
            loadVideo(mUrlOrPath);
        } else {
            Toast.makeText(this, "Video source is empty", Toast.LENGTH_SHORT).show();
            finish();
        }
    }

    private void buildUI() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        // 1. VideoView
        mVideoView = new VideoView(this);
        FrameLayout.LayoutParams videoParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        );
        root.addView(mVideoView, videoParams);

        // 2. Loading Indicator
        mProgressBar = new ProgressBar(this);
        mProgressBar.setIndeterminate(true);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        root.addView(mProgressBar, progressParams);

        // 3. Top Header Bar (YouTube / MX Player style)
        mHeaderLayout = new LinearLayout(this);
        mHeaderLayout.setOrientation(LinearLayout.HORIZONTAL);
        mHeaderLayout.setGravity(Gravity.CENTER_VERTICAL);
        mHeaderLayout.setPadding(dpToPx(16), dpToPx(12), dpToPx(16), dpToPx(14));
        GradientDrawable headerBg = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{ Color.argb(220, 0, 0, 0), Color.argb(0, 0, 0, 0) }
        );
        mHeaderLayout.setBackground(headerBg);

        // Back Button
        TextView backBtn = new TextView(this);
        backBtn.setText("‹ Back");
        backBtn.setTextColor(Color.WHITE);
        backBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        backBtn.setPadding(0, 0, dpToPx(16), 0);
        backBtn.setOnClickListener(v -> finish());
        mHeaderLayout.addView(backBtn);

        // Video Title
        String title = getIntent().getStringExtra("title");
        if (TextUtils.isEmpty(title) && !TextUtils.isEmpty(mUrlOrPath)) {
            try {
                Uri parsed = Uri.parse(mUrlOrPath);
                String lastSeg = parsed.getLastPathSegment();
                title = lastSeg != null ? lastSeg : "Video Player";
            } catch (Throwable ignored) {
                title = "Video Player";
            }
        }
        TextView titleView = new TextView(this);
        titleView.setText(title != null ? title : "Video Player");
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        titleView.setLayoutParams(new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f
        ));
        mHeaderLayout.addView(titleView);

        // Playback Speed Button (0.5x - 2.0x)
        mSpeedBtn = createHeaderPillButton("1.0x");
        mSpeedBtn.setOnClickListener(v -> cyclePlaybackSpeed());
        mHeaderLayout.addView(mSpeedBtn);

        // Aspect Ratio Mode Button (FIT / ZOOM / 16:9)
        mAspectBtn = createHeaderPillButton("FIT");
        mAspectBtn.setOnClickListener(v -> cycleAspectRatio());
        mHeaderLayout.addView(mAspectBtn);

        // Open in External App (VLC / MX Player)
        TextView openExtBtn = createHeaderPillButton("↗ App");
        openExtBtn.setOnClickListener(v -> openInExternalApp());
        mHeaderLayout.addView(openExtBtn);

        FrameLayout.LayoutParams headerParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        );
        root.addView(mHeaderLayout, headerParams);

        // 4. Center Controls (Rewind 10s, Play/Pause, Forward 10s)
        mCenterControlsLayout = new LinearLayout(this);
        mCenterControlsLayout.setOrientation(LinearLayout.HORIZONTAL);
        mCenterControlsLayout.setGravity(Gravity.CENTER);

        TextView rewindBtn = createCircleButton("↺ 10", 52, 13);
        rewindBtn.setOnClickListener(v -> seekDelta(-10000));
        mCenterControlsLayout.addView(rewindBtn);

        mPlayPauseBtn = createCircleButton("❙❙", 68, 24);
        mPlayPauseBtn.setOnClickListener(v -> togglePlayPause());
        LinearLayout.LayoutParams playParams = new LinearLayout.LayoutParams(
            dpToPx(68), dpToPx(68)
        );
        playParams.setMargins(dpToPx(32), 0, dpToPx(32), 0);
        mPlayPauseBtn.setLayoutParams(playParams);
        mCenterControlsLayout.addView(mPlayPauseBtn);

        TextView forwardBtn = createCircleButton("↻ 10", 52, 13);
        forwardBtn.setOnClickListener(v -> seekDelta(10000));
        mCenterControlsLayout.addView(forwardBtn);

        FrameLayout.LayoutParams centerParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        root.addView(mCenterControlsLayout, centerParams);

        // 5. Bottom Controls (Seekbar, timestamps, lock button)
        mFooterLayout = new LinearLayout(this);
        mFooterLayout.setOrientation(LinearLayout.HORIZONTAL);
        mFooterLayout.setGravity(Gravity.CENTER_VERTICAL);
        mFooterLayout.setPadding(dpToPx(16), dpToPx(14), dpToPx(16), dpToPx(12));
        GradientDrawable footerBg = new GradientDrawable(
            GradientDrawable.Orientation.BOTTOM_TOP,
            new int[]{ Color.argb(220, 0, 0, 0), Color.argb(0, 0, 0, 0) }
        );
        mFooterLayout.setBackground(footerBg);

        mCurrentTimeText = new TextView(this);
        mCurrentTimeText.setText("00:00");
        mCurrentTimeText.setTextColor(Color.WHITE);
        mCurrentTimeText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        mFooterLayout.addView(mCurrentTimeText);

        mSeekBar = new SeekBar(this);
        mSeekBar.setLayoutParams(new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f
        ));
        mSeekBar.setPadding(dpToPx(12), dpToPx(8), dpToPx(12), dpToPx(8));
        mSeekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (fromUser) {
                    mCurrentTimeText.setText(formatTime(progress));
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {
                mIsUserScrubbing = true;
                mMainHandler.removeCallbacks(mHideControlsRunnable);
            }

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {
                mIsUserScrubbing = false;
                if (mVideoView != null) {
                    mVideoView.seekTo(seekBar.getProgress());
                }
                scheduleControlsHide(3500);
            }
        });
        mFooterLayout.addView(mSeekBar);

        mDurationText = new TextView(this);
        mDurationText.setText("00:00");
        mDurationText.setTextColor(Color.parseColor("#94A3B8"));
        mDurationText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        mFooterLayout.addView(mDurationText);

        // Lock Button (MX Player Screen Lock)
        mLockBtn = createHeaderPillButton("🔓");
        mLockBtn.setPadding(dpToPx(8), dpToPx(4), dpToPx(8), dpToPx(4));
        mLockBtn.setOnClickListener(v -> toggleScreenLock());
        mFooterLayout.addView(mLockBtn);

        FrameLayout.LayoutParams footerParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        root.addView(mFooterLayout, footerParams);

        // 6. Floating Gesture HUD Card (Volume / Brightness / Seek Feedback)
        mHudOverlay = new FrameLayout(this);
        mHudOverlay.setVisibility(View.GONE);
        GradientDrawable hudBg = new GradientDrawable();
        hudBg.setColor(Color.argb(200, 15, 23, 42));
        hudBg.setCornerRadius(dpToPx(16));
        hudBg.setStroke(dpToPx(1), Color.argb(80, 59, 130, 246));
        mHudOverlay.setBackground(hudBg);
        mHudOverlay.setPadding(dpToPx(20), dpToPx(14), dpToPx(20), dpToPx(14));

        mHudText = new TextView(this);
        mHudText.setTextColor(Color.WHITE);
        mHudText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        mHudText.setGravity(Gravity.CENTER);
        mHudOverlay.addView(mHudText);

        FrameLayout.LayoutParams hudParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        root.addView(mHudOverlay, hudParams);

        // 7. Double Tap Indicators (Left -10s, Right +10s)
        mDoubleTapLeftHud = createDoubleTapBadge("−10s");
        FrameLayout.LayoutParams leftHudParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER_VERTICAL | Gravity.START
        );
        leftHudParams.setMarginStart(dpToPx(40));
        root.addView(mDoubleTapLeftHud, leftHudParams);

        mDoubleTapRightHud = createDoubleTapBadge("+10s");
        FrameLayout.LayoutParams rightHudParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER_VERTICAL | Gravity.END
        );
        rightHudParams.setMarginEnd(dpToPx(40));
        root.addView(mDoubleTapRightHud, rightHudParams);

        setContentView(root);
    }

    private TextView createHeaderPillButton(String text) {
        TextView btn = new TextView(this);
        btn.setText(text);
        btn.setTextColor(Color.WHITE);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(dpToPx(10), dpToPx(5), dpToPx(10), dpToPx(5));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(120, 30, 41, 59));
        bg.setCornerRadius(dpToPx(8));
        bg.setStroke(dpToPx(1), Color.argb(60, 255, 255, 255));
        btn.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lp.setMargins(dpToPx(4), 0, dpToPx(4), 0);
        btn.setLayoutParams(lp);
        return btn;
    }

    private TextView createCircleButton(String text, int sizeDp, int textSizeSp) {
        TextView btn = new TextView(this);
        btn.setText(text);
        btn.setTextColor(Color.WHITE);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp);
        btn.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.argb(160, 15, 23, 42));
        bg.setStroke(dpToPx(1.5f), Color.argb(100, 37, 99, 235));
        btn.setBackground(bg);
        btn.setLayoutParams(new LinearLayout.LayoutParams(dpToPx(sizeDp), dpToPx(sizeDp)));
        return btn;
    }

    private TextView createDoubleTapBadge(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        tv.setGravity(Gravity.CENTER);
        tv.setVisibility(View.GONE);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(190, 15, 23, 42));
        bg.setCornerRadius(dpToPx(24));
        bg.setStroke(dpToPx(1), Color.argb(120, 59, 130, 246));
        tv.setBackground(bg);
        tv.setPadding(dpToPx(18), dpToPx(12), dpToPx(18), dpToPx(12));
        return tv;
    }

    private void loadVideo(String urlOrPath) {
        mProgressBar.setVisibility(View.VISIBLE);

        mVideoView.setOnPreparedListener(mp -> {
            mIsPrepared = true;
            mMediaPlayer = mp;
            mProgressBar.setVisibility(View.GONE);

            int dur = mp.getDuration();
            mSeekBar.setMax(dur > 0 ? dur : 0);
            mDurationText.setText(formatTime(dur));

            applyAspectRatio();
            applyPlaybackSpeed();

            mVideoView.start();
            mPlayPauseBtn.setText("❙❙");
            scheduleControlsHide(3500);

            mMainHandler.post(mProgressUpdateRunnable);
        });

        mVideoView.setOnCompletionListener(mp -> {
            mPlayPauseBtn.setText("▶");
            showControls();
        });

        mVideoView.setOnErrorListener((mp, what, extra) -> {
            mProgressBar.setVisibility(View.GONE);
            Log.e(TAG, "Video error: " + what + ", " + extra);
            Toast.makeText(this, "Cannot play video (Error " + what + ")", Toast.LENGTH_SHORT).show();
            return true;
        });

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
            Log.e(TAG, "Failed loading video: " + t.getMessage(), t);
            Toast.makeText(this, "Failed loading video", Toast.LENGTH_SHORT).show();
        }
    }

    // =========================================================================
    // MX PLAYER & YOUTUBE TOUCH GESTURES
    // =========================================================================
    private void initGestureDetector() {
        mGestureDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                if (mIsLocked) {
                    // Show lock button briefly
                    mFooterLayout.setVisibility(View.VISIBLE);
                    scheduleControlsHide(2500);
                    return true;
                }
                if (mControlsVisible) {
                    hideControls();
                } else {
                    showControls();
                }
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent e) {
                if (mIsLocked || !mIsPrepared) return false;
                int screenWidth = getWindow().getDecorView().getWidth();
                if (e.getX() < screenWidth / 2f) {
                    // Left Side Double Tap: Rewind 10s
                    seekDelta(-10000);
                    flashDoubleTapBadge(mDoubleTapLeftHud);
                } else {
                    // Right Side Double Tap: Forward 10s
                    seekDelta(10000);
                    flashDoubleTapBadge(mDoubleTapRightHud);
                }
                return true;
            }
        });
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (mGestureDetector != null && mGestureDetector.onTouchEvent(event)) {
            return true;
        }

        if (mIsLocked) return super.onTouchEvent(event);

        int screenWidth = getWindow().getDecorView().getWidth();
        int screenHeight = getWindow().getDecorView().getHeight();

        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                mTouchStartX = event.getX();
                mTouchStartY = event.getY();
                mIsHorizontalSeek = false;
                mIsVerticalVolume = false;
                mIsVerticalBrightness = false;
                mSeekInitialPosition = mVideoView != null ? mVideoView.getCurrentPosition() : 0;
                mInitialBrightness = getWindow().getAttributes().screenBrightness;
                if (mInitialBrightness < 0) mInitialBrightness = 0.5f;
                if (mAudioManager != null) {
                    mInitialVolume = mAudioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                }
                break;

            case MotionEvent.ACTION_MOVE:
                float dx = event.getX() - mTouchStartX;
                float dy = event.getY() - mTouchStartY;

                // Threshold to avoid jitter
                if (!mIsHorizontalSeek && !mIsVerticalVolume && !mIsVerticalBrightness) {
                    if (Math.abs(dx) > dpToPx(24) && Math.abs(dx) > Math.abs(dy)) {
                        mIsHorizontalSeek = true;
                    } else if (Math.abs(dy) > dpToPx(24) && Math.abs(dy) > Math.abs(dx)) {
                        if (mTouchStartX < screenWidth / 2f) {
                            mIsVerticalBrightness = true;
                        } else {
                            mIsVerticalVolume = true;
                        }
                    }
                }

                // 1. Horizontal Swipe: Seek through video
                if (mIsHorizontalSeek && mIsPrepared && mVideoView != null) {
                    int duration = mVideoView.getDuration();
                    if (duration > 0) {
                        float seekDeltaMs = (dx / (float) screenWidth) * 90000f; // Max 90s scrub range
                        mSeekTargetPosition = (int) Math.max(0, Math.min(duration, mSeekInitialPosition + seekDeltaMs));
                        int diffSec = (int) ((mSeekTargetPosition - mSeekInitialPosition) / 1000);
                        String sign = diffSec >= 0 ? "+" : "";
                        showHud("⏩ " + sign + diffSec + "s\n" + formatTime(mSeekTargetPosition) + " / " + formatTime(duration));
                    }
                }

                // 2. Left Vertical Swipe: Brightness
                if (mIsVerticalBrightness) {
                    float delta = -dy / (float) screenHeight;
                    float newBrightness = Math.max(0.01f, Math.min(1.0f, mInitialBrightness + delta));
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    lp.screenBrightness = newBrightness;
                    getWindow().setAttributes(lp);
                    int percent = Math.round(newBrightness * 100);
                    showHud("☀ Brightness: " + percent + "%");
                }

                // 3. Right Vertical Swipe: Volume
                if (mIsVerticalVolume && mAudioManager != null) {
                    float delta = -dy / (float) screenHeight;
                    int volumeDelta = Math.round(delta * mMaxVolume);
                    int newVolume = Math.max(0, Math.min(mMaxVolume, mInitialVolume + volumeDelta));
                    mAudioManager.setStreamVolume(AudioManager.STREAM_MUSIC, newVolume, 0);
                    int percent = Math.round(((float) newVolume / mMaxVolume) * 100);
                    showHud("🔊 Volume: " + percent + "%");
                }
                break;

            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (mIsHorizontalSeek && mIsPrepared && mVideoView != null) {
                    mVideoView.seekTo(mSeekTargetPosition);
                    mSeekBar.setProgress(mSeekTargetPosition);
                }
                hideHud(800);
                mIsHorizontalSeek = false;
                mIsVerticalVolume = false;
                mIsVerticalBrightness = false;
                break;
        }

        return true;
    }

    private void showHud(String message) {
        mHudText.setText(message);
        mHudOverlay.setVisibility(View.VISIBLE);
        mMainHandler.removeCallbacksAndMessages(mHudOverlay);
    }

    private void hideHud(int delayMs) {
        mMainHandler.postDelayed(() -> mHudOverlay.setVisibility(View.GONE), delayMs);
    }

    private void flashDoubleTapBadge(TextView badge) {
        badge.setVisibility(View.VISIBLE);
        mMainHandler.postDelayed(() -> badge.setVisibility(View.GONE), 650);
    }

    private void togglePlayPause() {
        if (!mIsPrepared || mVideoView == null) return;
        if (mVideoView.isPlaying()) {
            mVideoView.pause();
            mPlayPauseBtn.setText("▶");
            mMainHandler.removeCallbacks(mHideControlsRunnable);
        } else {
            mVideoView.start();
            mPlayPauseBtn.setText("❙❙");
            scheduleControlsHide(3500);
        }
    }

    private void seekDelta(int deltaMs) {
        if (!mIsPrepared || mVideoView == null) return;
        int current = mVideoView.getCurrentPosition();
        int duration = mVideoView.getDuration();
        int target = Math.max(0, Math.min(duration, current + deltaMs));
        mVideoView.seekTo(target);
        mSeekBar.setProgress(target);
        mCurrentTimeText.setText(formatTime(target));
        showControls();
    }

    private void cyclePlaybackSpeed() {
        mSpeedIndex = (mSpeedIndex + 1) % SPEED_PRESETS.length;
        float speed = SPEED_PRESETS[mSpeedIndex];
        mSpeedBtn.setText(speed + "x");
        applyPlaybackSpeed();
        showHud("⚡ Speed: " + speed + "x");
        hideHud(1000);
    }

    private void applyPlaybackSpeed() {
        if (mMediaPlayer != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PlaybackParams params = mMediaPlayer.getPlaybackParams();
                params.setSpeed(SPEED_PRESETS[mSpeedIndex]);
                mMediaPlayer.setPlaybackParams(params);
            } catch (Throwable t) {
                Log.w(TAG, "Speed error: " + t.getMessage());
            }
        }
    }

    private void cycleAspectRatio() {
        mAspectMode = (mAspectMode + 1) % 3;
        String modeName = mAspectMode == 0 ? "FIT" : mAspectMode == 1 ? "ZOOM" : "16:9";
        mAspectBtn.setText(modeName);
        applyAspectRatio();
        showHud("⛶ Mode: " + modeName);
        hideHud(1000);
    }

    private void applyAspectRatio() {
        if (mVideoView != null && mMediaPlayer != null) {
            try {
                int videoW = mMediaPlayer.getVideoWidth();
                int videoH = mMediaPlayer.getVideoHeight();
                int rootW = getWindow().getDecorView().getWidth();
                int rootH = getWindow().getDecorView().getHeight();
                if (videoW <= 0 || videoH <= 0 || rootW <= 0 || rootH <= 0) return;

                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) mVideoView.getLayoutParams();
                if (mAspectMode == 1) { // ZOOM (cover)
                    float scale = Math.max((float) rootW / videoW, (float) rootH / videoH);
                    lp.width = (int) (videoW * scale);
                    lp.height = (int) (videoH * scale);
                } else if (mAspectMode == 2) { // 16:9 Stretch
                    lp.width = rootW;
                    lp.height = (int) (rootW * (9f / 16f));
                } else { // FIT (contain)
                    lp.width = FrameLayout.LayoutParams.MATCH_PARENT;
                    lp.height = FrameLayout.LayoutParams.MATCH_PARENT;
                }
                lp.gravity = Gravity.CENTER;
                mVideoView.setLayoutParams(lp);
            } catch (Throwable ignored) {}
        }
    }

    private void openInExternalApp() {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            Uri uri;
            if (mUrlOrPath.startsWith("http://") || mUrlOrPath.startsWith("https://") || mUrlOrPath.startsWith("content://")) {
                uri = Uri.parse(mUrlOrPath);
            } else if (mUrlOrPath.startsWith("file://")) {
                uri = Uri.parse(mUrlOrPath);
            } else {
                uri = Uri.fromFile(new File(mUrlOrPath));
            }
            intent.setDataAndType(uri, mMimeType != null ? mMimeType : "video/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(Intent.createChooser(intent, "Play video with..."));
        } catch (Throwable t) {
            Log.e(TAG, "External player launch failed: " + t.getMessage(), t);
            Toast.makeText(this, "No external video player found", Toast.LENGTH_SHORT).show();
        }
    }

    private void toggleScreenLock() {
        mIsLocked = !mIsLocked;
        if (mIsLocked) {
            mLockBtn.setText("🔒");
            mHeaderLayout.setVisibility(View.GONE);
            mCenterControlsLayout.setVisibility(View.GONE);
            mSeekBar.setVisibility(View.GONE);
            mCurrentTimeText.setVisibility(View.GONE);
            mDurationText.setVisibility(View.GONE);
            showHud("🔒 Controls Locked");
            hideHud(1200);
            scheduleControlsHide(2500);
        } else {
            mLockBtn.setText("🔓");
            mSeekBar.setVisibility(View.VISIBLE);
            mCurrentTimeText.setVisibility(View.VISIBLE);
            mDurationText.setVisibility(View.VISIBLE);
            showHud("🔓 Controls Unlocked");
            hideHud(1200);
            showControls();
        }
    }

    private void showControls() {
        if (mIsLocked) return;
        mControlsVisible = true;
        mHeaderLayout.setVisibility(View.VISIBLE);
        mCenterControlsLayout.setVisibility(View.VISIBLE);
        mFooterLayout.setVisibility(View.VISIBLE);
        scheduleControlsHide(3500);
    }

    private void hideControls() {
        mControlsVisible = false;
        mHeaderLayout.setVisibility(View.GONE);
        mCenterControlsLayout.setVisibility(View.GONE);
        mFooterLayout.setVisibility(View.GONE);
        setImmersiveMode();
    }

    private void scheduleControlsHide(int delayMs) {
        mMainHandler.removeCallbacks(mHideControlsRunnable);
        if (delayMs > 0 && mVideoView != null && mVideoView.isPlaying()) {
            mMainHandler.postDelayed(mHideControlsRunnable, delayMs);
        }
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

    private String formatTime(int ms) {
        int totalSec = ms / 1000;
        int min = totalSec / 60;
        int sec = totalSec % 60;
        int hrs = min / 60;
        if (hrs > 0) {
            min = min % 60;
            return String.format(Locale.US, "%d:%02d:%02d", hrs, min, sec);
        }
        return String.format(Locale.US, "%02d:%02d", min, sec);
    }

    private int dpToPx(float dp) {
        return (int) TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, dp, getResources().getDisplayMetrics()
        );
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (mVideoView != null && mVideoView.isPlaying()) {
            mVideoView.pause();
        }
        mMainHandler.removeCallbacksAndMessages(null);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        mMainHandler.removeCallbacksAndMessages(null);
        if (mVideoView != null) {
            mVideoView.stopPlayback();
        }
    }
}
