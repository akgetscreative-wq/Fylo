# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# React Native proguard rules
-keep public class com.facebook.react.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.fylo.mobile.** { *; }
