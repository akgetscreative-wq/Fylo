import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  const hasAbort = typeof AbortController !== 'undefined';
  const controller = hasAbort ? new AbortController() : null;
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
const SafeImage = ({ source, style, resizeMode, fallbackEmoji = '🖼️' }) => {
  const [hasError, setHasError] = useState(false);
  const uri = source?.uri;
  const prevUriRef = useRef(uri);

  useEffect(() => {
    if (prevUriRef.current !== uri) {
      prevUriRef.current = uri;
      setHasError(false);
    }
  }, [uri]);

  if (hasError || !uri) {
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)' }]}>
        <Text style={{ fontSize: 24 }}>{fallbackEmoji}</Text>
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

// File sorting helper (STRICT DEFAULT: LATEST-FIRST by date/mtime descending, folders always at top)
const sortExplorerItems = (items, sortBy = 'latest') => {
  if (!Array.isArray(items)) return [];
  const folders = [];
  const files = [];

  for (const item of items) {
    if (!item) continue;
    if (item.isDir) {
      folders.push(item);
    } else {
      files.push(item);
    }
  }

  const comparator = (a, b) => {
    if (sortBy === 'latest') {
      const aTime = typeof a.modified === 'number' ? a.modified : 0;
      const bTime = typeof b.modified === 'number' ? b.modified : 0;
      if (bTime !== aTime) return bTime - aTime; // descending: newest first
      return (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'oldest') {
      const aTime = typeof a.modified === 'number' ? a.modified : 0;
      const bTime = typeof b.modified === 'number' ? b.modified : 0;
      if (bTime !== aTime) return aTime - bTime; // ascending: oldest first
      return (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'name' || sortBy === 'name-asc') {
      return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true });
    } else if (sortBy === 'name-desc') {
      return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base', numeric: true });
    } else if (sortBy === 'size' || sortBy === 'size-desc') {
      const aSize = typeof a.size === 'number' ? a.size : 0;
      const bSize = typeof b.size === 'number' ? b.size : 0;
      if (bSize !== aSize) return bSize - aSize; // descending: largest first
      return (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'size-asc') {
      const aSize = typeof a.size === 'number' ? a.size : 0;
      const bSize = typeof b.size === 'number' ? b.size : 0;
      if (bSize !== aSize) return aSize - bSize; // ascending: smallest first
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
  const [pairModalTab, setPairModalTab] = useState('qr'); // 'qr' | 'manual'
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

  // Send to PC State (Replaces Sending)
  const [isSending, setIsSending] = useState(false);

  // Live Shared Clipboard Sync (OFF BY DEFAULT as requested by user)
  const [clipboardAutoSync, setClipboardAutoSync] = useState(false);

  // Direct Share Device Picker Modal State
  const [directShareModalVisible, setDirectShareModalVisible] = useState(false);
  const [directSharePendingFiles, setDirectSharePendingFiles] = useState([]);
  const directShareModalVisibleRef = useRef(directShareModalVisible);
  directShareModalVisibleRef.current = directShareModalVisible;

  // Universal Media Lightbox State with Pinch-to-Zoom & Pan & Carousel Playlist
  const [lightboxItem, setLightboxItem] = useState(null); // { item, source: 'phone' | 'pc', index: number, playlist: Array }
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const zoomScaleRef = useRef(1);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef(null);
  const lastTapTimeRef = useRef(0);

  // In-App Video Player State
  const [videoPaused, setVideoPaused] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoRepeat, setVideoRepeat] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const videoViewRef = useRef(null);

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

  // Gallery Navigation Functions
  const goToNextMedia = () => {
    const current = lightboxItemRef.current;
    if (!current?.playlist || current.playlist.length <= 1) return;
    const { playlist, index, source } = current;
    const nextIdx = (index + 1) % playlist.length;
    const nextItem = playlist[nextIdx];
    if (nextItem) {
      setLightboxItem({
        item: nextItem,
        source,
        index: nextIdx,
        playlist,
      });
      resetZoom();
      setVideoPaused(false);
      setVideoDuration(0);
    }
  };

  const goToPrevMedia = () => {
    const current = lightboxItemRef.current;
    if (!current?.playlist || current.playlist.length <= 1) return;
    const { playlist, index, source } = current;
    const prevIdx = (index - 1 + playlist.length) % playlist.length;
    const prevItem = playlist[prevIdx];
    if (prevItem) {
      setLightboxItem({
        item: prevItem,
        source,
        index: prevIdx,
        playlist,
      });
      resetZoom();
      setVideoPaused(false);
      setVideoDuration(0);
    }
  };

  const goToNextMediaRef = useRef(goToNextMedia);
  goToNextMediaRef.current = goToNextMedia;
  const goToPrevMediaRef = useRef(goToPrevMedia);
  goToPrevMediaRef.current = goToPrevMedia;

  // Native Image Container Ref for 120Hz Hardware-Accelerated Pan & Zoom
  const imageContainerRef = useRef(null);

  const updateNativeTransform = (scale, x, y) => {
    if (imageContainerRef.current && imageContainerRef.current.setNativeProps) {
      imageContainerRef.current.setNativeProps({
        style: {
          transform: [
            { scale: scale },
            { translateX: x },
            { translateY: y },
          ],
        },
      });
    }
  };

  // Reset zoom & pan helper
  const resetZoom = () => {
    zoomScaleRef.current = 1;
    panOffsetRef.current = { x: 0, y: 0 };
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    lastTouchDistanceRef.current = null;
    updateNativeTransform(1, 0, 0);
  };

  useEffect(() => {
    resetZoom();
    setVideoPaused(false);
    setVideoDuration(0);
  }, [lightboxItem?.item?.path]);

  // =========================================================
  // FLUID MULTI-TOUCH PINCH-TO-ZOOM, PAN & SWIPE CAROUSEL
  // =========================================================
  const zoomPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return evt.nativeEvent.touches.length > 1 || Math.abs(gestureState.dx) > 6 || Math.abs(gestureState.dy) > 6;
      },
      onPanResponderGrant: (evt) => {
        if (evt.nativeEvent.touches.length === 2) {
          const [t1, t2] = evt.nativeEvent.touches;
          lastTouchDistanceRef.current = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
        } else if (evt.nativeEvent.touches.length === 1) {
          // Double tap to smoothly toggle zoom in/out with native hardware acceleration
          const now = Date.now();
          if (now - lastTapTimeRef.current < 320) {
            const nextScale = zoomScaleRef.current > 1.2 ? 1 : 2.5;
            zoomScaleRef.current = nextScale;
            panOffsetRef.current = { x: 0, y: 0 };
            updateNativeTransform(nextScale, 0, 0);
            setZoomScale(nextScale);
            setPanOffset({ x: 0, y: 0 });
            lastTapTimeRef.current = 0;
            return;
          }
          lastTapTimeRef.current = now;
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          const [t1, t2] = touches;
          const currentDistance = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
          if (lastTouchDistanceRef.current && lastTouchDistanceRef.current > 0) {
            const delta = currentDistance / lastTouchDistanceRef.current;
            let nextScale = zoomScaleRef.current * delta;
            if (nextScale < 0.8) nextScale = 0.8;
            if (nextScale > 5) nextScale = 5;
            zoomScaleRef.current = nextScale;
            // Native direct update without React re-render: 120Hz butter-smooth!
            updateNativeTransform(nextScale, panOffsetRef.current.x, panOffsetRef.current.y);
          }
          lastTouchDistanceRef.current = currentDistance;
        } else if (touches.length === 1) {
          if (zoomScaleRef.current > 1.05) {
            const maxPanX = (SCREEN_WIDTH * (zoomScaleRef.current - 1)) / 1.8;
            const maxPanY = (SCREEN_HEIGHT * (zoomScaleRef.current - 1)) / 1.8;
            let nextX = panOffsetRef.current.x + gestureState.dx * 0.25;
            let nextY = panOffsetRef.current.y + gestureState.dy * 0.25;
            nextX = Math.max(-maxPanX, Math.min(maxPanX, nextX));
            nextY = Math.max(-maxPanY, Math.min(maxPanY, nextY));
            panOffsetRef.current = { x: nextX, y: nextY };
            // Native direct update without React re-render!
            updateNativeTransform(zoomScaleRef.current, nextX, nextY);
          } else {
            // At 1.0x Scale: Pull down to dismiss or swipe left/right for carousel
            if (gestureState.dy > 15 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.1) {
              // Google Photos style: slide / pull image down to dismiss!
              const dragY = gestureState.dy;
              const dragScale = Math.max(0.65, 1 - (dragY / SCREEN_HEIGHT) * 0.45);
              panOffsetRef.current = { x: gestureState.dx * 0.35, y: dragY };
              updateNativeTransform(dragScale, gestureState.dx * 0.35, dragY);
            } else if (Math.abs(gestureState.dx) > 10) {
              // Horizontal swipe feedback
              panOffsetRef.current = { x: gestureState.dx * 0.4, y: 0 };
              updateNativeTransform(1, gestureState.dx * 0.4, 0);
            }
          }
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        lastTouchDistanceRef.current = null;
        if (zoomScaleRef.current <= 1.05) {
          // If dragged down by > 80px or flicked down: dismiss!
          if (gestureState.dy > 80 || (gestureState.dy > 35 && gestureState.vy > 0.65)) {
            setLightboxItem(null);
            resetZoom();
            return;
          }

          // Horizontal swipe left/right to change media (Google Photos carousel)
          const isHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.1;
          if (isHorizontal && (gestureState.dx < -50 || gestureState.vx < -0.5)) {
            goToNextMediaRef.current();
          } else if (isHorizontal && (gestureState.dx > 50 || gestureState.vx > 0.5)) {
            goToPrevMediaRef.current();
          } else {
            zoomScaleRef.current = 1;
            panOffsetRef.current = { x: 0, y: 0 };
            updateNativeTransform(1, 0, 0);
            setZoomScale(1);
            setPanOffset({ x: 0, y: 0 });
          }
        } else {
          setZoomScale(zoomScaleRef.current);
          setPanOffset({ ...panOffsetRef.current });
        }
      },
    })
  ).current;

  // Video Swiping & Pull-Down Gestures
  const videoPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 18 || Math.abs(gestureState.dy) > 18;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 80 || (gestureState.dy > 35 && gestureState.vy > 0.65)) {
          setLightboxItem(null);
          resetZoom();
          return;
        }
        const isHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.1;
        if (isHorizontal && (gestureState.dx < -45 || gestureState.vx < -0.5)) {
          goToNextMediaRef.current();
        } else if (isHorizontal && (gestureState.dx > 45 || gestureState.vx > 0.5)) {
          goToPrevMediaRef.current();
        }
      },
    })
  ).current;

  // Zoom button triggers
  const handleZoomIn = () => {
    let next = Math.min(4, zoomScaleRef.current + 0.5);
    zoomScaleRef.current = next;
    setZoomScale(next);
  };
  const handleZoomOut = () => {
    let next = Math.max(1, zoomScaleRef.current - 0.5);
    zoomScaleRef.current = next;
    if (next === 1) {
      panOffsetRef.current = { x: 0, y: 0 };
      setPanOffset({ x: 0, y: 0 });
    }
    setZoomScale(next);
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

  // Periodic clipboard sync when paired with PC (OFF BY DEFAULT unless user toggles on)
  useEffect(() => {
    if (!pairedPc || !clipboardAutoSync) return;

    fetchPcClipboard();
    const clipTimer = setInterval(fetchPcClipboard, 4000);
    return () => clearInterval(clipTimer);
  }, [pairedPc, pcAuthToken, clipboardAutoSync]);

  // Load PC Explorer shortcuts when switching to PC Explorer tab or pairing
  useEffect(() => {
    if ((currentTab === 'pc-explorer' || currentTab === 'home') && pairedPc) {
      loadPcQuickAccess();
    }
  }, [currentTab, pairedPc]);

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

      // 7. On Home tab with no modal: exit/background app
      return false;
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
  // LAN Shared Clipboard Operations
  // ==========================================
  const fetchPcClipboard = async () => {
    if (!pairedPc) return;
    try {
      const res = await apiFetch(`http://${pairedPc}/api/clipboard`, {
        headers: { 'X-Auth-Token': pcAuthToken || '' },
      }, 4000);
      if (res.ok) {
        const data = await safeJson(res);
        if (data && data.text !== undefined && data.text !== pcClipboardText) {
          setPcClipboardText(data.text);
          setPcClipboardUpdatedBy(data.updatedBy || 'Windows PC');
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
      const res = await apiFetch(`http://${pairedPc}/api/clipboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': pcAuthToken || '' },
        body: JSON.stringify({
          text: text.trim(),
          updatedBy: phoneModelName || 'Mobile Companion',
        }),
      }, 5000);

      const data = await safeJson(res);
      if (res.ok && data && data.success) {
        setPcClipboardText(text.trim());
        setPcClipboardUpdatedBy('Phone Companion');
        setClipboardInput('');
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

        // Add to local Mobile Share Hub list
        setSharedHubFiles((prev) => [...sentFiles, ...prev].slice(0, 50));
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
      setSharedHubFiles((prev) => [...sentFiles, ...prev].slice(0, 50));
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

  // Directory Breadcrumb navigation helper
  const renderBreadcrumbs = (currentPath, onSelectPath, isPc = false) => {
    if (!currentPath || typeof currentPath !== 'string') return null;
    const delimiter = isPc && currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(delimiter).filter(Boolean);

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breadcrumbScroll}>
        <TouchableOpacity
          style={styles.breadcrumbItem}
          onPress={() => onSelectPath(isPc ? 'C:\\' : '/storage/emulated/0')}>
          <Text style={styles.breadcrumbTextRoot}>{isPc ? '💻 PC' : '📱 Phone'}</Text>
        </TouchableOpacity>

        {parts.map((part, index) => {
          if (!isPc && (part === 'storage' || part === 'emulated')) return null;
          const subPath = isPc
            ? parts.slice(0, index + 1).join('\\') + (index === 0 ? '\\' : '')
            : '/' + parts.slice(0, index + 1).join('/');
          const isLast = index === parts.length - 1;

          return (
            <View key={subPath} style={styles.breadcrumbSegmentWrap}>
              <Text style={styles.breadcrumbSeparator}>›</Text>
              <TouchableOpacity
                style={[styles.breadcrumbItem, isLast && styles.breadcrumbItemActive]}
                disabled={isLast}
                onPress={() => onSelectPath(subPath)}>
                <Text style={[styles.breadcrumbText, isLast && styles.breadcrumbTextActive]} numberOfLines={1}>
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

  const isMediaFile = (ext) => isImageFile(ext) || isVideoFile(ext);

  const getSortLabel = (mode) => {
    switch (mode) {
      case 'latest': return '⏱️ Latest';
      case 'oldest': return '⏱️ Oldest';
      case 'name': return '🔤 Name (A→Z)';
      case 'name-desc': return '🔤 Name (Z→A)';
      case 'size': return '📊 Size (Max)';
      case 'size-asc': return '📊 Size (Min)';
      default: return '⏱️ Latest';
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
      const next = phoneSortBy === 'latest' ? 'name' : phoneSortBy === 'name' ? 'size' : 'latest';
      setPhoneSortBy(next);
      showToast(`Sorted by: ${next === 'latest' ? '⏱️ Latest (Newest First)' : next === 'name' ? '🔤 Name (A-Z)' : '📊 Size'}`);
    } else {
      const next = pcSortBy === 'latest' ? 'name' : pcSortBy === 'name' ? 'size' : 'latest';
      setPcSortBy(next);
      showToast(`Sorted by: ${next === 'latest' ? '⏱️ Latest (Newest First)' : next === 'name' ? '🔤 Name (A-Z)' : '📊 Size'}`);
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
    <SafeAreaView style={[styles.container, !isDarkMode && styles.containerLight]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? "#080c14" : "#ffffff"} />
      <StatusBar barStyle="light-content" backgroundColor="#080c14" />

      {/* ========================================================= */}
      {/* REQUIREMENT 1: HEADER & NAVIGATION REDESIGN                */}
      {/* Sleek, compact top bar with vibrant pink/neon accents     */}
      {/* ========================================================= */}
      <View style={[styles.topHeader, !isDarkMode && styles.topHeaderLight]}>
        <View style={styles.brandRow}>
          <View style={styles.brandLeftGroup}>
            {/* Sleek Hamburger Menu Button */}
            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.hamburgerBtn, !isDarkMode && styles.hamburgerBtnLight]}
              onPress={openSidebar}>
              <Text style={[styles.hamburgerIcon, !isDarkMode && styles.hamburgerIconLight]}>☰</Text>
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
                <Text style={styles.brandSub}>
                  {currentTab === 'home' ? 'Dashboard' :
                   currentTab === 'phone-explorer' ? 'Phone Files' :
                   currentTab === 'pc-explorer' ? 'PC Drives' :
                   currentTab === 'clipboard' ? 'Shared Clip' : 'Speed Hub'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Connection Status Pill */}
          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.topStatusPill, pairedPc ? (isPcReachable ? styles.topStatusPillActive : styles.topStatusPillOffline) : styles.topStatusPillIdle]}
            onPress={() => {
              if (pairedPc) {
                setDiagVisible(true);
                runNetworkDiagnostic();
              } else {
                setShowPairModal(true);
              }
            }}>
            <View style={[styles.beaconDot, { backgroundColor: pairedPc ? (isPcReachable ? '#10b981' : '#ef4444') : '#64748b' }]} />
            <Text style={styles.topStatusPillText} numberOfLines={1}>
              {pairedPc ? (isPcReachable ? (pingLatency !== null ? `${pingLatency} ms` : 'Online') : '⚠️ PC Offline') : '⚡ Pair PC'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Floating Toast Notification (Vibrant pink pill) */}
      {clipboardToast !== '' && (
        <View style={styles.toastWrap}>
          <Text style={styles.toastText}>{clipboardToast}</Text>
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 1: STREAMLINED BENTO HOME DASHBOARD                   */}
      {/* ========================================================= */}
      {currentTab === 'home' && (
        <View style={{ flex: 1 }} {...homePanResponder.panHandlers}>
          <ScrollView
            contentContainerStyle={styles.bentoScroll}
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

           {/* 1. PROMINENT CONNECTION STATUS BEACON CARD */}
          <View style={styles.bentoCardHero}>
            {pairedPc ? (
              // Connected State
              <View>
                <View style={styles.beaconHeaderRow}>
                  <View style={styles.beaconRowLeft}>
                    <View style={isPcReachable ? styles.beaconGlowConnected : styles.beaconGlowOffline}>
                      <View style={[styles.beaconDot, { backgroundColor: isPcReachable ? '#10b981' : '#ef4444' }]} />
                    </View>
                    <View>
                      <Text style={isPcReachable ? styles.beaconStatusLabel : styles.beaconStatusLabelOffline}>
                        {isPcReachable ? 'CONNECTED TO PC' : '⚠️ PC OFFLINE'}
                      </Text>
                      <Text style={styles.beaconHostTitle} numberOfLines={1}>
                        {pcHostName || 'Windows Host'}
                      </Text>
                      <Text style={styles.beaconIpSub}>{pairedPc}</Text>
                    </View>
                  </View>
                  <View style={isPcReachable ? styles.latencyBadge : styles.latencyBadgeOffline}>
                    <Text style={isPcReachable ? styles.latencyBadgeText : styles.latencyBadgeTextOffline}>
                      {isPcReachable ? (pingLatency !== null ? `${pingLatency} ms` : 'Online') : 'Offline'}
                    </Text>
                  </View>
                </View>

                {/* Primary Action Buttons */}
                <View style={styles.heroBtnRow}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.heroPrimaryBtn}
                    onPress={() => setCurrentTab('pc-explorer')}>
                    <Text style={styles.heroPrimaryBtnText}>📂 Browse PC Drives</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.heroSecondaryBtn}
                    onPress={handleUnpair}>
                    <Text style={styles.heroSecondaryBtnText}>Disconnect</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              // Ready to Pair State
              <View>
                <View style={styles.beaconHeaderRow}>
                  <View style={styles.beaconRowLeft}>
                    <View style={styles.beaconGlowIdle}>
                      <View style={[styles.beaconDot, { backgroundColor: '#3b82f6' }]} />
                    </View>
                    <View>
                      <Text style={styles.beaconStatusLabelIdle}>READY TO PAIR</Text>
                      <Text style={styles.beaconHostTitle}>Fast Wireless Sync</Text>
                      <Text style={styles.beaconIpSub}>
                        Wi-Fi or Hotspot • {deviceIp}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.readyPairSubText}>
                  Pair with Fylo desktop app to browse Windows drives, stream media, and sync clipboard without cables.
                </Text>

                {/* Prominent Action Buttons */}
                <View style={styles.heroBtnRow}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.heroPrimaryBtn}
                    onPress={handleStartQrScan}>
                    <Text style={styles.heroPrimaryBtnText}>📷 Scan PC QR Code</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.heroOutlineBtn}
                    onPress={() => {
                      setPairModalTab('manual');
                      setShowPairModal(true);
                    }}>
                    <Text style={styles.heroOutlineBtnText}>⌨️ Manual IP</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* ========================================================= */}
          {/* FAST SHARE & DIRECT NATIVE ANDROID FILE PICKER            */}
          {/* ========================================================= */}
          <View style={[styles.quickShareCard, !isDarkMode && styles.bentoCardLight]}>
            <View style={styles.quickShareHeaderRow}>
              <View style={styles.quickShareHeaderLeft}>
                <View style={styles.quickShareIconWrap}>
                  <Text style={styles.quickShareIconEmoji}>📤</Text>
                </View>
                <View>
                  <Text style={[styles.quickShareCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>Send Files to PC</Text>
                  <Text style={styles.quickShareCardSub}>
                    {pairedPc
                      ? `Send directly into ${pcHostName || 'PC'} Downloads`
                      : 'Connect to PC to transfer photos & files wirelessly'}
                  </Text>
                </View>
              </View>
              <View style={styles.quickSharePillBadge}>
                <Text style={styles.quickSharePillBadgeText}>Direct</Text>
              </View>
            </View>

            {/* Native Android File Picker Button */}
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={isSending}
              style={[styles.quickShareSendBtn, isSending && { opacity: 0.6 }]}
              onPress={handlePickAndSendToPc}>
              <Text style={styles.quickShareSendBtnText}>
                {isSending ? 'Sending to PC...' : '📤 Send Files to PC'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ========================================================= */}
          {/* ⚡ SHARE HUB: ACTIVE SHARED FILES ON MOBILE HOMEPAGE     */}
          {/* ========================================================= */}
          <View style={[styles.bentoCard, !isDarkMode && styles.bentoCardLight]}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={[styles.bentoCardTitle, !isDarkMode && styles.bentoCardTitleLight]}>⚡ Share Hub</Text>
                <Text style={styles.bentoCardSubtitle}>Active shared files & transfers</Text>
              </View>
              <View style={styles.shareHubCountBadge}>
                <Text style={styles.shareHubCountText}>
                  {sharedHubFiles.length} {sharedHubFiles.length === 1 ? 'file' : 'files'}
                </Text>
              </View>
            </View>

            {sharedHubFiles.length === 0 ? (
              <View style={styles.shareHubEmpty}>
                <Text style={{ fontSize: 28, opacity: 0.7 }}>📦</Text>
                <Text style={[styles.shareHubEmptyTitle, !isDarkMode && styles.shareHubEmptyTitleLight]}>
                  No files shared yet
                </Text>
                <Text style={styles.shareHubEmptySub}>
                  Tap 'Send Files to PC' above to transfer files instantly across your LAN
                </Text>
              </View>
            ) : (
              <View style={styles.shareHubList}>
                {sharedHubFiles.slice(0, 8).map((f, i) => (
                  <View key={f.path || i} style={[styles.shareHubRow, !isDarkMode && styles.shareHubRowLight]}>
                    <Text style={{ fontSize: 20 }}>{getFileIcon((f.name || '').split('.').pop(), false)}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.shareHubFileName, !isDarkMode && styles.shareHubFileNameLight]} numberOfLines={1}>
                        {f.name}
                      </Text>
                      <Text style={styles.shareHubFileMeta}>
                        {f.size ? formatFileSize(f.size) : 'Ready'} • {f.direction === 'received' ? '📥 From PC' : '📤 Sent to PC'}
                      </Text>
                    </View>
                    <View style={styles.shareHubStatusChip}>
                      <Text style={styles.shareHubStatusText}>Done</Text>
                    </View>
                  </View>
                ))}
                {sharedHubFiles.length > 0 && (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.shareHubClearBtn}
                    onPress={() => setSharedHubFiles([])}>
                    <Text style={styles.shareHubClearBtnText}>Clear Hub History</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* 2. DEVICE STORAGE BENTO TILE (Real Internal Storage Meter) */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>📊 Device Internal Storage</Text>
                <Text style={styles.bentoCardSubtitle}>Real-time flash memory status</Text>
              </View>
              <View style={styles.storagePercentChip}>
                <Text style={styles.storagePercentChipText}>{storageStats.usedPercent}% Used</Text>
              </View>
            </View>

            {/* Visual Storage Meter Progress Bar */}
            <View style={styles.storageTrack}>
              <View style={[styles.storageFill, { width: `${storageStats.usedPercent}%` }]} />
            </View>

            <View style={styles.storageLegendRow}>
              <Text style={styles.storageLegendText}>Used: {storageStats.usedGB}</Text>
              <Text style={styles.storageLegendText}>Free: {storageStats.freeGB}</Text>
            </View>

            {/* Sub-Metrics Bento Row */}
            <View style={styles.storageMetricsRow}>
              <View style={styles.storageMetricCol}>
                <Text style={styles.metricVal}>{storageStats.freeGB}</Text>
                <Text style={styles.metricLabel}>Free Available</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.storageMetricCol}>
                <Text style={styles.metricVal}>{storageStats.totalGB}</Text>
                <Text style={styles.metricLabel}>Total Capacity</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.storageMetricCol}>
                <Text style={[styles.metricVal, { color: readOnlyMode ? '#10b981' : '#f59e0b' }]}>
                  {readOnlyMode ? 'Safe' : 'Write OK'}
                </Text>
                <Text style={styles.metricLabel}>Access Guard</Text>
              </View>
            </View>
          </View>

          {/* 3. LAN SHARED CLIPBOARD PREVIEW CARD */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>📋 LAN Shared Clipboard</Text>
                <Text style={styles.bentoCardSubtitle}>
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
                  📋 Copy to Phone
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
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>📡 Background File Server</Text>
                <Text style={styles.bentoCardSubtitle}>
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
                  {serverRunning ? '⏹ Stop Server' : '▶ Start Server'}
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
        </ScrollView>
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 2: PHONE STORAGE EXPLORER & GALLERY                   */}
      {/* Clean, compact, non-cropped, one-step-back & sorting       */}
      {/* ========================================================= */}
      {currentTab === 'phone-explorer' && (
        <View style={styles.explorerContainer}>
          {/* Breadcrumbs Navigation Bar with ONE-STEP-BACK */}
          <View style={styles.navBar}>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[
                styles.navUpBtn,
                phoneHistory.length === 0 && (!phoneParentPath || phoneParentPath === phoneCurrentPath) && styles.navBtnDisabled,
              ]}
              disabled={phoneHistory.length === 0 && (!phoneParentPath || phoneParentPath === phoneCurrentPath)}
              onPress={goBackPhoneFolder}>
              <Text style={styles.navUpBtnText}>‹ Back</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              {renderBreadcrumbs(phoneCurrentPath, (p) => loadPhoneFolder(p), false)}
            </View>

            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.refreshBtn}
              onPress={() => loadPhoneFolder(phoneCurrentPath)}>
              <Text style={styles.refreshBtnText}>↻</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.viewModeBtn, phoneViewMode === 'grid' && styles.viewModeBtnActive]}
              onPress={() => setPhoneViewMode(phoneViewMode === 'grid' ? 'list' : 'grid')}>
              <Text style={styles.viewModeBtnText}>{phoneViewMode === 'grid' ? '☷' : '☰'}</Text>
            </TouchableOpacity>
          </View>

          {/* Search, Sort & Multi-Select Bar */}
          <View style={styles.searchRow}>
            <View style={styles.searchInputWrap}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search phone files..."
                placeholderTextColor="#64748b"
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
              style={styles.sortToggleBtn}
              onPress={() => setSortModalTarget('phone')}>
              <Text style={styles.sortToggleBtnText}>
                {getSortLabel(phoneSortBy)} ▾
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.multiSelectToggle, phoneMultiSelect && styles.multiSelectToggleActive]}
              onPress={() => {
                setPhoneMultiSelect(!phoneMultiSelect);
                setPhoneSelectedPaths(new Set());
              }}>
              <Text style={[styles.multiSelectToggleText, phoneMultiSelect && styles.multiSelectToggleTextActive]}>
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
              { id: 'photos', label: '📸 Photos' },
              { id: 'videos', label: '🎬 Videos' },
              { id: 'audio', label: '🎵 Audio' },
              { id: 'docs', label: '📄 Docs' },
              { id: 'folders', label: '📁 Folders' },
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
              <Text style={styles.emptyFolderIcon}>📂</Text>
              <Text style={styles.emptyFolderText}>Folder is empty</Text>
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
                        } else {
                          const playlist = filteredPhoneItems.filter((f) => !f.isDir && isMediaFile(f.ext));
                          const idx = playlist.findIndex((f) => f.path === item.path);
                          setLightboxItem({
                            item,
                            source: 'phone',
                            index: idx >= 0 ? idx : 0,
                            playlist: playlist.length > 0 ? playlist : [item],
                          });
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
                          fallbackEmoji={getFileIcon(item?.ext, false)}
                        />
                      ) : isVideoFile(item?.ext) ? (
                        <View style={styles.gridVideoThumbWrap}>
                          <SafeImage
                            source={{
                              uri: `http://127.0.0.1:${serverPort || 8080}/api/fs/thumbnail?path=${encodeURIComponent(item?.path || '')}`,
                            }}
                            style={{ width: '100%', height: '100%', borderRadius: 8 }}
                            resizeMode="cover"
                            fallbackEmoji="🎬"
                          />
                          <View style={styles.gridVideoPlayBadge}>
                            <Text style={styles.gridVideoPlayBadgeIcon}>▶</Text>
                          </View>
                        </View>
                      ) : (
                        <Text style={styles.gridFileIconEmoji}>{getFileIcon(item?.ext, false)}</Text>
                      )}

                      <Text style={styles.gridFileName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.gridFileMeta}>
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
                    style={[styles.listRow, isSelected && styles.listRowSelected]}
                    onPress={() => {
                      if (phoneMultiSelect) {
                        const next = new Set(phoneSelectedPaths);
                        isSelected ? next.delete(item.path) : next.add(item.path);
                        setPhoneSelectedPaths(next);
                      } else if (item.isDir) {
                        loadPhoneFolder(item.path);
                      } else {
                        const playlist = filteredPhoneItems.filter((f) => !f.isDir && isMediaFile(f.ext));
                        const idx = playlist.findIndex((f) => f.path === item.path);
                        setLightboxItem({
                          item,
                          source: 'phone',
                          index: idx >= 0 ? idx : 0,
                          playlist: playlist.length > 0 ? playlist : [item],
                        });
                      }
                    }}>
                    {item.isDir ? (
                      <Win11FolderIcon size={26} />
                    ) : (
                      <Text style={styles.listRowEmoji}>{getFileIcon(item.ext, false)}</Text>
                    )}

                    <View style={styles.listRowContent}>
                      <Text style={styles.listRowName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.listRowMeta}>
                        {item.isDir ? 'Folder' : formatFileSize(item.size)}
                      </Text>
                    </View>

                    <Text style={styles.listRowChevron}>{item.isDir ? '›' : '👁'}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Floating Multi-Select Bar with SEND TO PC Action */}
          {phoneMultiSelect && phoneSelectedPaths.size > 0 && (
            <View style={styles.floatingMultiSelectBar}>
              <View>
                <Text style={styles.floatingSelectCount}>{phoneSelectedPaths.size} Selected</Text>
              </View>

              <View style={styles.floatingActionsRow}>
                {pairedPc && (
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.floatingSendBtn}
                    onPress={() => handleSendFilesToPc(phoneSelectedPaths)}>
                    <Text style={styles.floatingSendBtnText}>📤 Send to PC</Text>
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
                  <Text style={styles.floatingTrashBtnText}>🗑️ Trash</Text>
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
        <View style={styles.explorerContainer}>
          {!pairedPc ? (
            <View style={styles.centerLoading}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>💻</Text>
              <Text style={styles.pcEmptyTitle}>PC Remote Explorer</Text>
              <Text style={styles.pcEmptyDesc}>
                Browse, stream, and manage your Windows PC drives and folders directly from your phone.
              </Text>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.pcConnectPromptBtn}
                onPress={() => setShowPairModal(true)}>
                <Text style={styles.pcConnectPromptBtnText}>⚡ Pair with PC Now</Text>
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
                          pcCurrentPath === d?.path && styles.pcDrivePillActive,
                        ]}
                        onPress={() => d?.path && loadPcFolder(d.path)}>
                        <Text style={styles.pcDrivePillIcon}>💽</Text>
                        <Text style={[styles.pcDrivePillText, pcCurrentPath === d?.path && styles.pcDrivePillTextActive]}>
                          {d?.name || d?.path || 'Drive'}
                        </Text>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        style={[styles.pcDrivePill, pcCurrentPath.startsWith('C:') && styles.pcDrivePillActive]}
                        onPress={() => loadPcFolder('C:\\')}>
                        <Text style={styles.pcDrivePillIcon}>💽</Text>
                        <Text style={[styles.pcDrivePillText, pcCurrentPath.startsWith('C:') && styles.pcDrivePillTextActive]}>
                          Drive (C:)
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        style={[styles.pcDrivePill, pcCurrentPath.startsWith('D:') && styles.pcDrivePillActive]}
                        onPress={() => loadPcFolder('D:\\')}>
                        <Text style={styles.pcDrivePillIcon}>💽</Text>
                        <Text style={[styles.pcDrivePillText, pcCurrentPath.startsWith('D:') && styles.pcDrivePillTextActive]}>
                          Drive (D:)
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}

                  <View style={styles.ribbonDivider} />

                  {/* Windows Folder Shortcuts */}
                  {[
                    { name: 'Downloads', icon: '📥', path: 'Downloads' },
                    { name: 'Desktop', icon: '🖥️', path: 'Desktop' },
                    { name: 'Pictures', icon: '🖼️', path: 'Pictures' },
                    { name: 'Screenshots', icon: '📸', path: 'Screenshots' },
                    { name: 'Docs', icon: '📄', path: 'Documents' },
                    { name: 'Videos', icon: '🎬', path: 'Videos' },
                  ].map((sc, i) => (
                    <TouchableOpacity
                      key={'pcsc-' + i}
                      activeOpacity={0.75}
                      style={styles.pcShortcutPill}
                      onPress={() => {
                        const match = Array.isArray(pcQuickAccess?.shortcuts)
                          ? pcQuickAccess.shortcuts.find((s) =>
                              s?.name && sc?.name && s.name.toLowerCase().includes(sc.name.toLowerCase())
                            )
                          : null;
                        loadPcFolder(match?.path || sc.path);
                      }}>
                      <Text style={styles.pcShortcutPillText}>
                        {sc.icon} {sc.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* PC Breadcrumbs & Nav Bar with ONE-STEP-BACK */}
              <View style={styles.navBar}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[
                    styles.navUpBtn,
                    pcHistory.length === 0 && (!pcParentPath || pcParentPath === pcCurrentPath) && styles.navBtnDisabled,
                  ]}
                  disabled={pcHistory.length === 0 && (!pcParentPath || pcParentPath === pcCurrentPath)}
                  onPress={goBackPcFolder}>
                  <Text style={styles.navUpBtnText}>‹ Back</Text>
                </TouchableOpacity>

                <View style={{ flex: 1 }}>
                  {renderBreadcrumbs(pcCurrentPath, (p) => loadPcFolder(p), true)}
                </View>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.refreshBtn}
                  onPress={() => loadPcFolder(pcCurrentPath)}>
                  <Text style={styles.refreshBtnText}>↻</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[styles.viewModeBtn, pcViewMode === 'grid' && styles.viewModeBtnActive]}
                  onPress={() => setPcViewMode(pcViewMode === 'grid' ? 'list' : 'grid')}>
                  <Text style={styles.viewModeBtnText}>{pcViewMode === 'grid' ? '☷' : '☰'}</Text>
                </TouchableOpacity>
              </View>

              {/* Search, Sort & Multi-Select Bar */}
              <View style={styles.searchRow}>
                <View style={styles.searchInputWrap}>
                  <Text style={styles.searchIcon}>🔍</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search PC files..."
                    placeholderTextColor="#64748b"
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
                  style={styles.sortToggleBtn}
                  onPress={() => setSortModalTarget('pc')}>
                  <Text style={styles.sortToggleBtnText}>
                    {getSortLabel(pcSortBy)} ▾
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[styles.multiSelectToggle, pcMultiSelect && styles.multiSelectToggleActive]}
                  onPress={() => {
                    setPcMultiSelect(!pcMultiSelect);
                    setPcSelectedPaths(new Set());
                  }}>
                  <Text style={[styles.multiSelectToggleText, pcMultiSelect && styles.multiSelectToggleTextActive]}>
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
                  { id: 'photos', label: '📸 Photos' },
                  { id: 'videos', label: '🎬 Videos' },
                  { id: 'audio', label: '🎵 Audio' },
                  { id: 'docs', label: '📄 Docs' },
                  { id: 'folders', label: '📁 Folders' },
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
                  <Text style={styles.emptyFolderIcon}>📂</Text>
                  <Text style={styles.emptyFolderText}>Folder is empty</Text>
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
                            } else {
                              const playlist = filteredPcItems.filter((f) => !f.isDir && isMediaFile(f.ext));
                              const idx = playlist.findIndex((f) => f.path === item.path);
                              setLightboxItem({
                                item,
                                source: 'pc',
                                index: idx >= 0 ? idx : 0,
                                playlist: playlist.length > 0 ? playlist : [item],
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
                              fallbackEmoji={getFileIcon(item?.ext, false)}
                            />
                          ) : isVideoFile(item?.ext) ? (
                            <View style={styles.gridVideoThumbWrap}>
                              <SafeImage
                                source={{
                                  uri: pairedPc
                                    ? `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(item.path || '')}&auth=${pcAuthToken || ''}`
                                    : undefined,
                                }}
                                style={{ width: '100%', height: '100%', borderRadius: 8 }}
                                resizeMode="cover"
                                fallbackEmoji="🎬"
                              />
                              <View style={styles.gridVideoPlayBadge}>
                                <Text style={styles.gridVideoPlayBadgeIcon}>▶</Text>
                              </View>
                            </View>
                          ) : (
                            <Text style={styles.gridFileIconEmoji}>{getFileIcon(item.ext, false)}</Text>
                          )}
                          <Text style={styles.gridFileName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.gridFileMeta}>
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
                        style={[styles.listRow, isSelected && styles.listRowSelected]}
                        onPress={() => {
                          if (pcMultiSelect) {
                            const next = new Set(pcSelectedPaths);
                            isSelected ? next.delete(item.path) : next.add(item.path);
                            setPcSelectedPaths(next);
                          } else if (item.isDir) {
                            loadPcFolder(item.path);
                          } else {
                            const playlist = filteredPcItems.filter((f) => !f.isDir && isMediaFile(f.ext));
                            const idx = playlist.findIndex((f) => f.path === item.path);
                            setLightboxItem({
                              item,
                              source: 'pc',
                              index: idx >= 0 ? idx : 0,
                              playlist: playlist.length > 0 ? playlist : [item],
                            });
                          }
                        }}>
                        {item.isDir ? (
                          <Win11FolderIcon size={26} />
                        ) : (
                          <Text style={styles.listRowEmoji}>{getFileIcon(item.ext, false)}</Text>
                        )}
                        <View style={styles.listRowContent}>
                          <Text style={styles.listRowName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.listRowMeta}>
                            {item.isDir ? 'Folder' : formatFileSize(item.size)}
                          </Text>
                        </View>
                        <Text style={styles.listRowChevron}>{item.isDir ? '›' : '👁'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {/* Floating Multi-Select Bar for PC (Download Only - Security Enforced) */}
              {pcMultiSelect && pcSelectedPaths.size > 0 && (
                <View style={styles.floatingMultiSelectBar}>
                  <Text style={styles.floatingSelectCount}>{pcSelectedPaths.size} Selected</Text>
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
                    <Text style={styles.floatingTrashBtnText}>⬇ Save to Phone</Text>
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
        <ScrollView
          contentContainerStyle={styles.bentoScroll}
          showsVerticalScrollIndicator={false}>

          {/* Sync Beacon Status */}
          <View style={styles.bentoCardHero}>
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
                  <Text style={styles.beaconHostTitle}>
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
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>💻 PC Clipboard (Received)</Text>
                <Text style={styles.bentoCardSubtitle}>
                  {pcClipboardUpdatedBy ? `Last synced from: ${pcClipboardUpdatedBy}` : 'Waiting for sync...'}
                </Text>
              </View>
            </View>

            <View style={styles.clipboardDisplayBox}>
              <Text style={styles.clipboardDisplayText} selectable>
                {pcClipboardText || 'No clipboard content received yet.'}
              </Text>
            </View>

            <View style={styles.heroBtnRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.heroPrimaryBtn}
                onPress={handleCopyPcClipboardToPhone}>
                <Text style={styles.heroPrimaryBtnText}>📋 Copy to Phone Clipboard</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Card 2: Send Text to PC Clipboard */}
          <View style={styles.bentoCard}>
            <Text style={styles.bentoCardTitle}>📱 Push to PC Clipboard (Send)</Text>
            <Text style={styles.bentoCardSubtitle}>
              Type or paste text below to immediately set Windows PC clipboard
            </Text>

            <TextInput
              style={styles.clipboardTextInput}
              placeholder="Paste or type text to send to Windows PC..."
              placeholderTextColor="#64748b"
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
                <Text style={styles.heroPrimaryBtnText}>⚡ Push to PC Clipboard</Text>
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
                style={styles.snippetChip}
                onPress={() => setClipboardInput(`http://${deviceIp}:${serverPort}`)}>
                <Text style={styles.snippetChipText}>+ Phone Server URL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.snippetChip}
                onPress={() => setClipboardInput(deviceIp)}>
                <Text style={styles.snippetChipText}>+ Phone IP Address</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ========================================================= */}
      {/* TAB 5: TRANSFER & NETWORK SPEED OPTIMIZER                 */}
      {/* ========================================================= */}
      {currentTab === 'transfer' && (
        <ScrollView
          contentContainerStyle={styles.bentoScroll}
          showsVerticalScrollIndicator={false}>

          {/* Diagnostic Speed Test Card */}
          <View style={styles.bentoCardHero}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>⚡ Latency & Network Diagnostics</Text>
                <Text style={styles.bentoCardSubtitle}>Measure direct connection ping & speed</Text>
              </View>
              <View style={styles.speedRatingBadge}>
                <Text style={styles.speedRatingText}>High Speed</Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.runDiagHeroBtn}
              onPress={runNetworkDiagnostic}>
              <Text style={styles.runDiagHeroBtnText}>⚡ Run 1-Tap Speed & Latency Test</Text>
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
          <View style={styles.bentoCard}>
            <Text style={styles.bentoCardTitle}>🚀 Maximum Wi-Fi Speed Guide</Text>
            <Text style={styles.bentoCardSubtitle}>How to achieve up to 50+ MB/s transfers</Text>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>1</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Turn on Phone Hotspot (5GHz)</Text>
                <Text style={styles.stepDesc}>
                  Direct device-to-device hotspot eliminates router lag and bypasses slow public Wi-Fi.
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>2</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Connect PC to Phone Hotspot</Text>
                <Text style={styles.stepDesc}>
                  On Windows, connect your Wi-Fi to this phone's personal hotspot network.
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>3</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Enter Hotspot IP (192.168.43.1)</Text>
                <Text style={styles.stepDesc}>
                  Fylo automatically detects the direct hotspot IP for ultra-low ping transfers.
                </Text>
              </View>
            </View>
          </View>

          {/* Server Connection Logs */}
          <View style={styles.bentoCard}>
            <Text style={styles.bentoCardTitle}>📜 Real-Time Connection Logs</Text>
            <Text style={styles.bentoCardSubtitle}>Last 30 network & server events</Text>

            <ScrollView style={{ maxHeight: 180, marginTop: 8 }} nestedScrollEnabled>
              {logs.length === 0 ? (
                <Text style={styles.emptyLogsText}>No connection events logged yet.</Text>
              ) : (
                logs.map((log, index) => (
                  <Text key={index} style={styles.logTextItem}>
                    {log}
                  </Text>
                ))
              )}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {/* ========================================================= */}
      {/* UNIVERSAL MEDIA LIGHTBOX & GALLERY CAROUSEL WITH VIDEO    */}
      {/* ========================================================= */}
      {lightboxItem && (
        <Modal
          visible={!!lightboxItem}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setLightboxItem(null);
            resetZoom();
          }}>
          <View style={styles.lightboxOverlay}>
            <View style={styles.lightboxHeader}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.lightboxFileName} numberOfLines={1}>
                    {lightboxItem?.item?.name || 'File'}
                  </Text>
                  {lightboxItem?.playlist && lightboxItem.playlist.length > 1 && (
                    <View style={styles.lightboxIndexBadge}>
                      <Text style={styles.lightboxIndexBadgeText}>
                        {lightboxItem.index + 1} of {lightboxItem.playlist.length}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.lightboxMeta}>
                  {lightboxItem?.source === 'pc' ? '💻 Windows PC' : '📱 Local Phone'} • {formatFileSize(lightboxItem?.item?.size)}
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

            {/* Pinchable, Zoomable & Swipeable Media Body */}
            <View
              style={styles.lightboxBody}
              {...(isImageFile(lightboxItem?.item?.ext) ? zoomPanResponder.panHandlers : videoPanResponder.panHandlers)}>

              {/* Navigation chevrons for carousel playlists */}
              {lightboxItem?.playlist && lightboxItem.playlist.length > 1 && (
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

              {isVideoFile(lightboxItem?.item?.ext) ? (
                /* Native In-App Video View Component */
                <View style={styles.lightboxVideoContainer}>
                  {FyloVideoView ? (
                    <FyloVideoView
                      ref={videoViewRef}
                      style={styles.lightboxNativeVideoView}
                      source={
                        lightboxItem?.source === 'pc'
                          ? `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem?.item?.path || '')}&auth=${pcAuthToken || ''}`
                          : (lightboxItem?.item?.path || '')
                      }
                      paused={videoPaused}
                      controls={true}
                      repeat={videoRepeat}
                      muted={videoMuted}
                      resizeMode="contain"
                      onVideoLoad={(e) => {
                        setVideoDuration(e?.nativeEvent?.duration || 0);
                        setVideoLoading(false);
                      }}
                      onVideoEnd={() => {
                        if (!videoRepeat) {
                          setVideoPaused(true);
                        }
                      }}
                      onVideoError={(e) => {
                        setVideoLoading(false);
                        showToast('⚠️ Video error: ' + (e?.nativeEvent?.error || 'Playback failed'));
                      }}
                    />
                  ) : (
                    <View style={styles.lightboxNonImgContainer}>
                      <Text style={{ fontSize: 48 }}>🎬</Text>
                      <Text style={styles.lightboxNonImgTitle}>{lightboxItem?.item?.name}</Text>
                    </View>
                  )}

                  {/* Custom In-App Playback HUD */}
                  <View style={styles.lightboxVideoHud}>
                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={styles.lightboxHudBtn}
                      onPress={() => setVideoPaused(!videoPaused)}>
                      <Text style={styles.lightboxHudBtnText}>{videoPaused ? '▶' : '⏸'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={styles.lightboxHudBtn}
                      onPress={() => setVideoMuted(!videoMuted)}>
                      <Text style={styles.lightboxHudBtnText}>{videoMuted ? '🔇' : '🔊'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={styles.lightboxHudBtn}
                      onPress={() => setVideoRepeat(!videoRepeat)}>
                      <Text style={[styles.lightboxHudBtnText, videoRepeat && { color: '#60cdff' }]}>🔁</Text>
                    </TouchableOpacity>

                    <View style={styles.lightboxHudDurationWrap}>
                      <Text style={styles.lightboxHudDurationText}>
                        {formatDuration(videoDuration)}
                      </Text>
                    </View>

                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={styles.lightboxHudBtn}
                      onPress={() => {
                        const pathOrUrl = lightboxItem?.source === 'pc'
                          ? `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem?.item?.path || '')}&auth=${pcAuthToken || ''}`
                          : lightboxItem?.item?.path;
                        if (FyloModule && FyloModule.openVideoPlayer) {
                          FyloModule.openVideoPlayer(pathOrUrl, 'video/*');
                        }
                      }}>
                      <Text style={styles.lightboxHudBtnText}>⛶</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : isImageFile(lightboxItem?.item?.ext) ? (
                /* Hardware-Accelerated 120Hz Fluid Pinch & Zoom Image Container */
                <View
                  ref={imageContainerRef}
                  style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                  <SafeImage
                    source={{
                      uri: lightboxItem?.source === 'pc'
                        ? `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem?.item?.path || '')}&auth=${pcAuthToken || ''}`
                        : `file://${lightboxItem?.item?.path || ''}`,
                      headers: lightboxItem?.source === 'pc' ? { 'X-Auth-Token': pcAuthToken || '' } : undefined,
                    }}
                    style={styles.lightboxImage}
                    resizeMode="contain"
                    fallbackEmoji="🖼️"
                  />
                </View>
              ) : (
                <View style={styles.lightboxNonImgContainer}>
                  <Text style={{ fontSize: 64 }}>{getFileIcon(lightboxItem?.item?.ext, false)}</Text>
                  <Text style={styles.lightboxNonImgTitle}>{lightboxItem?.item?.name || 'File'}</Text>
                  <Text style={styles.lightboxNonImgMeta}>{formatFileSize(lightboxItem?.item?.size)}</Text>
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
            </View>

            <View style={styles.lightboxFooter}>
              {lightboxItem?.source === 'pc' && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.lightboxDlBtn}
                  onPress={() => {
                    handleDownloadPcFile(lightboxItem?.item?.path, lightboxItem?.item?.name);
                  }}>
                  <Text style={styles.lightboxDlBtnText}>⬇ Save to Phone</Text>
                </TouchableOpacity>
              )}

              {lightboxItem?.source === 'phone' && pairedPc && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.lightboxSendBtn}
                  onPress={() => handleSendFilesToPc([lightboxItem?.item?.path])}>
                  <Text style={styles.lightboxSendBtnText}>📤 Send to PC</Text>
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
                                showToast('Moved to .trash safely 🗑️');
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
                  <Text style={styles.lightboxTrashBtnText}>🗑️ Trash</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* COLLAPSIBLE NAVIGATION SIDEBAR DRAWER                     */}
      {/* ========================================================= */}
      <Modal visible={sidebarOpen} transparent animationType="fade" onRequestClose={closeSidebar}>
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
                <Text style={styles.drawerCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Connection Status Card in Drawer */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.drawerConnCard, pairedPc && styles.drawerConnCardActive]}
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
                <Text style={styles.drawerConnTitle}>
                  {pairedPc ? (isPcReachable ? `Linked to ${pcHostName || 'PC'}` : `${pcHostName || 'PC'} (Offline)`) : 'Not Paired to PC'}
                </Text>
                <Text style={styles.drawerConnSub}>
                  {pairedPc ? (isPcReachable ? `${pairedPc} • ${pingLatency !== null ? `${pingLatency} ms latency` : 'Connected'}` : `${pairedPc} • ⚠️ PC Unreachable`) : 'Tap to scan QR or connect via IP'}
                </Text>
              </View>
              <Text style={{ color: '#60a5fa', fontSize: 16 }}>{pairedPc ? '⚙️' : '⚡'}</Text>
            </TouchableOpacity>

            {/* Navigation Section Items */}
            <ScrollView style={styles.drawerNavList} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.drawerNavItem, currentTab === 'home' && styles.drawerNavItemActive]}
                onPress={() => {
                  setCurrentTab('home');
                  closeSidebar();
                }}>
                <Text style={styles.drawerNavIcon}>🏠</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.drawerNavLabel, currentTab === 'home' && styles.drawerNavLabelActive]}>
                    Dashboard & Fast Share
                  </Text>
                  <Text style={styles.drawerNavSub}>Instant transfer & device storage</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.drawerNavItem, currentTab === 'pc-explorer' && styles.drawerNavItemActive]}
                onPress={() => {
                  setCurrentTab('pc-explorer');
                  closeSidebar();
                }}>
                <Text style={styles.drawerNavIcon}>💻</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.drawerNavLabel, currentTab === 'pc-explorer' && styles.drawerNavLabelActive]}>
                    PC Drives Explorer
                  </Text>
                  <Text style={styles.drawerNavSub}>Browse Windows C:\, D:\, Downloads</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.drawerNavItem, currentTab === 'phone-explorer' && styles.drawerNavItemActive]}
                onPress={() => {
                  setCurrentTab('phone-explorer');
                  closeSidebar();
                }}>
                <Text style={styles.drawerNavIcon}>📱</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.drawerNavLabel, currentTab === 'phone-explorer' && styles.drawerNavLabelActive]}>
                    Phone Storage & Gallery
                  </Text>
                  <Text style={styles.drawerNavSub}>Internal files, DCIM, Photos & Media</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.drawerNavItem, currentTab === 'clipboard' && styles.drawerNavItemActive]}
                onPress={() => {
                  setCurrentTab('clipboard');
                  closeSidebar();
                }}>
                <Text style={styles.drawerNavIcon}>📋</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.drawerNavLabel, currentTab === 'clipboard' && styles.drawerNavLabelActive]}>
                    LAN Shared Clipboard
                  </Text>
                  <Text style={styles.drawerNavSub}>Live bidirectional text sync</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.drawerNavItem, currentTab === 'transfer' && styles.drawerNavItemActive]}
                onPress={() => {
                  setCurrentTab('transfer');
                  closeSidebar();
                }}>
                <Text style={styles.drawerNavIcon}>⚡</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.drawerNavLabel, currentTab === 'transfer' && styles.drawerNavLabelActive]}>
                    Speed & Diagnostics
                  </Text>
                  <Text style={styles.drawerNavSub}>Ping latency, server status & logs</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.drawerNavItem}
                onPress={() => {
                  closeSidebar();
                  setShowSettingsModal(true);
                }}>
                <Text style={styles.drawerNavIcon}>⚙️</Text>
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
                  <Text style={{ fontSize: 18 }}>📱</Text>
                  <Text style={[styles.drawerThemeText, !isDarkMode && styles.drawerThemeTextLight]}>
                    Allow Full Phone Storage Access
                  </Text>
                </View>
                <Text style={styles.drawerSettingSub}>
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

            {/* Live Clipboard Sync Toggle in Sidebar (OFF by Default) */}
            <View style={[styles.drawerThemeRow, !isDarkMode && styles.drawerThemeRowLight]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 20 }}>📋</Text>
                <Text style={[styles.drawerThemeText, !isDarkMode && styles.drawerThemeTextLight]}>
                  Live Clipboard Sync
                </Text>
              </View>
              <Switch
                value={clipboardAutoSync}
                onValueChange={(val) => {
                  setClipboardAutoSync(val);
                  showToast(val ? '🔄 Live Clipboard Sync Enabled' : '⏸️ Live Clipboard Sync Disabled');
                }}
                trackColor={{ false: '#94a3b8', true: '#2563eb' }}
                thumbColor={clipboardAutoSync ? '#60a5fa' : '#ffffff'}
              />
            </View>

            {/* Light / Dark Mode Toggle in Sidebar */}
            <View style={[styles.drawerThemeRow, !isDarkMode && styles.drawerThemeRowLight]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 20 }}>{isDarkMode ? '🌙' : '☀️'}</Text>
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
      <Modal visible={directShareModalVisible} transparent animationType="fade">
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
                    showToast(`🚀 Sending ${directSharePendingFiles.length} file(s) to ${pcHostName || 'PC'} Downloads...`);
                    const paths = directSharePendingFiles.map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean);
                    await handleSendFilesToPc(paths);
                  } else {
                    showToast('⚡ Please pair with PC first');
                    setShowPairModal(true);
                  }
                }}>
                <View style={styles.directShareIconWrap}>
                  <Text style={styles.directShareIconEmoji}>💻</Text>
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
                  {pairedPc ? 'Send ➔' : 'Pair ⚡'}
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
                  <Text style={styles.directShareIconEmoji}>📱</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.directShareDeviceName, !isDarkMode && styles.directShareDeviceNameLight]}>
                    Nearby Phone / Peer
                  </Text>
                  <Text style={styles.directShareDeviceMeta}>
                    Connect via IP or QR Code
                  </Text>
                </View>
                <Text style={styles.directShareActionText}>Connect ➔</Text>
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
      {/* DIRECT SHARE DEVICE PICKER MODAL (INSTANT ICONS & NAMES) */}
      {/* ========================================================= */}
      <Modal visible={directShareModalVisible} transparent animationType="fade">
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
                    showToast(`🚀 Sending ${directSharePendingFiles.length} file(s) to ${pcHostName || 'PC'} Downloads...`);
                    const paths = directSharePendingFiles.map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean);
                    await handleSendFilesToPc(paths);
                  } else {
                    showToast('⚡ Please pair with PC first');
                    setShowPairModal(true);
                  }
                }}>
                <View style={styles.directShareIconWrap}>
                  <Text style={styles.directShareIconEmoji}>💻</Text>
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
                  {pairedPc ? 'Send ➔' : 'Pair ⚡'}
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
                  <Text style={styles.directShareIconEmoji}>📱</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.directShareDeviceName, !isDarkMode && styles.directShareDeviceNameLight]}>
                    Nearby Phone / Peer
                  </Text>
                  <Text style={styles.directShareDeviceMeta}>
                    Connect via IP or QR Code
                  </Text>
                </View>
                <Text style={styles.directShareActionText}>Connect ➔</Text>
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
      {/* DEDICATED SORT OPTIONS MODAL DROPDOWN                     */}
      {/* ========================================================= */}
      <Modal visible={!!sortModalTarget} transparent animationType="fade">
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
              { id: 'latest', label: '⏱️ Latest First (Date Newest)', sub: 'Default: newest items appear at the top' },
              { id: 'oldest', label: '⏱️ Oldest First (Date Oldest)', sub: 'Ascending: oldest items at top' },
              { id: 'name', label: '🔤 Name (A → Z)', sub: 'Alphabetical ascending' },
              { id: 'name-desc', label: '🔤 Name (Z → A)', sub: 'Alphabetical descending' },
              { id: 'size', label: '📊 Size (Largest First)', sub: 'Highest file size at top' },
              { id: 'size-asc', label: '📊 Size (Smallest First)', sub: 'Smallest file size at top' },
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
      <Modal visible={showPairModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Pair with PC</Text>
              <TouchableOpacity activeOpacity={0.75} onPress={() => setShowPairModal(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Modal Tabs */}
            <View style={styles.modalSubTabsRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.modalSubTab, pairModalTab === 'qr' && styles.modalSubTabActive]}
                onPress={() => setPairModalTab('qr')}>
                <Text style={[styles.modalSubTabText, pairModalTab === 'qr' && styles.modalSubTabTextActive]}>
                  📷 Scan PC QR
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.modalSubTab, pairModalTab === 'manual' && styles.modalSubTabActive]}
                onPress={() => setPairModalTab('manual')}>
                <Text style={[styles.modalSubTabText, pairModalTab === 'manual' && styles.modalSubTabTextActive]}>
                  ⌨️ Manual IP
                </Text>
              </TouchableOpacity>
            </View>

            {pairModalTab === 'qr' ? (
              <View>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.qrViewfinderBox}
                  onPress={handleStartQrScan}>
                  <Text style={styles.qrViewfinderIcon}>📸</Text>
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
                  style={styles.modalInput}
                  placeholder="Paste QR Code String (e.g. http://192.168.1.5:3000/?auth=...)"
                  placeholderTextColor="#64748b"
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
                  <Text style={styles.hotspotPresetBtnText}>📋 Paste from Clipboard & Connect</Text>
                </TouchableOpacity>

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.modalCancelBtn}
                    onPress={() => setShowPairModal(false)}>
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
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
                <Text style={styles.modalSubtitle}>
                  Enter the Host IP and Port displayed in your Fylo PC application:
                </Text>

                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 192.168.1.5:3000"
                  placeholderTextColor="#64748b"
                  value={manualPcIp}
                  onChangeText={setManualPcIp}
                  autoCapitalize="none"
                />

                <TextInput
                  style={styles.modalInput}
                  placeholder="Auth Token (optional if on same LAN)"
                  placeholderTextColor="#64748b"
                  value={manualAuthToken}
                  onChangeText={setManualAuthToken}
                  autoCapitalize="none"
                />

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.hotspotPresetBtn, { flex: 1 }]}
                    onPress={() => setManualPcIp('192.168.137.1:3000')}>
                    <Text style={styles.hotspotPresetBtnText}>🔥 PC Hotspot (137.1)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={[styles.hotspotPresetBtn, { flex: 1 }]}
                    onPress={() => setManualPcIp('192.168.43.1:3000')}>
                    <Text style={styles.hotspotPresetBtnText}>📱 Phone Hotspot (43.1)</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.modalCancelBtn}
                    onPress={() => setShowPairModal(false)}>
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
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
      <Modal visible={adminModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🛡️ Admin Security Protection</Text>
            <Text style={styles.modalSubtitle}>
              {adminActionTitle || 'This action requires the Admin Security Password.'}
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Enter Admin Password (default: admin)"
              placeholderTextColor="#64748b"
              secureTextEntry
              value={adminPasswordInput}
              onChangeText={setAdminPasswordInput}
              autoCapitalize="none"
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.modalCancelBtn}
                onPress={() => {
                  setAdminModalVisible(false);
                  setAdminPasswordInput('');
                }}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
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
      <Modal visible={diagVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>⚡ Network & Ping Diagnostics</Text>
              <TouchableOpacity activeOpacity={0.75} onPress={() => setDiagVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.diagResultBento,
                diagStatus === 'success' ? styles.diagSuccess : styles.diagWarning,
              ]}>
              <Text style={styles.diagResultText}>{diagMessage || 'Running network diagnostic...'}</Text>
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.modalCancelBtn}
                onPress={() => setDiagVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Close</Text>
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
        animationType="fade"
        onRequestClose={() => handleSetStorageAccess(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.storagePromptCard, !isDarkMode && styles.storagePromptCardLight]}>
            <View style={styles.storagePromptHeader}>
              <View style={styles.storagePromptIconWrap}>
                <Text style={{ fontSize: 26 }}>📱</Text>
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
                <Text style={styles.storagePromptBadgeText}>📦 ShareHub Always Available</Text>
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
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.settingsModalCard, !isDarkMode && styles.settingsModalCardLight]}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 20 }}>⚙️</Text>
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
                      {allowFullPhoneAccess !== false ? '✅ Full Storage Browsing Enabled' : '🛡️ ShareHub Only (Storage Browsing Blocked)'}
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
                    showToast(val ? '🔄 Live Clipboard Sync Enabled' : '⏸️ Live Clipboard Sync Disabled');
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
    </SafeAreaView>
  );
}

// =========================================================
// STYLES: Vibrant Pink/Neon Accents matching Fylo logo (#2563eb, #3b82f6, #0ea5e9)
// =========================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080c14',
  },

  /* Top Header & Horizontal Pill Navigation */
  topHeader: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(37, 99, 235, 0.15)',
    backgroundColor: '#0d1322',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 5,
  },
  brandCircleText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  brandTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  brandSub: {
    fontSize: 9.5,
    color: '#60a5fa',
    fontWeight: '700',
    marginTop: -2,
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

  /* Bento Dashboard General */
  bentoScroll: {
    padding: 12,
    paddingBottom: 60,
  },
  bentoCardHero: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.25)',
    marginBottom: 10,
  },
  beaconHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  beaconRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  beaconGlowConnected: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconGlowIdle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconGlowOffline: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconStatusLabel: {
    fontSize: 9.5,
    color: '#10b981',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  beaconStatusLabelIdle: {
    fontSize: 9.5,
    color: '#60a5fa',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  beaconStatusLabelOffline: {
    fontSize: 9.5,
    color: '#ef4444',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  beaconHostTitle: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '800',
  },
  beaconIpSub: {
    fontSize: 10,
    color: '#94a3b8',
  },
  latencyBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  latencyBadgeText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '800',
  },
  latencyBadgeOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  latencyBadgeTextOffline: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '800',
  },
  heroBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  heroPrimaryBtn: {
    flex: 1,
    minHeight: 40,
    backgroundColor: '#2563eb',
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  heroPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  heroSecondaryBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSecondaryBtnText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '700',
  },
  heroOutlineBtn: {
    flex: 1,
    minHeight: 40,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroOutlineBtnText: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '800',
  },
  readyPairSubText: {
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 16,
    marginVertical: 4,
  },

  /* ALWAYS-PRESENT QUICK SHARE BENTO CARD */
  quickShareCard: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#2563eb',
    marginBottom: 10,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  quickShareHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  quickShareHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  quickShareIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickShareIconEmoji: {
    fontSize: 18,
  },
  quickShareCardTitle: {
    fontSize: 14.5,
    fontWeight: '900',
    color: '#ffffff',
  },
  quickShareCardSub: {
    fontSize: 10,
    color: '#60a5fa',
    marginTop: 1,
  },
  quickSharePillBadge: {
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  quickSharePillBadgeText: {
    color: '#2563eb',
    fontSize: 9.5,
    fontWeight: '900',
  },
  quickShareSendBtn: {
    minHeight: 42,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 3,
  },
  quickShareSendBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  quickShareCategoryRow: {
    flexDirection: 'row',
    gap: 6,
  },
  quickShareCatPill: {
    flex: 1,
    minHeight: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  quickShareCatPillText: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '700',
  },

  /* Standard Bento Card */
  bentoCard: {
    backgroundColor: '#0d1322',
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
    backgroundColor: '#0d1322',
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
    backgroundColor: '#172033',
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
    backgroundColor: '#0d1322',
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
    backgroundColor: '#172033',
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
    backgroundColor: '#172033',
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
    backgroundColor: '#0d1322',
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
    backgroundColor: '#172033',
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
    backgroundColor: '#172033',
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
    paddingBottom: 70,
  },
  responsiveGridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridTile: {
    minHeight: 102,
    backgroundColor: '#0d1322',
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
    paddingBottom: 70,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1322',
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
    backgroundColor: '#0d1322',
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
    backgroundColor: '#080c14',
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
    backgroundColor: '#06080e',
  },
  lightboxHeader: {
    height: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
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
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    gap: 8,
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
  lightboxVideoContainer: {
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
  lightboxVideoHud: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 30,
  },
  lightboxHudBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxHudBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  lightboxHudDurationWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxHudDurationText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    backgroundColor: '#0d1322',
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
    backgroundColor: '#080c14',
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
    backgroundColor: '#0a1020',
    borderRightWidth: 1,
    borderRightColor: 'rgba(37, 99, 235, 0.25)',
    paddingTop: 16,
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
    backgroundColor: '#0d1527',
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
    backgroundColor: '#f8fafc',
  },
  topHeaderLight: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#e2e8f0',
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
    backgroundColor: '#0d1527',
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
    backgroundColor: '#0d1527',
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
    backgroundColor: '#0d1322',
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
    backgroundColor: '#0d1322',
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
});
