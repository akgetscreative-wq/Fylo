package com.fylo.mobile;

import android.content.Context;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.MediaController;
import android.widget.ProgressBar;
import android.widget.VideoView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.common.MapBuilder;
import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;
import com.facebook.react.uimanager.events.RCTEventEmitter;

import java.io.File;
import java.util.Map;

public class FyloVideoViewManager extends SimpleViewManager<FyloVideoViewManager.FyloVideoLayout> {
    private static final String TAG = "FyloVideoViewManager";
    public static final String REACT_CLASS = "FyloVideoView";

    public static final String EVENT_LOAD = "topVideoLoad";
    public static final String EVENT_END = "topVideoEnd";
    public static final String EVENT_ERROR = "topVideoError";
    public static final String EVENT_PROGRESS = "topVideoProgress";

    @NonNull
    @Override
    public String getName() {
        return REACT_CLASS;
    }

    @NonNull
    @Override
    protected FyloVideoLayout createViewInstance(@NonNull ThemedReactContext reactContext) {
        return new FyloVideoLayout(reactContext);
    }

    @Override
    public void onDropViewInstance(@NonNull FyloVideoLayout view) {
        super.onDropViewInstance(view);
        view.cleanup();
    }

    @Nullable
    @Override
    public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
        return MapBuilder.<String, Object>builder()
            .put(EVENT_LOAD, MapBuilder.of("registrationName", "onVideoLoad"))
            .put(EVENT_END, MapBuilder.of("registrationName", "onVideoEnd"))
            .put(EVENT_ERROR, MapBuilder.of("registrationName", "onVideoError"))
            .put(EVENT_PROGRESS, MapBuilder.of("registrationName", "onVideoProgress"))
            .build();
    }

    @ReactProp(name = "source")
    public void setSource(FyloVideoLayout view, @Nullable String source) {
        view.setSource(source);
    }

    @ReactProp(name = "paused", defaultBoolean = false)
    public void setPaused(FyloVideoLayout view, boolean paused) {
        view.setPaused(paused);
    }

    @ReactProp(name = "controls", defaultBoolean = true)
    public void setControls(FyloVideoLayout view, boolean controls) {
        view.setControls(controls);
    }

    @ReactProp(name = "repeat", defaultBoolean = false)
    public void setRepeat(FyloVideoLayout view, boolean repeat) {
        view.setRepeat(repeat);
    }

    @ReactProp(name = "resizeMode")
    public void setResizeMode(FyloVideoLayout view, @Nullable String resizeMode) {
        view.setResizeMode(resizeMode);
    }

    @ReactProp(name = "muted", defaultBoolean = false)
    public void setMuted(FyloVideoLayout view, boolean muted) {
        view.setMuted(muted);
    }

    @ReactProp(name = "seek", defaultDouble = -1)
    public void setSeek(FyloVideoLayout view, double seekSeconds) {
        if (seekSeconds >= 0) {
            view.seekTo((int) (seekSeconds * 1000));
        }
    }

    @ReactProp(name = "speed", defaultFloat = 1.0f)
    public void setSpeed(FyloVideoLayout view, float speed) {
        view.setPlaybackSpeed(speed);
    }

    // =========================================================================
    // NATIVE VIDEO LAYOUT CONTAINER (Zero external npm libraries, 100% Native)
    // =========================================================================
    public static class FyloVideoLayout extends FrameLayout implements
            MediaPlayer.OnPreparedListener,
            MediaPlayer.OnCompletionListener,
            MediaPlayer.OnErrorListener {

        private final VideoView mVideoView;
        private final ProgressBar mProgressBar;
        private MediaController mMediaController;
        private MediaPlayer mMediaPlayer;

        private String mSource;
        private boolean mPaused = false;
        private boolean mControls = true;
        private boolean mRepeat = false;
        private boolean mMuted = false;
        private float mSpeed = 1.0f;
        private String mResizeMode = "contain";
        private boolean mIsPrepared = false;

        private final Handler mProgressHandler = new Handler(Looper.getMainLooper());
        private final Runnable mProgressRunnable = new Runnable() {
            @Override
            public void run() {
                if (mIsPrepared && mVideoView != null && mVideoView.isPlaying()) {
                    try {
                        int current = mVideoView.getCurrentPosition();
                        int duration = mVideoView.getDuration();
                        Context context = getContext();
                        if (context instanceof ThemedReactContext) {
                            ThemedReactContext reactContext = (ThemedReactContext) context;
                            WritableMap event = Arguments.createMap();
                            event.putDouble("currentTime", current > 0 ? current / 1000.0 : 0);
                            event.putDouble("duration", duration > 0 ? duration / 1000.0 : 0);
                            reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
                                getId(),
                                EVENT_PROGRESS,
                                event
                            );
                        }
                    } catch (Throwable ignored) {}
                }
                mProgressHandler.postDelayed(this, 250);
            }
        };

        public FyloVideoLayout(@NonNull Context context) {
            super(context);
            setBackgroundColor(Color.BLACK);

            mVideoView = new VideoView(context);
            FrameLayout.LayoutParams videoParams = new FrameLayout.LayoutParams(
                LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER
            );
            addView(mVideoView, videoParams);

            mProgressBar = new ProgressBar(context);
            mProgressBar.setIndeterminate(true);
            FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER
            );
            addView(mProgressBar, progressParams);

            mVideoView.setOnPreparedListener(this);
            mVideoView.setOnCompletionListener(this);
            mVideoView.setOnErrorListener(this);
        }

        // Fix for React Native measuring bug on custom view groups
        @Override
        public void requestLayout() {
            super.requestLayout();
            post(measureAndLayoutRunnable);
        }

        private final Runnable measureAndLayoutRunnable = new Runnable() {
            @Override
            public void run() {
                measure(
                    MeasureSpec.makeMeasureSpec(getWidth(), MeasureSpec.EXACTLY),
                    MeasureSpec.makeMeasureSpec(getHeight(), MeasureSpec.EXACTLY)
                );
                layout(getLeft(), getTop(), getRight(), getBottom());
            }
        };

        public void setSource(String source) {
            if (source == null || source.trim().isEmpty()) {
                cleanup();
                return;
            }
            if (source.equals(mSource) && mIsPrepared) {
                return;
            }
            mSource = source.trim();
            mIsPrepared = false;
            mProgressBar.setVisibility(View.VISIBLE);

            try {
                if (mSource.startsWith("http://") || mSource.startsWith("https://") || mSource.startsWith("content://")) {
                    mVideoView.setVideoURI(Uri.parse(mSource));
                } else if (mSource.startsWith("file://")) {
                    mVideoView.setVideoURI(Uri.parse(mSource));
                } else {
                    File file = new File(mSource);
                    if (file.exists()) {
                        mVideoView.setVideoPath(file.getAbsolutePath());
                    } else {
                        mVideoView.setVideoURI(Uri.parse(mSource));
                    }
                }
            } catch (Throwable t) {
                Log.e(TAG, "Error setting video source: " + t.getMessage(), t);
                onError(null, MediaPlayer.MEDIA_ERROR_UNKNOWN, -1);
            }
        }

        public void setPaused(boolean paused) {
            mPaused = paused;
            if (mIsPrepared) {
                if (mPaused) {
                    if (mVideoView.isPlaying()) {
                        mVideoView.pause();
                    }
                    mProgressHandler.removeCallbacks(mProgressRunnable);
                } else {
                    mVideoView.start();
                    mProgressHandler.post(mProgressRunnable);
                }
            }
        }

        public void setControls(boolean controls) {
            mControls = controls;
            updateMediaController();
        }

        public void setRepeat(boolean repeat) {
            mRepeat = repeat;
            if (mMediaPlayer != null) {
                try {
                    mMediaPlayer.setLooping(mRepeat);
                } catch (Throwable ignored) {}
            }
        }

        public void setMuted(boolean muted) {
            mMuted = muted;
            if (mMediaPlayer != null) {
                try {
                    float vol = mMuted ? 0.0f : 1.0f;
                    mMediaPlayer.setVolume(vol, vol);
                } catch (Throwable ignored) {}
            }
        }

        public void setPlaybackSpeed(float speed) {
            mSpeed = speed > 0 ? speed : 1.0f;
            if (mMediaPlayer != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    PlaybackParams params = mMediaPlayer.getPlaybackParams();
                    params.setSpeed(mSpeed);
                    mMediaPlayer.setPlaybackParams(params);
                } catch (Throwable t) {
                    Log.w(TAG, "Failed to set playback speed: " + t.getMessage());
                }
            }
        }

        public void setResizeMode(String resizeMode) {
            mResizeMode = resizeMode != null ? resizeMode : "contain";
            applyResizeMode();
        }

        private void applyResizeMode() {
            if (mVideoView != null && mMediaPlayer != null) {
                try {
                    int videoW = mMediaPlayer.getVideoWidth();
                    int videoH = mMediaPlayer.getVideoHeight();
                    int viewW = getWidth();
                    int viewH = getHeight();
                    if (videoW > 0 && videoH > 0 && viewW > 0 && viewH > 0) {
                        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) mVideoView.getLayoutParams();
                        if ("cover".equalsIgnoreCase(mResizeMode) || "fill".equalsIgnoreCase(mResizeMode)) {
                            float scaleX = (float) viewW / videoW;
                            float scaleY = (float) viewH / videoH;
                            float maxScale = Math.max(scaleX, scaleY);
                            lp.width = (int) (videoW * maxScale);
                            lp.height = (int) (videoH * maxScale);
                            lp.gravity = Gravity.CENTER;
                        } else {
                            lp.width = FrameLayout.LayoutParams.MATCH_PARENT;
                            lp.height = FrameLayout.LayoutParams.MATCH_PARENT;
                            lp.gravity = Gravity.CENTER;
                        }
                        mVideoView.setLayoutParams(lp);
                    }
                } catch (Throwable ignored) {}
            }
        }

        public void seekTo(int ms) {
            if (mIsPrepared && mVideoView != null) {
                try {
                    mVideoView.seekTo(ms);
                } catch (Throwable ignored) {}
            }
        }

        private void updateMediaController() {
            if (mControls) {
                if (mMediaController == null) {
                    mMediaController = new MediaController(getContext());
                    mMediaController.setAnchorView(this);
                }
                mVideoView.setMediaController(mMediaController);
            } else {
                mVideoView.setMediaController(null);
            }
        }

        @Override
        public void onPrepared(MediaPlayer mp) {
            mIsPrepared = true;
            mMediaPlayer = mp;
            mProgressBar.setVisibility(View.GONE);

            try {
                mp.setLooping(mRepeat);
                float vol = mMuted ? 0.0f : 1.0f;
                mp.setVolume(vol, vol);
                if (mSpeed != 1.0f && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PlaybackParams params = mp.getPlaybackParams();
                    params.setSpeed(mSpeed);
                    mp.setPlaybackParams(params);
                }
            } catch (Throwable ignored) {}

            updateMediaController();
            applyResizeMode();

            if (!mPaused) {
                mVideoView.start();
                mProgressHandler.post(mProgressRunnable);
            }

            // Dispatch topVideoLoad event to JS
            try {
                Context context = getContext();
                if (context instanceof ThemedReactContext) {
                    ThemedReactContext reactContext = (ThemedReactContext) context;
                    WritableMap event = Arguments.createMap();
                    event.putDouble("duration", mp.getDuration() > 0 ? mp.getDuration() / 1000.0 : 0);
                    WritableMap naturalSize = Arguments.createMap();
                    int w = mp.getVideoWidth();
                    int h = mp.getVideoHeight();
                    naturalSize.putInt("width", w);
                    naturalSize.putInt("height", h);
                    naturalSize.putString("orientation", w >= h ? "landscape" : "portrait");
                    event.putMap("naturalSize", naturalSize);
                    event.putDouble("currentTime", 0);

                    reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
                        getId(),
                        EVENT_LOAD,
                        event
                    );
                }
            } catch (Throwable t) {
                Log.w(TAG, "Error emitting onVideoLoad: " + t.getMessage());
            }
        }

        @Override
        public void onCompletion(MediaPlayer mp) {
            mProgressBar.setVisibility(View.GONE);
            mProgressHandler.removeCallbacks(mProgressRunnable);

            // Dispatch topVideoEnd event to JS
            try {
                Context context = getContext();
                if (context instanceof ThemedReactContext) {
                    ThemedReactContext reactContext = (ThemedReactContext) context;
                    WritableMap event = Arguments.createMap();
                    reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
                        getId(),
                        EVENT_END,
                        event
                    );
                }
            } catch (Throwable t) {
                Log.w(TAG, "Error emitting onVideoEnd: " + t.getMessage());
            }

            if (mRepeat) {
                mVideoView.start();
                mProgressHandler.post(mProgressRunnable);
            }
        }

        @Override
        public boolean onError(MediaPlayer mp, int what, int extra) {
            mProgressBar.setVisibility(View.GONE);
            mProgressHandler.removeCallbacks(mProgressRunnable);
            Log.e(TAG, "VideoView playback error: what=" + what + ", extra=" + extra);

            // Dispatch topVideoError event to JS
            try {
                Context context = getContext();
                if (context instanceof ThemedReactContext) {
                    ThemedReactContext reactContext = (ThemedReactContext) context;
                    WritableMap event = Arguments.createMap();
                    event.putString("error", "Video playback failed (code " + what + ", extra " + extra + ")");
                    reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
                        getId(),
                        EVENT_ERROR,
                        event
                    );
                }
            } catch (Throwable t) {
                Log.w(TAG, "Error emitting onVideoError: " + t.getMessage());
            }

            return true; // Error handled
        }

        public void cleanup() {
            try {
                mProgressHandler.removeCallbacks(mProgressRunnable);
                mIsPrepared = false;
                if (mVideoView != null) {
                    mVideoView.stopPlayback();
                    mVideoView.setOnPreparedListener(null);
                    mVideoView.setOnCompletionListener(null);
                    mVideoView.setOnErrorListener(null);
                }
                if (mMediaController != null) {
                    mMediaController.hide();
                    mMediaController = null;
                }
                mMediaPlayer = null;
            } catch (Throwable t) {
                Log.w(TAG, "Error in cleanup: " + t.getMessage());
            }
        }
    }
}
