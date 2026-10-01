import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Switch,
  TextInput,
  Modal,
  NativeModules,
  Platform,
  Image,
  Dimensions,
  ActivityIndicator,
  AppState,
  BackHandler,
  PanResponder,
  DeviceEventEmitter,
  Alert,
  Animated,
  requireNativeComponent,
} from 'react-native';

const { FyloModule } = NativeModules;
const FyloVideoView = Platform.OS === 'android' ? requireNativeComponent('FyloVideoView') : null;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const formatDuration = (sec) => {
  if (!sec || isNaN(sec) || sec <= 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
};

// Persistent Key-Value Storage helper (AsyncStorage compatible API backed by native SharedPreferences)
const _memoryStorage = {};
const AsyncStorage = {
  getItem: async (key) => {
    try {
      if (FyloModule && FyloModule.getSetting) {
        const val = await FyloModule.getSetting(key);
        if (val !== null && val !== undefined) return val;
      }
    } catch (e) {}
    return _memoryStorage[key] !== undefined ? _memoryStorage[key] : null;
  },
  setItem: async (key, val) => {
    const str = String(val);
    _memoryStorage[key] = str;
    try {
      if (FyloModule && FyloModule.setSetting) {
        await FyloModule.setSetting(key, str);
      }
    } catch (e) {}
  },
  removeItem: async (key) => {
    delete _memoryStorage[key];
    try {
      if (FyloModule && FyloModule.removeSetting) {
        await FyloModule.removeSetting(key);
      }
    } catch (e) {}
  },
};

// Robust AbortController-wrapped fetch helper to prevent socket hanging and unhandled rejections
const apiFetch = async (url, options = {}, timeoutMs = 6000) => {
  const AC = typeof global !== 'undefined' && global.AbortController ? global.AbortController : null;
  const controller = AC ? new AC() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const fetchOptions = controller ? { ...options, signal: controller.signal } : { ...options };
    const res = await fetch(url, fetchOptions);
    if (timeoutId) clearTimeout(timeoutId);
    return res;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    throw err;
  }
};

// Safe JSON parser that never throws SyntaxError on non-JSON HTML error responses
const safeJson = async (res) => {
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// Robust SafeImage component with onError fallback handler to prevent corrupt image crashes
const SafeImage = ({ source, style, resizeMode, fallbackText, fallbackEmoji }) => {
  const [hasError, setHasError] = useState(false);
  const uri = source?.uri;
  const prevUriRef = useRef(uri);

  useEffect(() => {
    if (prevUriRef.current !== uri) {
      prevUriRef.current = uri;
      setHasError(false);
    }
  }, [uri]);

  const displayFallback = fallbackText !== undefined ? fallbackText : (fallbackEmoji !== undefined ? fallbackEmoji : '');

  if (hasError || !uri) {
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)' }]}>
        {displayFallback ? (
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748b', letterSpacing: 0.5 }}>{displayFallback}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <Image
      source={source}
      style={style}
      resizeMode={resizeMode}
      onError={() => setHasError(true)}
    />
  );
};

// Dedicated VideoThumbnail component that extracts native video frame thumbnails
const VideoThumbnail = React.memo(({ path, isPc, pairedPc, pcAuthToken, serverPort }) => {
  const [thumbUri, setThumbUri] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchThumbnail = async () => {
      // For remote PC video files, do NOT download or fetch multi-gigabyte video frames across Wi-Fi for thumbnails!
      // This eliminates network saturation, lag, and crashing when loading folders with large videos.
      if (isPc) {
        return;
      }
      try {
        if (FyloModule && FyloModule.getVideoThumbnail) {
          const target = isPc
            ? `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(path || '')}`
            : (path || '');
          const uri = await FyloModule.getVideoThumbnail(target, pcAuthToken || '');
          if (isMounted && uri) {
            setThumbUri(uri);
            return;
          }
        }
      } catch (e) {}

      // Fallback for phone files: query local HTTP server
      if (!isPc && isMounted && path) {
        const httpUri = `http://127.0.0.1:${serverPort || 8080}/api/fs/thumbnail?path=${encodeURIComponent(path)}${pcAuthToken ? `&auth=${pcAuthToken}` : ''}`;
        setThumbUri(httpUri);
      }
    };

    fetchThumbnail();
    return () => {
      isMounted = false;
    };
  }, [path, isPc, pairedPc, pcAuthToken, serverPort]);

  return (
    <View style={styles.gridVideoThumbWrap}>
      {thumbUri ? (
        <SafeImage
          source={{ uri: thumbUri }}
          style={{ width: '100%', height: '100%', borderRadius: 8 }}
          resizeMode="cover"
          fallbackText=""
        />
      ) : (
        <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(37, 99, 235, 0.12)' }}>
          <Text style={{ fontSize: 18, color: '#38bdf8' }}>▶</Text>
        </View>
      )}
      <View style={styles.gridVideoPlayBadge}>
        <Text style={styles.gridVideoPlayBadgeIcon}>▶</Text>
      </View>
    </View>
  );
});

// Authentic Windows 11 Yellow Folder Vector Icon
const Win11FolderIcon = ({ size = 28 }) => {
  const scale = size / 28;
  return (
    <View style={[styles.win11FolderWrap, { width: 30 * scale, height: 26 * scale }]}>
      <View style={[styles.win11FolderBackTab, { width: 13 * scale, height: 6 * scale }]} />
      <View style={[styles.win11FolderBack, { width: 30 * scale, height: 20 * scale }]} />
      <View style={[styles.win11FolderFront, { width: 30 * scale, height: 15 * scale }]} />
    </View>
  );
};

// =========================================================
// ALPINE NATURE & SCENIC VECTOR ARTWORK (Image 2 & 3 Vision)
// Pure React Native Views: Zero external image assets, zero bloat, sharp scaling
// =========================================================

// 1. Scalable Vector Conifer Pine Tree
const PineTree = React.memo(({ scale = 1, color = '#1A5C4A', trunkColor = '#5C4033', style }) => (
  <View style={[{ alignItems: 'center', width: 22 * scale }, style]} pointerEvents="none">
    <View style={{
      width: 0, height: 0,
      borderLeftWidth: 6 * scale,
      borderRightWidth: 6 * scale,
      borderBottomWidth: 10 * scale,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderBottomColor: color,
    }} />
    <View style={{
      width: 0, height: 0,
      borderLeftWidth: 8 * scale,
      borderRightWidth: 8 * scale,
      borderBottomWidth: 12 * scale,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderBottomColor: color,
      marginTop: -5 * scale,
    }} />
    <View style={{
      width: 0, height: 0,
      borderLeftWidth: 10 * scale,
      borderRightWidth: 10 * scale,
      borderBottomWidth: 14 * scale,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderBottomColor: color,
      marginTop: -6 * scale,
    }} />
    <View style={{ width: 3 * scale, height: 4 * scale, backgroundColor: trunkColor }} />
  </View>
));

// 2. Flying Bird Silhouette
const FlyingBird = React.memo(({ scale = 1, style, color = '#3D5A54' }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'flex-end', height: 6 * scale }, style]} pointerEvents="none">
    <View style={{
      width: 6 * scale, height: 4 * scale,
      borderTopWidth: 1.5 * scale,
      borderRightWidth: 1.5 * scale,
      borderColor: color,
      borderTopRightRadius: 5 * scale,
      transform: [{ rotate: '-15deg' }]
    }} />
    <View style={{
      width: 6 * scale, height: 4 * scale,
      borderTopWidth: 1.5 * scale,
      borderLeftWidth: 1.5 * scale,
      borderColor: color,
      borderTopLeftRadius: 5 * scale,
      transform: [{ rotate: '15deg' }],
      marginLeft: -1
    }} />
  </View>
));

// 3. Alpine Sunrise Landscape for Hero Card (Matching Image 3)
const AlpineSunriseLandscape = React.memo(({ isDark = false }) => {
  const sunColor = isDark ? '#E2E8F0' : '#F59E0B';
  const sunGlow = isDark ? 'rgba(226, 232, 240, 0.15)' : 'rgba(245, 158, 11, 0.22)';
  const mountainFar = isDark ? '#1E293B' : '#7CB3A9';
  const mountainMid = isDark ? '#132A26' : '#457B70';
  const mountainNear = isDark ? '#0D201D' : '#2D5E54';
  const pineGreen = isDark ? '#081715' : '#1A4D43';

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Sky subtle gradient / warm wash */}
      <View style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 95,
        backgroundColor: isDark ? 'transparent' : 'rgba(254, 243, 199, 0.45)',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
      }} />

      {/* Radiant Sunrise Sun */}
      <View style={{
        position: 'absolute', top: 12, right: 88,
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: sunGlow,
        alignItems: 'center', justifyContent: 'center'
      }}>
        <View style={{
          width: 24, height: 24, borderRadius: 12,
          backgroundColor: sunColor,
          shadowColor: sunColor, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4
        }} />
      </View>

      {/* Birds soaring in sky */}
      <FlyingBird scale={0.9} color={isDark ? '#64748b' : '#6B8E87'} style={{ position: 'absolute', top: 20, right: 148 }} />
      <FlyingBird scale={0.7} color={isDark ? '#475569' : '#88A9A3'} style={{ position: 'absolute', top: 30, right: 172 }} />
      <FlyingBird scale={0.6} color={isDark ? '#334155' : '#99B7B1'} style={{ position: 'absolute', top: 24, right: 194 }} />

      {/* Mountain Ridge 1 (Far peaks) */}
      <View style={{
        position: 'absolute', top: 28, right: 0, width: 220, height: 80,
        backgroundColor: mountainFar,
        borderTopLeftRadius: 100, borderTopRightRadius: 60,
        transform: [{ rotate: '-8deg' }, { scaleX: 1.2 }],
        opacity: 0.75
      }} />

      {/* Mountain Ridge 2 (Mid ridge) */}
      <View style={{
        position: 'absolute', top: 44, right: -20, width: 260, height: 90,
        backgroundColor: mountainMid,
        borderTopLeftRadius: 130, borderTopRightRadius: 90,
        transform: [{ rotate: '4deg' }],
        opacity: 0.85
      }} />

      {/* Mountain Ridge 3 (Near ridge / hill) */}
      <View style={{
        position: 'absolute', top: 62, left: -20, right: -20, height: 100,
        backgroundColor: mountainNear,
        borderTopLeftRadius: 160, borderTopRightRadius: 140,
        transform: [{ rotate: '-2deg' }]
      }} />

      {/* Pine Tree Forest Along the Right Ridge */}
      <View style={{ position: 'absolute', top: 38, right: 14, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        <PineTree scale={0.7} color={pineGreen} />
        <PineTree scale={0.95} color={pineGreen} />
        <PineTree scale={0.75} color={pineGreen} />
        <PineTree scale={1.15} color={pineGreen} />
        <PineTree scale={0.85} color={pineGreen} />
        <PineTree scale={0.65} color={pineGreen} />
      </View>

      {/* Soft Bottom Mist Veil */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 50,
        backgroundColor: isDark ? 'rgba(13, 32, 29, 0.4)' : 'rgba(247, 246, 242, 0.55)',
        borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
      }} />
    </View>
  );
});

// Backward-compatible alias
const HeroDeskIllustration = AlpineSunriseLandscape;

// 4. Meadow Monitor Scene for "Browse PC" (Matching Image 3)
const MeadowMonitorScene = React.memo(({ isDark = false }) => {
  const hillFar = isDark ? '#132A26' : '#A7D7C5';
  const hillNear = isDark ? '#0D201D' : '#68A89A';
  const pineGreen = isDark ? '#081715' : '#1A4D43';

  return (
    <View style={{ width: 85, height: 75, position: 'relative', overflow: 'hidden', borderRadius: 14 }} pointerEvents="none">
      {/* Meadow Hills */}
      <View style={{
        position: 'absolute', bottom: -10, left: -20, width: 120, height: 55,
        backgroundColor: hillFar,
        borderRadius: 50, transform: [{ rotate: '-12deg' }], opacity: 0.6
      }} />
      <View style={{
        position: 'absolute', bottom: -18, right: -15, width: 110, height: 55,
        backgroundColor: hillNear,
        borderRadius: 50, transform: [{ rotate: '10deg' }]
      }} />

      {/* Small Pine Conifers */}
      <View style={{ position: 'absolute', bottom: 12, left: 4, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
        <PineTree scale={0.55} color={pineGreen} />
        <PineTree scale={0.7} color={pineGreen} />
      </View>

      {/* Desktop PC Monitor Standing in Meadow */}
      <View style={{ position: 'absolute', top: 6, right: 8, alignItems: 'center' }}>
        <View style={{
          width: 52, height: 36, borderRadius: 5,
          backgroundColor: isDark ? '#0F172A' : '#1A4D43',
          padding: 2, borderWidth: 1.2, borderColor: isDark ? '#334155' : '#457B70',
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, elevation: 3
        }}>
          <View style={{
            flex: 1, borderRadius: 3.5, backgroundColor: isDark ? '#1E293B' : '#E6F4F1',
            alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
          }}>
            {/* Screen wallpaper landscape preview */}
            <View style={{
              position: 'absolute', bottom: -5, left: -5, right: -5, height: 16,
              backgroundColor: isDark ? '#064E3B' : '#68A89A', borderRadius: 8
            }} />
            <View style={{
              width: 12, height: 12, borderRadius: 6,
              backgroundColor: isDark ? '#10B981' : '#1A4D43', opacity: 0.85
            }} />
          </View>
        </View>
        <View style={{ width: 6, height: 7, backgroundColor: isDark ? '#334155' : '#457B70' }} />
        <View style={{ width: 22, height: 2.5, borderRadius: 1.5, backgroundColor: isDark ? '#475569' : '#2D5E54' }} />
      </View>
    </View>
  );
});

// Backward-compatible alias
const PcMonitorIllustration = MeadowMonitorScene;

// 5. Golden Ridge Phone Scene for "Browse Phone" (Matching Image 3)
const RidgePhoneScene = React.memo(({ isDark = false }) => {
  const duneFar = isDark ? '#271F15' : '#FDE68A';
  const duneNear = isDark ? '#382A18' : '#F59E0B';
  const pineAmber = isDark ? '#1F170D' : '#B45309';

  return (
    <View style={{ width: 85, height: 75, position: 'relative', overflow: 'hidden', borderRadius: 14 }} pointerEvents="none">
      {/* Amber Dunes / Alpine Ridge */}
      <View style={{
        position: 'absolute', bottom: -12, left: -15, width: 110, height: 50,
        backgroundColor: duneFar,
        borderRadius: 45, transform: [{ rotate: '-8deg' }], opacity: 0.7
      }} />
      <View style={{
        position: 'absolute', bottom: -16, right: -15, width: 115, height: 52,
        backgroundColor: duneNear,
        borderRadius: 45, transform: [{ rotate: '12deg' }]
      }} />

      {/* Pine Trees along Ridge */}
      <View style={{ position: 'absolute', bottom: 10, left: 6, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
        <PineTree scale={0.5} color={pineAmber} />
        <PineTree scale={0.65} color={pineAmber} />
        <PineTree scale={0.45} color={pineAmber} />
      </View>

      {/* Modern Bezel-less Smartphone Standing on Ridge */}
      <View style={{
        position: 'absolute', top: 4, right: 12,
        width: 32, height: 56, borderRadius: 7,
        backgroundColor: isDark ? '#0F172A' : '#78350F',
        padding: 1.5, borderWidth: 1, borderColor: isDark ? '#334155' : '#D97706',
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, elevation: 3
      }}>
        <View style={{
          flex: 1, borderRadius: 5, backgroundColor: isDark ? '#1E293B' : '#FEF3C7',
          overflow: 'hidden', position: 'relative'
        }}>
          {/* Wallpaper with warm mountain ridge */}
          <View style={{
            position: 'absolute', bottom: -6, left: -5, right: -5, height: 24,
            backgroundColor: isDark ? '#78350F' : '#F59E0B', borderRadius: 10
          }} />
          <View style={{
            position: 'absolute', top: 6, right: 5, width: 10, height: 10,
            borderRadius: 5, backgroundColor: isDark ? '#D97706' : '#FBBF24', opacity: 0.9
          }} />
        </View>
      </View>
    </View>
  );
});

// Backward-compatible alias
const PhoneIllustration = RidgePhoneScene;

// 6. Send Files Background Landscape (Matching Image 3)
const SendFilesLandscape = React.memo(({ isDark = false }) => (
  <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
    <View style={{
      position: 'absolute', bottom: -10, left: -20, right: -20, height: 45,
      backgroundColor: isDark ? 'rgba(19, 42, 38, 0.5)' : '#D1FAE5',
      borderRadius: 40, transform: [{ rotate: '-1.5deg' }], opacity: 0.65
    }} />
    <View style={{ position: 'absolute', bottom: 12, right: 30, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      <PineTree scale={0.6} color={isDark ? '#0D201D' : '#1A4D43'} />
      <PineTree scale={0.8} color={isDark ? '#0D201D' : '#1A4D43'} />
      <PineTree scale={0.5} color={isDark ? '#0D201D' : '#1A4D43'} />
    </View>
  </View>
));

// 7. Bottom Canvas Framing (Trees and hills framing the screen bottom)
const BottomCanvasLandscape = React.memo(({ isDark = false }) => (
  <View style={{ height: 42, marginTop: 12, position: 'relative', overflow: 'hidden' }} pointerEvents="none">
    <View style={{
      position: 'absolute', bottom: -20, left: -30, width: 220, height: 60,
      backgroundColor: isDark ? '#0D201D' : '#A7D7C5',
      borderRadius: 70, opacity: 0.45
    }} />
    <View style={{
      position: 'absolute', bottom: -24, right: -30, width: 220, height: 60,
      backgroundColor: isDark ? '#132A26' : '#68A89A',
      borderRadius: 70, opacity: 0.45
    }} />
    <View style={{ position: 'absolute', bottom: 2, right: 16, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      <PineTree scale={0.65} color={isDark ? '#081715' : '#1A4D43'} />
      <PineTree scale={0.85} color={isDark ? '#081715' : '#1A4D43'} />
      <PineTree scale={0.55} color={isDark ? '#081715' : '#1A4D43'} />
    </View>
    <View style={{ position: 'absolute', bottom: 2, left: 16, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      <PineTree scale={0.6} color={isDark ? '#081715' : '#1A4D43'} />
      <PineTree scale={0.8} color={isDark ? '#081715' : '#1A4D43'} />
    </View>
  </View>
));

// Aesthetic Vector Icons for premium UI look (No cheap OS emojis!)
const VectorHomeIcon = React.memo(({ size = 18, color = '#3b82f6' }) => (
  <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ fontSize: size * 0.95, color, fontWeight: '900', lineHeight: size }}>⌂</Text>
  </View>
));

const VectorMonitorIcon = React.memo(({ size = 18, color = '#38bdf8' }) => {
  const w = size;
  const h = size * 0.72;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: w,
          height: h,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: w * 0.4, height: 1, backgroundColor: color, opacity: 0.6 }} />
      </View>
      <View style={{ width: 2, height: 2.5, backgroundColor: color }} />
      <View style={{ width: w * 0.55, height: 1.5, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
});

const VectorPhoneIcon = React.memo(({ size = 18, color = '#10b981' }) => {
  const w = size * 0.62;
  const h = size;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: w,
          height: h,
          borderRadius: 4,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 2,
        }}>
        <View style={{ width: w * 0.35, height: 1.2, borderRadius: 1, backgroundColor: color }} />
        <View style={{ width: w * 0.45, height: 1.2, borderRadius: 1, backgroundColor: color }} />
      </View>
    </View>
  );
});

const VectorLightningIcon = React.memo(({ size = 18, color = '#f59e0b' }) => (
  <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ fontSize: size * 0.95, color, fontWeight: '900', lineHeight: size, textAlign: 'center' }}>⚡</Text>
  </View>
));

const VectorClipboardIcon = React.memo(({ size = 18, color = '#a855f7' }) => {
  const w = size * 0.72;
  const h = size * 0.9;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: w * 0.45,
          height: 3,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          backgroundColor: color,
          zIndex: 2,
          marginBottom: -1.5,
        }}
      />
      <View
        style={{
          width: w,
          height: h,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          paddingTop: 3,
          paddingHorizontal: 2,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}>
        <View style={{ width: '70%', height: 1, backgroundColor: color, opacity: 0.7 }} />
        <View style={{ width: '50%', height: 1, backgroundColor: color, opacity: 0.7 }} />
      </View>
    </View>
  );
});

const VectorShareHubIcon = React.memo(({ size = 18, color = '#60a5fa' }) => (
  <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ fontSize: size * 0.9, color, fontWeight: '900', lineHeight: size }}>⇄</Text>
  </View>
));

// Floating Bottom Navigation Bar (Modern floating capsule tabs for quick navigation)
const FloatingBottomTabBar = React.memo(({ currentTab, setCurrentTab, isDark = false, pairedPc = null }) => {
  const tabs = [
    { id: 'home', label: 'Home', renderIcon: (c) => <VectorHomeIcon size={17} color={c} /> },
    { id: 'sharehub', label: 'ShareHub', renderIcon: (c) => <VectorShareHubIcon size={17} color={c} /> },
    { id: 'pc-explorer', label: 'PC', renderIcon: (c) => <VectorMonitorIcon size={17} color={c} /> },
    { id: 'phone-explorer', label: 'Phone', renderIcon: (c) => <VectorPhoneIcon size={17} color={c} /> },
    { id: 'clipboard', label: 'Clip', renderIcon: (c) => <VectorClipboardIcon size={17} color={c} /> },
    { id: 'transfer', label: 'Transfers', renderIcon: (c) => <VectorLightningIcon size={17} color={c} /> },
  ];

  return (
    <View style={{
      position: 'absolute',
      bottom: Platform.OS === 'android' ? 22 : 16,
      left: 14,
      right: 14,
      backgroundColor: isDark ? 'rgba(10, 10, 10, 0.96)' : 'rgba(255, 255, 255, 0.97)',
      borderRadius: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      paddingVertical: 6,
      paddingHorizontal: 6,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(37, 99, 235, 0.3)' : 'rgba(37, 99, 235, 0.2)',
      shadowColor: '#2563eb',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.45 : 0.16,
      shadowRadius: 12,
      elevation: 10,
      zIndex: 1000,
    }}>
      {tabs.map((t) => {
        const isActive = currentTab === t.id;
        const iconColor = isActive
          ? (isDark ? '#93c5fd' : '#ffffff')
          : (isDark ? '#64748b' : '#64748b');
        return (
          <TouchableOpacity
            key={t.id}
            activeOpacity={0.75}
            onPress={() => setCurrentTab(t.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 7,
              paddingHorizontal: isActive ? 11 : 7,
              borderRadius: 24,
              backgroundColor: isActive
                ? (isDark ? 'rgba(37, 99, 235, 0.3)' : '#2563eb')
                : 'transparent',
            }}>
            <View style={{ marginRight: isActive ? 4 : 0 }}>
              {t.renderIcon(iconColor)}
            </View>
            {isActive && (
              <Text style={{
                fontSize: 11.5,
                fontWeight: '800',
                color: isDark ? '#93c5fd' : '#ffffff',
              }}>
                {t.label}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
});


// Clean Vector File Badge Icon (Replaces random emojis with professional type badges)
const FileBadgeIcon = ({ ext, isDir, size = 28 }) => {
  if (isDir) {
    return <Win11FolderIcon size={size} />;
  }
  const e = (ext || '').toLowerCase();
  let badgeColor = '#3b82f6'; // default blue
  let label = (e || 'FILE').toUpperCase().substring(0, 4);

  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'bmp', 'svg'].includes(e)) {
    badgeColor = '#0ea5e9'; // sky cyan
    label = 'IMG';
  } else if (['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', '3gp'].includes(e)) {
    badgeColor = '#8b5cf6'; // violet
    label = 'VID';
  } else if (['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'].includes(e)) {
    badgeColor = '#06b6d4'; // cyan
    label = 'AUD';
  } else if (e === 'pdf') {
    badgeColor = '#ef4444'; // red
    label = 'PDF';
  } else if (['doc', 'docx', 'txt', 'rtf', 'md'].includes(e)) {
    badgeColor = '#2563eb'; // blue
    label = e === 'md' ? 'MD' : 'DOC';
  } else if (['xls', 'xlsx', 'csv'].includes(e)) {
    badgeColor = '#10b981'; // emerald green
    label = 'XLS';
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) {
    badgeColor = '#f59e0b'; // amber
    label = 'ZIP';
  } else if (e === 'apk') {
    badgeColor = '#10b981'; // green
    label = 'APK';
  } else if (['exe', 'msi', 'bat', 'cmd'].includes(e)) {
    badgeColor = '#64748b'; // slate
    label = 'EXE';
  }

  const scale = size / 28;
  return (
    <View style={{
      width: 30 * scale,
      height: 34 * scale,
      borderRadius: 6 * scale,
      backgroundColor: badgeColor + '18',
      borderColor: badgeColor + '55',
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    }}>
      <View style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 9 * scale,
        height: 9 * scale,
        backgroundColor: badgeColor + '35',
        borderBottomLeftRadius: 5 * scale,
        borderTopRightRadius: 5 * scale,
      }} />
      <Text style={{
        fontSize: Math.max(8, 8.5 * scale),
        fontWeight: '800',
        color: badgeColor,
        letterSpacing: 0.3,
      }}>
        {label}
      </Text>
    </View>
  );
};

// Sleek 3-Line Vector Hamburger Icon
const VectorHamburger = ({ isDark }) => (
  <View style={{ width: 20, height: 16, justifyContent: 'space-between', paddingVertical: 1 }}>
    <View style={{ height: 2, width: 20, borderRadius: 1, backgroundColor: isDark ? '#f1f5f9' : '#0f172a' }} />
    <View style={{ height: 2, width: 14, borderRadius: 1, backgroundColor: '#2563eb' }} />
    <View style={{ height: 2, width: 18, borderRadius: 1, backgroundColor: isDark ? '#f1f5f9' : '#0f172a' }} />
  </View>
);

// Sleek Minimalist Vector Search Icon
const SearchVectorIcon = ({ color = '#64748b' }) => (
  <View style={{ width: 15, height: 15, marginRight: 6, position: 'relative', justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1.6, borderColor: color }} />
    <View style={{ position: 'absolute', bottom: 1, right: 1, width: 5, height: 1.6, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
  </View>
);



// File sorting helper:
// When sorting by latest/oldest, files that are more recent than folders appear at the top!
const sortExplorerItems = (items, sortBy = 'latest') => {
  if (!Array.isArray(items)) return [];

  // Date descending (latest first): newest items at the top across all files & folders
  if (sortBy === 'latest' || sortBy === 'date-desc') {
    return [...items].filter(Boolean).sort((a, b) => {
      const aTime = typeof a.modified === 'number' ? a.modified : (Number(a.modified || a.mtime || 0) || 0);
      const bTime = typeof b.modified === 'number' ? b.modified : (Number(b.modified || b.mtime || 0) || 0);
      if (bTime !== aTime) return bTime - aTime;
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  // Date ascending (oldest first): oldest items at the top across all files & folders
  if (sortBy === 'oldest' || sortBy === 'date-asc') {
    return [...items].filter(Boolean).sort((a, b) => {
      const aTime = typeof a.modified === 'number' ? a.modified : (Number(a.modified || a.mtime || 0) || 0);
      const bTime = typeof b.modified === 'number' ? b.modified : (Number(b.modified || b.mtime || 0) || 0);
      if (bTime !== aTime) return aTime - bTime;
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  // For name, size, type etc., group folders first then files
  const folders = [];
  const files = [];
  for (const item of items) {
    if (!item) continue;
    if (item.isDir) folders.push(item);
    else files.push(item);
  }

  const comparator = (a, b) => {
    if (sortBy === 'name' || sortBy === 'name-asc') {
      return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true });
    } else if (sortBy === 'name-desc') {
      return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base', numeric: true });
    } else if (sortBy === 'size' || sortBy === 'size-desc') {
      const aSize = typeof a.size === 'number' ? a.size : 0;
      const bSize = typeof b.size === 'number' ? b.size : 0;
      if (bSize !== aSize) return bSize - aSize;
      return (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'size-asc') {
      const aSize = typeof a.size === 'number' ? a.size : 0;
      const bSize = typeof b.size === 'number' ? b.size : 0;
      if (bSize !== aSize) return aSize - bSize;
      return (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'type' || sortBy === 'type-asc' || sortBy === 'ext') {
      const extA = (a.ext || (a.name || '').split('.').pop() || '').toLowerCase();
      const extB = (b.ext || (b.name || '').split('.').pop() || '').toLowerCase();
      const cmp = extA.localeCompare(extB);
      if (cmp !== 0) return cmp;
      return (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'type-desc') {
      const extA = (a.ext || (a.name || '').split('.').pop() || '').toLowerCase();
      const extB = (b.ext || (b.name || '').split('.').pop() || '').toLowerCase();
      const cmp = extB.localeCompare(extA);
      if (cmp !== 0) return cmp;
      return (a.name || '').localeCompare(b.name || '');
    }
    return 0;
  };

  folders.sort(comparator);
  files.sort(comparator);

  return [...folders, ...files];
};

export default function App() {
  // Navigation: 'home' | 'phone-explorer' | 'pc-explorer' | 'clipboard' | 'transfer'
  const [currentTab, setCurrentTab] = useState('home');

  // Server & Connection State
  const [serverRunning, setServerRunning] = useState(false);
  const [deviceIp, setDeviceIp] = useState('Detecting...');
  const [serverPort, setServerPort] = useState(8080);
  const [hasPermission, setHasPermission] = useState(false);
  const [readOnlyMode, setReadOnlyMode] = useState(true);
  const [allowFullPhoneAccess, setAllowFullPhoneAccess] = useState(null); // null (undecided) | true | false
  const [showStorageAccessPrompt, setShowStorageAccessPrompt] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const showStorageAccessPromptRef = useRef(showStorageAccessPrompt);
  showStorageAccessPromptRef.current = showStorageAccessPrompt;
  const showSettingsModalRef = useRef(showSettingsModal);
  showSettingsModalRef.current = showSettingsModal;
  const [pairedPc, setPairedPc] = useState(null); // '192.168.1.10:3000'
  const [pcHostName, setPcHostName] = useState('');
  const [pcAuthToken, setPcAuthToken] = useState('');
  const [pingLatency, setPingLatency] = useState(null); // Real measured latency in ms
  const [isPcReachable, setIsPcReachable] = useState(false); // True only when heartbeat succeeds
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairModalTab, setPairModalTab] = useState('auto'); // 'auto' | 'qr' | 'manual'
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [transferProgress, setTransferProgress] = useState(null); // { fileName, percent, transferred, total }
  const lastBackPressTimeRef = useRef(0);
  const [qrInputText, setQrInputText] = useState('');
  const [manualPcIp, setManualPcIp] = useState('');
  const [manualAuthToken, setManualAuthToken] = useState('');
  const [logs, setLogs] = useState([]);
  const [storageInfo, setStorageInfo] = useState({ totalGB: '--', freeGB: '--' });
  const [batteryLevel, setBatteryLevel] = useState(null);
  const [phoneModelName, setPhoneModelName] = useState(Platform.constants?.Model || 'Android');
  const deviceIdRef = useRef('phone-' + Math.random().toString(36).substring(2, 9));

  // LAN Shared Clipboard State
  const [pcClipboardText, setPcClipboardText] = useState('');
  const [pcClipboardUpdatedBy, setPcClipboardUpdatedBy] = useState('');
  const [clipboardInput, setClipboardInput] = useState('');
  const [clipboardToast, setClipboardToast] = useState('');

  // Phone Local Filesystem Explorer State
  const [phoneCurrentPath, setPhoneCurrentPath] = useState('');
  const [phoneParentPath, setPhoneParentPath] = useState('');
  const [phoneHistory, setPhoneHistory] = useState([]); // Directory navigation history stack
  const [phoneItems, setPhoneItems] = useState([]);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneFilter, setPhoneFilter] = useState('all');
  const [phoneSearch, setPhoneSearch] = useState('');
  const [phoneSortBy, setPhoneSortBy] = useState('latest'); // 'latest' | 'name' | 'size' (STRICT DEFAULT: latest)
  const [phoneViewMode, setPhoneViewMode] = useState('grid'); // 'grid' | 'list'
  const [phoneSelectedPaths, setPhoneSelectedPaths] = useState(new Set());
  const [phoneMultiSelect, setPhoneMultiSelect] = useState(false);

  // PC Remote Filesystem Explorer State
  const [pcQuickAccess, setPcQuickAccess] = useState({ drives: [], shortcuts: [] });
  const [pcCurrentPath, setPcCurrentPath] = useState('');
  const [pcParentPath, setPcParentPath] = useState('');
  const [pcHistory, setPcHistory] = useState([]); // Remote PC directory navigation history stack
  const [pcItems, setPcItems] = useState([]);
  const [pcLoading, setPcLoading] = useState(false);
  const [pcFilter, setPcFilter] = useState('all');
  const [pcSearch, setPcSearch] = useState('');
  const [pcSortBy, setPcSortBy] = useState('latest'); // 'latest' | 'name' | 'size' (STRICT DEFAULT: latest)
  const [pcViewMode, setPcViewMode] = useState('grid'); // 'grid' | 'list'
  const [pcSelectedPaths, setPcSelectedPaths] = useState(new Set());
  const [pcMultiSelect, setPcMultiSelect] = useState(false);

  // Theme State: Dark / Light Mode (Toggle in Sidebar)
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Collapsible Navigation Sidebar Drawer State
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  // Dedicated Sort Selection Modal ('phone' | 'pc' | null)
  const [sortModalTarget, setSortModalTarget] = useState(null);
  const sortModalTargetRef = useRef(sortModalTarget);
  sortModalTargetRef.current = sortModalTarget;

  // Active Shared Files Hub (Visible in Mobile Dashboard)
  const [sharedHubFiles, setSharedHubFiles] = useState([]);
  const [downloadedSharedIds, setDownloadedSharedIds] = useState(new Set());
  const [shareHubSearch, setShareHubSearch] = useState('');
  const [shareHubViewMode, setShareHubViewMode] = useState('grid');

  // Send to PC State (Replaces Sending)
  const [isSending, setIsSending] = useState(false);

  // Live Shared Clipboard Sync (Continuous Live Sync with PC)
  const [clipboardAutoSync, setClipboardAutoSync] = useState(true);
  const lastSeenPcClipRef = useRef('');
  const lastSeenPhoneClipRef = useRef('');
  const videoTouchStartRef = useRef({ time: 0, x: 0, y: 0 });

  // Direct Share Device Picker Modal State
  const [directShareModalVisible, setDirectShareModalVisible] = useState(false);
  const [directSharePendingFiles, setDirectSharePendingFiles] = useState([]);
  const directShareModalVisibleRef = useRef(directShareModalVisible);
  directShareModalVisibleRef.current = directShareModalVisible;

  // Native PC File Action & Chooser Prompt State (Download to Phone vs Open in App)
  const [pcFileActionPrompt, setPcFileActionPrompt] = useState(null); // { file, source: 'pc' | 'sharehub' }

  // Universal Media Lightbox State with Pinch-to-Zoom & Pan & Carousel Playlist
  const [lightboxItem, setLightboxItem] = useState(null); // { item, source: 'phone' | 'pc', index: number, playlist: Array }
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const zoomScaleRef = useRef(1);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef(null);
  const lastTapTimeRef = useRef(0);

  // In-App Video Player State (YouTube / MX Player Engine)
  const [videoPaused, setVideoPaused] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoRepeat, setVideoRepeat] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoControlsVisible, setVideoControlsVisible] = useState(true);
  const [videoSpeed, setVideoSpeed] = useState(1.0);
  const [videoResizeMode, setVideoResizeMode] = useState('contain');
  const [videoSeek, setVideoSeek] = useState(-1);
  const [videoDoubleTapFeedback, setVideoDoubleTapFeedback] = useState(null); // { side: 'left'|'right', text: '-10s'|'+10s' }
  const [videoScrubbing, setVideoScrubbing] = useState(false);
  const [videoScrubTime, setVideoScrubTime] = useState(0);
  const [scrubberWidth, setScrubberWidth] = useState(SCREEN_WIDTH - 120);
  const videoViewRef = useRef(null);
  const lastVideoTapRef = useRef(0);
  const videoControlsTimerRef = useRef(null);
  const videoCurrentTimeRef = useRef(0);
  videoCurrentTimeRef.current = videoCurrentTime;
  const videoDurationRef = useRef(0);
  videoDurationRef.current = videoDuration;

  // Admin Security Password Modal State
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [adminActionCallback, setAdminActionCallback] = useState(null);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminActionTitle, setAdminActionTitle] = useState('');

  // Diagnostic Assistant State
  const [diagVisible, setDiagVisible] = useState(false);
  const [diagStatus, setDiagStatus] = useState('idle'); // 'idle' | 'testing' | 'success' | 'warning'
  const [diagMessage, setDiagMessage] = useState('');

  // Live Refs for BackHandler to avoid stale state closures
  const currentTabRef = useRef(currentTab);
  currentTabRef.current = currentTab;
  const lightboxItemRef = useRef(lightboxItem);
  lightboxItemRef.current = lightboxItem;
  const showPairModalRef = useRef(showPairModal);
  showPairModalRef.current = showPairModal;
  const adminModalVisibleRef = useRef(adminModalVisible);
  adminModalVisibleRef.current = adminModalVisible;
  const diagVisibleRef = useRef(diagVisible);
  diagVisibleRef.current = diagVisible;
  const phoneMultiSelectRef = useRef(phoneMultiSelect);
  phoneMultiSelectRef.current = phoneMultiSelect;
  const pcMultiSelectRef = useRef(pcMultiSelect);
  pcMultiSelectRef.current = pcMultiSelect;
  const phoneHistoryRef = useRef(phoneHistory);
  phoneHistoryRef.current = phoneHistory;
  const phoneCurrentPathRef = useRef(phoneCurrentPath);
  phoneCurrentPathRef.current = phoneCurrentPath;
  const phoneParentPathRef = useRef(phoneParentPath);
  phoneParentPathRef.current = phoneParentPath;
  const pcHistoryRef = useRef(pcHistory);
  pcHistoryRef.current = pcHistory;
  const pcCurrentPathRef = useRef(pcCurrentPath);
  pcCurrentPathRef.current = pcCurrentPath;
  const pcParentPathRef = useRef(pcParentPath);
  pcParentPathRef.current = pcParentPath;

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 30)]);
  };

  const showToast = (msg) => {
    setClipboardToast(msg);
    setTimeout(() => setClipboardToast(''), 3200);
  };

  // Gallery Navigation Functions with Smooth Sliding Transition Animation
  const mediaSlideAnim = useRef(new Animated.Value(0)).current;
  const isSlidingRef = useRef(false);

  const goToNextMedia = () => {
    if (isSlidingRef.current) return;
    const current = lightboxItemRef.current;
    if (!current?.playlist || current.playlist.length <= 1) return;
    const { playlist, index, source } = current;
    const nextIdx = (index + 1) % playlist.length;
    const nextItem = playlist[nextIdx];
    if (!nextItem) return;

    isSlidingRef.current = true;
    Animated.timing(mediaSlideAnim, {
      toValue: -SCREEN_WIDTH,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      setLightboxItem({
        item: nextItem,
        source: nextItem.downloadUrl ? 'pc' : source,
        index: nextIdx,
        playlist,
      });
      resetZoom();
      setVideoPaused(false);
      setVideoDuration(0);
      setVideoCurrentTime(0);
      setVideoControlsVisible(true);
      setVideoSeek(-1);
      mediaSlideAnim.setValue(SCREEN_WIDTH);
      Animated.spring(mediaSlideAnim, {
        toValue: 0,
        damping: 22,
        mass: 0.8,
        stiffness: 190,
        useNativeDriver: true,
      }).start(() => {
        isSlidingRef.current = false;
      });
    });
  };

  const goToPrevMedia = () => {
    if (isSlidingRef.current) return;
    const current = lightboxItemRef.current;
    if (!current?.playlist || current.playlist.length <= 1) return;
    const { playlist, index, source } = current;
    const prevIdx = (index - 1 + playlist.length) % playlist.length;
    const prevItem = playlist[prevIdx];
    if (!prevItem) return;

    isSlidingRef.current = true;
    Animated.timing(mediaSlideAnim, {
      toValue: SCREEN_WIDTH,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      setLightboxItem({
        item: prevItem,
        source: prevItem.downloadUrl ? 'pc' : source,
        index: prevIdx,
        playlist,
      });
      resetZoom();
      setVideoPaused(false);
      setVideoDuration(0);
      setVideoCurrentTime(0);
      setVideoControlsVisible(true);
      setVideoSeek(-1);
      mediaSlideAnim.setValue(-SCREEN_WIDTH);
      Animated.spring(mediaSlideAnim, {
        toValue: 0,
        damping: 22,
        mass: 0.8,
        stiffness: 190,
        useNativeDriver: true,
      }).start(() => {
        isSlidingRef.current = false;
      });
    });
  };

  const goToNextMediaRef = useRef(goToNextMedia);
  goToNextMediaRef.current = goToNextMedia;
  const goToPrevMediaRef = useRef(goToPrevMedia);
  goToPrevMediaRef.current = goToPrevMedia;

  // Native Animated Values for 120Hz Hardware-Accelerated Pan & Zoom (Pinch, Double-Tap & Buttons)
  const zoomScaleAnim = useRef(new Animated.Value(1)).current;
  const panXAnim = useRef(new Animated.Value(0)).current;
  const panYAnim = useRef(new Animated.Value(0)).current;

  const updateNativeTransform = (scale, x, y) => {
    zoomScaleAnim.setValue(scale);
    panXAnim.setValue(x);
    panYAnim.setValue(y);
    setZoomScale(scale);
    setPanOffset({ x, y });
  };

  // Reset zoom & pan helper
  const resetZoom = () => {
    zoomScaleRef.current = 1;
    panOffsetRef.current = { x: 0, y: 0 };
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    lastTouchDistanceRef.current = null;
    Animated.timing(zoomScaleAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    Animated.timing(panXAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    Animated.timing(panYAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
  };

  useEffect(() => {
    resetZoom();
    setVideoPaused(false);
    setVideoDuration(0);
  }, [lightboxItem?.item?.path, lightboxItem?.item?.id, lightboxItem?.item?.name]);

  // =========================================================
  // FLUID MULTI-TOUCH PINCH-TO-ZOOM, PAN & SWIPE CAROUSEL (IMAGES)
  // =========================================================
  const zoomPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return evt.nativeEvent.touches.length > 1 || Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4;
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        return evt.nativeEvent.touches.length > 1 || Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        if (evt.nativeEvent.touches.length >= 2) {
          const [t1, t2] = evt.nativeEvent.touches;
          lastTouchDistanceRef.current = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
        } else if (evt.nativeEvent.touches.length === 1) {
          const now = Date.now();
          if (now - lastTapTimeRef.current < 320) {
            const nextScale = zoomScaleRef.current > 1.2 ? 1 : 2.5;
            zoomScaleRef.current = nextScale;
            panOffsetRef.current = { x: 0, y: 0 };
            setZoomScale(nextScale);
            setPanOffset({ x: 0, y: 0 });
            Animated.spring(zoomScaleAnim, { toValue: nextScale, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
            Animated.spring(panXAnim, { toValue: 0, useNativeDriver: true }).start();
            Animated.spring(panYAnim, { toValue: 0, useNativeDriver: true }).start();
            lastTapTimeRef.current = 0;
            return;
          }
          lastTapTimeRef.current = now;
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const [t1, t2] = touches;
          const currentDistance = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
          if (lastTouchDistanceRef.current && lastTouchDistanceRef.current > 0) {
            const delta = currentDistance / lastTouchDistanceRef.current;
            let nextScale = zoomScaleRef.current * delta;
            if (nextScale < 0.6) nextScale = 0.6;
            if (nextScale > 60) nextScale = 60;
            zoomScaleRef.current = nextScale;
            zoomScaleAnim.setValue(nextScale);
            setZoomScale(nextScale);
          }
          lastTouchDistanceRef.current = currentDistance;
        } else if (touches.length === 1) {
          if (zoomScaleRef.current > 1.05) {
            const maxPanX = (SCREEN_WIDTH * (zoomScaleRef.current - 0.7)) / 1.4;
            const maxPanY = (SCREEN_HEIGHT * (zoomScaleRef.current - 0.7)) / 1.4;
            let nextX = panOffsetRef.current.x + gestureState.dx * 0.55;
            let nextY = panOffsetRef.current.y + gestureState.dy * 0.55;
            nextX = Math.max(-maxPanX, Math.min(maxPanX, nextX));
            nextY = Math.max(-maxPanY, Math.min(maxPanY, nextY));
            panOffsetRef.current = { x: nextX, y: nextY };
            panXAnim.setValue(nextX);
            panYAnim.setValue(nextY);
          } else {
            if (gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 0.9) {
              const dragY = gestureState.dy;
              const dragScale = Math.max(0.65, 1 - (dragY / SCREEN_HEIGHT) * 0.45);
              panYAnim.setValue(dragY);
              zoomScaleAnim.setValue(dragScale);
            } else if (Math.abs(gestureState.dx) > 4 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 0.7) {
              mediaSlideAnim.setValue(gestureState.dx);
            }
          }
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        lastTouchDistanceRef.current = null;
        if (zoomScaleRef.current <= 1.05) {
          if (gestureState.dy > 50 || (gestureState.dy > 20 && gestureState.vy > 0.4)) {
            setLightboxItem(null);
            resetZoom();
            return;
          }
          Animated.spring(panYAnim, { toValue: 0, useNativeDriver: true }).start();
          Animated.spring(zoomScaleAnim, { toValue: 1, useNativeDriver: true }).start();

          const isHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 0.7;
          const swipeThreshold = SCREEN_WIDTH * 0.16;
          if (isHorizontal && (gestureState.dx < -swipeThreshold || gestureState.vx < -0.3)) {
            goToNextMediaRef.current();
          } else if (isHorizontal && (gestureState.dx > swipeThreshold || gestureState.vx > 0.3)) {
            goToPrevMediaRef.current();
          } else {
            Animated.spring(mediaSlideAnim, {
              toValue: 0,
              damping: 18,
              mass: 0.7,
              stiffness: 200,
              useNativeDriver: true,
            }).start();
            resetZoom();
          }
        } else {
          setZoomScale(zoomScaleRef.current);
          setPanOffset({ ...panOffsetRef.current });
        }
      },
      onPanResponderTerminate: () => {
        lastTouchDistanceRef.current = null;
      },
    })
  ).current;

  // =========================================================
  // FLUID VIDEO SWIPING, PULL-DOWN TO CLOSE & TAP TO TOGGLE
  // =========================================================
  const videoPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 6 || Math.abs(gestureState.dy) > 6;
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 12 || Math.abs(gestureState.dy) > 12;
      },
      onPanResponderGrant: (evt) => {
        videoTouchStartRef.current = {
          time: Date.now(),
          x: evt.nativeEvent.pageX,
          y: evt.nativeEvent.pageY,
        };
      },
      onPanResponderMove: (evt, gestureState) => {
        if (Math.abs(gestureState.dx) > 6 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 0.7) {
          mediaSlideAnim.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        const elapsed = Date.now() - videoTouchStartRef.current.time;
        const totalDistance = Math.hypot(gestureState.dx, gestureState.dy);

        // 1. Tap & Double-Tap Handling (YouTube Style 10s Seek & Toggle Controls)
        if (elapsed < 350 && totalDistance < 15) {
          const now = Date.now();
          const tapX = evt.nativeEvent.pageX;
          if (now - lastVideoTapRef.current < 350) {
            // Double Tap Detected! YouTube style 10s seek
            lastVideoTapRef.current = 0;
            if (tapX < SCREEN_WIDTH / 2) {
              // Rewind 10s
              const target = Math.max(0, videoCurrentTimeRef.current - 10);
              setVideoCurrentTime(target);
              setVideoSeek(target);
              setVideoDoubleTapFeedback({ side: 'left', text: '−10s' });
              setTimeout(() => setVideoDoubleTapFeedback(null), 650);
            } else {
              // Forward 10s
              const target = Math.min(videoDurationRef.current, videoCurrentTimeRef.current + 10);
              setVideoCurrentTime(target);
              setVideoSeek(target);
              setVideoDoubleTapFeedback({ side: 'right', text: '+10s' });
              setTimeout(() => setVideoDoubleTapFeedback(null), 650);
            }
            setVideoControlsVisible(true);
            return;
          }
          lastVideoTapRef.current = now;
          // Single tap toggles controls visibility
          setVideoControlsVisible((prev) => !prev);
          return;
        }

        // 2. Swipe Down to Close: dy > 50 or downward flick with vy > 0.4
        if (gestureState.dy > 50 || (gestureState.dy > 20 && gestureState.vy > 0.4)) {
          setLightboxItem(null);
          resetZoom();
          return;
        }

        // 3. Natural Swipe Left / Right with spring reset
        const isHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 0.7;
        const swipeThreshold = SCREEN_WIDTH * 0.16;
        if (isHorizontal && (gestureState.dx < -swipeThreshold || gestureState.vx < -0.3)) {
          goToNextMediaRef.current();
        } else if (isHorizontal && (gestureState.dx > swipeThreshold || gestureState.vx > 0.3)) {
          goToPrevMediaRef.current();
        } else {
          Animated.spring(mediaSlideAnim, {
            toValue: 0,
            damping: 18,
            mass: 0.7,
            stiffness: 200,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // YouTube / MX Player Scrubber Pan Responder
  const scrubberPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setVideoScrubbing(true);
        const touchX = evt.nativeEvent.locationX;
        const dur = videoDurationRef.current || 0;
        const ratio = Math.max(0, Math.min(1, touchX / (scrubberWidth || 1)));
        setVideoScrubTime(ratio * dur);
      },
      onPanResponderMove: (evt) => {
        const touchX = evt.nativeEvent.locationX;
        const dur = videoDurationRef.current || 0;
        const ratio = Math.max(0, Math.min(1, touchX / (scrubberWidth || 1)));
        setVideoScrubTime(ratio * dur);
      },
      onPanResponderRelease: (evt) => {
        const touchX = evt.nativeEvent.locationX;
        const dur = videoDurationRef.current || 0;
        const ratio = Math.max(0, Math.min(1, touchX / (scrubberWidth || 1)));
        const target = ratio * dur;
        setVideoCurrentTime(target);
        setVideoSeek(target);
        setVideoScrubbing(false);
      },
      onPanResponderTerminate: () => {
        setVideoScrubbing(false);
      },
    })
  ).current;

  // Video Player Control Handlers
  const cycleVideoSpeed = () => {
    const speeds = [0.5, 1.0, 1.25, 1.5, 2.0];
    const idx = speeds.indexOf(videoSpeed);
    const next = speeds[(idx + 1) % speeds.length];
    setVideoSpeed(next);
    showToast(`Speed: ${next}x`);
  };

  const cycleVideoResizeMode = () => {
    const next = videoResizeMode === 'contain' ? 'cover' : 'contain';
    setVideoResizeMode(next);
    showToast(`Aspect: ${next === 'contain' ? 'FIT' : 'FILL'}`);
  };

  const seekVideoDelta = (deltaSec) => {
    const cur = videoCurrentTimeRef.current;
    const dur = videoDurationRef.current;
    const target = Math.max(0, Math.min(dur, cur + deltaSec));
    setVideoCurrentTime(target);
    setVideoSeek(target);
    showToast(deltaSec > 0 ? `+${deltaSec}s` : `${deltaSec}s`);
  };

  // Auto-hide video controls after 3.5s of playing (YouTube / MX Player style)
  useEffect(() => {
    if (videoControlsTimerRef.current) {
      clearTimeout(videoControlsTimerRef.current);
    }
    if (videoControlsVisible && !videoPaused && lightboxItem && isVideoFile(lightboxItem?.item?.ext)) {
      videoControlsTimerRef.current = setTimeout(() => {
        setVideoControlsVisible(false);
      }, 3500);
    }
    return () => {
      if (videoControlsTimerRef.current) clearTimeout(videoControlsTimerRef.current);
    };
  }, [videoControlsVisible, videoPaused, lightboxItem]);

  // Zoom button triggers
  const handleZoomIn = () => {
    let next = Math.min(60, zoomScaleRef.current + (zoomScaleRef.current < 4 ? 0.75 : 2.5));
    zoomScaleRef.current = next;
    setZoomScale(next);
    Animated.spring(zoomScaleAnim, {
      toValue: next,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
    }).start();
  };
  const handleZoomOut = () => {
    let next = Math.max(1, zoomScaleRef.current - (zoomScaleRef.current > 4 ? 2.5 : 0.75));
    zoomScaleRef.current = next;
    setZoomScale(next);
    if (next <= 1) {
      panOffsetRef.current = { x: 0, y: 0 };
      setPanOffset({ x: 0, y: 0 });
      Animated.spring(panXAnim, { toValue: 0, useNativeDriver: true }).start();
      Animated.spring(panYAnim, { toValue: 0, useNativeDriver: true }).start();
    }
    Animated.spring(zoomScaleAnim, {
      toValue: next,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
    }).start();
  };

  // Left-anchored Drawer Slide Animation & Helpers
  const drawerSlideAnim = useRef(new Animated.Value(-300)).current;

  const openSidebar = () => {
    setSidebarOpen(true);
    drawerSlideAnim.setValue(-300);
    Animated.timing(drawerSlideAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  };

  const closeSidebar = () => {
    Animated.timing(drawerSlideAnim, {
      toValue: -300,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setSidebarOpen(false);
    });
  };

  useEffect(() => {
    if (sidebarOpen) {
      Animated.timing(drawerSlideAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [sidebarOpen]);

  // Swipe right on homepage to open sidebar gesture
  const homePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Detect horizontal rightward swipe: dx > 25, dominant over vertical movement
        if (gestureState.dx > 25 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.3) {
          return true;
        }
        return false;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 50 || (gestureState.dx > 25 && gestureState.vx > 0.35)) {
          openSidebar();
        }
      },
      onPanResponderTerminate: () => {},
    })
  ).current;

  // Storage Access Preference Helper & Synchronization
  const syncStorageAccessPreference = async (allow, targetPc) => {
    const pc = targetPc || pairedPc;
    if (!pc) return;
    try {
      await apiFetch(`http://${pc}/api/device/update-capabilities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': pcAuthToken || '',
        },
        body: JSON.stringify({
          deviceId: deviceIdRef.current,
          allowFullPhoneAccess: allow,
        }),
      }, 4000);
    } catch (e) {
      try {
        await apiFetch(`http://${pc}/api/mobile/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: deviceIdRef.current,
            allowFullPhoneAccess: allow,
          }),
        }, 3000);
      } catch (ignored) {}
    }
  };

  const handleSetStorageAccess = async (allow) => {
    try {
      setShowStorageAccessPrompt(false);
      setAllowFullPhoneAccess(allow);
      await AsyncStorage.setItem('fylo_allow_full_phone_access', String(allow));
      if (FyloModule && FyloModule.setAllowFullPhoneAccess) {
        await FyloModule.setAllowFullPhoneAccess(allow);
      }
      if (pairedPc) {
        await syncStorageAccessPreference(allow, pairedPc);
      }
      showToast(allow ? '📁 Full Phone Storage Sharing: ALLOWED' : '🛡️ Phone Storage Sharing: DENIED (ShareHub Only)');
      addLog(`Phone Storage Sharing: ${allow ? 'FULL ACCESS' : 'RESTRICTED (ShareHub Only)'}`);
    } catch (err) {
      console.warn('handleSetStorageAccess error:', err);
    }
  };

  // Load persistent storage access permission preference on launch
  useEffect(() => {
    const loadStoragePref = async () => {
      try {
        let stored = await AsyncStorage.getItem('fylo_allow_full_phone_access');
        if (stored === null && FyloModule && FyloModule.getAllowFullPhoneAccess) {
          const nativeVal = await FyloModule.getAllowFullPhoneAccess();
          if (nativeVal !== null && nativeVal !== undefined) {
            stored = String(nativeVal);
            await AsyncStorage.setItem('fylo_allow_full_phone_access', stored);
          }
        }
        if (stored !== null && stored !== undefined) {
          const isAllowed = stored === 'true' || stored === true;
          setAllowFullPhoneAccess(isAllowed);
          if (FyloModule && FyloModule.setAllowFullPhoneAccess) {
            FyloModule.setAllowFullPhoneAccess(isAllowed).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('Error loading storage access pref:', e);
      }
    };
    loadStoragePref();
  }, []);

  // Periodic device & server status check and persistent pairing restore
  useEffect(() => {
    if (FyloModule && FyloModule.setDeviceId) {
      FyloModule.setDeviceId(deviceIdRef.current).catch(() => {});
    }
    // Restore pairing from Android SharedPreferences across app restarts
    if (FyloModule && FyloModule.getSavedPairedDevice) {
      FyloModule.getSavedPairedDevice()
        .then(async (saved) => {
          if (saved && saved.paired_pc && saved.paired_pc.trim() !== '') {
            const savedHost = saved.paired_pc.trim();
            const savedName = (saved.pc_hostname || 'Windows Host').trim();
            const savedToken = (saved.pc_token || '').trim();
            setPairedPc(savedHost);
            setPcHostName(savedName);
            if (savedToken) setPcAuthToken(savedToken);
            addLog(`Restored persistent pairing to ${savedHost} (${savedName})`);

            // Check if user has decided on storage access permission
            try {
              const storedAccess = await AsyncStorage.getItem('fylo_allow_full_phone_access');
              if (storedAccess === null || storedAccess === undefined) {
                setShowStorageAccessPrompt(true);
              } else {
                const isAllowed = storedAccess === 'true' || storedAccess === true;
                setAllowFullPhoneAccess(isAllowed);
                if (FyloModule && FyloModule.setAllowFullPhoneAccess) {
                  FyloModule.setAllowFullPhoneAccess(isAllowed).catch(() => {});
                }
                syncStorageAccessPreference(isAllowed, savedHost);
              }
            } catch (ignored) {}
          }
        })
        .catch((e) => console.warn('getSavedPairedDevice error:', e));
    }
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Monitor AppState to track background sync status
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'inactive' || nextAppState === 'background') {
        addLog('App backgrounded. Fylo Foreground Service active.');
      }
    });
    return () => sub.remove();
  }, [pairedPc]);

  // Real-time Heartbeat & Real Ping Latency Measurement while paired
  useEffect(() => {
    if (!pairedPc) {
      setPingLatency(null);
      setIsPcReachable(false);
      return;
    }

    let consecutiveFails = 0;
    const sendHeartbeat = async () => {
      const startTime = Date.now();
      try {
        const res = await apiFetch(`http://${pairedPc}/api/mobile/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': pcAuthToken || '',
          },
          body: JSON.stringify({
            deviceId: deviceIdRef.current,
            battery: batteryLevel,
            storage: {
              total: storageInfo?.totalGB || 'Unknown',
              free: storageInfo?.freeGB || 'Unknown',
            },
            readOnly: readOnlyMode,
            allowFullPhoneAccess: allowFullPhoneAccess !== false,
          }),
        }, 4000); // 4s timeout

        const roundTripMs = Date.now() - startTime;

        if (res.ok) {
          setPingLatency(roundTripMs);
          setIsPcReachable(true);
          consecutiveFails = 0;
        } else if (res.status === 404) {
          // PC doesn't recognize us, try re-pairing
          handleConnectToPc(pairedPc, pcAuthToken);
        } else {
          consecutiveFails++;
          if (consecutiveFails >= 3) {
            setPingLatency(null);
            setIsPcReachable(false);
          }
        }
      } catch (e) {
        consecutiveFails++;
        if (consecutiveFails >= 3) {
          setPingLatency(null);
          setIsPcReachable(false);
        }
      }

      // After 10 consecutive failures (~40s), unpair
      if (consecutiveFails >= 10) {
        addLog(`Lost connection to PC at ${pairedPc}`);
        setPairedPc(null);
        setPingLatency(null);
        setIsPcReachable(false);
      }
    };

    sendHeartbeat();
    const heartbeatTimer = setInterval(sendHeartbeat, 3500); // 3.5s ping interval
    return () => clearInterval(heartbeatTimer);
  }, [pairedPc, pcAuthToken, storageInfo, readOnlyMode, batteryLevel]);

  // Periodic continuous clipboard sync when paired with PC
  useEffect(() => {
    if (!pairedPc || !clipboardAutoSync) return;

    fetchPcClipboard();
    const clipTimer = setInterval(fetchPcClipboard, 3500); // Continuous 3.5s live sync with PC
    return () => clearInterval(clipTimer);
  }, [pairedPc, pcAuthToken, clipboardAutoSync]);

  // Real-time clipboard sync on app resume / foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && pairedPc && clipboardAutoSync) {
        fetchPcClipboard();
      }
    });
    return () => {
      if (sub && sub.remove) sub.remove();
    };
  }, [pairedPc, pcAuthToken, clipboardAutoSync]);

  // Periodic Share Hub sync when paired with PC
  useEffect(() => {
    if (!pairedPc) return;
    fetchSharedHubFiles();
    const hubTimer = setInterval(fetchSharedHubFiles, 3500);
    return () => clearInterval(hubTimer);
  }, [pairedPc, pcAuthToken, fetchSharedHubFiles]);

  // Load PC Explorer shortcuts when switching to PC Explorer tab or pairing
  useEffect(() => {
    if ((currentTab === 'pc-explorer' || currentTab === 'home') && pairedPc) {
      loadPcQuickAccess();
      if (currentTab === 'home') fetchSharedHubFiles();
    }
  }, [currentTab, pairedPc, fetchSharedHubFiles]);

  // Load Phone Explorer root when switching to Phone Explorer tab
  useEffect(() => {
    if (currentTab === 'phone-explorer' && phoneItems.length === 0) {
      loadPhoneFolder();
    }
  }, [currentTab]);

  // =========================================================
  // REQUIREMENT 2: ONE-STEP-BACK HARDWARE & IN-APP NAVIGATION
  // =========================================================
  const goBackPhoneFolder = () => {
    if (phoneHistoryRef.current.length > 0) {
      const nextStack = [...phoneHistoryRef.current];
      const prevPath = nextStack.pop();
      setPhoneHistory(nextStack);
      loadPhoneFolder(prevPath, true);
    } else if (phoneParentPathRef.current && phoneParentPathRef.current !== phoneCurrentPathRef.current) {
      loadPhoneFolder(phoneParentPathRef.current, true);
    } else {
      setCurrentTab('home');
    }
  };

  const goBackPcFolder = () => {
    if (pcHistoryRef.current.length > 0) {
      const nextStack = [...pcHistoryRef.current];
      const prevPath = nextStack.pop();
      setPcHistory(nextStack);
      loadPcFolder(prevPath, true);
    } else if (pcParentPathRef.current && pcParentPathRef.current !== pcCurrentPathRef.current) {
      loadPcFolder(pcParentPathRef.current, true);
    } else {
      setCurrentTab('home');
    }
  };

  // React Native hardware back button listener
  useEffect(() => {
    const handleHardwareBackPress = () => {
      // 1. Close lightbox if open
      if (lightboxItemRef.current) {
        setLightboxItem(null);
        resetZoom();
        return true;
      }
      // 2. Close sidebar drawer if open
      if (sidebarOpenRef.current) {
        closeSidebar();
        return true;
      }

      // 2b. Close sort modal if open
      if (sortModalTargetRef.current) {
        setSortModalTarget(null);
        return true;
      }

      // 2c. Close direct share device picker modal if open
      if (directShareModalVisibleRef.current) {
        setDirectShareModalVisible(false);
        return true;
      }

      // 2c. Close direct share device picker modal if open
      if (directShareModalVisibleRef.current) {
        setDirectShareModalVisible(false);
        return true;
      }
      // 3. Close other modals if open
      if (showPairModalRef.current) {
        setShowPairModal(false);
        return true;
      }
      if (adminModalVisibleRef.current) {
        setAdminModalVisible(false);
        return true;
      }
      if (diagVisibleRef.current) {
        setDiagVisible(false);
        return true;
      }
      if (showStorageAccessPromptRef.current) {
        handleSetStorageAccess(false);
        return true;
      }
      if (showSettingsModalRef.current) {
        setShowSettingsModal(false);
        return true;
      }

      // 4. In Phone Explorer: clear multi-select or step one directory back
      if (currentTabRef.current === 'phone-explorer') {
        if (phoneMultiSelectRef.current) {
          setPhoneMultiSelect(false);
          setPhoneSelectedPaths(new Set());
          return true;
        }
        if (
          phoneHistoryRef.current.length > 0 ||
          (phoneParentPathRef.current && phoneParentPathRef.current !== phoneCurrentPathRef.current)
        ) {
          goBackPhoneFolder();
          return true;
        }
        setCurrentTab('home');
        return true;
      }

      // 5. In PC Explorer: clear multi-select or step one directory back
      if (currentTabRef.current === 'pc-explorer') {
        if (pcMultiSelectRef.current) {
          setPcMultiSelect(false);
          setPcSelectedPaths(new Set());
          return true;
        }
        if (
          pcHistoryRef.current.length > 0 ||
          (pcParentPathRef.current && pcParentPathRef.current !== pcCurrentPathRef.current)
        ) {
          goBackPcFolder();
          return true;
        }
        setCurrentTab('home');
        return true;
      }

      // 6. In any other tab: return to Home
      if (currentTabRef.current !== 'home') {
        setCurrentTab('home');
        return true;
      }

      // 7. On Home tab with no modal: double tap back navigation to exit app completely
      const now = Date.now();
      if (now - lastBackPressTimeRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPressTimeRef.current = now;
      showToast('Press back again to exit Fylo');
      return true;
    };

    const backSubscription = BackHandler.addEventListener('hardwareBackPress', handleHardwareBackPress);
    return () => backSubscription.remove();
  }, []);

  const checkStatus = async () => {
    try {
      if (FyloModule && FyloModule.getServerInfo) {
        const info = await FyloModule.getServerInfo();
        if (info) {
          setServerRunning(!!info.running);
          setDeviceIp(info.ip || '127.0.0.1');
          setServerPort(info.port || 8080);
          setHasPermission(!!info.hasStoragePermission);
          if (info.battery !== undefined && info.battery >= 0) {
            setBatteryLevel(info.battery);
          }
          if (info.deviceName) {
            setPhoneModelName(info.deviceName);
          }
          if (info.storage) {
            setStorageInfo({
              totalGB: info.storage.totalGB || '--',
              freeGB: info.storage.freeGB || '--',
            });
          }
          if (info.hasStoragePermission && !info.running) {
            try {
              await FyloModule.startServer(info.port || 8080, readOnlyMode, pcAuthToken || '');
              setServerRunning(true);
            } catch (ignored) {}
          }
        }
      } else {
        setDeviceIp('192.168.1.105');
        setHasPermission(true);
      }
    } catch (e) {
      console.log('Error checking status:', e);
    }
  };

  const handleToggleServer = async () => {
    if (!hasPermission) {
      handleRequestPermission();
      showToast('⚠️ Storage permission required');
      return;
    }

    try {
      if (FyloModule) {
        if (serverRunning) {
          if (pairedPc) {
            await handleUnpair();
          }
          await FyloModule.stopServer();
          setServerRunning(false);
          addLog('Fylo server stopped.');
          showToast('Fylo server stopped');
        } else {
          await FyloModule.startServer(serverPort, readOnlyMode, pcAuthToken || '');
          setServerRunning(true);
          addLog(`Server active on http://${deviceIp}:${serverPort}`);
          showToast(`⚡ Server active on ${deviceIp}:${serverPort}`);
        }
      } else {
        setServerRunning(!serverRunning);
        addLog(`Server toggled: ${!serverRunning ? 'RUNNING' : 'STOPPED'}`);
      }
    } catch (err) {
      showToast('Server Error: ' + (err?.message || String(err)));
    }
  };

  const handleRequestPermission = () => {
    if (FyloModule && FyloModule.requestStoragePermission) {
      FyloModule.requestStoragePermission();
    } else {
      showToast('Storage permission must be enabled in Android Settings');
    }
  };

  const handleToggleReadOnly = async (val) => {
    setReadOnlyMode(val);
    if (FyloModule && FyloModule.setReadOnly) {
      await FyloModule.setReadOnly(val);
    }
    addLog(`Read-Only Mode: ${val ? 'ENABLED (Safe Mode)' : 'DISABLED (Write-Allowed)'}`);
    showToast(val ? '🛡️ Safe Mode Enabled' : '⚡ Write-Allowed Mode');
  };

  const handleUnpair = async () => {
    if (!pairedPc) return;
    try {
      await apiFetch(`http://${pairedPc}/api/mobile/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': pcAuthToken || '' },
        body: JSON.stringify({ deviceId: deviceIdRef.current }),
      }, 3000);
    } catch (e) {}
    addLog(`Unpaired from ${pairedPc}`);
    if (FyloModule && FyloModule.clearSavedPairedDevice) {
      FyloModule.clearSavedPairedDevice().catch(() => {});
    }
    setPairedPc(null);
    setPingLatency(null);
    setIsPcReachable(false);
    showToast('Unpaired from PC');
  };

  // =========================================================
  // REQUIREMENT 6: REMOVE ANNOYING POPUPS (Non-blocking Toasts)
  // =========================================================
  const handleConnectToPc = async (pcIp, token) => {
    if (!pcIp) {
      showToast('⚠️ Please enter PC address');
      return;
    }

    let cleanIp = pcIp.trim().replace(/^https?:\/\//, '').replace(/^fylo:\/\//, '').replace(/\/.*$/, '');
    let host = cleanIp.split(':')[0];
    let port = cleanIp.includes(':') ? cleanIp.split(':')[1] : '3000';
    if (!port || port === '4444') port = '3000';

    try {
      addLog(`Pairing with PC at ${host}:${port}...`);
      const startTime = Date.now();

      if (!serverRunning && FyloModule && FyloModule.startServer) {
        try {
          await FyloModule.startServer(serverPort || 8080, readOnlyMode, token || pcAuthToken || '');
          setServerRunning(true);
        } catch (e) {
          console.warn('Failed to auto-start server during pairing:', e);
        }
      }

      const brand = Platform.constants?.Brand ? Platform.constants.Brand.charAt(0).toUpperCase() + Platform.constants.Brand.slice(1) : '';
      const model = Platform.constants?.Model || 'Android Phone';
      const cleanName = brand && !model.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${model}` : model;

      const payload = {
        deviceId: deviceIdRef.current,
        deviceName: phoneModelName || cleanName,
        model: model,
        ip: (deviceIp && deviceIp !== 'Detecting...' && deviceIp !== '127.0.0.1') ? deviceIp : '',
        port: serverPort || 8080,
        authToken: token ? token.trim() : (pcAuthToken || ''),
        readOnly: readOnlyMode,
        allowFullPhoneAccess: allowFullPhoneAccess !== false,
        battery: batteryLevel,
        storage: {
          total: storageInfo?.totalGB || 'Unknown',
          free: storageInfo?.freeGB || 'Unknown',
        },
      };

      const res = await apiFetch(`http://${host}:${port}/api/mobile/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token ? token.trim() : '',
        },
        body: JSON.stringify(payload),
      }, 7000);

      const roundTrip = Date.now() - startTime;
      const data = await safeJson(res);
      if (res.ok && data && data.success) {
        setPairedPc(`${host}:${port}`);
        setPcHostName(data.hostName || 'Windows Host');
        setPingLatency(roundTrip);
        setIsPcReachable(true);
        if (data.authToken) {
          setPcAuthToken(data.authToken);
          if (FyloModule && FyloModule.setAuthToken) {
            await FyloModule.setAuthToken(data.authToken);
          }
        }
        if (FyloModule && FyloModule.savePairedDevice) {
          FyloModule.savePairedDevice(`${host}:${port}`, data.hostName || 'Windows Host', data.authToken || '').catch(() => {});
        }
        setShowPairModal(false);
        addLog(`Successfully paired with PC (${host}:${port})!`);
        // Non-blocking toast replacing disruptive popup!
        showToast(`⚡ Linked to ${data.hostName || 'PC'} (${roundTrip} ms)`);

        // Check if full phone storage access has been decided yet
        const storedAccess = await AsyncStorage.getItem('fylo_allow_full_phone_access');
        if (storedAccess === null || storedAccess === undefined) {
          setShowStorageAccessPrompt(true);
        } else {
          const isAllowed = storedAccess === 'true' || storedAccess === true;
          setAllowFullPhoneAccess(isAllowed);
          if (FyloModule && FyloModule.setAllowFullPhoneAccess) {
            FyloModule.setAllowFullPhoneAccess(isAllowed).catch(() => {});
          }
          syncStorageAccessPreference(isAllowed, `${host}:${port}`);
        }
      } else {
        showToast(`⚠️ Pairing Failed: ${data?.error || 'PC rejected pairing request.'}`);
      }
    } catch (e) {
      showToast(`⚠️ Connection Failed: Could not reach ${host}:${port}`);
    }
  };

  const handleParseAndConnectQr = (rawText) => {
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      showToast('⚠️ Please enter or paste QR code string');
      return;
    }
    const clean = rawText.trim();
    let host = '';
    let port = '3000';
    let token = '';

    try {
      const urlStr = (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('fylo://'))
        ? clean.replace(/^fylo:\/\//i, 'http://')
        : 'http://' + clean;

      if (typeof URL !== 'undefined') {
        const parsed = new URL(urlStr);
        host = parsed.hostname;
        port = parsed.port || '3000';
        token = parsed.searchParams.get('auth') || parsed.searchParams.get('token') || '';
      } else {
        throw new Error('URL not globally defined');
      }
    } catch (e) {
      const withoutProto = clean.replace(/^https?:\/\//i, '').replace(/^fylo:\/\//i, '');
      const [addrPart, queryPart] = withoutProto.split('?');
      if (addrPart && addrPart.includes(':')) {
        const parts = addrPart.split(':');
        host = parts[0];
        port = parts[1].replace(/[^0-9]/g, '') || '3000';
      } else if (addrPart) {
        host = addrPart.replace(/\/.*$/, '');
        port = '3000';
      }
      if (queryPart) {
        try {
          const match = queryPart.match(/(?:auth|token)=([^&]+)/i);
          if (match && match[1]) token = decodeURIComponent(match[1]);
        } catch (ignored) {}
      }
    }

    if (!host) {
      showToast('⚠️ Invalid QR code address format');
      return;
    }

    handleConnectToPc(`${host}:${port}`, token);
  };

  const handleStartQrScan = async () => {
    try {
      if (!FyloModule || typeof FyloModule.scanQrCode !== 'function') {
        showToast('📷 QR scanner unavailable on device');
        return;
      }
      const scannedCode = await FyloModule.scanQrCode();
      if (scannedCode && typeof scannedCode === 'string' && scannedCode.trim()) {
        setShowPairModal(false);
        setQrInputText(scannedCode.trim());
        handleParseAndConnectQr(scannedCode.trim());
      }
    } catch (err) {
      console.warn('QR scan error:', err);
      showToast('📷 Camera scanner unavailable');
    }
  };

  // ==========================================
  // LAN Shared Clipboard Operations (Bidirectional Real-Time Live Sync)
  // ==========================================
  const fetchPcClipboard = async () => {
    if (!pairedPc) return;
    try {
      // 1. If live sync is enabled, check if user copied new text on Android phone
      if (clipboardAutoSync && FyloModule && FyloModule.getClipboardText) {
        try {
          const phoneClip = await FyloModule.getClipboardText();
          if (
            phoneClip &&
            phoneClip.trim() &&
            phoneClip !== lastSeenPhoneClipRef.current &&
            phoneClip !== lastSeenPcClipRef.current
          ) {
            // User copied something on Phone! Auto-push to PC clipboard
            const trimmed = phoneClip.trim();
            lastSeenPhoneClipRef.current = trimmed;
            lastSeenPcClipRef.current = trimmed;
            setPcClipboardText(trimmed);
            setPcClipboardUpdatedBy(phoneModelName || 'Mobile Companion');
            await apiFetch(`http://${pairedPc}/api/clipboard`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Auth-Token': pcAuthToken || '' },
              body: JSON.stringify({
                text: trimmed,
                updatedBy: phoneModelName || 'Mobile Companion',
              }),
            }, 3500);
            return;
          }
        } catch (e) {}
      }

      // 2. Fetch PC Clipboard
      const res = await apiFetch(`http://${pairedPc}/api/clipboard`, {
        headers: { 'X-Auth-Token': pcAuthToken || '' },
      }, 3500);
      if (res.ok) {
        const data = await safeJson(res);
        if (data && data.text !== undefined && data.text !== lastSeenPcClipRef.current) {
          lastSeenPcClipRef.current = data.text;
          setPcClipboardText(data.text);
          setPcClipboardUpdatedBy(data.updatedBy || 'Windows PC');

          // If auto-sync is enabled and PC text differs from phone, automatically write to Android native clipboard!
          if (clipboardAutoSync && data.text && data.text !== lastSeenPhoneClipRef.current) {
            lastSeenPhoneClipRef.current = data.text;
            if (FyloModule && FyloModule.setClipboardText) {
              try {
                await FyloModule.setClipboardText(data.text);
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {}
  };

  const handlePushClipboardToPc = async (textToSend) => {
    const text = textToSend !== undefined ? textToSend : clipboardInput;
    if (!text || !text.trim()) {
      showToast('⚠️ Please enter text to push');
      return;
    }
    if (!pairedPc) {
      showToast('⚠️ Pair with PC first to share clipboard');
      return;
    }

    try {
      const trimmed = text.trim();
      lastSeenPhoneClipRef.current = trimmed;
      lastSeenPcClipRef.current = trimmed;
      const res = await apiFetch(`http://${pairedPc}/api/clipboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': pcAuthToken || '' },
        body: JSON.stringify({
          text: trimmed,
          updatedBy: phoneModelName || 'Mobile Companion',
        }),
      }, 5000);

      const data = await safeJson(res);
      if (res.ok && data && data.success) {
        setPcClipboardText(trimmed);
        setPcClipboardUpdatedBy(phoneModelName || 'Phone Companion');
        if (textToSend === undefined) {
          setClipboardInput('');
        }
        showToast('⚡ Pushed to PC clipboard! 📋');
      } else {
        showToast('⚠️ PC rejected clipboard update');
      }
    } catch (e) {
      showToast('⚠️ Could not reach PC: ' + (e?.message || 'Error'));
    }
  };

  const handleCopyPcClipboardToPhone = async () => {
    if (!pcClipboardText) {
      showToast('⚠️ PC clipboard is empty');
      return;
    }
    try {
      lastSeenPhoneClipRef.current = pcClipboardText;
      if (FyloModule && FyloModule.setClipboardText) {
        await FyloModule.setClipboardText(pcClipboardText);
        showToast('📋 Copied PC text to Phone clipboard!');
      } else {
        showToast('📋 Copied to clipboard!');
      }
    } catch (e) {
      showToast('📋 Text copied: ' + pcClipboardText.substring(0, 40));
    }
  };

  // ==========================================
  // REQUIREMENT 2 & 4: Phone Explorer Functions
  // ==========================================
  const loadPhoneFolder = async (folderPath, isBack = false) => {
    setPhoneLoading(true);
    try {
      const targetPath = folderPath || '/storage/emulated/0';
      if (!isBack && phoneCurrentPath && targetPath !== phoneCurrentPath) {
        setPhoneHistory((prev) => [...prev, phoneCurrentPath]);
      }

      if (FyloModule && FyloModule.listDirectory) {
        const result = await FyloModule.listDirectory(folderPath || '');
        if (result) {
          setPhoneCurrentPath(result.path || targetPath);
          setPhoneParentPath(result.parent || '');
          setPhoneItems(Array.isArray(result.items) ? result.items : []);
        }
      } else {
        setPhoneCurrentPath(targetPath);
        setPhoneParentPath(folderPath ? '/storage/emulated/0' : '');
        setPhoneItems([]);
      }
      setPhoneSelectedPaths(new Set());
    } catch (err) {
      showToast('Could not open folder: ' + (err?.message || 'Error'));
    } finally {
      setPhoneLoading(false);
    }
  };

  // ==========================================
  // FAST SHARE & NATIVE FILE PICKER TO PC
  // ==========================================
  const handlePickAndSendToPc = async () => {
    if (!pairedPc) {
      setShowPairModal(true);
      showToast('⚡ Pair with PC to send files!');
      return;
    }

    try {
      if (!FyloModule || !FyloModule.openNativeFilePicker) {
        showToast('⚠️ Native file picker is not available');
        return;
      }

      // DIRECT NATIVE ANDROID FILE PICKER
      const files = await FyloModule.openNativeFilePicker(true);
      if (!files || !Array.isArray(files) || files.length === 0) {
        return;
      }

      setIsSending(true);
      showToast(`🚀 Sending ${files.length} file(s) to ${pcHostName || 'PC'}...`);

      let successCount = 0;
      const sentFiles = [];

      for (const file of files) {
        try {
          const res = await apiFetch(`http://${pairedPc}/api/mobile/fs/download-direct`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Auth-Token': pcAuthToken || '',
            },
            body: JSON.stringify({
              deviceId: deviceIdRef.current,
              path: file.path,
            }),
          }, 15000);
          const data = await safeJson(res);
          if (data && data.success) {
            successCount++;
            sentFiles.push({
              name: file.name,
              path: file.path,
              size: file.size,
              mimeType: file.mimeType,
              savedPath: data.savedPath,
              source: 'phone',
              direction: 'sent',
              time: Date.now(),
            });
          }
        } catch (err) {
          console.warn('Direct send error:', err);
        }
      }

      // Notify PC Share Hub so they immediately appear in the PC Share Hub!
      if (sentFiles.length > 0) {
        try {
          await apiFetch(`http://${pairedPc}/api/files/share-event`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Auth-Token': pcAuthToken || '',
            },
            body: JSON.stringify({
              files: sentFiles,
              deviceName: phoneModelName,
            }),
          }, 6000);
        } catch (e) {
          console.warn('Share event notify error:', e);
        }

        // Refresh Mobile Share Hub list
        fetchSharedHubFiles();
      }

      setIsSending(false);
      if (successCount > 0) {
        showToast(`✅ Sent ${successCount} file(s) to PC! 🎉`);
      } else {
        showToast('⚠️ Send failed. Check PC connection.');
      }
    } catch (err) {
      console.warn('openNativeFilePicker error:', err);
      setIsSending(false);
      showToast('⚠️ Could not open file picker');
    }
  };

  const handleSendFilesToPc = async (pathsToSend) => {
    if (!pairedPc) {
      setShowPairModal(true);
      showToast('⚡ Pair with PC to send files!');
      return;
    }
    const pathArray = Array.from(pathsToSend);
    if (pathArray.length === 0) {
      showToast('⚠️ No files selected to send');
      return;
    }

    setIsSending(true);
    showToast(`🚀 Sending ${pathArray.length} file(s) to PC Downloads...`);
    let successCount = 0;
    const sentFiles = [];

    for (const fPath of pathArray) {
      try {
        const res = await apiFetch(`http://${pairedPc}/api/mobile/fs/download-direct`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': pcAuthToken || '',
          },
          body: JSON.stringify({
            deviceId: deviceIdRef.current,
            path: fPath,
          }),
        }, 15000);
        const data = await safeJson(res);
        if (data && data.success) {
          successCount++;
          const fileName = fPath.split(/[/\\]/).pop();
          sentFiles.push({
            name: fileName,
            path: fPath,
            savedPath: data.savedPath,
            direction: 'sent',
            time: Date.now(),
          });
        }
      } catch (e) {
        console.warn('Send error:', e);
      }
    }

    if (sentFiles.length > 0) {
      try {
        await apiFetch(`http://${pairedPc}/api/files/share-event`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': pcAuthToken || '',
          },
          body: JSON.stringify({
            files: sentFiles,
            deviceName: phoneModelName,
          }),
        }, 6000);
      } catch (ignored) {}
      fetchSharedHubFiles();
    }

    setIsSending(false);
    if (successCount > 0) {
      showToast(`✅ Sent ${successCount} file(s) to PC! 🎉`);
      setPhoneSelectedPaths(new Set());
    } else {
      showToast('⚠️ Send failed. Check PC connection.');
    }
  };

  // Handle Android System Direct Share (Opens Device Picker interface)
  useEffect(() => {
    const handleIncomingFiles = (files) => {
      if (!files || !Array.isArray(files) || files.length === 0) return;
      const validPaths = files.map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean);
      if (validPaths.length === 0) return;

      setDirectSharePendingFiles(files);
      setDirectShareModalVisible(true);
      if (FyloModule && FyloModule.clearPendingSharedFiles) {
        FyloModule.clearPendingSharedFiles();
      }
    };

    // Check for pending shared files on launch
    if (FyloModule && FyloModule.getPendingSharedFiles) {
      FyloModule.getPendingSharedFiles()
        .then((files) => {
          if (files && files.length > 0) {
            handleIncomingFiles(files);
          }
        })
        .catch(() => {});
    }

    // Listen for runtime direct shares while app is open/foregrounded
    const sub = DeviceEventEmitter.addListener('onFilesShared', (data) => {
      const files = Array.isArray(data) ? data : (data?.files || []);
      if (files.length > 0) {
        handleIncomingFiles(files);
      }
    });

    return () => {
      sub.remove();
    };
  }, [pairedPc, pcAuthToken]);

  // Auto-Discovery of PC on local Wi-Fi & Resumable Transfer Progress Listeners
  useEffect(() => {
    const subDiscovery = DeviceEventEmitter.addListener('onDeviceDiscovered', (device) => {
      if (!device || !device.ip) return;
      setDiscoveredDevices((prev) => {
        const key = `${device.ip}:${device.port || 3000}`;
        const exists = prev.some((d) => `${d.ip}:${d.port || 3000}` === key);
        if (!exists) {
          addLog(`Discovered PC: ${device.name || 'Windows PC'} (${device.ip}:${device.port || 3000})`);
          return [...prev, device];
        }
        return prev;
      });
    });

    const subProgress = DeviceEventEmitter.addListener('onTransferProgress', (prog) => {
      if (prog) {
        setTransferProgress(prog);
        if (prog.percent >= 100) {
          setTimeout(() => setTransferProgress(null), 2500);
        }
      }
    });

    if (FyloModule && FyloModule.startDiscovery) {
      FyloModule.startDiscovery().catch(() => {});
    }

    return () => {
      subDiscovery.remove();
      subProgress.remove();
      if (FyloModule && FyloModule.stopDiscovery) {
        FyloModule.stopDiscovery().catch(() => {});
      }
    };
  }, []);

  // Directory Breadcrumb navigation helper
  const renderBreadcrumbs = (currentPath, onSelectPath, isPc = false) => {
    if (!currentPath || typeof currentPath !== 'string') return null;
    const delimiter = isPc && currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(delimiter).filter(Boolean);

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breadcrumbScroll}>
        <TouchableOpacity
          style={[styles.breadcrumbItem, !isDarkMode && styles.breadcrumbItemLight]}
          onPress={() => onSelectPath(isPc ? 'C:\\' : '/storage/emulated/0')}>
          <Text style={[styles.breadcrumbTextRoot, !isDarkMode && styles.breadcrumbTextRootLight]}>{isPc ? 'PC' : 'Phone'}</Text>
        </TouchableOpacity>

        {parts.map((part, index) => {
          if (!isPc && (part === 'storage' || part === 'emulated')) return null;
          const subPath = isPc
            ? parts.slice(0, index + 1).join('\\') + (index === 0 ? '\\' : '')
            : '/' + parts.slice(0, index + 1).join('/');
          const isLast = index === parts.length - 1;

          return (
            <View key={subPath} style={styles.breadcrumbSegmentWrap}>
              <Text style={[styles.breadcrumbSeparator, !isDarkMode && styles.breadcrumbSeparatorLight]}>›</Text>
              <TouchableOpacity
                style={[
                  styles.breadcrumbItem,
                  !isDarkMode && styles.breadcrumbItemLight,
                  isLast && (isDarkMode ? styles.breadcrumbItemActive : styles.breadcrumbItemActiveLight),
                ]}
                disabled={isLast}
                onPress={() => onSelectPath(subPath)}>
                <Text
                  style={[
                    styles.breadcrumbText,
                    !isDarkMode && styles.breadcrumbTextLight,
                    isLast && (isDarkMode ? styles.breadcrumbTextActive : styles.breadcrumbTextActiveLight),
                  ]}
                  numberOfLines={1}>
                  {part}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  // Download PC file to local Android Downloads/Fylo folder
  const handleDownloadPcFile = async (filePath, fileName) => {
    if (!pairedPc) {
      showToast('⚠️ Pair with PC first to download files');
      return;
    }
    const cleanName = fileName || (filePath ? filePath.substring(filePath.lastIndexOf('\\') + 1) : 'pc_file');
    const downloadUrl = `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(filePath)}&auth=${pcAuthToken || ''}`;
    try {
      showToast(`📥 Saving "${cleanName}" to Downloads/Fylo...`);
      if (FyloModule && FyloModule.downloadFileFromUrl) {
        await FyloModule.downloadFileFromUrl(downloadUrl, cleanName);
        showToast(`✓ Saved "${cleanName}" to Downloads/Fylo 📥`);
      } else {
        const res = await apiFetch(downloadUrl);
        if (res.ok) {
          showToast(`✓ Received "${cleanName}"`);
        } else {
          showToast('⚠️ PC download failed');
        }
      }
    } catch (e) {
      showToast('⚠️ Download error: ' + (e?.message || 'Failed'));
    }
  };

  // ==========================================
  // REQUIREMENT 2 & 4: PC Remote Explorer Functions
  // ==========================================
  const loadPcQuickAccess = async () => {
    if (!pairedPc) return;
    try {
      const res = await apiFetch(`http://${pairedPc}/api/pc/explorer/quick-access`, {
        headers: { 'X-Auth-Token': pcAuthToken || '' },
      }, 5000);
      if (res.ok) {
        const data = await safeJson(res);
        if (data) {
          setPcQuickAccess({
            drives: Array.isArray(data.drives) ? data.drives : [],
            shortcuts: Array.isArray(data.shortcuts) ? data.shortcuts : [],
          });
          if (Array.isArray(data.shortcuts) && data.shortcuts.length > 0 && !pcCurrentPath && data.shortcuts[0]?.path) {
            loadPcFolder(data.shortcuts[0].path);
          }
        }
      }
    } catch (err) {
      console.log('Error loading PC quick access:', err);
    }
  };

  const loadPcFolder = async (folderPath, isBack = false) => {
    if (!pairedPc) return;
    setPcLoading(true);
    try {
      const targetPath = folderPath || 'C:\\';
      if (!isBack && pcCurrentPath && targetPath !== pcCurrentPath) {
        setPcHistory((prev) => [...prev, pcCurrentPath]);
      }

      const url = folderPath
        ? `http://${pairedPc}/api/pc/explorer/list?path=${encodeURIComponent(folderPath)}`
        : `http://${pairedPc}/api/pc/explorer/list`;

      const res = await apiFetch(url, {
        headers: { 'X-Auth-Token': pcAuthToken || '' },
      }, 8000);
      if (res.ok) {
        const data = await safeJson(res);
        if (data) {
          setPcCurrentPath(data.path || targetPath);
          setPcParentPath(data.parent || '');
          setPcItems(Array.isArray(data.items) ? data.items : []);
          setPcSelectedPaths(new Set());
        }
      } else {
        showToast('⚠️ Could not open folder on PC');
      }
    } catch (err) {
      showToast('⚠️ Failed to reach PC: ' + (err?.message || 'Error'));
    } finally {
      setPcLoading(false);
    }
  };

  // Helpers
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileIcon = (ext, isDir) => {
    if (isDir) return '📁';
    const e = (ext || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'bmp', 'svg'].includes(e)) return '🖼️';
    if (['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv'].includes(e)) return '🎬';
    if (['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'].includes(e)) return '🎵';
    if (['pdf'].includes(e)) return '📕';
    if (['doc', 'docx', 'txt', 'rtf', 'md'].includes(e)) return '📄';
    if (['xls', 'xlsx', 'csv'].includes(e)) return '📊';
    if (['ppt', 'pptx'].includes(e)) return '📑';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return '📦';
    if (['apk'].includes(e)) return '🤖';
    if (['exe', 'msi', 'bat', 'cmd'].includes(e)) return '⚙️';
    return '📄';
  };

  const isImageFile = (ext) => {
    const e = (ext || '').toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(e);
  };

  const isVideoFile = (ext) => {
    const e = (ext || '').toLowerCase();
    return ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', '3gp', 'wmv'].includes(e);
  };

  const isAudioFile = (ext) => {
    const e = (ext || '').toLowerCase().replace(/^\./, '');
    return ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'wma', 'amr', 'mid', 'midi'].includes(e);
  };

  const isViewableMedia = (ext) => isImageFile(ext) || isVideoFile(ext);
  const isMediaFile = (ext) => isImageFile(ext) || isVideoFile(ext);

  const getMimeTypeForExt = (ext) => {
    const e = (ext || '').toLowerCase().replace(/^\./, '');
    const map = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      csv: 'text/csv',
      html: 'text/html',
      htm: 'text/html',
      json: 'application/json',
      xml: 'application/xml',
      zip: 'application/zip',
      rar: 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      tar: 'application/x-tar',
      gz: 'application/gzip',
      apk: 'application/vnd.android.package-archive',
      epub: 'application/epub+zip',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      flac: 'audio/flac',
      opus: 'audio/opus',
      wma: 'audio/x-ms-wma',
      mp4: 'video/mp4',
      mkv: 'video/x-matroska',
      webm: 'video/webm',
      avi: 'video/avi',
      mov: 'video/quicktime',
      '3gp': 'video/3gpp',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      svg: 'image/svg+xml',
    };
    return map[e] || '*/*';
  };

  const playInbuiltAudio = (file, source = 'phone') => {
    if (!file) return;
    const pathOrUrl = source === 'pc'
      ? (file.downloadUrl
          ? file.downloadUrl
          : (pairedPc ? `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(file.path || '')}&auth=${pcAuthToken || ''}` : null))
      : file.path;
    if (pathOrUrl && FyloModule && FyloModule.openVideoPlayer) {
      FyloModule.openVideoPlayer(pathOrUrl, 'audio/*');
    } else {
      setLightboxItem({ item: file, source, index: 0, playlist: [file] });
    }
  };

  const openExternalFileOrChooser = async (file, source = 'phone', mode = 'auto') => {
    if (!file) return;
    const fileName = file.name || file.path?.split(/[\\/]/).pop() || 'file';
    const fileExt = file.ext || (fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '');
    const mimeType = getMimeTypeForExt(fileExt);

    if (source === 'phone') {
      const filePath = file.path;
      if (!filePath) {
        showToast('⚠️ Local file path is not available');
        return;
      }
      if (FyloModule && FyloModule.openFileWithChooser) {
        try {
          await FyloModule.openFileWithChooser(filePath, mimeType);
        } catch (err) {
          console.warn('openFileWithChooser error:', err);
          showToast(err?.message || '⚠️ No app found on phone to open this file');
        }
      } else {
        showToast('⚠️ Native app chooser is not available');
      }
    } else {
      // source === 'pc'
      const downloadUrl = file.downloadUrl
        ? file.downloadUrl
        : (pairedPc ? `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(file.path || '')}${pcAuthToken ? `&auth=${pcAuthToken}` : ''}` : null);

      if (!downloadUrl) {
        showToast('⚠️ Cannot access PC file without connection');
        return;
      }

      // For Video and Audio files: NEVER download the whole file just to stream it!
      // Directly stream via external media players (VLC, MX Player, etc.) with 0-second buffering
      if (isVideoFile(fileExt) || isAudioFile(fileExt)) {
        const streamMime = isVideoFile(fileExt) ? 'video/*' : 'audio/*';
        if (FyloModule && FyloModule.openUrlWithChooser) {
          try {
            await FyloModule.openUrlWithChooser(downloadUrl, streamMime, `Stream ${fileName}`);
            return;
          } catch (err) {
            console.warn('openUrlWithChooser failed for stream:', err);
            showToast('⚠️ No player app (like VLC or MX Player) found to stream this file');
            return;
          }
        }
      }

      if (mode === 'download') {
        await handleDownloadPcFile(file.path, file.name);
        return;
      }

      // Try opening directly via URL with Android native chooser (VLC, MX Player, Office, Drive, browsers)
      if (FyloModule && FyloModule.openUrlWithChooser) {
        try {
          await FyloModule.openUrlWithChooser(downloadUrl, mimeType, `Open ${fileName}`);
          return;
        } catch (err) {
          console.warn('openUrlWithChooser failed:', err);
          showToast('⚠️ No app found to stream this file directly. Please use "Download to Phone".');
          return;
        }
      } else {
        showToast('⚠️ Native app chooser is not available');
      }
    }
  };

  const handleOpenPcFileInApp = async (file) => {
    if (!file) return;
    const fileName = file.name || file.path?.split(/[\\/]/).pop() || 'file';
    const fileExt = file.ext || (fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '');
    const mimeType = getMimeTypeForExt(fileExt);
    const downloadUrl = file.downloadUrl
      ? file.downloadUrl
      : (pairedPc ? `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(file.path || '')}${pcAuthToken ? `&auth=${pcAuthToken}` : ''}` : null);

    if (!downloadUrl) {
      showToast('⚠️ Cannot access PC file without connection');
      return;
    }

    if (FyloModule && FyloModule.openUrlWithChooser) {
      try {
        await FyloModule.openUrlWithChooser(downloadUrl, mimeType, `Open ${fileName}`);
      } catch (err) {
        console.warn('openUrlWithChooser failed:', err);
        showToast('⚠️ No app found to stream this file directly. Please use "Download to Phone".');
      }
    } else {
      showToast('⚠️ Native app chooser is not available');
    }
  };

  // ==========================================
  // Active Share Hub Operations (Fetch from PC)
  // ==========================================
  const fetchSharedHubFiles = useCallback(async () => {
    if (!pairedPc) return;
    try {
      const res = await apiFetch(`http://${pairedPc}/api/files`, {
        headers: { 'X-Auth-Token': pcAuthToken || '' },
      }, 4000);
      if (res.ok) {
        const data = await safeJson(res);
        if (Array.isArray(data)) {
          const mapped = data.map((f) => {
            const isSentByPhone = f.uploadedBy === 'Mobile Phone' || f.ownerSessionId === 'mobile' || f.direction === 'sent';
            const dl = f.downloadUrl
              ? (f.downloadUrl.startsWith('http') ? f.downloadUrl : `http://${pairedPc}${f.downloadUrl}`)
              : `http://${pairedPc}/api/download/${f.id}`;
            const fullDlUrl = `${dl}${dl.includes('?') ? '&' : '?'}auth=${pcAuthToken || ''}`;
            return {
              id: f.id,
              name: f.name,
              size: f.size,
              sizeLabel: f.sizeLabel || (f.size ? formatFileSize(f.size) : 'Ready'),
              ext: f.ext || (f.name ? f.name.split('.').pop().toLowerCase() : ''),
              path: f.path,
              phonePath: f.phonePath || (isSentByPhone && f.path && !f.path.includes('\\') ? f.path : null),
              downloadUrl: fullDlUrl,
              direction: isSentByPhone ? 'sent' : 'received',
              uploadedBy: f.uploadedBy || (isSentByPhone ? 'Mobile Phone' : 'Host PC'),
              sharedAt: Number(f.sharedAt || f.timestamp || f.modified || Date.now()),
              type: f.type || 'file',
            };
          });
          setSharedHubFiles(mapped);
        }
      }
    } catch (e) {
      // transient network error
    }
  }, [pairedPc, pcAuthToken]);

  const handleDownloadSharedHubFile = async (file) => {
    if (!file || !file.name) return;
    if (!pairedPc) {
      showToast('⚠️ Pair with PC first to download files');
      return;
    }
    const cleanName = (file.name || 'file').replace(/[\\/:*?"<>|]/g, '_');
    const dlUrl = file.downloadUrl || `http://${pairedPc}/api/download/${file.id}?auth=${pcAuthToken || ''}`;

    try {
      showToast(`📥 Saving "${cleanName}" to Downloads/Fylo...`);
      if (FyloModule && FyloModule.downloadFileFromUrl) {
        await FyloModule.downloadFileFromUrl(dlUrl, cleanName);
        setDownloadedSharedIds((prev) => new Set(prev).add(file.id || file.name));
        showToast(`✓ Saved "${cleanName}" to Downloads/Fylo 📥`);
      } else {
        const res = await apiFetch(dlUrl);
        if (res.ok) {
          setDownloadedSharedIds((prev) => new Set(prev).add(file.id || file.name));
          showToast(`✓ Saved "${cleanName}"`);
        } else {
          showToast('⚠️ PC download failed');
        }
      }
    } catch (e) {
      showToast('⚠️ Download error: ' + (e?.message || 'Failed'));
    }
  };

  const handleDownloadAllSharedHubFiles = async () => {
    const received = sharedHubFiles.filter((f) => f.direction === 'received');
    if (received.length === 0) {
      showToast('No files from PC available to save');
      return;
    }
    showToast(`📥 Saving ${received.length} file(s) from PC...`);
    let count = 0;
    for (let i = 0; i < received.length; i++) {
      const f = received[i];
      try {
        const cleanName = (f.name || 'file').replace(/[\\/:*?"<>|]/g, '_');
        const dlUrl = f.downloadUrl || `http://${pairedPc}/api/download/${f.id}?auth=${pcAuthToken || ''}`;
        showToast(`Saving (${i + 1}/${received.length}) ${cleanName}...`);
        if (FyloModule && FyloModule.downloadFileFromUrl) {
          await FyloModule.downloadFileFromUrl(dlUrl, cleanName);
        } else {
          await apiFetch(dlUrl);
        }
        setDownloadedSharedIds((prev) => new Set(prev).add(f.id || f.name));
        count++;
      } catch (e) {
        console.warn('Batch download error for:', f.name, e);
      }
    }
    showToast(`✓ Saved ${count} file(s) to Downloads/Fylo 📥`);
  };

  const handleSharedHubItemPress = (file) => {
    if (!file) return;
    const isSentByPhone = file.direction === 'sent' || file.uploadedBy === 'Mobile Phone' || file.ownerSessionId === 'mobile';
    const ext = file.ext || (file.name || '').split('.').pop().toLowerCase();
    const resolvedPath = file.phonePath || file.path || file.name;

    if (isAudioFile(ext)) {
      playInbuiltAudio(file, isSentByPhone ? 'phone' : 'pc');
      return;
    }

    if (isVideoFile(ext)) {
      const mediaFiles = sharedHubFiles.filter((f) => isVideoFile(f.ext));
      const idx = mediaFiles.findIndex((f) => (f.id && file.id && f.id === file.id) || f.name === file.name || (f.path && file.path && f.path === file.path));
      const activeIdx = idx >= 0 ? idx : 0;
      setLightboxItem({
        item: {
          ...file,
          path: resolvedPath,
        },
        source: isSentByPhone ? 'phone' : 'pc',
        index: activeIdx,
        playlist: mediaFiles.length > 0 ? mediaFiles : [file],
      });
      return;
    }

    const isImg = isImageFile(ext);

    if (isImg) {
      const mediaFiles = sharedHubFiles.filter((f) => isViewableMedia(f.ext));
      const idx = mediaFiles.findIndex((f) => (f.id && file.id && f.id === file.id) || f.name === file.name || (f.path && file.path && f.path === file.path));
      const activeIdx = idx >= 0 ? idx : 0;
      setLightboxItem({
        item: {
          ...file,
          path: resolvedPath,
        },
        source: isSentByPhone ? 'phone' : 'pc',
        index: activeIdx,
        playlist: mediaFiles.length > 0 ? mediaFiles : [file],
      });
      return;
    }

    // Non-media files (PDF, DOCX, APK, ZIP, etc.)
    if (isSentByPhone) {
      // If the file was sent from the phone (already on the phone): opens with phone app chooser.
      openExternalFileOrChooser({
        ...file,
        path: resolvedPath,
      }, 'phone');
    } else {
      // If the file is from PC and non-media: shows the sleek file action prompt with "⬇️ Save to Phone", "↗ Open with App", and "Cancel".
      setPcFileActionPrompt({
        file,
        source: 'sharehub',
      });
    }
  };

  const getSortLabel = (mode) => {
    switch (mode) {
      case 'latest': return 'Latest';
      case 'oldest': return 'Oldest';
      case 'name': return 'Name (A→Z)';
      case 'name-desc': return 'Name (Z→A)';
      case 'size': return 'Size (Max)';
      case 'size-asc': return 'Size (Min)';
      case 'type-asc': return 'Type (A→Z)';
      case 'type-desc': return 'Type (Z→A)';
      default: return 'Latest';
    }
  };

  // =========================================================
  // REQUIREMENT 4: SORTING (STRICT DEFAULT: LATEST-FIRST)
  // =========================================================
  const filteredPhoneItems = useMemo(() => {
    if (!Array.isArray(phoneItems)) return [];
    const searchLower = (phoneSearch || '').toLowerCase().trim();
    const filtered = phoneItems.filter((item) => {
      if (!item || !item.name) return false;
      if (searchLower && !item.name.toLowerCase().includes(searchLower)) {
        return false;
      }
      if (phoneFilter === 'all') return true;
      if (phoneFilter === 'folders') return !!item.isDir;
      if (item.isDir) return false;
      const ext = (item.ext || '').toLowerCase();
      if (phoneFilter === 'photos') return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext);
      if (phoneFilter === 'videos') return ['mp4', 'mkv', 'mov', 'webm'].includes(ext);
      if (phoneFilter === 'audio') return ['mp3', 'wav', 'm4a', 'flac', 'ogg'].includes(ext);
      if (phoneFilter === 'docs') return ['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx'].includes(ext);
      return true;
    });
    return sortExplorerItems(filtered, phoneSortBy);
  }, [phoneItems, phoneFilter, phoneSearch, phoneSortBy]);

  const filteredPcItems = useMemo(() => {
    if (!Array.isArray(pcItems)) return [];
    const searchLower = (pcSearch || '').toLowerCase().trim();
    const filtered = pcItems.filter((item) => {
      if (!item || !item.name) return false;
      if (searchLower && !item.name.toLowerCase().includes(searchLower)) {
        return false;
      }
      if (pcFilter === 'all') return true;
      if (pcFilter === 'folders') return !!item.isDir;
      if (item.isDir) return false;
      const ext = (item.ext || '').toLowerCase();
      if (pcFilter === 'photos') return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
      if (pcFilter === 'videos') return ['mp4', 'mkv', 'mov', 'webm'].includes(ext);
      if (pcFilter === 'audio') return ['mp3', 'wav', 'm4a', 'flac'].includes(ext);
      if (pcFilter === 'docs') return ['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx'].includes(ext);
      return true;
    });
    return sortExplorerItems(filtered, pcSortBy);
  }, [pcItems, pcFilter, pcSearch, pcSortBy]);

  const filteredShareHubFiles = useMemo(() => {
    if (!Array.isArray(sharedHubFiles)) return [];
    if (!shareHubSearch.trim()) return sharedHubFiles;
    const query = shareHubSearch.toLowerCase().trim();
    return sharedHubFiles.filter((f) => (f.name || '').toLowerCase().includes(query));
  }, [sharedHubFiles, shareHubSearch]);

  // Admin Protected Action Handler
  const requestAdminProtectedAction = (actionTitle, callback) => {
    setAdminActionTitle(actionTitle);
    setAdminPasswordInput('');
    setAdminActionCallback(() => callback);
    setAdminModalVisible(true);
  };

  const handleExecuteAdminAction = async () => {
    if (!adminPasswordInput) {
      showToast('⚠️ Please enter Admin password');
      return;
    }

    try {
      if (adminActionCallback) {
        await adminActionCallback(adminPasswordInput);
      }
      setAdminModalVisible(false);
      setAdminPasswordInput('');
    } catch (e) {
      showToast('⚠️ ' + (e?.message || 'Incorrect password or operation error.'));
    }
  };

  // Run Network Diagnostic Test
  const runNetworkDiagnostic = async () => {
    setDiagStatus('testing');
    setDiagMessage('Testing local network latency and packet stability...');

    setTimeout(async () => {
      if (!pairedPc) {
        setDiagStatus('warning');
        setDiagMessage(
          `📱 Device IP: ${deviceIp}\n\n⚠️ No PC is paired yet.\n\n⚡ For fastest transfer:\n1. Turn on Android Mobile Hotspot.\n2. Connect PC to this Hotspot.\n3. Open Fylo on PC and enter the IP shown.`
        );
        return;
      }

      try {
        const start = Date.now();
        const res = await apiFetch(`http://${pairedPc}/api/connection-info`, {
          headers: { 'X-Auth-Token': pcAuthToken || '' },
        }, 4000);
        const latency = Date.now() - start;

        if (res.ok) {
          const data = await safeJson(res);
          setPingLatency(latency);
          setDiagStatus('success');
          setDiagMessage(
            `🟢 Connection Excellent!\n\n• Target PC: ${pairedPc}\n• Real Latency: ${latency} ms\n• Network: ${data?.networkName || 'Direct Wi-Fi / Hotspot'}\n• Zero packet drop detected.`
          );
        } else {
          setDiagStatus('warning');
          setDiagMessage(`⚠️ PC responded with status ${res.status}. Check token or restart server.`);
        }
      } catch (err) {
        setDiagStatus('warning');
        setDiagMessage(
          `🔴 Connection Timeout!\n\nCould not reach PC at ${pairedPc}.\n\nFix Options:\n1. Router AP Isolation blocks device-to-device communication.\n2. Recommended: Enable Phone Mobile Hotspot and connect PC to it.\n3. Verify Windows Firewall allows Fylo on Private Networks.`
        );
      }
    }, 500);
  };

  // Quick category jumper handler
  const handleCategoryJump = (category) => {
    setPhoneFilter(category);
    setCurrentTab('phone-explorer');
    if (category === 'photos') {
      loadPhoneFolder('/storage/emulated/0/DCIM');
    } else if (category === 'downloads') {
      loadPhoneFolder('/storage/emulated/0/Download');
    } else if (category === 'videos') {
      loadPhoneFolder('/storage/emulated/0/Movies');
    } else if (category === 'audio') {
      loadPhoneFolder('/storage/emulated/0/Music');
    } else {
      loadPhoneFolder('/storage/emulated/0');
    }
  };

  // Cycle sort mode helper
  const cycleSortMode = (type) => {
    if (type === 'phone') {
      const next = phoneSortBy === 'latest' ? 'name' : phoneSortBy === 'name' ? 'size' : phoneSortBy === 'size' ? 'type-asc' : 'latest';
      setPhoneSortBy(next);
      showToast(`Sorted by: ${getSortLabel(next)}`);
    } else {
      const next = pcSortBy === 'latest' ? 'name' : pcSortBy === 'name' ? 'size' : pcSortBy === 'size' ? 'type-asc' : 'latest';
      setPcSortBy(next);
      showToast(`Sorted by: ${getSortLabel(next)}`);
    }
  };

  // Compute storage statistics
  const storageStats = useMemo(() => {
    const total = parseFloat(storageInfo.totalGB) || 0;
    const free = parseFloat(storageInfo.freeGB) || 0;
    const used = total > 0 ? (total - free).toFixed(1) : 0;
    const usedPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
    return {
      usedGB: `${used} GB`,
      freeGB: `${free} GB`,
      totalGB: `${total} GB`,
      usedPercent: Math.max(5, Math.min(98, usedPercent)),
    };
  }, [storageInfo]);

  // 3-Column dynamic tile width for responsive grid
  const GRID_TILE_WIDTH = (SCREEN_WIDTH - 32 - 16) / 3;

  return (
    <View style={[styles.container, !isDarkMode && styles.containerLight]}>
      <StatusBar
        translucent={true}
        backgroundColor="transparent"
        barStyle={isDarkMode ? "light-content" : "dark-content"}
      />

      {/* ========================================================= */}
      {/* TOP HEADER: Clean elevated bar with squircle & latency pill */}
      {/* ========================================================= */}
      <View style={[styles.topHeader, !isDarkMode && styles.topHeaderLight]}>
        <View style={styles.brandRow}>
          <View style={styles.brandLeftGroup}>
            {/* Rounded Squircle Hamburger Menu Button */}
            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.hamburgerBtn, !isDarkMode && styles.hamburgerBtnLight]}
              onPress={openSidebar}>
              <VectorHamburger isDark={isDarkMode} />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.brandLeft}
              onPress={() => setCurrentTab('home')}>
              <View style={styles.brandCircle}>
                <Text style={styles.brandCircleText}>F</Text>
              </View>
              <View>
                <Text style={[styles.brandTitle, !isDarkMode && styles.brandTitleLight]}>fylo</Text>
                <Text style={[styles.brandSub, !isDarkMode && styles.brandSubLight]}>
                  {currentTab === 'home' ? 'Home' :
                   currentTab === 'sharehub' ? 'ShareHub' :
                   currentTab === 'phone-explorer' ? 'Phone Storage' :
                   currentTab === 'pc-explorer' ? 'PC Drives' :
                   currentTab === 'clipboard' ? 'Shared Clip' : 'Speed Hub'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Elevated Latency / Connection Pill */}
          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.topLatencyPill, !isDarkMode && styles.topLatencyPillLight]}
            onPress={() => {
              if (pairedPc) {
                setDiagVisible(true);
                runNetworkDiagnostic();
              } else {
                setShowPairModal(true);
              }
            }}>
            <View style={[styles.topLatencyDot, { backgroundColor: pairedPc ? (isPcReachable ? '#22c55e' : '#ef4444') : '#3b82f6' }]} />
            <Text style={[styles.topLatencyText, !isDarkMode && styles.topLatencyTextLight]} numberOfLines={1}>
              {pairedPc ? (isPcReachable ? (pingLatency !== null ? `${pingLatency} ms` : '22 ms') : 'PC Offline') : 'Connect PC'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Floating Toast Notification */}
      {clipboardToast !== '' && (
        <View style={styles.toastWrap}>
          <Text style={styles.toastText}>{clipboardToast}</Text>
        </View>
      )}

      {/* Live Chunked Resumable Transfer Progress Banner */}
      {transferProgress && (
        <View style={[styles.transferProgressWrap, !isDarkMode && styles.transferProgressWrapLight]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={[styles.transferProgressTitle, !isDarkMode && styles.transferProgressTitleLight]} numberOfLines={1}>
              📥 {transferProgress.fileName}
            </Text>
            <Text style={styles.transferProgressPct}>
              {transferProgress.percent}%
            </Text>
          </View>
          <View style={styles.transferProgressBarBg}>
            <View style={[styles.transferProgressBarFill, { width: `${Math.min(100, Math.max(2, transferProgress.percent))}%` }]} />
          </View>
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 1: STREAMLINED BENTO HOME DASHBOARD (Matching Image 2) */}
      {/* ========================================================= */}
      {currentTab === 'home' && (
        <View style={{ flex: 1, backgroundColor: isDarkMode ? '#000000' : '#F7F6F2' }} {...homePanResponder.panHandlers}>
          <ScrollView contentContainerStyle={[styles.bentoScroll, isDarkMode ? styles.bentoScrollDark : styles.bentoScrollLight]}
            showsVerticalScrollIndicator={false}>

          {/* Storage Permission Banner if Missing */}
          {!hasPermission && (
            <View style={styles.permissionCard}>
              <View style={styles.permissionCardTop}>
                <Text style={styles.permissionBadge}>ACTION REQUIRED</Text>
                <Text style={styles.permissionTitle}>Storage Permission Needed</Text>
              </View>
              <Text style={styles.permissionDesc}>
                Android requires "All Files Access" so your PC can view and transfer files to this device.
              </Text>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.permissionBtn}
                onPress={handleRequestPermission}>
                <Text style={styles.permissionBtnText}>Grant Storage Access</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 1. HERO CONNECTION STATUS CARD (Alpine Sunrise Landscape) */}
          <View style={[styles.bentoCardHero, !isDarkMode && styles.bentoCardHeroLight]}>
            <AlpineSunriseLandscape isDark={isDarkMode} />

            {pairedPc ? (
              // Connected State
              <View style={{ zIndex: 2 }}>
                <View style={styles.heroTopRow}>
                  {/* Left: Device Icon Badge & Host Details */}
                  <View style={styles.heroLeftGroup}>
                    <View style={[styles.heroDeviceBadge, !isDarkMode && styles.heroDeviceBadgeLight]}>
                      <Text style={{ fontSize: 24 }}>💻</Text>
                      <View style={[styles.heroOnlineDot, !isDarkMode && styles.heroOnlineDotLight, { backgroundColor: isPcReachable ? '#22c55e' : '#ef4444' }]} />
                    </View>
                    <View style={{ flex: 1, justifyContent: 'center' }}>
                      <Text style={[styles.heroConnectedLabel, !isDarkMode && styles.heroConnectedLabelLight]}>
                        {isPcReachable ? 'CONNECTED TO PC' : 'PC OFFLINE'}
                      </Text>
                      <Text style={[styles.heroHostTitle, !isDarkMode && styles.heroHostTitleLight]} numberOfLines={1}>
                        {pcHostName || 'Windows Host'}
                      </Text>
                      <Text style={[styles.heroIpSub, !isDarkMode && styles.heroIpSubLight]}>{pairedPc}</Text>
                    </View>
                  </View>

                  {/* Right: Latency Pill */}
                  <View style={styles.heroRightGroup}>
                    <View style={[styles.heroLatencyPill, !isDarkMode && styles.heroLatencyPillLight]}>
                      <View style={[styles.beaconDot, { backgroundColor: '#22c55e', width: 6, height: 6, borderRadius: 3, marginRight: 4 }]} />
                      <Text style={[styles.heroLatencyText, !isDarkMode && styles.heroLatencyTextLight]}>
                        {isPcReachable ? (pingLatency !== null ? `${pingLatency} ms` : '22 ms') : 'Offline'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Primary Action Buttons */}
                <View style={styles.heroBtnRow}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={[styles.heroPrimaryBtn, !isDarkMode && styles.heroPrimaryBtnLight]}
                    onPress={() => setCurrentTab('pc-explorer')}>
                    <View style={{ marginRight: 6 }}>
                      <Win11FolderIcon size={20} />
                    </View>
                    <Text style={styles.heroPrimaryBtnText}>Browse PC Drives →</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.heroSecondaryBtn, !isDarkMode && styles.heroSecondaryBtnLight]}
                    onPress={handleUnpair}>
                    <Text style={[styles.heroSecondaryBtnText, !isDarkMode && styles.heroSecondaryBtnTextLight]}>
                      🔗 Disconnect
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              // Ready to Pair State
              <View style={{ zIndex: 2 }}>
                <View style={styles.heroTopRow}>
                  <View style={styles.heroLeftGroup}>
                    <View style={[styles.heroDeviceBadge, !isDarkMode && styles.heroDeviceBadgeLight, { backgroundColor: isDarkMode ? 'rgba(16,185,129,0.2)' : '#d1fae5' }]}>
                      <Text style={{ fontSize: 24 }}>⚡</Text>
                      <View style={[styles.heroOnlineDot, !isDarkMode && styles.heroOnlineDotLight, { backgroundColor: '#10b981' }]} />
                    </View>
                    <View style={{ flex: 1, justifyContent: 'center' }}>
                      <Text style={[styles.heroConnectedLabel, !isDarkMode && styles.heroConnectedLabelLight]}>READY TO PAIR</Text>
                      <Text style={[styles.heroHostTitle, !isDarkMode && styles.heroHostTitleLight]} numberOfLines={1}>
                        Fast Wireless Sync
                      </Text>
                      <Text style={[styles.heroIpSub, !isDarkMode && styles.heroIpSubLight]}>Wi-Fi or Hotspot • {deviceIp}</Text>
                    </View>
                  </View>
                </View>

                <Text style={[styles.heroReadySubText, !isDarkMode && styles.heroReadySubTextLight]}>
                  Pair with Fylo desktop app to browse Windows drives, stream media, and sync clipboard without cables.
                </Text>

                {/* Auto-Discovered PC on local Wi-Fi */}
                {discoveredDevices.length > 0 && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={[styles.heroDiscoveredBanner, !isDarkMode && styles.heroDiscoveredBannerLight]}
                    onPress={() => handleConnectToPc(`${discoveredDevices[0].ip}:${discoveredDevices[0].port || 3000}`, discoveredDevices[0].token)}>
                    <View style={styles.heroDiscoveredDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.heroDiscoveredTitle, !isDarkMode && styles.heroDiscoveredTitleLight]} numberOfLines={1}>
                        ✨ Found {discoveredDevices[0].name || 'PC'} on Wi-Fi
                      </Text>
                      <Text style={[styles.heroDiscoveredSub, !isDarkMode && styles.heroDiscoveredSubLight]}>
                        {discoveredDevices[0].ip}:{discoveredDevices[0].port || 3000} • Tap to link instantly ⚡
                      </Text>
                    </View>
                    <Text style={styles.heroDiscoveredBtnText}>Connect →</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.heroBtnRow}>
                  {discoveredDevices.length > 0 ? (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={[styles.heroPrimaryBtn, !isDarkMode && styles.heroPrimaryBtnLight]}
                      onPress={() => handleConnectToPc(`${discoveredDevices[0].ip}:${discoveredDevices[0].port || 3000}`, discoveredDevices[0].token)}>
                      <Text style={styles.heroPrimaryBtnText}>⚡ Link to {discoveredDevices[0].name || 'PC'}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={[styles.heroPrimaryBtn, !isDarkMode && styles.heroPrimaryBtnLight]}
                      onPress={handleStartQrScan}>
                      <Text style={styles.heroPrimaryBtnText}>Scan PC QR Code</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.heroSecondaryBtn, !isDarkMode && styles.heroSecondaryBtnLight]}
                    onPress={() => {
                      setPairModalTab(discoveredDevices.length > 0 ? 'auto' : 'manual');
                      setShowPairModal(true);
                    }}>
                    <Text style={[styles.heroSecondaryBtnText, !isDarkMode && styles.heroSecondaryBtnTextLight]}>
                      {discoveredDevices.length > 0 ? `Devices (${discoveredDevices.length})` : 'Manual IP'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* 2. BENTO PRIMARY TILES (Browse PC & Browse Phone with Alpine Meadow & Ridge) */}
          <View style={styles.bentoPrimaryRow}>
            {/* Card 1: Browse PC (Meadow Monitor Scene) */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.bentoPrimaryCard, !isDarkMode && styles.bentoPrimaryCardLight]}
              onPress={() => {
                if (pairedPc) {
                  setCurrentTab('pc-explorer');
                } else {
                  setShowPairModal(true);
                }
              }}>
              <View style={[styles.bentoPillGreen, !isDarkMode && styles.bentoPillGreenLight]}>
                <View style={[styles.beaconDot, { backgroundColor: '#22c55e', width: 6, height: 6, borderRadius: 3, marginRight: 4 }]} />
                <Text style={[styles.bentoPillGreenText, !isDarkMode && styles.bentoPillGreenTextLight]}>
                  {pairedPc ? (isPcReachable ? 'Online' : 'Offline') : 'Ready'}
                </Text>
              </View>

              <View style={styles.bentoCardMiddleRow}>
                <View style={{ flex: 1, paddingRight: 4 }}>
                  <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Browse PC</Text>
                  <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]} numberOfLines={1}>
                    {pairedPc ? (isPcReachable ? `${pcHostName || 'Windows'} drives` : 'PC unreachable') : 'Pair to explore drives'}
                  </Text>
                </View>
                <MeadowMonitorScene isDark={isDarkMode} />
              </View>

              <View style={styles.bentoCardBottomRow}>
                <Text style={[styles.bentoActionLink, { color: !isDarkMode ? '#2563eb' : '#60a5fa' }]}>Open PC Drives →</Text>
                <View style={[styles.circleArrowBtn, { backgroundColor: !isDarkMode ? '#D1FAE5' : 'rgba(16, 185, 129, 0.25)' }]}>
                  <Text style={{ color: !isDarkMode ? '#065F46' : '#34D399', fontSize: 13, fontWeight: '900' }}>→</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Card 2: Browse Phone (Golden Ridge Phone Scene) */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.bentoPrimaryCard, !isDarkMode && styles.bentoPrimaryCardLight]}
              onPress={() => setCurrentTab('phone-explorer')}>
              <View style={[styles.bentoPillAmber, !isDarkMode && styles.bentoPillAmberLight]}>
                <View style={[styles.beaconDot, { backgroundColor: '#F59E0B', width: 6, height: 6, borderRadius: 3, marginRight: 4 }]} />
                <Text style={[styles.bentoPillAmberText, !isDarkMode && styles.bentoPillAmberTextLight]}>
                  {storageStats.freeGB} Free
                </Text>
              </View>

              <View style={styles.bentoCardMiddleRow}>
                <View style={{ flex: 1, paddingRight: 4 }}>
                  <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Browse Phone</Text>
                  <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]} numberOfLines={1}>
                    Storage, DCIM & files
                  </Text>
                </View>
                <RidgePhoneScene isDark={isDarkMode} />
              </View>

              <View style={styles.bentoCardBottomRow}>
                <Text style={[styles.bentoActionLink, { color: !isDarkMode ? '#D97706' : '#FBBF24' }]}>Open Phone Files →</Text>
                <View style={[styles.circleArrowBtn, { backgroundColor: !isDarkMode ? '#FEF3C7' : 'rgba(245, 158, 11, 0.25)' }]}>
                  <Text style={{ color: !isDarkMode ? '#B45309' : '#FBBF24', fontSize: 13, fontWeight: '900' }}>→</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* 3. SECONDARY ACTION CARDS (ShareHub, Clipboard, Transfers with sleek vector icons) */}
          <View style={styles.bentoSecondaryRow}>
            {/* ShareHub */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.bentoSecCard, !isDarkMode && styles.bentoSecCardLight, { backgroundColor: isDarkMode ? '#0A0A0A' : '#F3E8FF' }]}
              onPress={() => {
                setCurrentTab('sharehub');
                fetchSharedHubFiles();
              }}>
              <View style={[styles.bentoSecIconCircle, { backgroundColor: isDarkMode ? 'rgba(124, 58, 237, 0.25)' : '#EDE9FE' }]}>
                <VectorShareHubIcon size={18} color="#7C3AED" />
              </View>
              <Text style={[styles.bentoSecTitle, !isDarkMode && styles.bentoSecTitleLight]}>ShareHub</Text>
              <Text style={[styles.bentoSecSub, !isDarkMode && styles.bentoSecSubLight]}>
                {sharedHubFiles.length} shared
              </Text>
              <View style={[styles.secChevronCircle, !isDarkMode && styles.secChevronCircleLight]}>
                <Text style={styles.secChevronText}>›</Text>
              </View>
            </TouchableOpacity>

            {/* Clipboard */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.bentoSecCard, !isDarkMode && styles.bentoSecCardLight, { backgroundColor: isDarkMode ? '#0A0A0A' : '#FEF3C7' }]}
              onPress={() => setCurrentTab('clipboard')}>
              <View style={[styles.bentoSecIconCircle, { backgroundColor: isDarkMode ? 'rgba(245, 158, 11, 0.25)' : '#FDE68A' }]}>
                <VectorClipboardIcon size={18} color="#D97706" />
              </View>
              <Text style={[styles.bentoSecTitle, !isDarkMode && styles.bentoSecTitleLight]}>Clipboard</Text>
              <Text style={[styles.bentoSecSub, !isDarkMode && styles.bentoSecSubLight]}>
                {pcClipboardText ? 'Live Synced' : 'Ready'}
              </Text>
              <View style={[styles.secChevronCircle, !isDarkMode && styles.secChevronCircleLight]}>
                <Text style={styles.secChevronText}>›</Text>
              </View>
            </TouchableOpacity>

            {/* Transfers */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.bentoSecCard, !isDarkMode && styles.bentoSecCardLight, { backgroundColor: isDarkMode ? '#0A0A0A' : '#FFE4E6' }]}
              onPress={() => setCurrentTab('transfer')}>
              <View style={[styles.bentoSecIconCircle, { backgroundColor: isDarkMode ? 'rgba(225, 29, 72, 0.25)' : '#FECDD3' }]}>
                <VectorLightningIcon size={18} color="#E11D48" />
              </View>
              <Text style={[styles.bentoSecTitle, !isDarkMode && styles.bentoSecTitleLight]}>Transfers</Text>
              <Text style={[styles.bentoSecSub, !isDarkMode && styles.bentoSecSubLight]}>
                Diagnostics
              </Text>
              <View style={[styles.secChevronCircle, !isDarkMode && styles.secChevronCircleLight]}>
                <Text style={styles.secChevronText}>›</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* 4. SEND FILES TO PC CARD (Meadow Landscape & Forest Emerald Button) */}
          <View style={[styles.sectionCard, !isDarkMode && styles.sectionCardLight, { overflow: 'hidden' }]}>
            <SendFilesLandscape isDark={isDarkMode} />

            <View style={[styles.sectionHeaderRow, { zIndex: 2 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                <View style={[styles.sendBadgeCircle, !isDarkMode && styles.sendBadgeCircleLight]}>
                  <Text style={{ color: '#ffffff', fontSize: 18 }}>✈</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionTitle, !isDarkMode && styles.sectionTitleLight]}>Send Files to PC</Text>
                  <Text style={[styles.sectionSubtitle, !isDarkMode && styles.sectionSubtitleLight]} numberOfLines={1}>
                    {pairedPc
                      ? `Send directly into ${pcHostName || 'PC'} Downloads`
                      : 'Send photos & files directly to PC'}
                  </Text>
                </View>
              </View>
              <View style={[styles.sectionChipPill, !isDarkMode && styles.sectionChipPillLight]}>
                <Text style={[styles.sectionChipText, !isDarkMode && styles.sectionChipTextLight]}>Direct</Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              disabled={isSending}
              style={[styles.sendFilesBigBtn, !isDarkMode && styles.sendFilesBigBtnLight, isSending && { opacity: 0.6 }, { zIndex: 2 }]}
              onPress={handlePickAndSendToPc}>
              <Text style={styles.sendFilesBigBtnText}>
                {isSending ? 'Sending to PC...' : '➤  Send Files to PC →'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 5. SHARE HUB CARD */}
          <View style={[styles.sectionCard, !isDarkMode && styles.sectionCardLight]}>
            <View style={styles.sectionHeaderRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => {
                  setCurrentTab('sharehub');
                  fetchSharedHubFiles();
                }}>
                <Text style={[styles.sectionTitle, !isDarkMode && styles.sectionTitleLight]}>ShareHub →</Text>
                <Text style={[styles.sectionSubtitle, !isDarkMode && styles.sectionSubtitleLight]}>
                  Active shared files from PC & Mobile
                </Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={[styles.shareHubRefreshBtn, !isDarkMode && styles.shareHubRefreshBtnLight]}
                  onPress={() => {
                    fetchSharedHubFiles();
                    showToast('Share Hub synchronized');
                  }}>
                  <Text style={{ fontSize: 16, color: '#0284c7' }}>↻</Text>
                </TouchableOpacity>
                <View style={[styles.sectionChipPill, !isDarkMode && styles.sectionChipPillLight]}>
                  <Text style={[styles.sectionChipText, !isDarkMode && styles.sectionChipTextLight]}>
                    {sharedHubFiles.length} files
                  </Text>
                </View>
              </View>
            </View>

            {/* Quick Batch Download Action if PC has shared files */}
            {sharedHubFiles.some((f) => f.direction === 'received') && (
              <View style={styles.shareHubBatchRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.shareHubSaveAllBtn}
                  onPress={handleDownloadAllSharedHubFiles}>
                  <Text style={styles.shareHubSaveAllBtnText}>
                    Save All From PC ({sharedHubFiles.filter((f) => f.direction === 'received').length}) ↓
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {sharedHubFiles.length === 0 ? (
              <View style={[styles.shareHubDashedBox, !isDarkMode && styles.shareHubDashedBoxLight]}>
                <View style={[styles.shareHubEmptyCircle, !isDarkMode && styles.shareHubEmptyCircleLight]}>
                  <Win11FolderIcon size={26} />
                </View>
                <Text style={[styles.shareHubEmptyTitle, !isDarkMode && styles.shareHubEmptyTitleLight]}>
                  No files shared yet
                </Text>
                <Text style={[styles.shareHubEmptySub, !isDarkMode && styles.shareHubEmptySubLight]}>
                  Upload or drop files in PC Share Hub, or tap "Send Files to PC" above to transfer files instantly
                </Text>
              </View>
            ) : (
              <View style={styles.shareHubList}>
                {sharedHubFiles.slice(0, 15).map((f, i) => {
                  const isSaved = downloadedSharedIds.has(f.id || f.name);
                  const isReceived = f.direction === 'received';
                  return (
                    <TouchableOpacity
                      key={f.id || f.path || i}
                      activeOpacity={0.7}
                      style={[styles.shareHubRow, !isDarkMode && styles.shareHubRowLight]}
                      onPress={() => handleSharedHubItemPress(f)}>
                      <FileBadgeIcon ext={(f.name || '').split('.').pop()} isDir={false} size={24} />
                      <View style={{ flex: 1, minWidth: 0, marginHorizontal: 8 }}>
                        <Text style={[styles.shareHubFileName, !isDarkMode && styles.shareHubFileNameLight]} numberOfLines={1}>
                          {f.name}
                        </Text>
                        <Text style={styles.shareHubFileMeta}>
                          {f.size ? formatFileSize(f.size) : (f.sizeLabel || 'Ready')} • {isReceived ? 'From PC' : 'Sent to PC'}
                        </Text>
                      </View>
                      {isReceived ? (
                        isSaved ? (
                          <View style={styles.shareHubSavedChip}>
                            <Text style={styles.shareHubSavedChipText}>✓ Saved</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            activeOpacity={0.8}
                            style={styles.shareHubActionBtn}
                            onPress={() => handleDownloadSharedHubFile(f)}>
                            <Text style={styles.shareHubActionBtnText}>Save</Text>
                          </TouchableOpacity>
                        )
                      ) : (
                        <View style={styles.shareHubStatusChip}>
                          <Text style={styles.shareHubStatusText}>Done</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {sharedHubFiles.length > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 8 }}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.shareHubClearBtn}
                      onPress={() => setSharedHubFiles([])}>
                      <Text style={styles.shareHubClearBtnText}>Clear Local List</Text>
                    </TouchableOpacity>
                    {pairedPc && (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        style={styles.shareHubClearBtn}
                        onPress={() => {
                          fetchSharedHubFiles();
                          showToast('Share Hub synchronized');
                        }}>
                        <Text style={[styles.shareHubClearBtnText, { color: '#38bdf8' }]}>Sync with PC ↻</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* 6. INTERNAL STORAGE CARD */}
          <View style={[styles.sectionCard, !isDarkMode && styles.sectionCardLight]}>
            <View style={styles.sectionHeaderRow}>
              <View>
                <Text style={[styles.sectionTitle, !isDarkMode && styles.sectionTitleLight]}>Internal Storage</Text>
                <Text style={[styles.sectionSubtitle, !isDarkMode && styles.sectionSubtitleLight]}>
                  Real-time flash memory status
                </Text>
              </View>
              <View style={[styles.sectionChipPill, !isDarkMode && styles.sectionChipPillLight]}>
                <Text style={[styles.sectionChipText, !isDarkMode && styles.sectionChipTextLight]}>
                  {storageStats.usedPercent}% Used
                </Text>
              </View>
            </View>

            {/* Storage Progress Bar */}
            <View style={[styles.storageTrackBar, !isDarkMode && styles.storageTrackBarLight]}>
              <View style={[styles.storageFillBar, { width: `${storageStats.usedPercent}%` }]} />
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={[styles.storageLegendText, !isDarkMode && styles.storageLegendTextLight]}>
                Used: {storageStats.usedGB}
              </Text>
              <Text style={[styles.storageLegendText, !isDarkMode && styles.storageLegendTextLight]}>
                Free: {storageStats.freeGB}
              </Text>
            </View>
          </View>

          {/* 3. LAN SHARED CLIPBOARD PREVIEW CARD */}
          <View style={[styles.bentoCard, !isDarkMode && styles.bentoCardLight]}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Shared Clipboard</Text>
                <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]}>
                  {pairedPc
                    ? `Synced with PC (${pcClipboardUpdatedBy || 'Host Computer'})`
                    : 'Pair with PC to share clipboard wirelessly'}
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => setCurrentTab('clipboard')}>
                <Text style={styles.cardHeaderLink}>Full Hub ›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.clipboardPreviewBox}>
              <Text
                style={styles.clipboardPreviewText}
                numberOfLines={3}
                selectable>
                {pcClipboardText || 'Clipboard empty or waiting for text...'}
              </Text>
            </View>

            <View style={styles.clipboardActionRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.clipboardActionBtn, styles.clipboardActionBtnPrimary]}
                onPress={handleCopyPcClipboardToPhone}>
                <Text style={styles.clipboardActionBtnPrimaryText}>
                  Copy to Phone
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.clipboardActionBtnSecondary}
                onPress={() => setCurrentTab('clipboard')}>
                <Text style={styles.clipboardActionBtnSecondaryText}>
                  Push Text to PC ›
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 5. BACKGROUND SERVER CONTROLS CARD */}
          <View style={[styles.bentoCard, !isDarkMode && styles.bentoCardLight]}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Local File Server</Text>
                <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]}>
                  Port {serverPort} • {readOnlyMode ? 'Safe Read-Only' : 'Read/Write Access'}
                </Text>
              </View>
              <View style={[styles.serverStatusTag, serverRunning ? styles.serverStatusRunning : styles.serverStatusStopped]}>
                <Text style={styles.serverStatusTagText}>
                  {serverRunning ? 'ACTIVE' : 'STOPPED'}
                </Text>
              </View>
            </View>

            <View style={styles.serverControlButtonsRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.serverToggleBtn,
                  serverRunning ? styles.serverToggleBtnStop : styles.serverToggleBtnStart,
                ]}
                onPress={handleToggleServer}>
                <Text style={styles.serverToggleBtnText}>
                  {serverRunning ? 'Stop Server' : 'Start Server'}
                </Text>
              </TouchableOpacity>

              <View style={styles.safeModeSwitchRow}>
                <Text style={styles.safeModeLabel}>Safe Mode</Text>
                <Switch
                  value={readOnlyMode}
                  onValueChange={handleToggleReadOnly}
                  trackColor={{ false: '#475569', true: '#2563eb' }}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </View>

          {/* Bottom Canvas Landscape Framing */}
          <BottomCanvasLandscape isDark={isDarkMode} />
        </ScrollView>
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB: DEDICATED FULLSCREEN SHAREHUB VIEW                  */}
      {/* ========================================================= */}
      {currentTab === 'sharehub' && (
        <View style={[styles.explorerContainer, !isDarkMode && styles.explorerContainerLight]}>
          {/* Top navigation bar */}
          <View style={[styles.navBar, !isDarkMode && styles.navBarLight]}>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.navUpBtn, !isDarkMode && styles.navUpBtnLight]}
              onPress={() => setCurrentTab('home')}>
              <Text style={[styles.navUpBtnText, !isDarkMode && styles.navUpBtnTextLight]}>‹ Back to Home</Text>
            </TouchableOpacity>

            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={[styles.shareHubScreenTitle, !isDarkMode && styles.shareHubScreenTitleLight]}>
                ShareHub
              </Text>
            </View>

            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.refreshBtn, !isDarkMode && styles.refreshBtnLight]}
              onPress={() => {
                fetchSharedHubFiles();
                showToast('ShareHub refreshed');
              }}>
              <Text style={[styles.refreshBtnText, !isDarkMode && styles.refreshBtnTextLight]}>↻</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              style={[
                styles.viewModeBtn,
                !isDarkMode && styles.viewModeBtnLight,
                shareHubViewMode === 'grid' && styles.viewModeBtnActive,
              ]}
              onPress={() => setShareHubViewMode(shareHubViewMode === 'grid' ? 'list' : 'grid')}>
              <Text style={[styles.viewModeBtnText, !isDarkMode && styles.viewModeBtnTextLight]}>
                {shareHubViewMode === 'grid' ? '☷' : '☰'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search Bar + Batch "Save All From PC" Button Row */}
          <View style={styles.searchRow}>
            <View style={[styles.searchInputWrap, !isDarkMode && styles.searchInputWrapLight]}>
              <SearchVectorIcon color={!isDarkMode ? '#64748b' : '#94a3b8'} />
              <TextInput
                style={[styles.searchInput, !isDarkMode && styles.searchInputLight]}
                placeholder="Search shared files..."
                placeholderTextColor={!isDarkMode ? '#64748b' : '#94a3b8'}
                value={shareHubSearch}
                onChangeText={setShareHubSearch}
              />
              {shareHubSearch.length > 0 && (
                <TouchableOpacity onPress={() => setShareHubSearch('')} style={{ padding: 4 }}>
                  <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {filteredShareHubFiles.some((f) => f.direction === 'received') && (
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.shareHubSaveAllBtn}
                onPress={handleDownloadAllSharedHubFiles}>
                <Text style={styles.shareHubSaveAllBtnText}>
                  Save All From PC ({filteredShareHubFiles.filter((f) => f.direction === 'received').length}) ↓
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Action buttons row: "+ Send to PC" and "Clear Local List" */}
          <View style={styles.shareHubActionRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={isSending}
              style={[styles.shareHubPrimarySendBtn, isSending && { opacity: 0.6 }]}
              onPress={handlePickAndSendToPc}>
              <Text style={styles.shareHubPrimarySendBtnText}>
                {isSending ? 'Sending to PC...' : '+ Send to PC'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              style={[styles.shareHubClearBtn, !isDarkMode && styles.shareHubClearBtnLight]}
              onPress={() => setSharedHubFiles([])}>
              <Text style={[styles.shareHubClearBtnText, !isDarkMode && styles.shareHubClearBtnTextLight]}>
                Clear Local List
              </Text>
            </TouchableOpacity>

            {pairedPc && (
              <TouchableOpacity
                activeOpacity={0.7}
                style={[styles.shareHubClearBtn, !isDarkMode && styles.shareHubClearBtnLight]}
                onPress={() => {
                  fetchSharedHubFiles();
                  showToast('ShareHub synced with PC');
                }}>
                <Text style={[styles.shareHubClearBtnText, { color: '#2563eb' }]}>↻ Sync</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ShareHub Content: Grid mode vs List mode vs Empty state */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 90 }}
            showsVerticalScrollIndicator={false}>
            {filteredShareHubFiles.length === 0 ? (
              <View style={[styles.shareHubDashedBox, !isDarkMode && styles.shareHubDashedBoxLight]}>
                <View style={[styles.shareHubEmptyCircle, !isDarkMode && styles.shareHubEmptyCircleLight]}>
                  <Win11FolderIcon size={32} />
                </View>
                <Text style={[styles.shareHubEmptyTitle, !isDarkMode && styles.shareHubEmptyTitleLight]}>
                  {shareHubSearch ? 'No matching shared files' : 'No files shared yet'}
                </Text>
                <Text style={[styles.shareHubEmptySub, !isDarkMode && styles.shareHubEmptySubLight]}>
                  {shareHubSearch
                    ? 'Try searching with a different term'
                    : 'Send photos & documents to PC or share files from PC to access them here instantly'}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={[styles.shareHubPrimarySendBtn, { marginTop: 14 }]}
                  onPress={handlePickAndSendToPc}>
                  <Text style={styles.shareHubPrimarySendBtnText}>+ Send Files to PC</Text>
                </TouchableOpacity>
              </View>
            ) : shareHubViewMode === 'grid' ? (
              /* GRID MODE (3 COLUMNS) */
              <View style={styles.responsiveGridWrap}>
                {filteredShareHubFiles.map((file, idx) => {
                  const isSaved = downloadedSharedIds.has(file.id || file.name);
                  const isReceived = file.direction === 'received';
                  const ext = file.ext || (file.name || '').split('.').pop().toLowerCase();
                  const isImg = isImageFile(ext);
                  const isVid = isVideoFile(ext);

                  return (
                    <TouchableOpacity
                      key={file.id || file.path || idx}
                      activeOpacity={0.75}
                      style={[
                        styles.gridTile,
                        !isDarkMode && styles.gridTileLight,
                        { width: GRID_TILE_WIDTH },
                      ]}
                      onPress={() => handleSharedHubItemPress(file)}>
                      {/* Media Preview or Icon */}
                      {isImg ? (
                        <SafeImage
                          source={{
                            uri: file.downloadUrl
                              ? file.downloadUrl
                              : (file.path ? 'file://' + file.path : ''),
                          }}
                          style={styles.gridThumbnailImage}
                          resizeMode="cover"
                          fallbackText=""
                        />
                      ) : isVid ? (
                        <VideoThumbnail
                          path={file.path || file.name}
                          isPc={isReceived}
                          pairedPc={pairedPc}
                          pcAuthToken={pcAuthToken}
                        />
                      ) : (
                        <FileBadgeIcon ext={ext} isDir={false} size={34} />
                      )}

                      {/* Direction Badge (PC vs Phone) */}
                      <View style={[
                        styles.shareHubDirectionBadge,
                        isReceived ? styles.badgePc : styles.badgePhone,
                      ]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                          {isReceived ? (
                            <VectorMonitorIcon size={10} color="#93c5fd" />
                          ) : (
                            <VectorPhoneIcon size={10} color="#6ee7b7" />
                          )}
                          <Text style={styles.shareHubDirectionText}>
                            {isReceived ? 'PC' : 'Phone'}
                          </Text>
                        </View>
                      </View>

                      {/* File Name */}
                      <Text style={[styles.gridFileName, !isDarkMode && styles.gridFileNameLight]} numberOfLines={1}>
                        {file.name}
                      </Text>

                      {/* Meta & Status */}
                      <Text style={[styles.gridFileMeta, !isDarkMode && styles.gridFileMetaLight]}>
                        {file.size ? formatFileSize(file.size) : (file.sizeLabel || 'Ready')}
                      </Text>

                      {/* Quick Save / Saved Chip for PC files in Grid */}
                      {isReceived && (
                        isSaved ? (
                          <View style={styles.shareHubGridSavedChip}>
                            <Text style={styles.shareHubGridSavedChipText}>✓ Saved</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            activeOpacity={0.8}
                            style={styles.shareHubGridActionBtn}
                            onPress={() => handleDownloadSharedHubFile(file)}>
                            <Text style={styles.shareHubGridActionBtnText}>Save ↓</Text>
                          </TouchableOpacity>
                        )
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              /* LIST MODE */
              <View style={styles.shareHubList}>
                {filteredShareHubFiles.map((file, idx) => {
                  const isSaved = downloadedSharedIds.has(file.id || file.name);
                  const isReceived = file.direction === 'received';
                  const ext = file.ext || (file.name || '').split('.').pop().toLowerCase();
                  const isImg = isImageFile(ext);

                  return (
                    <TouchableOpacity
                      key={file.id || file.path || idx}
                      activeOpacity={0.75}
                      style={[styles.shareHubRow, !isDarkMode && styles.shareHubRowLight]}
                      onPress={() => handleSharedHubItemPress(file)}>
                      {isImg ? (
                        <SafeImage
                          source={{
                            uri: file.downloadUrl
                              ? file.downloadUrl
                              : (file.path ? 'file://' + file.path : ''),
                          }}
                          style={{ width: 38, height: 38, borderRadius: 8 }}
                          resizeMode="cover"
                          fallbackText=""
                        />
                      ) : (
                        <FileBadgeIcon ext={ext} isDir={false} size={28} />
                      )}

                      <View style={{ flex: 1, minWidth: 0, marginHorizontal: 10 }}>
                        <Text style={[styles.shareHubFileName, !isDarkMode && styles.shareHubFileNameLight]} numberOfLines={1}>
                          {file.name}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <View style={[styles.shareHubDirectionBadge, isReceived ? styles.badgePc : styles.badgePhone]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              {isReceived ? (
                                <VectorMonitorIcon size={10} color="#93c5fd" />
                              ) : (
                                <VectorPhoneIcon size={10} color="#6ee7b7" />
                              )}
                              <Text style={styles.shareHubDirectionText}>
                                {isReceived ? 'PC' : 'Phone'}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.shareHubFileMeta}>
                            {file.size ? formatFileSize(file.size) : (file.sizeLabel || 'Ready')}
                          </Text>
                        </View>
                      </View>

                      {isReceived ? (
                        isSaved ? (
                          <View style={styles.shareHubSavedChip}>
                            <Text style={styles.shareHubSavedChipText}>✓ Saved</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            activeOpacity={0.8}
                            style={styles.shareHubActionBtn}
                            onPress={() => handleDownloadSharedHubFile(file)}>
                            <Text style={styles.shareHubActionBtnText}>Save ↓</Text>
                          </TouchableOpacity>
                        )
                      ) : (
                        <View style={styles.shareHubStatusChip}>
                          <Text style={styles.shareHubStatusText}>Done</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 2: PHONE STORAGE EXPLORER & GALLERY                   */}
      {/* Clean, compact, non-cropped, one-step-back & sorting       */}
      {/* ========================================================= */}
      {currentTab === 'phone-explorer' && (
        <View style={[styles.explorerContainer, !isDarkMode && styles.explorerContainerLight]}>
          {/* Breadcrumbs Navigation Bar with ONE-STEP-BACK */}
          <View style={[styles.navBar, !isDarkMode && styles.navBarLight]}>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[
                styles.navUpBtn,
                !isDarkMode && styles.navUpBtnLight,
                phoneHistory.length === 0 && (!phoneParentPath || phoneParentPath === phoneCurrentPath) && styles.navBtnDisabled,
              ]}
              disabled={phoneHistory.length === 0 && (!phoneParentPath || phoneParentPath === phoneCurrentPath)}
              onPress={goBackPhoneFolder}>
              <Text style={[styles.navUpBtnText, !isDarkMode && styles.navUpBtnTextLight]}>‹ Back</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              {renderBreadcrumbs(phoneCurrentPath, (p) => loadPhoneFolder(p), false)}
            </View>

            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.refreshBtn, !isDarkMode && styles.refreshBtnLight]}
              onPress={() => loadPhoneFolder(phoneCurrentPath)}>
              <Text style={[styles.refreshBtnText, !isDarkMode && styles.refreshBtnTextLight]}>↻</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              style={[
                styles.viewModeBtn,
                !isDarkMode && styles.viewModeBtnLight,
                phoneViewMode === 'grid' && styles.viewModeBtnActive,
              ]}
              onPress={() => setPhoneViewMode(phoneViewMode === 'grid' ? 'list' : 'grid')}>
              <Text style={[styles.viewModeBtnText, !isDarkMode && styles.viewModeBtnTextLight]}>{phoneViewMode === 'grid' ? '☷' : '☰'}</Text>
            </TouchableOpacity>
          </View>

          {/* Search, Sort & Multi-Select Bar */}
          <View style={styles.searchRow}>
            <View style={[styles.searchInputWrap, !isDarkMode && styles.searchInputWrapLight]}>
              <SearchVectorIcon color={!isDarkMode ? '#64748b' : '#94a3b8'} />
              <TextInput
                style={[styles.searchInput, !isDarkMode && styles.searchInputLight]}
                placeholder="Search phone files..."
                placeholderTextColor={!isDarkMode ? '#64748b' : '#94a3b8'}
                value={phoneSearch}
                onChangeText={setPhoneSearch}
              />
              {phoneSearch.length > 0 && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.searchClearBtn}
                  onPress={() => setPhoneSearch('')}>
                  <Text style={styles.searchClearBtnText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Sort Toggle Button (Latest STRICT DEFAULT) */}
            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.sortToggleBtn, !isDarkMode && styles.sortToggleBtnLight]}
              onPress={() => setSortModalTarget('phone')}>
              <Text style={[styles.sortToggleBtnText, !isDarkMode && styles.sortToggleBtnTextLight]}>
                {getSortLabel(phoneSortBy)} ▾
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              style={[
                styles.multiSelectToggle,
                !isDarkMode && styles.multiSelectToggleLight,
                phoneMultiSelect && styles.multiSelectToggleActive,
              ]}
              onPress={() => {
                setPhoneMultiSelect(!phoneMultiSelect);
                setPhoneSelectedPaths(new Set());
              }}>
              <Text style={[
                styles.multiSelectToggleText,
                !isDarkMode && styles.multiSelectToggleTextLight,
                phoneMultiSelect && styles.multiSelectToggleTextActive,
              ]}>
                {phoneMultiSelect ? 'Done' : 'Select'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Filter Pills Bar */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
            {[
              { id: 'all', label: 'All Files' },
              { id: 'photos', label: 'Photos' },
              { id: 'videos', label: 'Videos' },
              { id: 'audio', label: 'Audio' },
              { id: 'docs', label: 'Documents' },
              { id: 'folders', label: 'Folders' },
            ].map((f) => (
              <TouchableOpacity
                key={f.id}
                activeOpacity={0.75}
                style={[styles.filterPill, phoneFilter === f.id && styles.filterPillActive]}
                onPress={() => setPhoneFilter(f.id)}>
                <Text style={[styles.filterPillText, phoneFilter === f.id && styles.filterPillTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Explorer Items View */}
          {phoneLoading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color="#2563eb" />
              <Text style={styles.loadingText}>Loading folder contents...</Text>
            </View>
          ) : filteredPhoneItems.length === 0 ? (
            <View style={styles.centerLoading}>
              <Win11FolderIcon size={46} />
              <Text style={[styles.emptyFolderText, { marginTop: 12 }]}>Folder is empty</Text>
            </View>
          ) : phoneViewMode === 'grid' ? (
            // 3-Column Responsive Grid View with Real Thumbnails
            <ScrollView
              contentContainerStyle={styles.gridContentContainer}
              showsVerticalScrollIndicator={false}>
              <View style={styles.responsiveGridWrap}>
                {filteredPhoneItems.map((item, idx) => {
                  const isSelected = phoneSelectedPaths.has(item.path);
                  const isPhoto = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(
                    (item.ext || '').toLowerCase()
                  );

                  return (
                    <TouchableOpacity
                      key={item.path || idx}
                      activeOpacity={0.75}
                      style={[
                        styles.gridTile,
                        !isDarkMode && styles.gridTileLight,
                        { width: GRID_TILE_WIDTH },
                        isSelected && styles.gridTileSelected,
                      ]}
                      onPress={() => {
                        if (phoneMultiSelect) {
                          const next = new Set(phoneSelectedPaths);
                          isSelected ? next.delete(item.path) : next.add(item.path);
                          setPhoneSelectedPaths(next);
                        } else if (item.isDir) {
                          loadPhoneFolder(item.path);
                        } else if (isAudioFile(item.ext)) {
                          playInbuiltAudio(item, 'phone');
                        } else if (isVideoFile(item.ext)) {
                          const playlist = filteredPhoneItems.filter((f) => !f.isDir && isVideoFile(f.ext));
                          const idx = playlist.findIndex((f) => f.path === item.path);
                          setLightboxItem({
                            item,
                            source: 'phone',
                            index: idx >= 0 ? idx : 0,
                            playlist: playlist.length > 0 ? playlist : [item],
                          });
                        } else if (isViewableMedia(item.ext)) {
                          const playlist = filteredPhoneItems.filter((f) => !f.isDir && isViewableMedia(f.ext));
                          const idx = playlist.findIndex((f) => f.path === item.path);
                          setLightboxItem({
                            item,
                            source: 'phone',
                            index: idx >= 0 ? idx : 0,
                            playlist: playlist.length > 0 ? playlist : [item],
                          });
                        } else {
                          openExternalFileOrChooser(item, 'phone');
                        }
                      }}
                      onLongPress={() => {
                        if (!phoneMultiSelect) {
                          setPhoneMultiSelect(true);
                          setPhoneSelectedPaths(new Set([item.path]));
                        }
                      }}>
                      {/* Selection Checkmark Badge */}
                      {phoneMultiSelect && (
                        <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
                          {isSelected && <Text style={styles.checkMark}>✓</Text>}
                        </View>
                      )}

                      {/* Tile Thumbnail or Icon */}
                      {item.isDir ? (
                        <Win11FolderIcon size={38} />
                      ) : isImageFile(item?.ext) ? (
                        <SafeImage
                          source={{ uri: 'file://' + (item?.path || '') }}
                          style={styles.gridThumbnailImage}
                          resizeMode="cover"
                          fallbackText=""
                        />
                      ) : isVideoFile(item?.ext) ? (
                        <VideoThumbnail
                          path={item?.path}
                          isPc={false}
                          serverPort={serverPort}
                          pcAuthToken={pcAuthToken}
                        />
                      ) : (
                        <FileBadgeIcon ext={item?.ext} isDir={false} size={34} />
                      )}

                      <Text style={[styles.gridFileName, !isDarkMode && styles.gridFileNameLight]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[styles.gridFileMeta, !isDarkMode && styles.gridFileMetaLight]}>
                        {item.isDir ? 'Folder' : formatFileSize(item.size)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            // Clean List View
            <ScrollView
              contentContainerStyle={styles.listContentContainer}
              showsVerticalScrollIndicator={false}>
              {filteredPhoneItems.map((item, idx) => {
                const isSelected = phoneSelectedPaths.has(item.path);
                return (
                  <TouchableOpacity
                    key={item.path || idx}
                    activeOpacity={0.75}
                    style={[styles.listRow, !isDarkMode && styles.listRowLight, isSelected && styles.listRowSelected]}
                    onPress={() => {
                      if (phoneMultiSelect) {
                        const next = new Set(phoneSelectedPaths);
                        isSelected ? next.delete(item.path) : next.add(item.path);
                        setPhoneSelectedPaths(next);
                      } else if (item.isDir) {
                        loadPhoneFolder(item.path);
                      } else if (isAudioFile(item.ext)) {
                        playInbuiltAudio(item, 'phone');
                      } else if (isVideoFile(item.ext)) {
                        const playlist = filteredPhoneItems.filter((f) => !f.isDir && isVideoFile(f.ext));
                        const idx = playlist.findIndex((f) => f.path === item.path);
                        setLightboxItem({
                          item,
                          source: 'phone',
                          index: idx >= 0 ? idx : 0,
                          playlist: playlist.length > 0 ? playlist : [item],
                        });
                      } else if (isViewableMedia(item.ext)) {
                        const playlist = filteredPhoneItems.filter((f) => !f.isDir && isViewableMedia(f.ext));
                        const idx = playlist.findIndex((f) => f.path === item.path);
                        setLightboxItem({
                          item,
                          source: 'phone',
                          index: idx >= 0 ? idx : 0,
                          playlist: playlist.length > 0 ? playlist : [item],
                        });
                      } else {
                        openExternalFileOrChooser(item, 'phone');
                      }
                    }}>
                    {item.isDir ? (
                      <Win11FolderIcon size={26} />
                    ) : isImageFile(item?.ext) ? (
                      <SafeImage
                        source={{ uri: 'file://' + (item?.path || '') }}
                        style={{ width: 34, height: 34, borderRadius: 6, marginRight: 10 }}
                        resizeMode="cover"
                        fallbackText=""
                      />
                    ) : isVideoFile(item?.ext) ? (
                      <View style={{ width: 34, height: 34, borderRadius: 6, overflow: 'hidden', marginRight: 10 }}>
                        <VideoThumbnail
                          path={item?.path}
                          isPc={false}
                          serverPort={serverPort}
                          pcAuthToken={pcAuthToken}
                        />
                      </View>
                    ) : (
                      <FileBadgeIcon ext={item.ext} isDir={false} size={24} />
                    )}

                    <View style={styles.listRowContent}>
                      <Text style={[styles.listRowName, !isDarkMode && styles.listRowNameLight]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[styles.listRowMeta, !isDarkMode && styles.listRowMetaLight]}>
                        {item.isDir ? 'Folder' : formatFileSize(item.size)}
                      </Text>
                    </View>

                    <Text style={[styles.listRowChevron, !isDarkMode && styles.listRowChevronLight]}>›</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Floating Multi-Select Bar with SEND TO PC Action */}
          {phoneMultiSelect && phoneSelectedPaths.size > 0 && (
            <View style={[styles.floatingMultiSelectBar, !isDarkMode && styles.floatingMultiSelectBarLight]}>
              <View>
                <Text style={[styles.floatingSelectCount, !isDarkMode && styles.floatingSelectCountLight]}>{phoneSelectedPaths.size} Selected</Text>
              </View>

              <View style={styles.floatingActionsRow}>
                {pairedPc && (
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.floatingSendBtn}
                    onPress={() => handleSendFilesToPc(phoneSelectedPaths)}>
                    <Text style={styles.floatingSendBtnText}>Send to PC →</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.floatingTrashBtn}
                  onPress={() => {
                    Alert.alert(
                      'Move to Trash',
                      `Are you sure you want to move ${phoneSelectedPaths?.size || 0} file(s) to trash?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Trash',
                          style: 'destructive',
                          onPress: async () => {
                            let trashedCount = 0;
                            if (phoneSelectedPaths && phoneSelectedPaths.size > 0) {
                              for (const path of phoneSelectedPaths) {
                                try {
                                  if (FyloModule && FyloModule.trashFile) {
                                    await FyloModule.trashFile(path);
                                    trashedCount++;
                                  }
                                } catch (e) {
                                  console.warn('Failed to trash file:', path, e);
                                }
                              }
                            }
                            showToast(`Moved ${trashedCount} file(s) to .trash safely 🗑️`);
                            setPhoneSelectedPaths(new Set());
                            loadPhoneFolder(phoneCurrentPath);
                          },
                        },
                      ]
                    );
                  }}>
                  <Text style={styles.floatingTrashBtnText}>Trash</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.floatingCancelBtn}
                  onPress={() => setPhoneSelectedPaths(new Set())}>
                  <Text style={styles.floatingCancelBtnText}>Clear</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 3: PC REMOTE DRIVES EXPLORER                           */}
      {/* Clean, compact ribbon, one-step-back & sorting            */}
      {/* ========================================================= */}
      {currentTab === 'pc-explorer' && (
        <View style={[styles.explorerContainer, !isDarkMode && styles.explorerContainerLight]}>
          {!pairedPc ? (
            <View style={styles.centerLoading}>
              <Text style={{ fontSize: 40, color: '#3b82f6', marginBottom: 12 }}>⬡</Text>
              <Text style={[styles.pcEmptyTitle, !isDarkMode && styles.pcEmptyTitleLight]}>PC Remote Explorer</Text>
              <Text style={[styles.pcEmptyDesc, !isDarkMode && styles.pcEmptyDescLight]}>
                Browse, stream, and manage your Windows PC drives and folders directly from your phone.
              </Text>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.pcConnectPromptBtn}
                onPress={() => setShowPairModal(true)}>
                <Text style={styles.pcConnectPromptBtnText}>Pair with PC Now →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              {/* REQUIREMENT 1: UNIFIED COMPACT DRIVES & SHORTCUTS RIBBON (No vertical bloat!) */}
              <View style={styles.unifiedRibbonWrap}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.unifiedRibbonScroll}>
                  {/* Windows Drives */}
                  {Array.isArray(pcQuickAccess?.drives) && pcQuickAccess.drives.length > 0 ? (
                    pcQuickAccess.drives.map((d, i) => (
                      <TouchableOpacity
                        key={'pcdrive-' + i}
                        activeOpacity={0.75}
                        style={[
                          styles.pcDrivePill,
                          !isDarkMode && styles.pcDrivePillLight,
                          pcCurrentPath === d?.path && styles.pcDrivePillActive,
                        ]}
                        onPress={() => d?.path && loadPcFolder(d.path)}>
                        <Text style={[styles.pcDrivePillIcon, { color: '#60a5fa', fontWeight: '800' }]}>⛁</Text>
                        <Text style={[styles.pcDrivePillText, !isDarkMode && styles.pcDrivePillTextLight, pcCurrentPath === d?.path && styles.pcDrivePillTextActive]}>
                          {d?.name || d?.path || 'Drive'}
                        </Text>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        style={[
                          styles.pcDrivePill,
                          !isDarkMode && styles.pcDrivePillLight,
                          pcCurrentPath.startsWith('C:') && styles.pcDrivePillActive,
                        ]}
                        onPress={() => loadPcFolder('C:\\')}>
                        <Text style={[styles.pcDrivePillIcon, { color: '#60a5fa', fontWeight: '800' }]}>⛁</Text>
                        <Text style={[
                          styles.pcDrivePillText,
                          !isDarkMode && styles.pcDrivePillTextLight,
                          pcCurrentPath.startsWith('C:') && styles.pcDrivePillTextActive,
                        ]}>
                          Drive (C:)
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        style={[
                          styles.pcDrivePill,
                          !isDarkMode && styles.pcDrivePillLight,
                          pcCurrentPath.startsWith('D:') && styles.pcDrivePillActive,
                        ]}
                        onPress={() => loadPcFolder('D:\\')}>
                        <Text style={[styles.pcDrivePillIcon, { color: '#60a5fa', fontWeight: '800' }]}>⛁</Text>
                        <Text style={[
                          styles.pcDrivePillText,
                          !isDarkMode && styles.pcDrivePillTextLight,
                          pcCurrentPath.startsWith('D:') && styles.pcDrivePillTextActive,
                        ]}>
                          Drive (D:)
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}

                  <View style={[styles.ribbonDivider, !isDarkMode && { backgroundColor: '#cbd5e1' }]} />

                  {/* Windows Folder Shortcuts (PC Quick Jump) */}
                  {[
                    { name: 'Downloads', icon: '📥', path: 'Downloads' },
                    { name: 'Videos', icon: '🎬', path: 'Videos' },
                    { name: 'Desktop', icon: '🖥️', path: 'Desktop' },
                    { name: 'Pictures', icon: '🖼️', path: 'Pictures' },
                    { name: 'Documents', icon: '📄', path: 'Documents' },
                    { name: 'Screenshots', icon: '📸', path: 'Screenshots' },
                  ].map((sc, i) => {
                    const match = Array.isArray(pcQuickAccess?.shortcuts)
                      ? pcQuickAccess.shortcuts.find((s) =>
                          s?.name && sc?.name && s.name.toLowerCase().includes(sc.name.toLowerCase())
                        )
                      : null;
                    const targetPath = match?.path || sc.path;
                    const isActive = pcCurrentPath && (
                      pcCurrentPath.toLowerCase().endsWith(sc.name.toLowerCase()) ||
                      pcCurrentPath.toLowerCase().includes(sc.name.toLowerCase())
                    );
                    return (
                      <TouchableOpacity
                        key={'pcsc-' + i}
                        activeOpacity={0.75}
                        style={[
                          styles.pcShortcutPill,
                          !isDarkMode && styles.pcShortcutPillLight,
                          isActive && styles.pcShortcutPillActive,
                        ]}
                        onPress={() => loadPcFolder(targetPath)}>
                        <Text style={{ fontSize: 13, marginRight: 4 }}>{sc.icon}</Text>
                        <Text style={[
                          styles.pcShortcutPillText,
                          !isDarkMode && styles.pcShortcutPillTextLight,
                          isActive && styles.pcShortcutPillTextActive,
                        ]}>
                          {sc.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* PC Breadcrumbs & Nav Bar with ONE-STEP-BACK */}
              <View style={[styles.navBar, !isDarkMode && styles.navBarLight]}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[
                    styles.navUpBtn,
                    !isDarkMode && styles.navUpBtnLight,
                    pcHistory.length === 0 && (!pcParentPath || pcParentPath === pcCurrentPath) && styles.navBtnDisabled,
                  ]}
                  disabled={pcHistory.length === 0 && (!pcParentPath || pcParentPath === pcCurrentPath)}
                  onPress={goBackPcFolder}>
                  <Text style={[styles.navUpBtnText, !isDarkMode && styles.navUpBtnTextLight]}>‹ Back</Text>
                </TouchableOpacity>

                <View style={{ flex: 1 }}>
                  {renderBreadcrumbs(pcCurrentPath, (p) => loadPcFolder(p), true)}
                </View>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[styles.refreshBtn, !isDarkMode && styles.refreshBtnLight]}
                  onPress={() => loadPcFolder(pcCurrentPath)}>
                  <Text style={[styles.refreshBtnText, !isDarkMode && styles.refreshBtnTextLight]}>↻</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[
                    styles.viewModeBtn,
                    !isDarkMode && styles.viewModeBtnLight,
                    pcViewMode === 'grid' && styles.viewModeBtnActive,
                  ]}
                  onPress={() => setPcViewMode(pcViewMode === 'grid' ? 'list' : 'grid')}>
                  <Text style={[styles.viewModeBtnText, !isDarkMode && styles.viewModeBtnTextLight]}>{pcViewMode === 'grid' ? '☷' : '☰'}</Text>
                </TouchableOpacity>
              </View>

              {/* Search, Sort & Multi-Select Bar */}
              <View style={styles.searchRow}>
                <View style={[styles.searchInputWrap, !isDarkMode && styles.searchInputWrapLight]}>
                  <SearchVectorIcon color={!isDarkMode ? '#64748b' : '#94a3b8'} />
                  <TextInput
                    style={[styles.searchInput, !isDarkMode && styles.searchInputLight]}
                    placeholder="Search PC files..."
                    placeholderTextColor={!isDarkMode ? '#64748b' : '#94a3b8'}
                    value={pcSearch}
                    onChangeText={setPcSearch}
                  />
                  {pcSearch.length > 0 && (
                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={styles.searchClearBtn}
                      onPress={() => setPcSearch('')}>
                      <Text style={styles.searchClearBtnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Sort Toggle Button (Latest STRICT DEFAULT) */}
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[styles.sortToggleBtn, !isDarkMode && styles.sortToggleBtnLight]}
                  onPress={() => setSortModalTarget('pc')}>
                  <Text style={[styles.sortToggleBtnText, !isDarkMode && styles.sortToggleBtnTextLight]}>
                    {getSortLabel(pcSortBy)} ▾
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[
                    styles.multiSelectToggle,
                    !isDarkMode && styles.multiSelectToggleLight,
                    pcMultiSelect && styles.multiSelectToggleActive,
                  ]}
                  onPress={() => {
                    setPcMultiSelect(!pcMultiSelect);
                    setPcSelectedPaths(new Set());
                  }}>
                  <Text style={[
                    styles.multiSelectToggleText,
                    !isDarkMode && styles.multiSelectToggleTextLight,
                    pcMultiSelect && styles.multiSelectToggleTextActive,
                  ]}>
                    {pcMultiSelect ? 'Done' : 'Select'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Filter Pills */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScroll}
                contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
                {[
                  { id: 'all', label: 'All Files' },
                  { id: 'photos', label: 'Photos' },
                  { id: 'videos', label: 'Videos' },
                  { id: 'audio', label: 'Audio' },
                  { id: 'docs', label: 'Documents' },
                  { id: 'folders', label: 'Folders' },
                ].map((f) => (
                  <TouchableOpacity
                    key={f.id}
                    activeOpacity={0.75}
                    style={[styles.filterPill, pcFilter === f.id && styles.filterPillActive]}
                    onPress={() => setPcFilter(f.id)}>
                    <Text style={[styles.filterPillText, pcFilter === f.id && styles.filterPillTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Files Display */}
              {pcLoading ? (
                <View style={styles.centerLoading}>
                  <ActivityIndicator size="large" color="#2563eb" />
                  <Text style={styles.loadingText}>Fetching files from PC...</Text>
                </View>
              ) : filteredPcItems.length === 0 ? (
                <View style={styles.centerLoading}>
                  <Win11FolderIcon size={46} />
                  <Text style={[styles.emptyFolderText, { marginTop: 12 }]}>Folder is empty</Text>
                </View>
              ) : pcViewMode === 'grid' ? (
                <ScrollView
                  contentContainerStyle={styles.gridContentContainer}
                  showsVerticalScrollIndicator={false}>
                  <View style={styles.responsiveGridWrap}>
                    {filteredPcItems.map((item, idx) => {
                      const isSelected = pcSelectedPaths.has(item.path);
                      return (
                        <TouchableOpacity
                          key={item.path || idx}
                          activeOpacity={0.75}
                          style={[
                            styles.gridTile,
                            !isDarkMode && styles.gridTileLight,
                            { width: GRID_TILE_WIDTH },
                            isSelected && styles.gridTileSelected,
                          ]}
                          onPress={() => {
                            if (pcMultiSelect) {
                              const next = new Set(pcSelectedPaths);
                              isSelected ? next.delete(item.path) : next.add(item.path);
                              setPcSelectedPaths(next);
                            } else if (item.isDir) {
                              loadPcFolder(item.path);
                            } else if (isAudioFile(item.ext)) {
                              playInbuiltAudio(item, 'pc');
                            } else if (isVideoFile(item.ext)) {
                              const playlist = filteredPcItems.filter((f) => !f.isDir && isVideoFile(f.ext));
                              const idx = playlist.findIndex((f) => f.path === item.path);
                              setLightboxItem({
                                item,
                                source: 'pc',
                                index: idx >= 0 ? idx : 0,
                                playlist: playlist.length > 0 ? playlist : [item],
                              });
                            } else if (isViewableMedia(item.ext)) {
                              const playlist = filteredPcItems.filter((f) => !f.isDir && isViewableMedia(f.ext));
                              const idx = playlist.findIndex((f) => f.path === item.path);
                              setLightboxItem({
                                item,
                                source: 'pc',
                                index: idx >= 0 ? idx : 0,
                                playlist: playlist.length > 0 ? playlist : [item],
                              });
                            } else {
                              setPcFileActionPrompt({
                                file: item,
                                source: 'pc',
                              });
                            }
                          }}>
                          {item.isDir ? (
                            <Win11FolderIcon size={38} />
                          ) : isImageFile(item?.ext) && pairedPc ? (
                            <SafeImage
                              source={{
                                uri: `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(item.path || '')}&auth=${pcAuthToken || ''}`,
                              }}
                              style={styles.gridThumbnailImage}
                              resizeMode="cover"
                              fallbackText=""
                            />
                          ) : isVideoFile(item?.ext) ? (
                            <VideoThumbnail
                              path={item.path}
                              isPc={true}
                              pairedPc={pairedPc}
                              pcAuthToken={pcAuthToken}
                            />
                          ) : (
                            <FileBadgeIcon ext={item.ext} isDir={false} size={34} />
                          )}
                          <Text style={[styles.gridFileName, !isDarkMode && styles.gridFileNameLight]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={[styles.gridFileMeta, !isDarkMode && styles.gridFileMetaLight]}>
                            {item.isDir ? 'Folder' : formatFileSize(item.size)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              ) : (
                <ScrollView
                  contentContainerStyle={styles.listContentContainer}
                  showsVerticalScrollIndicator={false}>
                  {filteredPcItems.map((item, idx) => {
                    const isSelected = pcSelectedPaths.has(item.path);
                    return (
                      <TouchableOpacity
                        key={item.path || idx}
                        activeOpacity={0.75}
                        style={[styles.listRow, !isDarkMode && styles.listRowLight, isSelected && styles.listRowSelected]}
                        onPress={() => {
                          if (pcMultiSelect) {
                            const next = new Set(pcSelectedPaths);
                            isSelected ? next.delete(item.path) : next.add(item.path);
                            setPcSelectedPaths(next);
                          } else if (item.isDir) {
                            loadPcFolder(item.path);
                          } else if (isAudioFile(item.ext)) {
                            playInbuiltAudio(item, 'pc');
                          } else if (isVideoFile(item.ext)) {
                            const playlist = filteredPcItems.filter((f) => !f.isDir && isVideoFile(f.ext));
                            const idx = playlist.findIndex((f) => f.path === item.path);
                            setLightboxItem({
                              item,
                              source: 'pc',
                              index: idx >= 0 ? idx : 0,
                              playlist: playlist.length > 0 ? playlist : [item],
                            });
                          } else if (isViewableMedia(item.ext)) {
                            const playlist = filteredPcItems.filter((f) => !f.isDir && isViewableMedia(f.ext));
                            const idx = playlist.findIndex((f) => f.path === item.path);
                            setLightboxItem({
                              item,
                              source: 'pc',
                              index: idx >= 0 ? idx : 0,
                              playlist: playlist.length > 0 ? playlist : [item],
                            });
                          } else {
                            setPcFileActionPrompt({
                              file: item,
                              source: 'pc',
                            });
                          }
                        }}>
                        {item.isDir ? (
                          <Win11FolderIcon size={26} />
                        ) : isImageFile(item?.ext) ? (
                          <SafeImage
                            source={{ uri: `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(item?.path || '')}${pcAuthToken ? `&auth=${pcAuthToken}` : ''}` }}
                            style={{ width: 34, height: 34, borderRadius: 6, marginRight: 10 }}
                            resizeMode="cover"
                            fallbackText=""
                          />
                        ) : isVideoFile(item?.ext) ? (
                          <View style={{ width: 34, height: 34, borderRadius: 6, overflow: 'hidden', marginRight: 10 }}>
                            <VideoThumbnail
                              path={item?.path}
                              isPc={true}
                              pairedPc={pairedPc}
                              pcAuthToken={pcAuthToken}
                              serverPort={serverPort}
                            />
                          </View>
                        ) : (
                          <FileBadgeIcon ext={item.ext} isDir={false} size={24} />
                        )}
                        <View style={styles.listRowContent}>
                          <Text style={[styles.listRowName, !isDarkMode && styles.listRowNameLight]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={[styles.listRowMeta, !isDarkMode && styles.listRowMetaLight]}>
                            {item.isDir ? 'Folder' : formatFileSize(item.size)}
                          </Text>
                        </View>
                        <Text style={[styles.listRowChevron, !isDarkMode && styles.listRowChevronLight]}>›</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {/* Floating Multi-Select Bar for PC (Download Only - Security Enforced) */}
              {pcMultiSelect && pcSelectedPaths.size > 0 && (
                <View style={[styles.floatingMultiSelectBar, !isDarkMode && styles.floatingMultiSelectBarLight]}>
                  <Text style={[styles.floatingSelectCount, !isDarkMode && styles.floatingSelectCountLight]}>{pcSelectedPaths.size} Selected</Text>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.floatingTrashBtn, { backgroundColor: '#2563eb' }]}
                    onPress={async () => {
                      const paths = Array.from(pcSelectedPaths);
                      showToast(`⬇️ Saving ${paths.length} file(s) to Downloads...`);
                      for (const path of paths) {
                        try {
                          const fileName = path.substring(path.lastIndexOf('\\') + 1);
                          await handleDownloadPcFile(path, fileName);
                        } catch (e) {
                          console.warn('Failed to download PC file:', path, e);
                        }
                      }
                      setPcSelectedPaths(new Set());
                    }}>
                    <Text style={styles.floatingTrashBtnText}>Save to Phone ↓</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 4: DEDICATED LAN SHARED CLIPBOARD HUB                 */}
      {/* ========================================================= */}
      {currentTab === 'clipboard' && (
        <View style={{ flex: 1, backgroundColor: isDarkMode ? '#000000' : '#F7F6F2' }}>
          <ScrollView
            style={{ flex: 1, backgroundColor: isDarkMode ? '#000000' : '#F7F6F2' }}
            contentContainerStyle={[styles.bentoScroll, isDarkMode ? styles.bentoScrollDark : styles.bentoScrollLight]}
            showsVerticalScrollIndicator={false}>

          {/* Sync Beacon Status */}
          <View style={[styles.bentoCardHero, !isDarkMode && styles.bentoCardHeroLight]}>
            <View style={styles.beaconHeaderRow}>
              <View style={styles.beaconRowLeft}>
                <View style={pairedPc ? styles.beaconGlowConnected : styles.beaconGlowIdle}>
                  <View
                    style={[styles.beaconDot, { backgroundColor: pairedPc ? '#10b981' : '#3b82f6' }]}
                  />
                </View>
                <View>
                  <Text style={pairedPc ? styles.beaconStatusLabel : styles.beaconStatusLabelIdle}>
                    {pairedPc ? 'LAN CLIPBOARD SYNC ACTIVE' : 'CLIPBOARD STANDALONE'}
                  </Text>
                  <Text style={[styles.beaconHostTitle, !isDarkMode && styles.beaconHostTitleLight]}>
                    {pairedPc ? `Linked to ${pairedPc}` : 'Not Paired with PC'}
                  </Text>
                </View>
              </View>
              {pairedPc && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.syncRefreshChip}
                  onPress={fetchPcClipboard}>
                  <Text style={styles.syncRefreshChipText}>↻ Refresh</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Card 1: Received PC Clipboard */}
          <View style={[styles.bentoCard, !isDarkMode && styles.bentoCardLight]}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>PC Clipboard (Received)</Text>
                <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]}>
                  {pcClipboardUpdatedBy ? `Last synced from: ${pcClipboardUpdatedBy}` : 'Waiting for sync...'}
                </Text>
              </View>
            </View>

            <View style={[styles.clipboardDisplayBox, !isDarkMode && styles.clipboardDisplayBoxLight]}>
              <Text style={[styles.clipboardDisplayText, !isDarkMode && styles.clipboardDisplayTextLight]} selectable>
                {pcClipboardText || 'No clipboard content received yet.'}
              </Text>
            </View>

            <View style={styles.heroBtnRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.heroPrimaryBtn}
                onPress={handleCopyPcClipboardToPhone}>
                <Text style={styles.heroPrimaryBtnText}>Copy to Phone Clipboard</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Card 2: Send Text to PC Clipboard */}
          <View style={[styles.bentoCard, !isDarkMode && styles.bentoCardLight]}>
            <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Push to PC Clipboard (Send)</Text>
            <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]}>
              Type or paste text below to immediately set Windows PC clipboard
            </Text>

            <TextInput
              style={[styles.clipboardTextInput, !isDarkMode && styles.clipboardTextInputLight]}
              placeholder="Paste or type text to send to Windows PC..."
              placeholderTextColor={!isDarkMode ? '#64748b' : '#94a3b8'}
              multiline
              numberOfLines={4}
              value={clipboardInput}
              onChangeText={setClipboardInput}
            />

            <View style={styles.heroBtnRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.heroPrimaryBtn, !pairedPc && { opacity: 0.5 }]}
                disabled={!pairedPc}
                onPress={() => handlePushClipboardToPc()}>
                <Text style={styles.heroPrimaryBtnText}>Push to PC Clipboard →</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.heroSecondaryBtn}
                onPress={() => setClipboardInput('')}>
                <Text style={styles.heroSecondaryBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>

            {/* Quick helper snippet pills */}
            <View style={styles.snippetRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.snippetChip, !isDarkMode && styles.snippetChipLight]}
                onPress={() => setClipboardInput(`http://${deviceIp}:${serverPort}`)}>
                <Text style={[styles.snippetChipText, !isDarkMode && styles.snippetChipTextLight]}>+ Phone Server URL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.snippetChip, !isDarkMode && styles.snippetChipLight]}
                onPress={() => setClipboardInput(deviceIp)}>
                <Text style={[styles.snippetChipText, !isDarkMode && styles.snippetChipTextLight]}>+ Phone IP Address</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 5: TRANSFER & NETWORK SPEED OPTIMIZER                 */}
      {/* ========================================================= */}
      {currentTab === 'transfer' && (
        <View style={{ flex: 1, backgroundColor: isDarkMode ? '#000000' : '#F7F6F2' }}>
          <ScrollView
            style={{ flex: 1, backgroundColor: isDarkMode ? '#000000' : '#F7F6F2' }}
            contentContainerStyle={[styles.bentoScroll, isDarkMode ? styles.bentoScrollDark : styles.bentoScrollLight]}
            showsVerticalScrollIndicator={false}>

          {/* Diagnostic Speed Test Card */}
          <View style={[styles.bentoCardHero, !isDarkMode && styles.bentoCardHeroLight]}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Latency & Network Diagnostics</Text>
                <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]}>Measure direct connection ping & speed</Text>
              </View>
              <View style={styles.speedRatingBadge}>
                <Text style={styles.speedRatingText}>High Speed</Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.runDiagHeroBtn}
              onPress={runNetworkDiagnostic}>
              <Text style={styles.runDiagHeroBtnText}>Run Speed & Latency Test →</Text>
            </TouchableOpacity>

            {diagMessage !== '' && (
              <View
                style={[
                  styles.diagResultBento,
                  diagStatus === 'success' ? styles.diagSuccess : styles.diagWarning,
                ]}>
                <Text style={styles.diagResultText}>{diagMessage}</Text>
              </View>
            )}
          </View>

          {/* High-Speed Transfer Guide */}
          <View style={[styles.bentoCard, !isDarkMode && styles.bentoCardLight]}>
            <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Maximum Wi-Fi Speed Guide</Text>
            <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]}>How to achieve up to 50+ MB/s transfers</Text>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>1</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepTitle, !isDarkMode && styles.stepTitleLight]}>Turn on Phone Hotspot (5GHz)</Text>
                <Text style={[styles.stepDesc, !isDarkMode && styles.stepDescLight]}>
                  Direct device-to-device hotspot eliminates router lag and bypasses slow public Wi-Fi.
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>2</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepTitle, !isDarkMode && styles.stepTitleLight]}>Connect PC to Phone Hotspot</Text>
                <Text style={[styles.stepDesc, !isDarkMode && styles.stepDescLight]}>
                  On Windows, connect your Wi-Fi to this phone's personal hotspot network.
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>3</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepTitle, !isDarkMode && styles.stepTitleLight]}>Enter Hotspot IP (192.168.43.1)</Text>
                <Text style={[styles.stepDesc, !isDarkMode && styles.stepDescLight]}>
                  Fylo automatically detects the direct hotspot IP for ultra-low ping transfers.
                </Text>
              </View>
            </View>
          </View>

          {/* Server Connection Logs */}
          <View style={[styles.bentoCard, !isDarkMode && styles.bentoCardLight]}>
            <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Real-Time Connection Logs</Text>
            <Text style={[styles.bentoCardSubtitle, !isDarkMode && styles.bentoCardSubtitleLight]}>Last 30 network & server events</Text>

            <ScrollView style={{ maxHeight: 180, marginTop: 8 }} nestedScrollEnabled>
              {logs.length === 0 ? (
                <Text style={[styles.emptyLogsText, !isDarkMode && styles.emptyLogsTextLight]}>No connection events logged yet.</Text>
              ) : (
                logs.map((log, index) => (
                  <Text key={index} style={[styles.logTextItem, !isDarkMode && styles.logTextItemLight]}>
                    {log}
                  </Text>
                ))
              )}
            </ScrollView>
          </View>
        </ScrollView>
        </View>
      )}


      {/* ========================================================= */}
      {/* FLOATING CAPSULE BOTTOM NAVIGATION BAR                    */}
      {/* ========================================================= */}
      {!lightboxItem && !sidebarOpen && (
        <FloatingBottomTabBar
          currentTab={currentTab}
          setCurrentTab={setCurrentTab}
          isDark={isDarkMode}
          pairedPc={pairedPc}
        />
      )}

      {/* ========================================================= */}
      {/* UNIVERSAL MEDIA LIGHTBOX & GALLERY CAROUSEL WITH VIDEO    */}
      {/* ========================================================= */}
      {lightboxItem && (
        <Modal
          visible={!!lightboxItem}
          transparent={false}
          statusBarTranslucent={true}
          animationType="fade"
          onRequestClose={() => {
            setLightboxItem(null);
            resetZoom();
          }}>
          <StatusBar hidden={isVideoFile(lightboxItem?.item?.ext)} translucent={true} backgroundColor="transparent" barStyle="light-content" />
          <View style={styles.lightboxOverlay}>
            {!isVideoFile(lightboxItem?.item?.ext) && (
              <View style={styles.lightboxHeader}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.lightboxFileName} numberOfLines={1}>
                      {lightboxItem?.item?.name || 'File'}
                    </Text>
                    {lightboxItem?.playlist && lightboxItem.playlist.length > 0 && (
                      <View style={styles.lightboxIndexBadge}>
                        <Text style={styles.lightboxIndexBadgeText}>
                          {lightboxItem.index + 1} of {lightboxItem.playlist.length}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.lightboxMeta}>
                    {lightboxItem?.source === 'pc' ? 'Windows PC' : 'Local Phone'} • {formatFileSize(lightboxItem?.item?.size)}
                  </Text>
                </View>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.lightboxCloseBtn}
                  onPress={() => {
                    setLightboxItem(null);
                    resetZoom();
                  }}>
                  <Text style={styles.lightboxCloseBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Pinchable, Zoomable & Swipeable Media Body */}
            <View
              style={isVideoFile(lightboxItem?.item?.ext) ? styles.lightboxVideoFullBody : styles.lightboxBody}
              {...(isImageFile(lightboxItem?.item?.ext) ? zoomPanResponder.panHandlers : videoPanResponder.panHandlers)}>

              {/* Navigation chevrons for carousel playlists */}
              {!isVideoFile(lightboxItem?.item?.ext) && lightboxItem?.playlist && lightboxItem.playlist.length > 1 && (
                <>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.lightboxChevronLeft}
                    onPress={goToPrevMedia}>
                    <Text style={styles.lightboxChevronText}>‹</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.lightboxChevronRight}
                    onPress={goToNextMedia}>
                    <Text style={styles.lightboxChevronText}>›</Text>
                  </TouchableOpacity>
                </>
              )}

              <Animated.View style={{ flex: 1, width: '100%', height: '100%', transform: [{ translateX: mediaSlideAnim }] }}>
              {isVideoFile(lightboxItem?.item?.ext) ? (
                /* Native In-App Video View Component with YouTube & MX Player UI */
                <View style={styles.lightboxVideoContainer}>
                  {FyloVideoView ? (
                    <FyloVideoView
                      ref={videoViewRef}
                      style={styles.lightboxNativeVideoView}
                      source={
                        lightboxItem?.source === 'pc'
                          ? (lightboxItem?.item?.downloadUrl
                              ? lightboxItem.item.downloadUrl
                              : `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem?.item?.path || '')}&auth=${pcAuthToken || ''}`)
                          : (lightboxItem?.item?.path || '')
                      }
                      paused={videoPaused}
                      controls={false}
                      repeat={videoRepeat}
                      muted={videoMuted}
                      speed={videoSpeed}
                      seek={videoSeek}
                      resizeMode={videoResizeMode}
                      onVideoLoad={(e) => {
                        setVideoDuration(e?.nativeEvent?.duration || 0);
                        setVideoLoading(false);
                      }}
                      onVideoProgress={(e) => {
                        if (!videoScrubbing) {
                          setVideoCurrentTime(e?.nativeEvent?.currentTime || 0);
                        }
                      }}
                      onVideoEnd={() => {
                        if (!videoRepeat) {
                          setVideoPaused(true);
                          setVideoControlsVisible(true);
                        }
                      }}
                      onVideoError={(e) => {
                        setVideoLoading(false);
                        showToast('⚠️ Video error: ' + (e?.nativeEvent?.error || 'Playback failed'));
                      }}
                    />
                  ) : (
                    <View style={styles.lightboxNonImgContainer}>
                      <Text style={{ fontSize: 44, color: '#8b5cf6' }}>▶</Text>
                      <Text style={styles.lightboxNonImgTitle}>{lightboxItem?.item?.name}</Text>
                    </View>
                  )}

                  {/* Transparent Gesture Overlay directly over native video: intercepts swipes & single/double taps */}
                  <View
                    style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]}
                    {...videoPanResponder.panHandlers}
                  />

                  {/* Double Tap Seek Feedback Ripple (YouTube style) */}
                  {videoDoubleTapFeedback && (
                    <View
                      style={[
                        styles.ytRippleBadge,
                        videoDoubleTapFeedback.side === 'left' ? styles.ytRippleBadgeLeft : styles.ytRippleBadgeRight,
                        { zIndex: 40 },
                      ]}>
                      <Text style={styles.ytRippleBadgeIcon}>
                        {videoDoubleTapFeedback.side === 'left' ? '↺' : '↻'}
                      </Text>
                      <Text style={styles.ytRippleBadgeText}>{videoDoubleTapFeedback.text}</Text>
                    </View>
                  )}

                  {/* YouTube / MX Player Full Controls Overlay */}
                  {videoControlsVisible && (
                    <View style={[StyleSheet.absoluteFillObject, { zIndex: 30, justifyContent: 'space-between' }]} pointerEvents="box-none">
                      {/* Top Bar */}
                      <View style={styles.ytTopBar}>
                        <TouchableOpacity
                          activeOpacity={0.75}
                          style={styles.ytTopBackBtn}
                          onPress={() => {
                            setLightboxItem(null);
                            resetZoom();
                          }}>
                          <Text style={styles.ytTopBackBtnText}>✕</Text>
                        </TouchableOpacity>

                        <View style={styles.ytTopTitleWrap}>
                          <Text style={styles.ytTopTitle} numberOfLines={1}>
                            {lightboxItem?.item?.name || 'Video Player'}
                          </Text>
                          <Text style={styles.ytTopMeta}>
                            {lightboxItem?.source === 'pc' ? 'PC Drive' : 'Phone'} • {(lightboxItem?.item?.ext || 'MP4').toUpperCase()}
                          </Text>
                        </View>

                        <TouchableOpacity
                          activeOpacity={0.75}
                          style={styles.ytTopActionBtn}
                          onPress={cycleVideoSpeed}>
                          <Text style={styles.ytTopActionBtnText}>{videoSpeed}x</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          activeOpacity={0.75}
                          style={styles.ytTopActionBtn}
                          onPress={cycleVideoResizeMode}>
                          <Text style={styles.ytTopActionBtnText}>
                            {videoResizeMode === 'contain' ? 'FIT' : 'FILL'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          activeOpacity={0.75}
                          style={[styles.ytTopActionBtn, { backgroundColor: 'rgba(37, 99, 235, 0.45)', borderColor: '#3b82f6', borderWidth: 1 }]}
                          onPress={() => {
                            const pathOrUrl = lightboxItem?.source === 'pc'
                              ? (lightboxItem?.item?.downloadUrl
                                  ? lightboxItem.item.downloadUrl
                                  : `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem?.item?.path || '')}&auth=${pcAuthToken || ''}`)
                              : lightboxItem?.item?.path;
                            if (FyloModule && FyloModule.openVideoPlayer) {
                              FyloModule.openVideoPlayer(pathOrUrl, 'video/*');
                            }
                          }}>
                          <Text style={[styles.ytTopActionBtnText, { color: '#93c5fd' }]}>⛶ Fullscreen</Text>
                        </TouchableOpacity>

                        {lightboxItem?.source === 'pc' && (
                          <TouchableOpacity
                            activeOpacity={0.75}
                            style={[styles.ytTopActionBtn, { backgroundColor: 'rgba(30, 41, 59, 0.75)', borderColor: 'rgba(255, 255, 255, 0.25)', borderWidth: 1 }]}
                            onPress={() => {
                              const streamUrl = lightboxItem?.item?.downloadUrl
                                ? lightboxItem.item.downloadUrl
                                : `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem?.item?.path || '')}&auth=${pcAuthToken || ''}`;
                              if (FyloModule && FyloModule.openUrlWithChooser) {
                                FyloModule.openUrlWithChooser(streamUrl, 'video/*', `Stream ${lightboxItem?.item?.name || 'Video'}`);
                              }
                            }}>
                            <Text style={[styles.ytTopActionBtnText, { color: '#38bdf8' }]}>⚡ VLC/MX</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Center Controls (Rewind 10s, Big Play/Pause, Forward 10s) */}
                      <View style={styles.ytCenterControls} pointerEvents="box-none">
                        <TouchableOpacity
                          activeOpacity={0.75}
                          style={styles.ytCircleBtn}
                          onPress={() => seekVideoDelta(-10)}>
                          <Text style={styles.ytCircleBtnText}>↺ 10</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          activeOpacity={0.75}
                          style={styles.ytPlayPauseBtn}
                          onPress={() => setVideoPaused(!videoPaused)}>
                          <Text style={styles.ytPlayPauseText}>{videoPaused ? '▶' : '❙❙'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          activeOpacity={0.75}
                          style={styles.ytCircleBtn}
                          onPress={() => seekVideoDelta(10)}>
                          <Text style={styles.ytCircleBtnText}>↻ 10</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Bottom Bar: Timeline Scrubber + Actions */}
                      <View style={styles.ytBottomBar}>
                        {/* Interactive Scrubber Bar */}
                        <View
                          style={styles.ytScrubberTrack}
                          onLayout={(e) => setScrubberWidth(e.nativeEvent.layout.width)}
                          {...scrubberPanResponder.panHandlers}>
                          <View style={styles.ytScrubberBg}>
                            <View
                              style={[
                                styles.ytScrubberFill,
                                {
                                  width: `${
                                    videoDuration > 0
                                      ? Math.max(0, Math.min(100, ((videoScrubbing ? videoScrubTime : videoCurrentTime) / videoDuration) * 100))
                                      : 0
                                  }%`,
                                },
                              ]}
                            />
                            <View
                              style={[
                                styles.ytScrubberThumb,
                                {
                                  left: `${
                                    videoDuration > 0
                                      ? Math.max(0, Math.min(100, ((videoScrubbing ? videoScrubTime : videoCurrentTime) / videoDuration) * 100))
                                      : 0
                                  }%`,
                                  marginLeft: -7,
                                },
                              ]}
                            />
                          </View>
                        </View>

                        {/* Bottom Actions Row */}
                        <View style={styles.ytBottomActionRow}>
                          <Text style={styles.ytTimeText}>
                            {formatDuration(videoScrubbing ? videoScrubTime : videoCurrentTime)} / {formatDuration(videoDuration)}
                          </Text>

                          <View style={styles.ytBottomActionsRight}>
                            <TouchableOpacity
                              activeOpacity={0.75}
                              style={styles.ytIconBtn}
                              onPress={() => setVideoMuted(!videoMuted)}>
                              <Text style={styles.ytIconBtnText}>{videoMuted ? '🔇' : '🔊'}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              activeOpacity={0.75}
                              style={styles.ytIconBtn}
                              onPress={() => setVideoRepeat(!videoRepeat)}>
                              <Text style={[styles.ytIconBtnText, videoRepeat && { color: '#60cdff' }]}>↻</Text>
                            </TouchableOpacity>

                            {lightboxItem?.source === 'pc' && (
                              <TouchableOpacity
                                activeOpacity={0.75}
                                style={styles.ytIconBtn}
                                onPress={() => {
                                  if (lightboxItem?.item?.downloadUrl) {
                                    handleDownloadSharedHubFile(lightboxItem.item);
                                  } else {
                                    handleDownloadPcFile(lightboxItem?.item?.path, lightboxItem?.item?.name);
                                  }
                                }}>
                                <Text style={styles.ytIconBtnText}>↓ Save</Text>
                              </TouchableOpacity>
                            )}

                            {lightboxItem?.source === 'phone' && pairedPc && (
                              <TouchableOpacity
                                activeOpacity={0.75}
                                style={styles.ytIconBtn}
                                onPress={() => handleSendFilesToPc([lightboxItem?.item?.path])}>
                                <Text style={styles.ytIconBtnText}>→ PC</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              ) : isImageFile(lightboxItem?.item?.ext) ? (
                /* Hardware-Accelerated 120Hz Fluid Pinch & Zoom Image Container */
                <Animated.View
                  style={{
                    width: '100%',
                    height: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [
                      { scale: zoomScaleAnim },
                      { translateX: panXAnim },
                      { translateY: panYAnim },
                    ],
                  }}>
                  <SafeImage
                    source={{
                      uri: lightboxItem?.source === 'pc'
                        ? (lightboxItem?.item?.downloadUrl
                            ? lightboxItem.item.downloadUrl
                            : `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem?.item?.path || '')}&auth=${pcAuthToken || ''}`)
                        : `file://${lightboxItem?.item?.path || ''}`,
                      headers: (lightboxItem?.source === 'pc' && !lightboxItem?.item?.downloadUrl) ? { 'X-Auth-Token': pcAuthToken || '' } : undefined,
                    }}
                    style={styles.lightboxImage}
                    resizeMode="contain"
                    fallbackText=""
                  />
                </Animated.View>
              ) : (
                <View style={styles.lightboxNonImgContainer}>
                  <FileBadgeIcon ext={lightboxItem?.item?.ext} isDir={false} size={64} />
                  <Text style={styles.lightboxNonImgTitle}>{lightboxItem?.item?.name || 'File'}</Text>
                  <Text style={styles.lightboxNonImgMeta}>{formatFileSize(lightboxItem?.item?.size)}</Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.lightboxOpenExternalBtn}
                    onPress={() => {
                      if (isAudioFile(lightboxItem?.item?.ext)) {
                        playInbuiltAudio(lightboxItem.item, lightboxItem.source);
                      } else {
                        openExternalFileOrChooser(lightboxItem.item, lightboxItem.source);
                      }
                    }}>
                    <Text style={styles.lightboxOpenExternalBtnIcon}>
                      {isAudioFile(lightboxItem?.item?.ext) ? '🎵' : '↗'}
                    </Text>
                    <Text style={styles.lightboxOpenExternalBtnText}>
                      {isAudioFile(lightboxItem?.item?.ext) ? 'Play in Built-in Player' : 'Open in External App / Player ↗'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Quick zoom controls for image files */}
              {isImageFile(lightboxItem?.item?.ext) && (
                <View style={styles.lightboxZoomControls}>
                  <TouchableOpacity activeOpacity={0.75} style={styles.zoomCtrlBtn} onPress={handleZoomOut}>
                    <Text style={styles.zoomCtrlBtnText}>−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.75} style={styles.zoomScaleBadge} onPress={resetZoom}>
                    <Text style={styles.zoomScaleBadgeText}>{Math.round(zoomScale * 100)}%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.75} style={styles.zoomCtrlBtn} onPress={handleZoomIn}>
                    <Text style={styles.zoomCtrlBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              )}
              </Animated.View>
            </View>

            {!isVideoFile(lightboxItem?.item?.ext) && (
              <View style={styles.lightboxFooter}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.lightboxOpenInAppBtn}
                  onPress={() => {
                    if (isAudioFile(lightboxItem?.item?.ext)) {
                      playInbuiltAudio(lightboxItem.item, lightboxItem.source);
                    } else {
                      openExternalFileOrChooser(lightboxItem.item, lightboxItem.source);
                    }
                  }}>
                  <Text style={styles.lightboxOpenInAppBtnText}>
                    {isAudioFile(lightboxItem?.item?.ext) ? 'Play Track 🎵' : 'Open with App ↗'}
                  </Text>
                </TouchableOpacity>
                {lightboxItem?.source === 'pc' && (
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.lightboxDlBtn}
                    onPress={() => {
                      if (lightboxItem?.item?.downloadUrl) {
                        handleDownloadSharedHubFile(lightboxItem.item);
                      } else {
                        handleDownloadPcFile(lightboxItem?.item?.path, lightboxItem?.item?.name);
                      }
                    }}>
                    <Text style={styles.lightboxDlBtnText}>Save to Phone ↓</Text>
                  </TouchableOpacity>
                )}

                {lightboxItem?.source === 'phone' && pairedPc && (
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.lightboxSendBtn}
                    onPress={() => handleSendFilesToPc([lightboxItem?.item?.path])}>
                    <Text style={styles.lightboxSendBtnText}>Send to PC →</Text>
                  </TouchableOpacity>
                )}

                {lightboxItem?.source === 'phone' && (
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.lightboxTrashBtn}
                    onPress={() => {
                      Alert.alert(
                        'Move to Trash',
                        `Are you sure you want to move "${lightboxItem?.item?.name || 'this file'}" to trash?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Trash',
                            style: 'destructive',
                            onPress: async () => {
                              if (FyloModule && FyloModule.trashFile && lightboxItem?.item?.path) {
                                try {
                                  await FyloModule.trashFile(lightboxItem.item.path);
                                  showToast('Moved to .trash safely');
                                } catch (err) {
                                  showToast('Trash Error: ' + (err?.message || 'Failed'));
                                }
                              }
                              setLightboxItem(null);
                              loadPhoneFolder(phoneCurrentPath);
                            },
                          },
                        ]
                      );
                    }}>
                    <Text style={styles.lightboxTrashBtnText}>Trash</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* COLLAPSIBLE NAVIGATION SIDEBAR DRAWER                     */}
      {/* ========================================================= */}
      <Modal visible={sidebarOpen} transparent statusBarTranslucent={true} animationType="fade" onRequestClose={closeSidebar}>
        <View style={styles.drawerBackdrop}>
          <Animated.View
            style={[
              styles.drawerPanel,
              !isDarkMode && styles.drawerPanelLight,
              { transform: [{ translateX: drawerSlideAnim }] },
            ]}>
            {/* Drawer Brand Header */}
            <View style={[styles.drawerHeader, !isDarkMode && styles.drawerHeaderLight]}>
              <View style={styles.drawerHeaderBrand}>
                <View style={styles.brandCircle}>
                  <Text style={styles.brandCircleText}>F</Text>
                </View>
                <View>
                  <Text style={[styles.drawerTitle, !isDarkMode && styles.drawerTitleLight]}>fylo</Text>
                  <Text style={styles.drawerSub}>Mobile Companion</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.drawerCloseBtn}
                activeOpacity={0.75}
                onPress={closeSidebar}>
                <Text style={[styles.drawerCloseBtnText, !isDarkMode && styles.drawerCloseBtnTextLight]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Connection Status Card in Drawer */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.drawerConnCard, !isDarkMode && styles.drawerConnCardLight, pairedPc && (isDarkMode ? styles.drawerConnCardActive : styles.drawerConnCardActiveLight)]}
              onPress={() => {
                closeSidebar();
                if (pairedPc) {
                  setShowSettingsModal(true);
                } else {
                  setShowPairModal(true);
                }
              }}>
              <View style={[styles.beaconDot, { backgroundColor: pairedPc ? (isPcReachable ? '#10b981' : '#ef4444') : '#64748b' }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.drawerConnTitle, !isDarkMode && styles.drawerConnTitleLight]}>
                  {pairedPc ? (isPcReachable ? `Linked to ${pcHostName || 'PC'}` : `${pcHostName || 'PC'} (Offline)`) : 'Not Paired to PC'}
                </Text>
                <Text style={[styles.drawerConnSub, !isDarkMode && styles.drawerConnSubLight]}>
                  {pairedPc ? (isPcReachable ? `${pairedPc} • ${pingLatency !== null ? `${pingLatency} ms latency` : 'Connected'}` : `${pairedPc} • PC Unreachable`) : 'Tap to scan QR or connect via IP'}
                </Text>
              </View>
              <Text style={{ color: '#60a5fa', fontSize: 16 }}>{pairedPc ? '⚙' : '⚡'}</Text>
            </TouchableOpacity>

            {/* Navigation Section Items */}
            <ScrollView style={styles.drawerNavList} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.drawerNavItem,
                  !isDarkMode && styles.drawerNavItemLight,
                  currentTab === 'home' && (isDarkMode ? styles.drawerNavItemActive : styles.drawerNavItemActiveLight),
                ]}
                onPress={() => {
                  setCurrentTab('home');
                  closeSidebar();
                }}>
                <VectorHomeIcon size={18} color={currentTab === 'home' ? '#2563eb' : (isDarkMode ? '#94a3b8' : '#475569')} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.drawerNavLabel,
                      !isDarkMode && styles.drawerNavLabelLight,
                      currentTab === 'home' && (isDarkMode ? styles.drawerNavLabelActive : styles.drawerNavLabelActiveLight),
                    ]}>
                    Home
                  </Text>
                  <Text style={[styles.drawerNavSub, !isDarkMode && styles.drawerNavSubLight]}>
                    Instant transfer & device storage
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.drawerNavItem,
                  !isDarkMode && styles.drawerNavItemLight,
                  currentTab === 'sharehub' && (isDarkMode ? styles.drawerNavItemActive : styles.drawerNavItemActiveLight),
                ]}
                onPress={() => {
                  setCurrentTab('sharehub');
                  fetchSharedHubFiles();
                  closeSidebar();
                }}>
                <VectorShareHubIcon size={18} color={currentTab === 'sharehub' ? '#2563eb' : (isDarkMode ? '#94a3b8' : '#475569')} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.drawerNavLabel,
                      !isDarkMode && styles.drawerNavLabelLight,
                      currentTab === 'sharehub' && (isDarkMode ? styles.drawerNavLabelActive : styles.drawerNavLabelActiveLight),
                    ]}>
                    ShareHub
                  </Text>
                  <Text style={[styles.drawerNavSub, !isDarkMode && styles.drawerNavSubLight]}>
                    Active shared files from PC & Phone
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.drawerNavItem,
                  !isDarkMode && styles.drawerNavItemLight,
                  currentTab === 'pc-explorer' && (isDarkMode ? styles.drawerNavItemActive : styles.drawerNavItemActiveLight),
                ]}
                onPress={() => {
                  setCurrentTab('pc-explorer');
                  closeSidebar();
                }}>
                <VectorMonitorIcon size={18} color={currentTab === 'pc-explorer' ? '#2563eb' : (isDarkMode ? '#94a3b8' : '#475569')} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.drawerNavLabel,
                      !isDarkMode && styles.drawerNavLabelLight,
                      currentTab === 'pc-explorer' && (isDarkMode ? styles.drawerNavLabelActive : styles.drawerNavLabelActiveLight),
                    ]}>
                    PC Drives Explorer
                  </Text>
                  <Text style={[styles.drawerNavSub, !isDarkMode && styles.drawerNavSubLight]}>
                    Browse Windows C:\, D:\, Downloads
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.drawerNavItem,
                  !isDarkMode && styles.drawerNavItemLight,
                  currentTab === 'phone-explorer' && (isDarkMode ? styles.drawerNavItemActive : styles.drawerNavItemActiveLight),
                ]}
                onPress={() => {
                  setCurrentTab('phone-explorer');
                  closeSidebar();
                }}>
                <VectorPhoneIcon size={18} color={currentTab === 'phone-explorer' ? '#2563eb' : (isDarkMode ? '#94a3b8' : '#475569')} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.drawerNavLabel,
                      !isDarkMode && styles.drawerNavLabelLight,
                      currentTab === 'phone-explorer' && (isDarkMode ? styles.drawerNavLabelActive : styles.drawerNavLabelActiveLight),
                    ]}>
                    Phone Storage & Gallery
                  </Text>
                  <Text style={[styles.drawerNavSub, !isDarkMode && styles.drawerNavSubLight]}>
                    Internal files, DCIM, Photos & Media
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.drawerNavItem,
                  !isDarkMode && styles.drawerNavItemLight,
                  currentTab === 'clipboard' && (isDarkMode ? styles.drawerNavItemActive : styles.drawerNavItemActiveLight),
                ]}
                onPress={() => {
                  setCurrentTab('clipboard');
                  closeSidebar();
                }}>
                <VectorClipboardIcon size={18} color={currentTab === 'clipboard' ? '#2563eb' : (isDarkMode ? '#94a3b8' : '#475569')} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.drawerNavLabel,
                      !isDarkMode && styles.drawerNavLabelLight,
                      currentTab === 'clipboard' && (isDarkMode ? styles.drawerNavLabelActive : styles.drawerNavLabelActiveLight),
                    ]}>
                    LAN Shared Clipboard
                  </Text>
                  <Text style={[styles.drawerNavSub, !isDarkMode && styles.drawerNavSubLight]}>
                    Live bidirectional text sync
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.drawerNavItem,
                  !isDarkMode && styles.drawerNavItemLight,
                  currentTab === 'transfer' && (isDarkMode ? styles.drawerNavItemActive : styles.drawerNavItemActiveLight),
                ]}
                onPress={() => {
                  setCurrentTab('transfer');
                  closeSidebar();
                }}>
                <VectorLightningIcon size={18} color={currentTab === 'transfer' ? '#2563eb' : (isDarkMode ? '#94a3b8' : '#475569')} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.drawerNavLabel,
                      !isDarkMode && styles.drawerNavLabelLight,
                      currentTab === 'transfer' && (isDarkMode ? styles.drawerNavLabelActive : styles.drawerNavLabelActiveLight),
                    ]}>
                    Speed & Diagnostics
                  </Text>
                  <Text style={[styles.drawerNavSub, !isDarkMode && styles.drawerNavSubLight]}>
                    Ping latency, server status & logs
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.drawerNavItem}
                onPress={() => {
                  closeSidebar();
                  setShowSettingsModal(true);
                }}>
                <Text style={styles.drawerNavIcon}>⚙</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.drawerNavLabel}>App Settings</Text>
                  <Text style={styles.drawerNavSub}>Storage sharing & preferences</Text>
                </View>
              </TouchableOpacity>
            </ScrollView>

            {/* Allow Full Phone Storage Access Toggle in Sidebar */}
            <View style={[styles.drawerSettingRow, !isDarkMode && styles.drawerSettingRowLight]}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <Text style={{ fontSize: 16, color: '#3b82f6' }}>▣</Text>
                  <Text style={[styles.drawerThemeText, !isDarkMode && styles.drawerThemeTextLight]}>
                    Allow Full Storage
                  </Text>
                </View>
                <Text style={[styles.drawerSettingSub, !isDarkMode && styles.drawerSettingSubLight]}>
                  Allow paired PC to browse phone folders. When disabled, only ShareHub transfers work.
                </Text>
              </View>
              <Switch
                value={allowFullPhoneAccess !== false}
                onValueChange={(val) => handleSetStorageAccess(val)}
                trackColor={{ false: '#94a3b8', true: '#2563eb' }}
                thumbColor={allowFullPhoneAccess !== false ? '#60a5fa' : '#ffffff'}
              />
            </View>

            {/* Live Clipboard Sync Toggle in Sidebar (ON by Default) */}
            <View style={[styles.drawerThemeRow, !isDarkMode && styles.drawerThemeRowLight]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 16, color: '#38bdf8' }}>⎘</Text>
                <Text style={[styles.drawerThemeText, !isDarkMode && styles.drawerThemeTextLight]}>
                  Live Clipboard Sync
                </Text>
              </View>
              <Switch
                value={clipboardAutoSync}
                onValueChange={(val) => {
                  setClipboardAutoSync(val);
                  showToast(val ? 'Live Clipboard Sync Enabled' : 'Live Clipboard Sync Disabled');
                }}
                trackColor={{ false: '#94a3b8', true: '#2563eb' }}
                thumbColor={clipboardAutoSync ? '#60a5fa' : '#ffffff'}
              />
            </View>

            {/* Light / Dark Mode Toggle in Sidebar */}
            <View style={[styles.drawerThemeRow, !isDarkMode && styles.drawerThemeRowLight]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 16, color: isDarkMode ? '#60a5fa' : '#f59e0b' }}>{isDarkMode ? '☾' : '☀'}</Text>
                <Text style={[styles.drawerThemeText, !isDarkMode && styles.drawerThemeTextLight]}>
                  {isDarkMode ? 'Dark Mode' : 'Light Mode'}
                </Text>
              </View>
              <Switch
                value={isDarkMode}
                onValueChange={(val) => setIsDarkMode(val)}
                trackColor={{ false: '#94a3b8', true: '#2563eb' }}
                thumbColor={isDarkMode ? '#60a5fa' : '#ffffff'}
              />
            </View>

            {/* Drawer Footer */}
            <View style={[styles.drawerFooter, !isDarkMode && styles.drawerFooterLight]}>
              <Text style={styles.drawerFooterText}>
                {phoneModelName} • {storageInfo.freeGB} Free
              </Text>
              {pairedPc && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.drawerUnpairBtn}
                  onPress={() => {
                    closeSidebar();
                    handleUnpair();
                  }}>
                  <Text style={styles.drawerUnpairBtnText}>Disconnect</Text>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
          <TouchableOpacity
            style={styles.drawerDismissArea}
            activeOpacity={1}
            onPress={closeSidebar}
          />
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* DIRECT SHARE DEVICE PICKER MODAL (INSTANT ICONS & NAMES) */}
      {/* ========================================================= */}
      <Modal visible={directShareModalVisible} transparent statusBarTranslucent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => setDirectShareModalVisible(false)}
          />
          <View style={[styles.directShareCard, !isDarkMode && styles.directShareCardLight]}>
            <View style={styles.directShareHeader}>
              <View>
                <Text style={[styles.directShareTitle, !isDarkMode && styles.directShareTitleLight]}>
                  Share to Device
                </Text>
                <Text style={styles.directShareSub}>
                  {directSharePendingFiles.length} file{directSharePendingFiles.length === 1 ? '' : 's'} selected to transfer
                </Text>
              </View>
              <TouchableOpacity activeOpacity={0.75} onPress={() => setDirectShareModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.directShareDeviceList}>
              {/* Primary Connected PC Device */}
              <TouchableOpacity
                activeOpacity={0.8}
                style={[
                  styles.directShareDeviceBtn,
                  pairedPc && styles.directShareDeviceBtnActive,
                  !isDarkMode && styles.directShareDeviceBtnLight,
                ]}
                onPress={async () => {
                  setDirectShareModalVisible(false);
                  if (pairedPc) {
                    showToast(`Sending ${directSharePendingFiles.length} file(s) to ${pcHostName || 'PC'} Downloads...`);
                    const paths = directSharePendingFiles.map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean);
                    await handleSendFilesToPc(paths);
                  } else {
                    showToast('Please pair with PC first');
                    setShowPairModal(true);
                  }
                }}>
                <View style={styles.directShareIconWrap}>
                  <Text style={[styles.directShareIconEmoji, { fontSize: 20, color: '#38bdf8' }]}>⬡</Text>
                  {pairedPc && <View style={styles.directShareOnlineDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.directShareDeviceName, !isDarkMode && styles.directShareDeviceNameLight]}>
                    {pcHostName || 'Windows PC'}
                  </Text>
                  <Text style={styles.directShareDeviceMeta}>
                    {pairedPc ? 'Downloads folder • Online' : 'Tap to Pair PC & Send'}
                  </Text>
                </View>
                <Text style={styles.directShareActionText}>
                  {pairedPc ? 'Send →' : 'Pair →'}
                </Text>
              </TouchableOpacity>

              {/* Nearby LAN / Other Device Option */}
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.directShareDeviceBtn, !isDarkMode && styles.directShareDeviceBtnLight]}
                onPress={() => {
                  setDirectShareModalVisible(false);
                  setShowPairModal(true);
                }}>
                <View style={styles.directShareIconWrap}>
                  <Text style={[styles.directShareIconEmoji, { fontSize: 20, color: '#60a5fa' }]}>▣</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.directShareDeviceName, !isDarkMode && styles.directShareDeviceNameLight]}>
                    Nearby Phone / Peer
                  </Text>
                  <Text style={styles.directShareDeviceMeta}>
                    Connect via IP or QR Code
                  </Text>
                </View>
                <Text style={styles.directShareActionText}>Connect →</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.directShareCancelBtn}
              onPress={() => setDirectShareModalVisible(false)}>
              <Text style={styles.directShareCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* PC FILE ACTION PROMPT MODAL (DOWNLOAD / OPEN IN APP)      */}
      {/* ========================================================= */}
      <Modal
        visible={!!pcFileActionPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setPcFileActionPrompt(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => setPcFileActionPrompt(null)}
          />
          <View style={[styles.externalPromptCard, !isDarkMode && styles.externalPromptCardLight]}>
            {/* Header */}
            <View style={styles.externalPromptHeader}>
              <View style={styles.externalPromptBadgeRow}>
                <FileBadgeIcon ext={pcFileActionPrompt?.file?.ext || (pcFileActionPrompt?.file?.name ? pcFileActionPrompt.file.name.split('.').pop() : '')} isDir={false} size={36} />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <Text style={[styles.externalPromptHeading, !isDarkMode && styles.externalPromptHeadingLight]}>
                    {pcFileActionPrompt?.source === 'sharehub' ? 'Shared PC File' : 'Remote PC File'}
                  </Text>
                  <Text style={styles.externalPromptBadgeSub}>
                    Windows PC • {formatFileSize(pcFileActionPrompt?.file?.size)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => setPcFileActionPrompt(null)}
                style={styles.externalPromptCloseBtn}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* File Details */}
            <View style={[styles.externalPromptFileBox, !isDarkMode && styles.externalPromptFileBoxLight]}>
              <Text
                style={[styles.externalPromptFileName, !isDarkMode && styles.externalPromptFileNameLight]}
                numberOfLines={2}>
                {pcFileActionPrompt?.file?.name || 'File'}
              </Text>
              <Text style={styles.externalPromptFileFormat}>
                Format: {(pcFileActionPrompt?.file?.ext || (pcFileActionPrompt?.file?.name ? pcFileActionPrompt.file.name.split('.').pop() : 'Unknown')).toUpperCase()}
              </Text>
            </View>

            {/* Informative text */}
            <Text style={[styles.externalPromptDesc, !isDarkMode && styles.externalPromptDescLight]}>
              {pcFileActionPrompt?.source === 'sharehub'
                ? 'Save this file from PC to your phone Downloads/Fylo folder, or open directly in an installed app.'
                : 'Download this file from your PC to phone Downloads/Fylo folder, or open directly in an installed app.'}
            </Text>

            {/* Action Buttons */}
            <View style={styles.externalPromptActions}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.externalPromptPrimaryBtn}
                onPress={async () => {
                  const prompt = pcFileActionPrompt;
                  setPcFileActionPrompt(null);
                  if (prompt?.file) {
                    if (prompt.source === 'sharehub') {
                      await handleDownloadSharedHubFile(prompt.file);
                    } else {
                      await handleDownloadPcFile(prompt.file.path, prompt.file.name);
                    }
                  }
                }}>
                <Text style={styles.externalPromptPrimaryBtnText}>
                  {pcFileActionPrompt?.source === 'sharehub' ? '⬇️ Save to Phone' : '⬇️ Download to Phone'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.externalPromptSecondaryBtn, !isDarkMode && styles.externalPromptSecondaryBtnLight]}
                onPress={async () => {
                  const prompt = pcFileActionPrompt;
                  setPcFileActionPrompt(null);
                  if (prompt?.file) {
                    await handleOpenPcFileInApp(prompt.file);
                  }
                }}>
                <Text style={[styles.externalPromptSecondaryBtnText, !isDarkMode && styles.externalPromptSecondaryBtnTextLight]}>
                  {pcFileActionPrompt?.source === 'sharehub' ? '↗ Open with App' : '↗ Open in Phone App'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.externalPromptCancelBtn}
                onPress={() => setPcFileActionPrompt(null)}>
                <Text style={styles.externalPromptCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* DEDICATED SORT OPTIONS MODAL DROPDOWN                     */}
      {/* ========================================================= */}
      <Modal visible={!!sortModalTarget} transparent statusBarTranslucent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => setSortModalTarget(null)}
          />
          <View style={[styles.sortModalCard, !isDarkMode && styles.sortModalCardLight]}>
            <View style={styles.sortModalHeader}>
              <Text style={[styles.sortModalTitle, !isDarkMode && styles.sortModalTitleLight]}>
                ⇅ Sort Files & Folders
              </Text>
              <TouchableOpacity activeOpacity={0.75} onPress={() => setSortModalTarget(null)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {[
              { id: 'latest', label: 'Latest First (Date Newest)', sub: 'Newest files & folders appear at the top' },
              { id: 'oldest', label: 'Oldest First (Date Oldest)', sub: 'Oldest files & folders appear at top' },
              { id: 'name', label: 'Name (A → Z)', sub: 'Alphabetical ascending' },
              { id: 'name-desc', label: 'Name (Z → A)', sub: 'Alphabetical descending' },
              { id: 'size', label: 'Size (Largest First)', sub: 'Highest file size at top' },
              { id: 'size-asc', label: 'Size (Smallest First)', sub: 'Smallest file size at top' },
              { id: 'type-asc', label: 'File Type (A → Z)', sub: 'Group by file extension ascending' },
              { id: 'type-desc', label: 'File Type (Z → A)', sub: 'Group by file extension descending' },
            ].map((opt) => {
              const currentSort = sortModalTarget === 'phone' ? phoneSortBy : pcSortBy;
              const isSelected = currentSort === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  activeOpacity={0.75}
                  style={[styles.sortOptionRow, isSelected && styles.sortOptionRowActive]}
                  onPress={() => {
                    if (sortModalTarget === 'phone') {
                      setPhoneSortBy(opt.id);
                    } else if (sortModalTarget === 'pc') {
                      setPcSortBy(opt.id);
                    }
                    setSortModalTarget(null);
                  }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sortOptionLabel, isSelected && styles.sortOptionLabelActive]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.sortOptionSub}>{opt.sub}</Text>
                  </View>
                  {isSelected && <Text style={styles.sortOptionCheckMark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* PAIRING MODAL: SCAN QR / MANUAL IP                        */}
      {/* ========================================================= */}
      <Modal visible={showPairModal} transparent statusBarTranslucent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, !isDarkMode && styles.modalContentLight]}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, !isDarkMode && styles.modalTitleLight]}>Pair with PC</Text>
              <TouchableOpacity activeOpacity={0.75} onPress={() => setShowPairModal(false)}>
                <Text style={[styles.modalCloseText, !isDarkMode && styles.modalCloseTextLight]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Modal Tabs */}
            <View style={styles.modalSubTabsRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.modalSubTab,
                  !isDarkMode && styles.modalSubTabLight,
                  pairModalTab === 'auto' && styles.modalSubTabActive,
                ]}
                onPress={() => setPairModalTab('auto')}>
                <Text style={[
                  styles.modalSubTabText,
                  !isDarkMode && styles.modalSubTabTextLight,
                  pairModalTab === 'auto' && styles.modalSubTabTextActive,
                ]}>
                  ✨ Auto-Detect {discoveredDevices.length > 0 ? `(${discoveredDevices.length})` : ''}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.modalSubTab,
                  !isDarkMode && styles.modalSubTabLight,
                  pairModalTab === 'qr' && styles.modalSubTabActive,
                ]}
                onPress={() => setPairModalTab('qr')}>
                <Text style={[
                  styles.modalSubTabText,
                  !isDarkMode && styles.modalSubTabTextLight,
                  pairModalTab === 'qr' && styles.modalSubTabTextActive,
                ]}>
                  Scan QR
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.modalSubTab,
                  !isDarkMode && styles.modalSubTabLight,
                  pairModalTab === 'manual' && styles.modalSubTabActive,
                ]}
                onPress={() => setPairModalTab('manual')}>
                <Text style={[
                  styles.modalSubTabText,
                  !isDarkMode && styles.modalSubTabTextLight,
                  pairModalTab === 'manual' && styles.modalSubTabTextActive,
                ]}>
                  Manual IP
                </Text>
              </TouchableOpacity>
            </View>

            {pairModalTab === 'auto' ? (
              <View>
                <Text style={[styles.modalSubtitle, !isDarkMode && styles.modalSubtitleLight]}>
                  Nearby Windows PCs running Fylo on this Wi-Fi network:
                </Text>

                {discoveredDevices.length === 0 ? (
                  <View style={styles.autoDiscoverEmptyBox}>
                    <ActivityIndicator size="small" color="#3b82f6" style={{ marginBottom: 10 }} />
                    <Text style={[styles.autoDiscoverSearchingTitle, !isDarkMode && styles.autoDiscoverSearchingTitleLight]}>
                      Listening on Wi-Fi for PC...
                    </Text>
                    <Text style={styles.autoDiscoverSearchingDesc}>
                      Make sure Fylo is running on your PC and both devices are connected to the same Wi-Fi or hotspot.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 8, marginTop: 6, marginBottom: 14 }}>
                    {discoveredDevices.map((dev, i) => (
                      <View key={'disc-' + i} style={[styles.autoDiscoverPcCard, !isDarkMode && styles.autoDiscoverPcCardLight]}>
                        <View style={styles.autoDiscoverIconWrap}>
                          <Text style={{ fontSize: 22 }}>🖥️</Text>
                          <View style={styles.autoDiscoverOnlineDot} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.autoDiscoverPcName, !isDarkMode && styles.autoDiscoverPcNameLight]} numberOfLines={1}>
                            {dev.name || 'Windows Host'}
                          </Text>
                          <Text style={styles.autoDiscoverPcIp}>
                            {dev.ip}:{dev.port || 3000} • Ready to Link
                          </Text>
                        </View>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          style={styles.autoDiscoverConnectBtn}
                          onPress={() => handleConnectToPc(`${dev.ip}:${dev.port || 3000}`, dev.token)}>
                          <Text style={styles.autoDiscoverConnectBtnText}>Link ⚡</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.modalCancelBtn, !isDarkMode && styles.modalCancelBtnLight]}
                    onPress={() => setShowPairModal(false)}>
                    <Text style={[styles.modalCancelBtnText, !isDarkMode && styles.modalCancelBtnTextLight]}>Close</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.modalPrimaryBtn}
                    onPress={() => setPairModalTab('qr')}>
                    <Text style={styles.modalPrimaryBtnText}>Scan QR Instead →</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : pairModalTab === 'qr' ? (
              <View>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.qrViewfinderBox}
                  onPress={handleStartQrScan}>
                  <Text style={[styles.qrViewfinderIcon, { color: '#3b82f6', fontSize: 32 }]}>⬡</Text>
                  <Text style={styles.qrScanBtnTitle}>Open Camera Scanner</Text>
                  <Text style={styles.qrViewfinderInstruction}>
                    Tap to open your camera and scan the QR code displayed on your PC screen in Fylo
                  </Text>
                </TouchableOpacity>

                <View style={styles.qrDividerRow}>
                  <View style={styles.qrDividerLine} />
                  <Text style={styles.qrDividerText}>OR PASTE STRING</Text>
                  <View style={styles.qrDividerLine} />
                </View>

                <TextInput
                  style={[styles.modalInput, !isDarkMode && styles.modalInputLight]}
                  placeholder="Paste QR Code String (e.g. http://192.168.1.5:3000/?auth=...)"
                  placeholderTextColor={!isDarkMode ? '#64748b' : '#94a3b8'}
                  value={qrInputText}
                  onChangeText={setQrInputText}
                  autoCapitalize="none"
                />

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[styles.hotspotPresetBtn, { marginBottom: 12 }]}
                  onPress={async () => {
                    try {
                      if (FyloModule && FyloModule.getClipboardText) {
                        const clip = await FyloModule.getClipboardText();
                        if (clip && clip.trim()) {
                          setQrInputText(clip.trim());
                          handleParseAndConnectQr(clip.trim());
                          return;
                        }
                      }
                      showToast('Clipboard is empty');
                    } catch (e) {
                      showToast('Could not read clipboard');
                    }
                  }}>
                  <Text style={styles.hotspotPresetBtnText}>Paste from Clipboard & Connect</Text>
                </TouchableOpacity>

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.modalCancelBtn, !isDarkMode && styles.modalCancelBtnLight]}
                    onPress={() => setShowPairModal(false)}>
                    <Text style={[styles.modalCancelBtnText, !isDarkMode && styles.modalCancelBtnTextLight]}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.modalPrimaryBtn}
                    onPress={() => handleParseAndConnectQr(qrInputText)}>
                    <Text style={styles.modalPrimaryBtnText}>Pair via Text</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
                <Text style={[styles.modalSubtitle, !isDarkMode && styles.modalSubtitleLight]}>
                  Enter the Host IP and Port displayed in your Fylo PC application:
                </Text>

                <TextInput
                  style={[styles.modalInput, !isDarkMode && styles.modalInputLight]}
                  placeholder="e.g. 192.168.1.5:3000"
                  placeholderTextColor={!isDarkMode ? '#64748b' : '#94a3b8'}
                  value={manualPcIp}
                  onChangeText={setManualPcIp}
                  autoCapitalize="none"
                />

                <TextInput
                  style={[styles.modalInput, !isDarkMode && styles.modalInputLight]}
                  placeholder="Auth Token (optional if on same LAN)"
                  placeholderTextColor={!isDarkMode ? '#64748b' : '#94a3b8'}
                  value={manualAuthToken}
                  onChangeText={setManualAuthToken}
                  autoCapitalize="none"
                />

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.hotspotPresetBtn, { flex: 1 }]}
                    onPress={() => setManualPcIp('192.168.137.1:3000')}>
                    <Text style={styles.hotspotPresetBtnText}>PC Hotspot (137.1)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.hotspotPresetBtn, { flex: 1 }]}
                    onPress={() => setManualPcIp('192.168.43.1:3000')}>
                    <Text style={styles.hotspotPresetBtnText}>Phone Hotspot (43.1)</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.modalCancelBtn, !isDarkMode && styles.modalCancelBtnLight]}
                    onPress={() => setShowPairModal(false)}>
                    <Text style={[styles.modalCancelBtnText, !isDarkMode && styles.modalCancelBtnTextLight]}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.modalPrimaryBtn}
                    onPress={() => handleConnectToPc(manualPcIp, manualAuthToken)}>
                    <Text style={styles.modalPrimaryBtnText}>Connect</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* ADMIN SECURITY PASSWORD MODAL                             */}
      {/* ========================================================= */}
      <Modal visible={adminModalVisible} transparent statusBarTranslucent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, !isDarkMode && styles.modalContentLight]}>
            <Text style={[styles.modalTitle, !isDarkMode && styles.modalTitleLight]}>Admin Security Protection</Text>
            <Text style={[styles.modalSubtitle, !isDarkMode && styles.modalSubtitleLight]}>
              {adminActionTitle || 'This action requires the Admin Security Password.'}
            </Text>

            <TextInput
              style={[styles.modalInput, !isDarkMode && styles.modalInputLight]}
              placeholder="Enter Admin Password (default: admin)"
              placeholderTextColor={!isDarkMode ? '#64748b' : '#94a3b8'}
              secureTextEntry
              value={adminPasswordInput}
              onChangeText={setAdminPasswordInput}
              autoCapitalize="none"
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.modalCancelBtn, !isDarkMode && styles.modalCancelBtnLight]}
                onPress={() => {
                  setAdminModalVisible(false);
                  setAdminPasswordInput('');
                }}>
                <Text style={[styles.modalCancelBtnText, !isDarkMode && styles.modalCancelBtnTextLight]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.modalPrimaryBtn, { backgroundColor: '#ef4444' }]}
                onPress={handleExecuteAdminAction}>
                <Text style={[styles.modalPrimaryBtnText, { color: '#ffffff' }]}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* 1-CLICK DIAGNOSTICS MODAL                                 */}
      {/* ========================================================= */}
      <Modal visible={diagVisible} transparent statusBarTranslucent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, !isDarkMode && styles.modalContentLight]}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, !isDarkMode && styles.modalTitleLight]}>Network & Ping Diagnostics</Text>
              <TouchableOpacity activeOpacity={0.75} onPress={() => setDiagVisible(false)}>
                <Text style={[styles.modalCloseText, !isDarkMode && styles.modalCloseTextLight]}>✕</Text>
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.diagResultBento,
                !isDarkMode && styles.diagResultBentoLight,
                diagStatus === 'success' ? styles.diagSuccess : styles.diagWarning,
              ]}>
              <Text style={[styles.diagResultText, !isDarkMode && styles.diagResultTextLight]}>{diagMessage || 'Running network diagnostic...'}</Text>
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.modalCancelBtn, !isDarkMode && styles.modalCancelBtnLight]}
                onPress={() => setDiagVisible(false)}>
                <Text style={[styles.modalCancelBtnText, !isDarkMode && styles.modalCancelBtnTextLight]}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.modalPrimaryBtn}
                onPress={runNetworkDiagnostic}>
                <Text style={styles.modalPrimaryBtnText}>Re-Test</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* STORAGE ACCESS PERMISSION PROMPT MODAL (AFTER QR/PAIRING) */}
      {/* ========================================================= */}
      <Modal
        visible={showStorageAccessPrompt}
        transparent
        statusBarTranslucent={true}
        animationType="fade"
        onRequestClose={() => handleSetStorageAccess(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.storagePromptCard, !isDarkMode && styles.storagePromptCardLight]}>
            <View style={styles.storagePromptHeader}>
              <View style={styles.storagePromptIconWrap}>
                <Text style={{ fontSize: 22, color: '#3b82f6' }}>⬡</Text>
              </View>
              <Text style={[styles.storagePromptTitle, !isDarkMode && styles.storagePromptTitleLight]}>
                Share Full Phone Storage?
              </Text>
            </View>

            <Text style={[styles.storagePromptDesc, !isDarkMode && styles.storagePromptDescLight]}>
              Allow paired PC to browse your phone folders and storage? If you deny, only ShareHub (direct send/receive) will be active, just like the Web companion.
            </Text>

            <View style={styles.storagePromptBadgeRow}>
              <View style={styles.storagePromptBadge}>
                <Text style={styles.storagePromptBadgeText}>ShareHub Always Available</Text>
              </View>
            </View>

            <View style={styles.storagePromptBtnRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.storagePromptSecondaryBtn, !isDarkMode && styles.storagePromptSecondaryBtnLight]}
                onPress={() => handleSetStorageAccess(false)}>
                <Text style={[styles.storagePromptSecondaryBtnText, !isDarkMode && styles.storagePromptSecondaryBtnTextLight]}>
                  Deny (ShareHub Only)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.storagePromptPrimaryBtn}
                onPress={() => handleSetStorageAccess(true)}>
                <Text style={styles.storagePromptPrimaryBtnText}>
                  Allow Full Storage
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* APP SETTINGS MODAL                                        */}
      {/* ========================================================= */}
      <Modal
        visible={showSettingsModal}
        transparent
        statusBarTranslucent={true}
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.settingsModalCard, !isDarkMode && styles.settingsModalCardLight]}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 18, color: '#3b82f6' }}>⚙</Text>
                <Text style={[styles.modalTitle, !isDarkMode && styles.sortModalTitleLight]}>
                  App Settings
                </Text>
              </View>
              <TouchableOpacity activeOpacity={0.75} onPress={() => setShowSettingsModal(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* Setting 1: Full Phone Storage Access */}
              <View style={[styles.settingsItemRow, !isDarkMode && styles.settingsItemRowLight]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingsItemTitle, !isDarkMode && styles.settingsItemTitleLight]}>
                    Allow Full Phone Storage Access
                  </Text>
                  <Text style={styles.settingsItemSub}>
                    Allow paired PC to browse phone folders. When disabled, only ShareHub transfers work.
                  </Text>
                  <View style={{ marginTop: 6 }}>
                    <Text style={{ fontSize: 10.5, fontWeight: '700', color: allowFullPhoneAccess !== false ? '#10b981' : '#f59e0b' }}>
                      {allowFullPhoneAccess !== false ? 'Full Storage Browsing Enabled' : 'ShareHub Only (Storage Browsing Blocked)'}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={allowFullPhoneAccess !== false}
                  onValueChange={(val) => handleSetStorageAccess(val)}
                  trackColor={{ false: '#94a3b8', true: '#2563eb' }}
                  thumbColor={allowFullPhoneAccess !== false ? '#60a5fa' : '#ffffff'}
                />
              </View>

              {/* Setting 2: Read-Only Safe Mode */}
              <View style={[styles.settingsItemRow, !isDarkMode && styles.settingsItemRowLight]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingsItemTitle, !isDarkMode && styles.settingsItemTitleLight]}>
                    PC Read-Only Mode
                  </Text>
                  <Text style={styles.settingsItemSub}>
                    Prevent paired PC from writing or trashing phone storage files.
                  </Text>
                </View>
                <Switch
                  value={readOnlyMode}
                  onValueChange={handleToggleReadOnly}
                  trackColor={{ false: '#94a3b8', true: '#2563eb' }}
                  thumbColor={readOnlyMode ? '#60a5fa' : '#ffffff'}
                />
              </View>

              {/* Setting 3: Live Clipboard Sync */}
              <View style={[styles.settingsItemRow, !isDarkMode && styles.settingsItemRowLight]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingsItemTitle, !isDarkMode && styles.settingsItemTitleLight]}>
                    Live Clipboard Sync
                  </Text>
                  <Text style={styles.settingsItemSub}>
                    Bidirectional real-time clipboard mirror with PC.
                  </Text>
                </View>
                <Switch
                  value={clipboardAutoSync}
                  onValueChange={(val) => {
                    setClipboardAutoSync(val);
                    showToast(val ? 'Live Clipboard Sync Enabled' : 'Live Clipboard Sync Disabled');
                  }}
                  trackColor={{ false: '#94a3b8', true: '#2563eb' }}
                  thumbColor={clipboardAutoSync ? '#60a5fa' : '#ffffff'}
                />
              </View>

              {/* Setting 4: Dark / Light Mode */}
              <View style={[styles.settingsItemRow, !isDarkMode && styles.settingsItemRowLight, { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingsItemTitle, !isDarkMode && styles.settingsItemTitleLight]}>
                    Theme Mode ({isDarkMode ? 'Dark' : 'Light'})
                  </Text>
                  <Text style={styles.settingsItemSub}>
                    Toggle dark / light appearance.
                  </Text>
                </View>
                <Switch
                  value={isDarkMode}
                  onValueChange={(val) => setIsDarkMode(val)}
                  trackColor={{ false: '#94a3b8', true: '#2563eb' }}
                  thumbColor={isDarkMode ? '#60a5fa' : '#ffffff'}
                />
              </View>
            </ScrollView>

            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.modalPrimaryBtn, { marginTop: 14 }]}
              onPress={() => setShowSettingsModal(false)}>
              <Text style={styles.modalPrimaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// =========================================================
// STYLES: Vibrant Pink/Neon Accents matching Fylo logo (#2563eb, #3b82f6, #0ea5e9)
// =========================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
  },
  containerLight: {
    backgroundColor: '#F7F6F2',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
  },

  /* Auto-Discovered PC on Home Hero */
  heroDiscoveredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(37, 99, 235, 0.16)',
    borderWidth: 1.5,
    borderColor: '#3b82f6',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 10,
  },
  heroDiscoveredBannerLight: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
  },
  heroDiscoveredDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10b981',
  },
  heroDiscoveredTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  heroDiscoveredTitleLight: {
    color: '#1e3a8a',
  },
  heroDiscoveredSub: {
    color: '#93c5fd',
    fontSize: 10.5,
    fontWeight: '500',
    marginTop: 1,
  },
  heroDiscoveredSubLight: {
    color: '#3b82f6',
  },
  heroDiscoveredBtnText: {
    color: '#60a5fa',
    fontSize: 12.5,
    fontWeight: '800',
  },

  /* Live Chunked Transfer Progress Floating Banner */
  transferProgressWrap: {
    position: 'absolute',
    top: 58,
    left: 16,
    right: 16,
    zIndex: 9999,
    backgroundColor: '#0f172a',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 12,
  },
  transferProgressWrapLight: {
    backgroundColor: '#ffffff',
    borderColor: '#3b82f6',
  },
  transferProgressTitle: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  transferProgressTitleLight: {
    color: '#0f172a',
  },
  transferProgressPct: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '800',
  },
  transferProgressBarBg: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 6,
  },
  transferProgressBarFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 3,
  },

  /* Auto-Discover Tab in Pair Modal */
  autoDiscoverEmptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    marginVertical: 10,
  },
  autoDiscoverSearchingTitle: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 4,
  },
  autoDiscoverSearchingTitleLight: {
    color: '#0f172a',
  },
  autoDiscoverSearchingDesc: {
    color: '#64748b',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  autoDiscoverPcCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderWidth: 1.5,
    borderColor: 'rgba(37, 99, 235, 0.4)',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  autoDiscoverPcCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#bfdbfe',
  },
  autoDiscoverIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  autoDiscoverOnlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    borderWidth: 1.5,
    borderColor: '#000000',
  },
  autoDiscoverPcName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  autoDiscoverPcNameLight: {
    color: '#0f172a',
  },
  autoDiscoverPcIp: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  autoDiscoverConnectBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  autoDiscoverConnectBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  pcShortcutPillActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  pcShortcutPillTextActive: {
    color: '#ffffff',
  },

  /* Top Header & Horizontal Pill Navigation */
  topHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: '#000000',
  },
  topHeaderLight: {
    backgroundColor: '#F7F6F2',
    borderBottomColor: 'rgba(26, 92, 74, 0.12)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hamburgerBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamburgerBtnLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e4de',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563eb',
    borderColor: '#60a5fa',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  brandCircleText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  brandTitle: {
    fontSize: 21,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  brandTitleLight: {
    color: '#0f172a',
  },
  brandSub: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
    marginTop: -1,
  },
  brandSubLight: {
    color: '#64748b',
  },
  topLatencyPill: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  topLatencyPillLight: {
    backgroundColor: '#D1FAE5',
    borderColor: '#A7F3D0',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  topLatencyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  topLatencyText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  topLatencyTextLight: {
    color: '#065F46',
  },
  topStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 30,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    gap: 5,
    borderWidth: 1,
  },
  topStatusPillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  topStatusPillIdle: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderColor: '#2563eb',
  },
  topStatusPillOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#ef4444',
  },
  topStatusPillText: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '800',
  },
  beaconDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },

  /* Compact Horizontal Capsule Pill Tabs (Non-cropping) */
  pillTabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 1,
  },
  pillTab: {
    minHeight: 32,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillTabActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  pillTabText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  pillTabTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },

  /* Floating Toast */
  toastWrap: {
    position: 'absolute',
    top: 96,
    alignSelf: 'center',
    zIndex: 9999,
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    shadowColor: '#2563eb',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  toastText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },

  /* Vector Illustrations (Hero Desk, PC Monitor, Phone) */
  heroDeskIllustWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  heroDeskPlant: {
    alignItems: 'center',
    marginBottom: 2,
  },
  heroPlantLeaf: {
    width: 5,
    height: 9,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  heroPlantPot: {
    width: 14,
    height: 12,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: '#64748b',
  },
  heroMonitorCol: {
    alignItems: 'center',
  },
  heroMonitorScreen: {
    width: 92,
    height: 60,
    borderRadius: 7,
    backgroundColor: '#0f172a',
    padding: 2.5,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  heroMonitorGlass: {
    flex: 1,
    borderRadius: 5,
    backgroundColor: '#1d4ed8',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  heroMonitorGlowWave: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#60a5fa',
    opacity: 0.4,
    top: -16,
    right: -16,
  },
  winGridMini: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 18,
    height: 18,
    gap: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  winGridTile: {
    width: 7,
    height: 7,
    borderRadius: 1,
    backgroundColor: '#ffffff',
    opacity: 0.9,
  },
  heroMonitorStand: {
    width: 7,
    height: 12,
    backgroundColor: '#94a3b8',
  },
  heroMonitorBase: {
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#64748b',
  },

  pcIllustWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
    height: 72,
  },
  pcIllustScreen: {
    width: 68,
    height: 48,
    borderRadius: 7,
    backgroundColor: '#0f172a',
    padding: 2.5,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
  },
  pcIllustGlass: {
    flex: 1,
    borderRadius: 5,
    backgroundColor: '#2563eb',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  pcIllustWave: {
    position: 'absolute',
    width: 55,
    height: 55,
    borderRadius: 28,
    backgroundColor: '#93c5fd',
    opacity: 0.35,
    bottom: -15,
    right: -10,
  },
  winGridStandard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 22,
    height: 22,
    gap: 2.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  winGridTileStandard: {
    width: 8.5,
    height: 8.5,
    borderRadius: 1.5,
    backgroundColor: '#ffffff',
    opacity: 0.9,
  },
  pcIllustStand: {
    width: 7,
    height: 10,
    backgroundColor: '#94a3b8',
  },
  pcIllustBase: {
    width: 30,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#64748b',
  },

  phoneIllustWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 76,
  },
  phoneIllustBody: {
    width: 44,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    padding: 2,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  phoneIllustScreen: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#fed7aa',
    overflow: 'hidden',
    position: 'relative',
  },
  phoneIllustWave1: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f43f5e',
    opacity: 0.75,
    top: -10,
    left: -15,
  },
  phoneIllustWave2: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#fbbf24',
    opacity: 0.8,
    bottom: -10,
    right: -10,
  },
  phoneIllustNotch: {
    position: 'absolute',
    top: 2,
    alignSelf: 'center',
    width: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#0f172a',
  },

  /* Bento Dashboard General */
  bentoScroll: {
    padding: 14,
    paddingBottom: 100,
  },
  bentoScrollDark: {
    backgroundColor: '#000000',
  },
  bentoScrollLight: {
    backgroundColor: '#F7F6F2',
  },
  bentoCardHero: {
    backgroundColor: '#0A0A0A',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.25)',
    marginBottom: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  bentoCardHeroLight: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(26, 92, 74, 0.14)',
    shadowColor: '#1A5C4A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heroLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  heroDeviceBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  heroDeviceBadgeLight: {
    backgroundColor: '#d1fae5',
  },
  heroOnlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#111827',
  },
  heroOnlineDotLight: {
    borderColor: '#ffffff',
  },
  heroConnectedLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#4ade80',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  heroConnectedLabelLight: {
    color: '#1A5C4A',
  },
  heroHostTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  heroHostTitleLight: {
    color: '#0f172a',
  },
  heroIpSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  heroIpSubLight: {
    color: '#64748b',
  },
  heroRightGroup: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  heroLatencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 12,
    marginBottom: 4,
  },
  heroLatencyPillLight: {
    backgroundColor: '#d1fae5',
  },
  heroLatencyText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4ade80',
  },
  heroLatencyTextLight: {
    color: '#065F46',
  },
  heroBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  heroPrimaryBtn: {
    flex: 1.6,
    height: 48,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  heroPrimaryBtnLight: {
    backgroundColor: '#1A5C4A',
    shadowColor: '#1A5C4A',
  },
  heroPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '800',
  },
  heroSecondaryBtn: {
    flex: 1,
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSecondaryBtnLight: {
    backgroundColor: '#FAF9F5',
    borderColor: '#e5e4de',
  },
  heroSecondaryBtnText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
  },
  heroSecondaryBtnTextLight: {
    color: '#334155',
  },
  heroReadySubText: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
    marginVertical: 10,
  },
  heroReadySubTextLight: {
    color: '#64748b',
  },

  /* Bento Primary Grid (Browse PC & Browse Phone) */
  bentoPrimaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  bentoPrimaryCard: {
    flex: 1,
    minHeight: 165,
    backgroundColor: '#111827',
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.25)',
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
  bentoPrimaryCardLight: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(26, 92, 74, 0.12)',
    shadowColor: '#1A5C4A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  bentoPillGreen: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  bentoPillGreenLight: {
    backgroundColor: '#d1fae5',
  },
  bentoPillGreenText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4ade80',
  },
  bentoPillGreenTextLight: {
    color: '#065F46',
  },
  bentoPillAmber: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  bentoPillAmberLight: {
    backgroundColor: '#FEF3C7',
  },
  bentoPillAmberText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#F59E0B',
  },
  bentoPillAmberTextLight: {
    color: '#B45309',
  },
  bentoCardMiddleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 6,
  },
  bentoCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  bentoCardTitleLight: {
    color: '#0f172a',
  },
  bentoCardSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  bentoCardSubtitleLight: {
    color: '#64748b',
  },
  bentoCardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  bentoActionLink: {
    fontSize: 12,
    fontWeight: '800',
  },
  circleArrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Bento Secondary Row (ShareHub, Clipboard, Transfers) */
  bentoSecondaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  bentoSecCard: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bentoSecCardLight: {
    borderWidth: 1,
    borderColor: 'rgba(26, 92, 74, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  bentoSecIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bentoSecTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#f8fafc',
    marginTop: 6,
  },
  bentoSecTitleLight: {
    color: '#0f172a',
  },
  bentoSecSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 1,
  },
  bentoSecSubLight: {
    color: '#64748b',
  },
  secChevronCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  secChevronCircleLight: {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  secChevronText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '900',
  },

  /* Section Cards (Send Files, Share Hub, Internal Storage, etc.) */
  sectionCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 12,
    position: 'relative',
  },
  sectionCardLight: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(26, 92, 74, 0.12)',
    shadowColor: '#1A5C4A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  sectionTitleLight: {
    color: '#0f172a',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  sectionSubtitleLight: {
    color: '#64748b',
  },
  sectionChipPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sectionChipPillLight: {
    backgroundColor: '#D1FAE5',
  },
  sectionChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#34D399',
  },
  sectionChipTextLight: {
    color: '#065F46',
  },

  /* Send Files Elements */
  sendBadgeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1A5C4A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBadgeCircleLight: {
    backgroundColor: '#2D6A4F',
  },
  sendFilesBigBtn: {
    backgroundColor: '#1A5C4A',
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#1A5C4A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  sendFilesBigBtnLight: {
    backgroundColor: '#1A5C4A',
    shadowColor: '#1A5C4A',
  },
  sendFilesBigBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  /* Share Hub Elements */
  shareHubRefreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareHubRefreshBtnLight: {
    borderColor: '#e5e4de',
    backgroundColor: '#FAF9F5',
  },
  shareHubDashedBox: {
    borderWidth: 1.5,
    borderColor: 'rgba(26, 92, 74, 0.25)',
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  shareHubDashedBoxLight: {
    borderColor: 'rgba(26, 92, 74, 0.25)',
    backgroundColor: 'rgba(250, 249, 245, 0.6)',
  },
  shareHubEmptyCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareHubEmptyCircleLight: {
    backgroundColor: '#D1FAE5',
  },
  shareHubEmptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 10,
  },
  shareHubEmptyTitleLight: {
    color: '#0f172a',
  },
  shareHubEmptySub: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 4,
    maxWidth: 280,
  },
  shareHubEmptySubLight: {
    color: '#64748b',
  },

  /* Storage Meter Elements */
  storageTrackBar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 8,
    overflow: 'hidden',
  },
  storageTrackBarLight: {
    backgroundColor: '#E5E4DE',
  },
  storageFillBar: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#10B981',
  },
  storageLegendText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  storageLegendTextLight: {
    color: '#64748b',
  },

  /* Standard Bento Card */
  bentoCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  bentoCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  bentoCardTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#ffffff',
  },
  bentoCardSubtitle: {
    fontSize: 10.5,
    color: '#94a3b8',
    marginTop: 1,
  },
  cardHeaderLink: {
    color: '#2563eb',
    fontSize: 11,
    fontWeight: '800',
  },

  /* Storage Meter */
  storagePercentChip: {
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  storagePercentChipText: {
    color: '#2563eb',
    fontSize: 10,
    fontWeight: '800',
  },
  storageTrack: {
    height: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  storageFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 4,
  },
  storageLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  storageLegendText: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
  },
  storageMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 12,
    padding: 8,
  },
  storageMetricCol: {
    flex: 1,
    alignItems: 'center',
  },
  metricVal: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  metricLabel: {
    fontSize: 9,
    color: '#64748b',
    marginTop: 1,
  },
  metricDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  /* Category Jumpers Grid */
  categoryJumperGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  jumperTile: {
    width: (SCREEN_WIDTH - 24 - 28 - 8) / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  jumperTileWide: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    gap: 10,
  },
  jumperEmoji: {
    fontSize: 20,
    marginBottom: 2,
  },
  jumperTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  jumperSubtitle: {
    color: '#64748b',
    fontSize: 9.5,
  },
  jumperArrow: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '800',
  },

  /* Clipboard Preview */
  clipboardPreviewBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 8,
    minHeight: 52,
    justifyContent: 'center',
  },
  clipboardPreviewText: {
    color: '#cbd5e1',
    fontSize: 11.5,
    lineHeight: 16,
  },
  clipboardActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  clipboardActionBtn: {
    minHeight: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipboardActionBtnPrimary: {
    flex: 1,
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  clipboardActionBtnPrimaryText: {
    color: '#2563eb',
    fontSize: 11,
    fontWeight: '800',
  },
  clipboardActionBtnSecondary: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipboardActionBtnSecondaryText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },

  /* Server Controls */
  serverStatusTag: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  serverStatusRunning: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  serverStatusStopped: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  serverStatusTagText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#10b981',
  },
  serverControlButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  serverToggleBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverToggleBtnStart: {
    backgroundColor: '#2563eb',
  },
  serverToggleBtnStop: {
    backgroundColor: '#ef4444',
  },
  serverToggleBtnText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  safeModeSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  safeModeLabel: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },

  /* Permission Card */
  permissionCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ef4444',
    marginBottom: 10,
  },
  permissionCardTop: {
    marginBottom: 4,
  },
  permissionBadge: {
    color: '#ef4444',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  permissionTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  permissionDesc: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 16,
    marginVertical: 6,
  },
  permissionBtn: {
    minHeight: 38,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  permissionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },

  /* ==================== EXPLORER STYLES ==================== */
  explorerContainer: {
    flex: 1,
    backgroundColor: '#000000',
    paddingHorizontal: 10,
    paddingTop: 8,
  },

  /* Compact Unified PC Ribbon (Drives + Shortcuts) */
  unifiedRibbonWrap: {
    marginBottom: 6,
  },
  unifiedRibbonScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  pcDrivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 6,
  },
  pcDrivePillActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.18)',
    borderColor: '#2563eb',
  },
  pcDrivePillIcon: {
    fontSize: 14,
  },
  pcDrivePillText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },
  pcDrivePillTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  ribbonDivider: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginHorizontal: 2,
  },
  pcShortcutPill: {
    minHeight: 30,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pcShortcutPillText: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: '700',
  },

  /* Nav Bar & Breadcrumbs */
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 4,
    marginBottom: 6,
    gap: 4,
    minHeight: 38,
  },
  navUpBtn: {
    minHeight: 30,
    backgroundColor: '#121212',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navUpBtnText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  breadcrumbScroll: {
    flex: 1,
  },
  breadcrumbItem: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  breadcrumbItemActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    borderRadius: 6,
  },
  breadcrumbTextRoot: {
    color: '#2563eb',
    fontSize: 10.5,
    fontWeight: '800',
  },
  breadcrumbSegmentWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbSeparator: {
    color: '#64748b',
    fontSize: 11,
    marginHorizontal: 1,
  },
  breadcrumbText: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: '700',
  },
  breadcrumbTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  refreshBtn: {
    minHeight: 30,
    minWidth: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  refreshBtnText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '800',
  },
  viewModeBtn: {
    minHeight: 30,
    minWidth: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#121212',
  },
  viewModeBtnActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.25)',
  },
  viewModeBtnText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '800',
  },

  /* Search & Filter Row */
  searchRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
    alignItems: 'center',
  },
  searchInputWrap: {
    flex: 1,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  searchIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 11.5,
    paddingVertical: 0,
  },
  searchClearBtn: {
    padding: 4,
  },
  searchClearBtnText: {
    color: '#64748b',
    fontSize: 11,
  },
  sortToggleBtn: {
    minHeight: 36,
    backgroundColor: '#121212',
    paddingHorizontal: 10,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.3)',
  },
  sortToggleBtnText: {
    color: '#60a5fa',
    fontSize: 10.5,
    fontWeight: '800',
  },
  multiSelectToggle: {
    minHeight: 36,
    backgroundColor: '#121212',
    paddingHorizontal: 11,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  multiSelectToggleActive: {
    backgroundColor: '#2563eb',
  },
  multiSelectToggleText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  multiSelectToggleTextActive: {
    color: '#ffffff',
  },

  /* Filter Pills */
  filterScroll: {
    maxHeight: 32,
    marginBottom: 8,
  },
  filterPill: {
    minHeight: 28,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
  },
  filterPillActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  filterPillText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
  },
  filterPillTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },

  /* Responsive Photo / File Grid */
  gridContentContainer: {
    paddingBottom: 100,
  },
  responsiveGridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridTile: {
    minHeight: 102,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  gridTileSelected: {
    borderColor: '#2563eb',
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
  },
  gridThumbnailImage: {
    width: '100%',
    height: 50,
    borderRadius: 8,
    marginBottom: 4,
  },
  gridFileIconEmoji: {
    fontSize: 30,
    marginBottom: 4,
  },
  gridFileName: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  gridFileMeta: {
    color: '#64748b',
    fontSize: 8.5,
    marginTop: 1,
  },
  checkCircle: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 10,
  },
  checkCircleSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },

  /* List View */
  listContentContainer: {
    paddingBottom: 100,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    gap: 10,
  },
  listRowSelected: {
    borderColor: '#2563eb',
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
  },
  listRowEmoji: {
    fontSize: 20,
  },
  listRowContent: {
    flex: 1,
  },
  listRowName: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '700',
  },
  listRowMeta: {
    color: '#64748b',
    fontSize: 9.5,
    marginTop: 1,
  },
  listRowChevron: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '800',
  },

  /* Floating Multi-Select Bar */
  floatingMultiSelectBar: {
    position: 'absolute',
    bottom: 14,
    left: 12,
    right: 12,
    backgroundColor: '#0A0A0A',
    borderWidth: 1.5,
    borderColor: '#2563eb',
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  floatingSelectCount: {
    color: '#60a5fa',
    fontWeight: '800',
    fontSize: 12,
  },
  floatingActionsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  floatingSendBtn: {
    minHeight: 34,
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingSendBtnText: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '800',
  },
  floatingTrashBtn: {
    minHeight: 34,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingTrashBtnText: {
    color: '#ef4444',
    fontSize: 10.5,
    fontWeight: '800',
  },
  floatingCancelBtn: {
    minHeight: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCancelBtnText: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '700',
  },

  /* Center Loading / Empty States */
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 8,
    fontSize: 12,
  },
  emptyFolderIcon: {
    fontSize: 44,
    marginBottom: 8,
  },
  emptyFolderText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  pcEmptyTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 6,
  },
  pcEmptyDesc: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  pcConnectPromptBtn: {
    minHeight: 42,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pcConnectPromptBtnText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '800',
  },

  /* CLIPBOARD TAB */
  syncRefreshChip: {
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    borderWidth: 1,
    borderColor: '#2563eb',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  syncRefreshChipText: {
    color: '#2563eb',
    fontSize: 10.5,
    fontWeight: '800',
  },
  clipboardDisplayBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
    minHeight: 80,
  },
  clipboardDisplayText: {
    color: '#ffffff',
    fontSize: 12.5,
    lineHeight: 18,
  },
  clipboardTextInput: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 10,
    color: '#ffffff',
    fontSize: 12.5,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 10,
    marginTop: 6,
  },
  snippetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  snippetChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  snippetChipText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },

  /* TRANSFER TAB & DIAGNOSTICS */
  speedRatingBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  speedRatingText: {
    color: '#10b981',
    fontSize: 9.5,
    fontWeight: '800',
  },
  runDiagHeroBtn: {
    minHeight: 42,
    backgroundColor: '#2563eb',
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    marginTop: 4,
  },
  runDiagHeroBtnText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '900',
  },
  diagResultBento: {
    marginVertical: 6,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  diagSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: '#10b981',
  },
  diagWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: '#f59e0b',
  },
  diagResultText: {
    color: '#ffffff',
    fontSize: 11,
    lineHeight: 16,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    alignItems: 'flex-start',
  },
  stepBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 10,
  },
  stepTitle: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  stepDesc: {
    color: '#94a3b8',
    fontSize: 10.5,
    marginTop: 1,
  },
  emptyLogsText: {
    color: '#64748b',
    fontSize: 10.5,
    fontStyle: 'italic',
  },
  logTextItem: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },

  /* UNIVERSAL LIGHTBOX */
  lightboxOverlay: {
    flex: 1,
    backgroundColor: '#000000',
  },
  lightboxHeader: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
    minHeight: 52 + (Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0),
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#000000',
  },
  lightboxFileName: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '800',
  },
  lightboxMeta: {
    color: '#60a5fa',
    fontSize: 9.5,
    marginTop: 1,
  },
  lightboxCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxCloseBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  lightboxBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  lightboxImage: {
    width: SCREEN_WIDTH - 20,
    height: SCREEN_HEIGHT * 0.65,
  },
  lightboxNonImgContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxNonImgTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 8,
  },
  lightboxNonImgMeta: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
  },
  lightboxZoomControls: {
    position: 'absolute',
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(13, 19, 34, 0.9)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  zoomCtrlBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomCtrlBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  zoomScaleBadge: {
    paddingHorizontal: 6,
  },
  zoomScaleBadgeText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '800',
  },
  lightboxFooter: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 28 : 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#000000',
  },
  lightboxDlBtn: {
    flex: 1,
    minHeight: 40,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxDlBtnText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  lightboxSendBtn: {
    flex: 1,
    minHeight: 40,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxSendBtnText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  lightboxTrashBtn: {
    minHeight: 40,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxTrashBtnText: {
    color: '#ef4444',
    fontSize: 11.5,
    fontWeight: '800',
  },
  lightboxIndexBadge: {
    backgroundColor: 'rgba(37, 99, 235, 0.25)',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  lightboxIndexBadgeText: {
    color: '#93c5fd',
    fontSize: 9.5,
    fontWeight: '800',
  },
  lightboxChevronLeft: {
    position: 'absolute',
    left: 10,
    top: '48%',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  lightboxChevronRight: {
    position: 'absolute',
    right: 10,
    top: '48%',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  lightboxChevronText: {
    color: '#ffffff',
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '300',
  },
  lightboxVideoFullBody: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  lightboxVideoContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: '#000000',
  },
  lightboxNativeVideoView: {
    width: '100%',
    height: '100%',
  },
  /* YouTube / MX Player In-App HUD Styles */
  ytTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? ((StatusBar.currentHeight || 24) + 8) : 14,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    zIndex: 35,
  },
  ytTopBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ytTopBackBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  ytTopTitleWrap: {
    flex: 1,
    marginHorizontal: 10,
  },
  ytTopTitle: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  ytTopMeta: {
    color: '#94a3b8',
    fontSize: 10.5,
    marginTop: 1,
    fontWeight: '600',
  },
  ytTopActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    marginLeft: 6,
  },
  ytTopActionBtnText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  ytCenterControls: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    zIndex: 35,
  },
  ytCircleBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ytCircleBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  ytPlayPauseBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(37, 99, 235, 0.9)',
    borderWidth: 2,
    borderColor: '#60a5fa',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#2563eb',
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  ytPlayPauseText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
    marginLeft: 2,
  },
  ytBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 28 : 20,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    zIndex: 35,
  },
  ytScrubberTrack: {
    height: 28,
    justifyContent: 'center',
  },
  ytScrubberBg: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    position: 'relative',
  },
  ytScrubberFill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
    position: 'absolute',
    left: 0,
    top: 0,
  },
  ytScrubberThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
    position: 'absolute',
    top: -4.5,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 3,
  },
  ytBottomActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  ytTimeText: {
    color: '#cbd5e1',
    fontSize: 11.5,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  ytBottomActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ytIconBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  ytIconBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  ytRippleBadge: {
    position: 'absolute',
    top: '42%',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: 1,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  ytRippleBadgeLeft: {
    left: 32,
  },
  ytRippleBadgeRight: {
    right: 32,
  },
  ytRippleBadgeIcon: {
    color: '#3b82f6',
    fontSize: 16,
    fontWeight: '900',
  },
  ytRippleBadgeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  /* QUICK SHARE MODAL ROW */
  quickShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    gap: 10,
  },
  quickShareRowSelected: {
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
  },
  quickSendSingleBtn: {
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
    borderWidth: 1,
    borderColor: '#2563eb',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  quickSendSingleBtnText: {
    color: '#60a5fa',
    fontSize: 10,
    fontWeight: '800',
  },

  /* MODALS */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#0A0A0A',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.25)',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 10,
    lineHeight: 15,
  },
  modalCloseText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '800',
    padding: 4,
  },
  modalSubTabsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  modalSubTab: {
    flex: 1,
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalSubTabActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  modalSubTabText: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '700',
  },
  modalSubTabTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  qrViewfinderBox: {
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#2563eb',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  qrScanBtnTitle: {
    color: '#60a5fa',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  qrViewfinderIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  qrViewfinderInstruction: {
    color: '#cbd5e1',
    fontSize: 10.5,
    textAlign: 'center',
    lineHeight: 15,
  },
  qrDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  qrDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  qrDividerText: {
    color: '#64748b',
    fontSize: 9.5,
    fontWeight: '700',
    paddingHorizontal: 6,
    letterSpacing: 0.5,
  },
  modalInput: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 12,
    marginBottom: 8,
    minHeight: 40,
  },
  hotspotPresetBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  hotspotPresetBtnText: {
    color: '#f59e0b',
    fontSize: 10.5,
    fontWeight: '800',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  modalCancelBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  modalPrimaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12,
  },

  /* Windows 11 Yellow Folder Component */
  win11FolderWrap: {
    justifyContent: 'flex-end',
    position: 'relative',
    marginBottom: 4,
  },
  win11FolderBackTab: {
    position: 'absolute',
    top: 0,
    left: 1,
    backgroundColor: '#d97706',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  win11FolderBack: {
    position: 'absolute',
    top: 3,
    left: 0,
    backgroundColor: '#f59e0b',
    borderRadius: 3,
  },
  win11FolderFront: {
    backgroundColor: '#fbbf24',
    borderRadius: 3,
  },

  /* Collapsible Navigation Sidebar Drawer */
  brandLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hamburgerBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamburgerBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  hamburgerIcon: {
    color: '#60a5fa',
    fontSize: 20,
    fontWeight: '900',
  },
  hamburgerIconLight: {
    color: '#2563eb',
  },
  drawerBackdrop: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  drawerDismissArea: {
    flex: 1,
  },
  drawerPanel: {
    width: 300,
    height: '100%',
    backgroundColor: '#0A0A0A',
    borderRightWidth: 1,
    borderRightColor: 'rgba(37, 99, 235, 0.25)',
    paddingTop: Platform.OS === 'android' ? ((StatusBar.currentHeight || 24) + 12) : 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
    display: 'flex',
    flexDirection: 'column',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 5, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
  },
  drawerPanelLight: {
    backgroundColor: '#ffffff',
    borderRightColor: '#e2e8f0',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(37, 99, 235, 0.15)',
    marginBottom: 14,
  },
  drawerHeaderLight: {
    borderBottomColor: '#e2e8f0',
  },
  drawerHeaderBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  drawerTitleLight: {
    color: '#0f172a',
  },
  drawerSub: {
    fontSize: 10,
    color: '#60a5fa',
    fontWeight: '700',
  },
  drawerCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerCloseBtnText: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '800',
  },
  drawerConnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 16,
  },
  drawerConnCardActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  drawerConnTitle: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '800',
  },
  drawerConnSub: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  drawerNavList: {
    flex: 1,
  },
  drawerNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  drawerNavItemActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.35)',
  },
  drawerNavIcon: {
    fontSize: 20,
  },
  drawerNavLabel: {
    color: '#94a3b8',
    fontSize: 13.5,
    fontWeight: '700',
  },
  drawerNavLabelActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  drawerNavSub: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 1,
  },
  drawerThemeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 10,
  },
  drawerThemeRowLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  drawerThemeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  drawerThemeTextLight: {
    color: '#0f172a',
  },
  drawerFooter: {
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  drawerFooterLight: {
    borderTopColor: '#e2e8f0',
  },
  drawerFooterText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  drawerUnpairBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  drawerUnpairBtnText: {
    color: '#f87171',
    fontSize: 11,
    fontWeight: '700',
  },

  /* Dedicated Sort Modal */
  modalDismissArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sortModalCard: {
    width: '88%',
    maxWidth: 380,
    backgroundColor: '#0A0A0A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.35)',
    padding: 18,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  sortModalCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
  },
  sortModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 8,
  },
  sortModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  sortModalTitleLight: {
    color: '#0f172a',
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginVertical: 2,
  },
  sortOptionRowActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
  },
  sortOptionLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
  },
  sortOptionLabelActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  sortOptionSub: {
    color: '#64748b',
    fontSize: 10.5,
    marginTop: 1,
  },
  sortOptionCheckMark: {
    color: '#60a5fa',
    fontSize: 16,
    fontWeight: '900',
    marginLeft: 8,
  },

  /* Share Hub Bento Card on Mobile Homepage */
  shareHubRefreshBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  shareHubCountBadge: {
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.3)',
  },
  shareHubCountText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '800',
  },
  shareHubBatchRow: {
    marginTop: 8,
    marginBottom: 4,
  },
  shareHubSaveAllBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareHubSaveAllBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  shareHubEmpty: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareHubEmptyTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 4,
  },
  shareHubEmptyTitleLight: {
    color: '#0f172a',
  },
  shareHubEmptySub: {
    color: '#94a3b8',
    fontSize: 11.5,
    textAlign: 'center',
    lineHeight: 16,
  },
  shareHubList: {
    marginTop: 6,
  },
  shareHubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    marginBottom: 6,
  },
  shareHubRowLight: {
    backgroundColor: '#f8fafc',
  },
  shareHubFileName: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '700',
  },
  shareHubFileNameLight: {
    color: '#0f172a',
  },
  shareHubFileMeta: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 1,
  },
  shareHubActionBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  shareHubActionBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  shareHubSavedChip: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  shareHubSavedChipText: {
    color: '#10b981',
    fontSize: 10.5,
    fontWeight: '800',
  },
  shareHubStatusChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  shareHubStatusText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '800',
  },
  shareHubClearBtn: {
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  shareHubClearBtnText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
  },

  /* Enhanced Video Player Hub in Lightbox */
  lightboxVideoHub: {
    width: '90%',
    maxWidth: 420,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  lightboxVideoPreviewCard: {
    width: '100%',
    borderRadius: 24,
    backgroundColor: 'rgba(13, 21, 39, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.35)',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  lightboxVideoGlowCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(37, 99, 235, 0.18)',
    borderWidth: 2,
    borderColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  lightboxVideoBigPlayBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxVideoPlayIcon: {
    color: '#ffffff',
    fontSize: 28,
    marginLeft: 4,
  },
  lightboxVideoName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  lightboxVideoSub: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  lightboxVideoActionGroup: {
    width: '100%',
    marginTop: 18,
    gap: 10,
  },
  lightboxVideoPrimaryPlayBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  lightboxVideoPrimaryPlayBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  gridVideoThumbWrap: {
    width: '100%',
    height: 50,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  gridVideoPlayBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  gridVideoPlayBadgeIcon: {
    color: '#ffffff',
    fontSize: 9,
    marginLeft: 1,
    fontWeight: '900',
  },

  /* Light Theme Overrides */
  containerLight: {
    backgroundColor: '#F7F6F2',
  },
  topHeaderLight: {
    backgroundColor: '#F7F6F2',
    borderBottomColor: 'rgba(26, 92, 74, 0.12)',
  },
  brandTitleLight: {
    color: '#0f172a',
  },
  bentoCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowColor: '#64748b',
    shadowOpacity: 0.08,
  },
  bentoCardTitleLight: {
    color: '#0f172a',
  },
  
  /* Direct Share Device Picker Modal */
  directShareCard: {
    width: '90%',
    maxWidth: 400,
    backgroundColor: '#0A0A0A',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.35)',
    padding: 20,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  directShareCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
  },
  directShareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 16,
  },
  directShareTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
  },
  directShareTitleLight: {
    color: '#0f172a',
  },
  directShareSub: {
    fontSize: 11.5,
    color: '#60a5fa',
    marginTop: 2,
    fontWeight: '600',
  },
  directShareDeviceList: {
    gap: 10,
    marginBottom: 14,
  },
  directShareDeviceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  directShareDeviceBtnActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderColor: 'rgba(37, 99, 235, 0.35)',
  },
  directShareDeviceBtnLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  directShareIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(37, 99, 235, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  directShareIconEmoji: {
    fontSize: 22,
  },
  directShareOnlineDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  directShareDeviceName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  directShareDeviceNameLight: {
    color: '#0f172a',
  },
  directShareDeviceMeta: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  directShareActionText: {
    color: '#60a5fa',
    fontSize: 12.5,
    fontWeight: '800',
  },
  directShareCancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  directShareCancelBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
  },

  /* Direct Share Device Picker Modal */
  directShareCard: {
    width: '90%',
    maxWidth: 400,
    backgroundColor: '#0A0A0A',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.35)',
    padding: 20,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  directShareCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
  },
  directShareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 16,
  },
  directShareTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
  },
  directShareTitleLight: {
    color: '#0f172a',
  },
  directShareSub: {
    fontSize: 11.5,
    color: '#60a5fa',
    marginTop: 2,
    fontWeight: '600',
  },
  directShareDeviceList: {
    gap: 10,
    marginBottom: 14,
  },
  directShareDeviceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  directShareDeviceBtnActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderColor: 'rgba(37, 99, 235, 0.35)',
  },
  directShareDeviceBtnLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  directShareIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(37, 99, 235, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  directShareIconEmoji: {
    fontSize: 22,
  },
  directShareOnlineDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  directShareDeviceName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  directShareDeviceNameLight: {
    color: '#0f172a',
  },
  directShareDeviceMeta: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  directShareActionText: {
    color: '#60a5fa',
    fontSize: 12.5,
    fontWeight: '800',
  },
  directShareCancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  directShareCancelBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
  },

  /* Storage Access Permission Prompt Modal */
  storagePromptCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.35)',
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 14,
  },
  storagePromptCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
  },
  storagePromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  storagePromptIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.3)',
  },
  storagePromptTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
    flex: 1,
  },
  storagePromptTitleLight: {
    color: '#0f172a',
  },
  storagePromptDesc: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 19,
    marginBottom: 14,
  },
  storagePromptDescLight: {
    color: '#475569',
  },
  storagePromptBadgeRow: {
    marginBottom: 18,
  },
  storagePromptBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    alignSelf: 'flex-start',
  },
  storagePromptBadgeText: {
    color: '#10b981',
    fontSize: 11.5,
    fontWeight: '700',
  },
  storagePromptBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  storagePromptSecondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  storagePromptSecondaryBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  storagePromptSecondaryBtnText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  storagePromptSecondaryBtnTextLight: {
    color: '#334155',
  },
  storagePromptPrimaryBtn: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  storagePromptPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },

  /* Drawer / Settings Switch styling */
  drawerSettingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 10,
  },
  drawerSettingRowLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  drawerSettingSub: {
    color: '#64748b',
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
  },

  /* Settings Modal Card */
  settingsModalCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.3)',
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  settingsModalCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  settingsItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  settingsItemRowLight: {
    borderBottomColor: '#f1f5f9',
  },
  settingsItemTitle: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  settingsItemTitleLight: {
    color: '#0f172a',
  },
  settingsItemSub: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },

  /* Native External File / Player Chooser Modal */
  externalPromptCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 20,
    padding: 20,
    width: SCREEN_WIDTH - 36,
    maxWidth: 420,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  externalPromptCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowOpacity: 0.15,
  },
  externalPromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  externalPromptBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  externalPromptHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.2,
  },
  externalPromptHeadingLight: {
    color: '#0f172a',
  },
  externalPromptBadgeSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '500',
  },
  externalPromptCloseBtn: {
    padding: 6,
  },
  externalPromptFileBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  externalPromptFileBoxLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  externalPromptFileName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#38bdf8',
    marginBottom: 4,
  },
  externalPromptFileNameLight: {
    color: '#0284c7',
  },
  externalPromptFileFormat: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  externalPromptDesc: {
    fontSize: 12.5,
    color: '#cbd5e1',
    lineHeight: 18,
    marginBottom: 18,
  },
  externalPromptDescLight: {
    color: '#475569',
  },
  externalPromptActions: {
    gap: 10,
  },
  externalPromptPrimaryBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  externalPromptPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  externalPromptSecondaryBtn: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.35)',
  },
  externalPromptSecondaryBtnLight: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  externalPromptSecondaryBtnText: {
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '700',
  },
  externalPromptSecondaryBtnTextLight: {
    color: '#2563eb',
  },
  externalPromptCancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalPromptCancelBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  lightboxOpenExternalBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  lightboxOpenExternalBtnIcon: {
    fontSize: 15,
    marginRight: 6,
    color: '#ffffff',
  },
  lightboxOpenExternalBtnText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '800',
  },
  lightboxOpenInAppBtn: {
    flex: 1,
    minHeight: 40,
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxOpenInAppBtnText: {
    color: '#93c5fd',
    fontSize: 11.5,
    fontWeight: '800',
  },

  /* UI POLISH & LIGHT MODE AUDIT STYLES */
  explorerContainerLight: {
    backgroundColor: '#F7F6F2',
  },
  bentoCardSubtitleLight: {
    color: '#64748b',
  },
  logTextItemLight: {
    color: '#334155',
  },
  emptyLogsTextLight: {
    color: '#64748b',
  },
  modalContentLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  modalTitleLight: {
    color: '#0f172a',
  },
  modalCloseTextLight: {
    color: '#64748b',
  },
  diagResultBentoLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  diagResultTextLight: {
    color: '#0f172a',
  },
  modalCancelBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  modalCancelBtnTextLight: {
    color: '#334155',
  },
  clipboardDisplayBoxLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  clipboardDisplayTextLight: {
    color: '#0f172a',
  },
  clipboardTextInputLight: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    color: '#0f172a',
  },
  snippetChipLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  snippetChipTextLight: {
    color: '#334155',
  },
  navBarLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  navUpBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  navUpBtnTextLight: {
    color: '#334155',
  },
  refreshBtnLight: {
    backgroundColor: '#f1f5f9',
  },
  refreshBtnTextLight: {
    color: '#2563eb',
  },
  viewModeBtnLight: {
    backgroundColor: '#f1f5f9',
  },
  viewModeBtnTextLight: {
    color: '#334155',
  },
  searchInputWrapLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  searchInputLight: {
    color: '#0f172a',
  },
  sortToggleBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  sortToggleBtnTextLight: {
    color: '#334155',
  },
  multiSelectToggleLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  multiSelectToggleTextLight: {
    color: '#334155',
  },
  pcDrivePillLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  pcDrivePillTextLight: {
    color: '#0f172a',
  },
  pcShortcutPillLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  pcShortcutPillTextLight: {
    color: '#334155',
  },
  breadcrumbItemLight: {
    backgroundColor: '#f8fafc',
  },
  breadcrumbItemActiveLight: {
    backgroundColor: '#eff6ff',
  },
  breadcrumbTextLight: {
    color: '#64748b',
  },
  breadcrumbTextActiveLight: {
    color: '#0f172a',
  },
  breadcrumbTextRootLight: {
    color: '#2563eb',
  },
  breadcrumbSeparatorLight: {
    color: '#94a3b8',
  },
  gridTileLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  gridFileNameLight: {
    color: '#0f172a',
  },
  gridFileMetaLight: {
    color: '#64748b',
  },
  listRowLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  listRowNameLight: {
    color: '#0f172a',
  },
  listRowMetaLight: {
    color: '#64748b',
  },
  listRowChevronLight: {
    color: '#94a3b8',
  },
  floatingMultiSelectBarLight: {
    backgroundColor: '#ffffff',
    borderColor: '#2563eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  floatingSelectCountLight: {
    color: '#1d4ed8',
  },
  drawerCloseBtnTextLight: {
    color: '#475569',
  },
  drawerSubLight: {
    color: '#64748b',
  },
  drawerConnCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  drawerConnCardActiveLight: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  drawerConnTitleLight: {
    color: '#0f172a',
  },
  drawerConnSubLight: {
    color: '#64748b',
  },
  drawerNavItemLight: {
    backgroundColor: 'transparent',
  },
  drawerNavItemActiveLight: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  drawerNavLabelLight: {
    color: '#475569',
  },
  drawerNavLabelActiveLight: {
    color: '#2563eb',
    fontWeight: '800',
  },
  drawerNavSubLight: {
    color: '#64748b',
  },
  drawerSettingSubLight: {
    color: '#64748b',
  },

  /* SHAREHUB DEDICATED VIEW STYLES */
  shareHubScreenTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  shareHubScreenTitleLight: {
    color: '#0f172a',
  },
  shareHubActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  shareHubPrimarySendBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  shareHubPrimarySendBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  shareHubDirectionBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'center',
    marginBottom: 3,
  },
  badgePc: {
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderColor: 'rgba(59, 130, 246, 0.35)',
    borderWidth: 1,
  },
  badgePhone: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderWidth: 1,
  },
  shareHubDirectionText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#93c5fd',
  },
  shareHubGridSavedChip: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  shareHubGridSavedChipText: {
    color: '#10b981',
    fontSize: 9,
    fontWeight: '800',
  },
  shareHubGridActionBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  shareHubGridActionBtnText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
  },
  shareHubClearBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  shareHubClearBtnTextLight: {
    color: '#64748b',
  },
  pcEmptyTitleLight: {
    color: '#0f172a',
  },
  pcEmptyDescLight: {
    color: '#64748b',
  },
  modalInputLight: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    color: '#0f172a',
  },
  modalSubTabLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  modalSubTabTextLight: {
    color: '#475569',
  },
  modalSubtitleLight: {
    color: '#64748b',
  },
  stepTitleLight: {
    color: '#0f172a',
  },
  stepDescLight: {
    color: '#475569',
  },
  beaconHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  beaconRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  beaconGlowConnected: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconGlowIdle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconStatusLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10b981',
    letterSpacing: 0.5,
  },
  beaconStatusLabelIdle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#60a5fa',
    letterSpacing: 0.5,
  },
  beaconHostTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 2,
  },
  beaconHostTitleLight: {
    color: '#0f172a',
  },
});
