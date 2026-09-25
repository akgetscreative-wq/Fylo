package com.fylo.mobile;

import android.app.Application;
import android.content.Context;
import android.util.Log;

import com.facebook.react.JSEngineResolutionAlgorithm;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.ReactNativeHost;
import com.facebook.react.ReactPackage;
import com.facebook.react.defaults.DefaultReactHost;
import com.facebook.react.defaults.DefaultReactNativeHost;
import com.facebook.react.shell.MainReactPackage;
import com.facebook.soloader.SoLoader;

import java.util.ArrayList;
import java.util.List;

public class MainApplication extends Application implements ReactApplication {
    private static final String TAG = "MainApplication";

    private final ReactNativeHost mReactNativeHost = new DefaultReactNativeHost(this) {
        @Override
        public boolean getUseDeveloperSupport() {
            return false;
        }

        @Override
        protected List<ReactPackage> getPackages() {
            List<ReactPackage> packages = new ArrayList<>();
            packages.add(new MainReactPackage());
            packages.add(new FyloPackage());
            return packages;
        }

        @Override
        protected String getJSMainModuleName() {
            return "index";
        }

        @Override
        protected boolean isNewArchEnabled() {
            return false;
        }

        @Override
        protected Boolean isHermesEnabled() {
            return true;
        }

        @Override
        protected JSEngineResolutionAlgorithm getJSEngineResolutionAlgorithm() {
            return JSEngineResolutionAlgorithm.HERMES;
        }
    };

    @Override
    public ReactNativeHost getReactNativeHost() {
        return mReactNativeHost;
    }

    @Override
    public ReactHost getReactHost() {
        return DefaultReactHost.getDefaultReactHost(getApplicationContext(), mReactNativeHost);
    }

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        try {
            CrashHandler.install(this);
        } catch (Throwable t) {
            Log.e(TAG, "Failed to install CrashHandler in attachBaseContext: " + t.getMessage());
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            CrashHandler.install(this);
        } catch (Throwable t) {
            Log.e(TAG, "Failed to install CrashHandler in onCreate: " + t.getMessage());
        }

        try {
            SoLoader.init(this, false);
        } catch (Throwable t) {
            Log.e(TAG, "SoLoader.init failed: " + t.getMessage(), t);
        }
    }
}
