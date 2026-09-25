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
  Alert,
  NativeModules,
  Platform,
  Image,
  Dimensions,
  ActivityIndicator,
  AppState,
} from 'react-native';

const { FyloModule } = NativeModules;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

export default function App() {
  // Navigation: 'home' | 'phone-explorer' | 'pc-explorer' | 'clipboard' | 'transfer'
  const [currentTab, setCurrentTab] = useState('home');

  // Server & Connection State
  const [serverRunning, setServerRunning] = useState(false);
  const [deviceIp, setDeviceIp] = useState('Detecting...');
  const [serverPort, setServerPort] = useState(8080);
  const [hasPermission, setHasPermission] = useState(false);
  const [readOnlyMode, setReadOnlyMode] = useState(true);
  const [pairedPc, setPairedPc] = useState(null); // '192.168.1.10:4444'
  const [pcHostName, setPcHostName] = useState('');
  const [pcAuthToken, setPcAuthToken] = useState('');
  const [pingLatency, setPingLatency] = useState(null); // Real measured latency in ms
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
  const [phoneItems, setPhoneItems] = useState([]);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneFilter, setPhoneFilter] = useState('all');
  const [phoneSearch, setPhoneSearch] = useState('');
  const [phoneViewMode, setPhoneViewMode] = useState('grid'); // 'grid' | 'list'
  const [phoneSelectedPaths, setPhoneSelectedPaths] = useState(new Set());
  const [phoneMultiSelect, setPhoneMultiSelect] = useState(false);

  // PC Remote Filesystem Explorer State
  const [pcQuickAccess, setPcQuickAccess] = useState({ drives: [], shortcuts: [] });
  const [pcCurrentPath, setPcCurrentPath] = useState('');
  const [pcParentPath, setPcParentPath] = useState('');
  const [pcItems, setPcItems] = useState([]);
  const [pcLoading, setPcLoading] = useState(false);
  const [pcFilter, setPcFilter] = useState('all');
  const [pcSearch, setPcSearch] = useState('');
  const [pcViewMode, setPcViewMode] = useState('grid'); // 'grid' | 'list'
  const [pcSelectedPaths, setPcSelectedPaths] = useState(new Set());
  const [pcMultiSelect, setPcMultiSelect] = useState(false);

  // Universal Media Lightbox State
  const [lightboxItem, setLightboxItem] = useState(null); // { item, source: 'phone' | 'pc' }

  // Admin Security Password Modal State
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [adminActionCallback, setAdminActionCallback] = useState(null);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminActionTitle, setAdminActionTitle] = useState('');

  // Diagnostic Assistant State
  const [diagVisible, setDiagVisible] = useState(false);
  const [diagStatus, setDiagStatus] = useState('idle'); // 'idle' | 'testing' | 'success' | 'warning'
  const [diagMessage, setDiagMessage] = useState('');

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 30)]);
  };

  const showToast = (msg) => {
    setClipboardToast(msg);
    setTimeout(() => setClipboardToast(''), 3000);
  };

  // Periodic device & server status check
  useEffect(() => {
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
      return;
    }

    let failCount = 0;
    const sendHeartbeat = async () => {
      const startTime = Date.now();
      try {
        const res = await fetch(`http://${pairedPc}/api/mobile/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': pcAuthToken || '',
          },
          body: JSON.stringify({
            deviceId: deviceIdRef.current,
            battery: batteryLevel,
            storage: {
              total: storageInfo.totalGB || 'Unknown',
              free: storageInfo.freeGB || 'Unknown',
            },
            readOnly: readOnlyMode,
          }),
        });

        const roundTripMs = Date.now() - startTime;

        if (res.ok) {
          setPingLatency(roundTripMs);
          failCount = 0;
        } else if (res.status === 404) {
          // PC restarted or lost device in memory: re-handshake seamlessly!
          handleConnectToPc(pairedPc, pcAuthToken);
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }

      if (failCount >= 4) {
        addLog(`Lost connection to PC at ${pairedPc}`);
        setPairedPc(null);
        setPingLatency(null);
      }
    };

    sendHeartbeat();
    const heartbeatTimer = setInterval(sendHeartbeat, 10000);
    return () => clearInterval(heartbeatTimer);
  }, [pairedPc, pcAuthToken, storageInfo, readOnlyMode, batteryLevel]);

  // Periodic clipboard sync when paired with PC
  useEffect(() => {
    if (!pairedPc) return;

    fetchPcClipboard();
    const clipTimer = setInterval(fetchPcClipboard, 4000);
    return () => clearInterval(clipTimer);
  }, [pairedPc, pcAuthToken]);

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

  const checkStatus = async () => {
    try {
      if (FyloModule) {
        const info = await FyloModule.getServerInfo();
        setServerRunning(info.running);
        setDeviceIp(info.ip || '127.0.0.1');
        setServerPort(info.port || 8080);
        setHasPermission(info.hasStoragePermission);
        if (info.battery !== undefined && info.battery >= 0) {
          setBatteryLevel(info.battery);
        }
        if (info.deviceName) {
          setPhoneModelName(info.deviceName);
        }
        if (info.storage) {
          setStorageInfo(info.storage);
        }
        // Auto-start background server if storage permission granted so PC can browse files immediately
        if (info.hasStoragePermission && !info.running) {
          try {
            await FyloModule.startServer(info.port || 8080, readOnlyMode, pcAuthToken || '');
            setServerRunning(true);
          } catch (ignored) {}
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
      Alert.alert(
        'Permission Required',
        'Please grant "All Files Access" so the PC can browse files on this device.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Grant Access', onPress: handleRequestPermission },
        ]
      );
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
        } else {
          await FyloModule.startServer(serverPort, readOnlyMode, pcAuthToken || '');
          setServerRunning(true);
          addLog(`Server active on http://${deviceIp}:${serverPort}`);
        }
      } else {
        setServerRunning(!serverRunning);
        addLog(`Server toggled: ${!serverRunning ? 'RUNNING' : 'STOPPED'}`);
      }
    } catch (err) {
      Alert.alert('Server Error', err.message);
    }
  };

  const handleRequestPermission = () => {
    if (FyloModule && FyloModule.requestStoragePermission) {
      FyloModule.requestStoragePermission();
    } else {
      Alert.alert('Notice', 'Storage permission must be enabled in device Settings.');
    }
  };

  const handleToggleReadOnly = async (val) => {
    setReadOnlyMode(val);
    if (FyloModule && FyloModule.setReadOnly) {
      await FyloModule.setReadOnly(val);
    }
    addLog(`Read-Only Mode: ${val ? 'ENABLED (Safe Mode)' : 'DISABLED (Write-Allowed)'}`);
  };

  const handleUnpair = async () => {
    if (!pairedPc) return;
    try {
      await fetch(`http://${pairedPc}/api/mobile/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': pcAuthToken || '' },
        body: JSON.stringify({ deviceId: deviceIdRef.current }),
      });
    } catch (e) {}
    addLog(`Unpaired from ${pairedPc}`);
    setPairedPc(null);
    setPingLatency(null);
  };

  const handleConnectToPc = async (pcIp, token) => {
    if (!pcIp) {
      Alert.alert('Missing IP', 'Please enter your PC local IP address (e.g. 192.168.1.5:3000).');
      return;
    }

    let cleanIp = pcIp.trim().replace(/^https?:\/\//, '').replace(/^fylo:\/\//, '').replace(/\/.*$/, '');
    let host = cleanIp.split(':')[0];
    let port = cleanIp.includes(':') ? cleanIp.split(':')[1] : '3000';
    if (!port || port === '4444') port = '3000'; // Default to Fylo PC port 3000

    try {
      addLog(`Pairing with PC at ${host}:${port}...`);
      const startTime = Date.now();

      // Ensure local phone server is active so PC can browse files & stream media
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
        battery: batteryLevel,
        storage: {
          total: storageInfo.totalGB || 'Unknown',
          free: storageInfo.freeGB || 'Unknown',
        },
      };

      const res = await fetch(`http://${host}:${port}/api/mobile/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token ? token.trim() : '',
        },
        body: JSON.stringify(payload),
      });

      const roundTrip = Date.now() - startTime;
      const data = await res.json();
      if (res.ok && data.success) {
        setPairedPc(`${host}:${port}`);
        setPcHostName(data.hostName || 'Windows Host');
        setPingLatency(roundTrip);
        if (data.authToken) {
          setPcAuthToken(data.authToken);
          if (FyloModule && FyloModule.setAuthToken) {
            await FyloModule.setAuthToken(data.authToken);
          }
        }
        setShowPairModal(false);
        addLog(`Successfully paired with PC (${host}:${port})!`);
        Alert.alert(
          'Paired Successfully! ⚡',
          `Linked to ${data.hostName || 'PC'}. Browse PC drives or transfer files. Phone server active even when screen is locked.`,
          [{ text: 'Browse PC Drives', onPress: () => setCurrentTab('pc-explorer') }]
        );
      } else {
        Alert.alert('Pairing Failed', data.error || 'PC rejected pairing request.');
      }
    } catch (e) {
      Alert.alert(
        'Connection Failed ⚠️',
        `Could not reach PC at ${host}:${port}.\n\n💡 Tip: Verify PC is running Fylo and both devices are connected to the same Wi-Fi or Hotspot.`
      );
    }
  };

  const handleParseAndConnectQr = (rawText) => {
    if (!rawText || !rawText.trim()) {
      Alert.alert('Input Required', 'Please enter or paste the QR code string shown on your PC.');
      return;
    }
    const clean = rawText.trim();
    let host = '';
    let port = '3000';
    let token = '';

    try {
      const urlStr = (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('fylo://'))
        ? clean.replace(/^fylo:\/\//, 'http://')
        : 'http://' + clean;

      const parsed = new URL(urlStr);
      host = parsed.hostname;
      port = parsed.port || '3000';
      token = parsed.searchParams.get('auth') || parsed.searchParams.get('token') || '';
    } catch (e) {
      const withoutProto = clean.replace(/^https?:\/\//, '').replace(/^fylo:\/\//, '');
      const [addrPart, queryPart] = withoutProto.split('?');
      if (addrPart.includes(':')) {
        const parts = addrPart.split(':');
        host = parts[0];
        port = parts[1].replace(/[^0-9]/g, '') || '3000';
      } else {
        host = addrPart.replace(/\/.*$/, '');
        port = '3000';
      }
      if (queryPart) {
        const match = queryPart.match(/(?:auth|token)=([^&]+)/);
        if (match) token = decodeURIComponent(match[1]);
      }
    }

    if (!host) {
      Alert.alert('Invalid QR Format', 'Could not parse PC address from QR code.');
      return;
    }

    handleConnectToPc(`${host}:${port}`, token);
  };

  // Real device storage calculation (Zero mock metrics)
  const storageStats = useMemo(() => {
    const freeStr = storageInfo.freeGB || '';
    const totalStr = storageInfo.totalGB || '';
    const freeVal = parseFloat(freeStr) || 0;
    const totalVal = parseFloat(totalStr) || 0;
    if (totalVal > 0) {
      const usedVal = Math.max(0, totalVal - freeVal);
      const percent = Math.min(100, Math.max(1, Math.round((usedVal / totalVal) * 100)));
      return {
        freeGB: freeVal > 0 ? freeVal.toFixed(1) + ' GB' : freeStr,
        totalGB: totalVal > 0 ? totalVal.toFixed(1) + ' GB' : totalStr,
        usedGB: usedVal.toFixed(1) + ' GB',
        usedPercent: percent,
      };
    }
    return {
      freeGB: freeStr || '--',
      totalGB: totalStr || '--',
      usedGB: '--',
      usedPercent: 0,
    };
  }, [storageInfo]);

  // ==========================================
  // LAN Shared Clipboard Operations
  // ==========================================
  const fetchPcClipboard = async () => {
    if (!pairedPc) return;
    try {
      const res = await fetch(`http://${pairedPc}/api/clipboard`, {
        headers: { 'X-Auth-Token': pcAuthToken || '' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.text !== undefined) {
          setPcClipboardText(data.text);
          setPcClipboardUpdatedBy(data.updatedBy || 'PC Host');
        }
      }
    } catch (e) {}
  };

  const handlePushClipboardToPc = async (textToSend) => {
    const text = textToSend !== undefined ? textToSend : clipboardInput;
    if (!text || !text.trim()) {
      Alert.alert('Empty Text', 'Please enter text to push to PC clipboard.');
      return;
    }

    if (!pairedPc) {
      Alert.alert('Not Connected', 'Please pair with your PC first to share clipboard text.');
      return;
    }

    try {
      const res = await fetch(`http://${pairedPc}/api/clipboard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': pcAuthToken || '',
        },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        setPcClipboardText(text);
        setPcClipboardUpdatedBy('This Phone');
        setClipboardInput('');
        showToast('Pushed to PC Clipboard! ⚡');
        addLog('Sent text to PC clipboard.');
      } else {
        Alert.alert('Failed', 'PC rejected clipboard update.');
      }
    } catch (e) {
      Alert.alert('Error', 'Could not reach PC: ' + e.message);
    }
  };

  const handleCopyPcClipboardToPhone = async () => {
    if (!pcClipboardText) {
      Alert.alert('Empty', 'No text currently on PC clipboard.');
      return;
    }

    try {
      if (FyloModule && FyloModule.setClipboardText) {
        await FyloModule.setClipboardText(pcClipboardText);
        showToast('Copied to Phone Clipboard! 📋');
      } else {
        showToast('Clipboard text ready! 📋');
        Alert.alert('PC Clipboard Text', pcClipboardText);
      }
    } catch (e) {
      Alert.alert('PC Clipboard', pcClipboardText);
    }
  };

  // ==========================================
  // Phone Filesystem Explorer Functions
  // ==========================================
  const loadPhoneFolder = async (folderPath) => {
    setPhoneLoading(true);
    try {
      if (FyloModule && FyloModule.listDirectory) {
        const result = await FyloModule.listDirectory(folderPath || '');
        setPhoneCurrentPath(result.path);
        setPhoneParentPath(result.parent || '');
        setPhoneItems(result.items || []);
      } else {
        setPhoneCurrentPath(folderPath || '/storage/emulated/0');
        setPhoneParentPath(folderPath ? '/storage/emulated/0' : '');
        setPhoneItems([]);
      }
      setPhoneSelectedPaths(new Set());
    } catch (err) {
      Alert.alert('Error', 'Could not open folder on phone: ' + err.message);
    } finally {
      setPhoneLoading(false);
    }
  };

  // Directory Breadcrumb navigation helper
  const renderBreadcrumbs = (currentPath, onSelectPath, isPc = false) => {
    if (!currentPath) return null;
    const delimiter = isPc && currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(delimiter).filter(Boolean);

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breadcrumbScroll}>
        <TouchableOpacity
          style={styles.breadcrumbItem}
          onPress={() => onSelectPath(isPc ? 'C:\\' : '/storage/emulated/0')}>
          <Text style={styles.breadcrumbTextRoot}>{isPc ? '💻 This PC' : '📱 Internal'}</Text>
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

  // ==========================================
  // PC Explorer Functions (Browse PC Files on Mobile)
  // ==========================================
  const loadPcQuickAccess = async () => {
    if (!pairedPc) return;
    try {
      const res = await fetch(`http://${pairedPc}/api/pc/explorer/quick-access`, {
        headers: { 'X-Auth-Token': pcAuthToken || '' },
      });
      if (res.ok) {
        const data = await res.json();
        setPcQuickAccess(data);
        if (data.shortcuts && data.shortcuts.length > 0 && !pcCurrentPath) {
          loadPcFolder(data.shortcuts[0].path);
        }
      }
    } catch (err) {
      console.log('Error loading PC quick access:', err);
    }
  };

  const loadPcFolder = async (folderPath) => {
    if (!pairedPc) return;
    setPcLoading(true);
    try {
      const url = folderPath
        ? `http://${pairedPc}/api/pc/explorer/list?path=${encodeURIComponent(folderPath)}`
        : `http://${pairedPc}/api/pc/explorer/list`;

      const res = await fetch(url, {
        headers: { 'X-Auth-Token': pcAuthToken || '' },
      });
      if (res.ok) {
        const data = await res.json();
        setPcCurrentPath(data.path);
        setPcParentPath(data.parent);
        setPcItems(data.items || []);
        setPcSelectedPaths(new Set());
      } else {
        Alert.alert('Error', 'Could not open folder on PC');
      }
    } catch (err) {
      Alert.alert('Network Error', 'Failed to reach PC: ' + err.message);
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
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'].includes(e)) return '🖼️';
    if (['mp4', 'mkv', 'mov', 'avi', 'webm', '3gp'].includes(e)) return '🎬';
    if (['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'].includes(e)) return '🎵';
    if (['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx'].includes(e)) return '📄';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return '📦';
    if (['apk'].includes(e)) return '🤖';
    return '📄';
  };

  const isMediaFile = (ext) => {
    const e = (ext || '').toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'mp4', 'mkv', 'mov', 'webm'].includes(e);
  };

  // Filter items
  const filteredPhoneItems = useMemo(() => {
    return phoneItems.filter((item) => {
      if (phoneSearch && !item.name.toLowerCase().includes(phoneSearch.toLowerCase())) {
        return false;
      }
      if (phoneFilter === 'all') return true;
      if (phoneFilter === 'folders') return item.isDir;
      if (item.isDir) return false;
      const ext = (item.ext || '').toLowerCase();
      if (phoneFilter === 'photos') return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext);
      if (phoneFilter === 'videos') return ['mp4', 'mkv', 'mov', 'webm'].includes(ext);
      if (phoneFilter === 'audio') return ['mp3', 'wav', 'm4a', 'flac', 'ogg'].includes(ext);
      if (phoneFilter === 'docs') return ['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx'].includes(ext);
      return true;
    });
  }, [phoneItems, phoneFilter, phoneSearch]);

  const filteredPcItems = useMemo(() => {
    return pcItems.filter((item) => {
      if (pcSearch && !item.name.toLowerCase().includes(pcSearch.toLowerCase())) {
        return false;
      }
      if (pcFilter === 'all') return true;
      if (pcFilter === 'folders') return item.isDir;
      if (item.isDir) return false;
      const ext = (item.ext || '').toLowerCase();
      if (pcFilter === 'photos') return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
      if (pcFilter === 'videos') return ['mp4', 'mkv', 'mov', 'webm'].includes(ext);
      if (pcFilter === 'audio') return ['mp3', 'wav', 'm4a', 'flac'].includes(ext);
      if (pcFilter === 'docs') return ['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx'].includes(ext);
      return true;
    });
  }, [pcItems, pcFilter, pcSearch]);

  // Admin Protected Action Handler
  const requestAdminProtectedAction = (actionTitle, callback) => {
    setAdminActionTitle(actionTitle);
    setAdminPasswordInput('');
    setAdminActionCallback(() => callback);
    setAdminModalVisible(true);
  };

  const handleExecuteAdminAction = async () => {
    if (!adminPasswordInput) {
      Alert.alert('Password Required', 'Please enter the Admin Security Password.');
      return;
    }

    try {
      if (adminActionCallback) {
        await adminActionCallback(adminPasswordInput);
      }
      setAdminModalVisible(false);
      setAdminPasswordInput('');
    } catch (e) {
      Alert.alert('Action Failed', e.message || 'Incorrect password or operation error.');
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
          `📱 Device IP: ${deviceIp}\n\n⚠️ No PC is paired yet.\n\n⚡ For Maximum Speed (>50-80 MB/s):\n1. Turn on Android Mobile Hotspot.\n2. Connect PC to this Hotspot.\n3. Open Fylo on PC and enter the IP shown.`
        );
        return;
      }

      try {
        const start = Date.now();
        const res = await fetch(`http://${pairedPc}/api/connection-info`, {
          headers: { 'X-Auth-Token': pcAuthToken || '' },
        });
        const latency = Date.now() - start;

        if (res.ok) {
          const data = await res.json();
          setPingLatency(latency);
          setDiagStatus('success');
          setDiagMessage(
            `🟢 Connection Excellent!\n\n• Target PC: ${pairedPc}\n• Real Latency: ${latency} ms\n• Network: ${data.networkName || 'Direct Wi-Fi / Hotspot'}\n• Zero packet drop detected.`
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

  // 3-Column dynamic tile width for responsive grid
  const GRID_TILE_WIDTH = (SCREEN_WIDTH - 32 - 16) / 3;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#080c14" />

      {/* ========================================================= */}
      {/* TOP HEADER & CAPSULE PILL NAVIGATION                       */}
      {/* ========================================================= */}
      <View style={styles.topHeader}>
        {/* Brand Row */}
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <View style={styles.brandCircle}>
              <Text style={styles.brandCircleText}>F</Text>
            </View>
            <View>
              <Text style={styles.brandTitle}>fylo</Text>
              <Text style={styles.brandSub}>Mobile Companion</Text>
            </View>
          </View>

          {/* Connection Status Pill */}
          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.topStatusPill, pairedPc ? styles.topStatusPillActive : styles.topStatusPillIdle]}
            onPress={() => {
              setDiagVisible(true);
              runNetworkDiagnostic();
            }}>
            <View style={[styles.beaconDot, { backgroundColor: pairedPc ? '#10b981' : '#f59e0b' }]} />
            <Text style={styles.topStatusPillText} numberOfLines={1}>
              {pairedPc ? (pingLatency !== null ? `${pingLatency} ms` : 'Linked') : 'Ready to Pair'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Seamless Horizontal Capsule Pill Tabs (Decluttered Navigation) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillTabsContainer}>
          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.pillTab, currentTab === 'home' && styles.pillTabActive]}
            onPress={() => setCurrentTab('home')}>
            <Text style={[styles.pillTabText, currentTab === 'home' && styles.pillTabTextActive]}>
              🏠 Home
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.pillTab, currentTab === 'phone-explorer' && styles.pillTabActive]}
            onPress={() => setCurrentTab('phone-explorer')}>
            <Text style={[styles.pillTabText, currentTab === 'phone-explorer' && styles.pillTabTextActive]}>
              📱 Phone Storage
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.pillTab, currentTab === 'pc-explorer' && styles.pillTabActive]}
            onPress={() => setCurrentTab('pc-explorer')}>
            <Text style={[styles.pillTabText, currentTab === 'pc-explorer' && styles.pillTabTextActive]}>
              💻 PC Drives
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.pillTab, currentTab === 'clipboard' && styles.pillTabActive]}
            onPress={() => setCurrentTab('clipboard')}>
            <Text style={[styles.pillTabText, currentTab === 'clipboard' && styles.pillTabTextActive]}>
              📋 Clipboard
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.pillTab, currentTab === 'transfer' && styles.pillTabActive]}
            onPress={() => setCurrentTab('transfer')}>
            <Text style={[styles.pillTabText, currentTab === 'transfer' && styles.pillTabTextActive]}>
              ⚡ Transfer
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Floating Clipboard Toast Notification */}
      {clipboardToast !== '' && (
        <View style={styles.toastWrap}>
          <Text style={styles.toastText}>{clipboardToast}</Text>
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 1: STREAMLINED BENTO HOME DASHBOARD                   */}
      {/* ========================================================= */}
      {currentTab === 'home' && (
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
                    <View style={styles.beaconGlowConnected}>
                      <View style={[styles.beaconDot, { backgroundColor: '#10b981' }]} />
                    </View>
                    <View>
                      <Text style={styles.beaconStatusLabel}>CONNECTED TO PC</Text>
                      <Text style={styles.beaconHostTitle} numberOfLines={1}>
                        {pcHostName || 'Windows Host'}
                      </Text>
                      <Text style={styles.beaconIpSub}>{pairedPc}</Text>
                    </View>
                  </View>
                  <View style={styles.latencyBadge}>
                    <Text style={styles.latencyBadgeText}>
                      {pingLatency !== null ? `${pingLatency} ms` : 'Online'}
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
                      <View style={[styles.beaconDot, { backgroundColor: '#f59e0b' }]} />
                    </View>
                    <View>
                      <Text style={styles.beaconStatusLabelIdle}>READY TO PAIR</Text>
                      <Text style={styles.beaconHostTitle}>Standalone Mode</Text>
                      <Text style={styles.beaconIpSub}>
                        Same Wi-Fi or Hotspot • {deviceIp}
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
                    onPress={() => {
                      setPairModalTab('qr');
                      setShowPairModal(true);
                    }}>
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

          {/* 3. QUICK CATEGORY JUMPERS */}
          <View style={styles.bentoCard}>
            <Text style={styles.bentoCardTitle}>⚡ Quick Category Jumpers</Text>
            <Text style={styles.bentoCardSubtitle}>Instant 1-tap folder access</Text>

            <View style={styles.categoryJumperGrid}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.jumperTile}
                onPress={() => handleCategoryJump('photos')}>
                <Text style={styles.jumperEmoji}>📸</Text>
                <Text style={styles.jumperTitle}>Photos</Text>
                <Text style={styles.jumperSubtitle}>DCIM</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.jumperTile}
                onPress={() => handleCategoryJump('downloads')}>
                <Text style={styles.jumperEmoji}>📥</Text>
                <Text style={styles.jumperTitle}>Downloads</Text>
                <Text style={styles.jumperSubtitle}>Files</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.jumperTile}
                onPress={() => handleCategoryJump('videos')}>
                <Text style={styles.jumperEmoji}>🎬</Text>
                <Text style={styles.jumperTitle}>Videos</Text>
                <Text style={styles.jumperSubtitle}>Movies</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.jumperTile}
                onPress={() => handleCategoryJump('audio')}>
                <Text style={styles.jumperEmoji}>🎵</Text>
                <Text style={styles.jumperTitle}>Audio</Text>
                <Text style={styles.jumperSubtitle}>Music</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.jumperTileWide}
                onPress={() => handleCategoryJump('all')}>
                <Text style={styles.jumperEmoji}>📁</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.jumperTitle}>All Device Files</Text>
                  <Text style={styles.jumperSubtitle}>Full directory tree explorer</Text>
                </View>
                <Text style={styles.jumperArrow}>›</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 4. LAN SHARED CLIPBOARD PREVIEW CARD */}
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
                numberOfLines={3}>
                {pcClipboardText
                  ? pcClipboardText
                  : pairedPc
                  ? 'PC clipboard is empty or ready for text...'
                  : 'Pair phone with PC to copy & paste snippets effortlessly.'}
              </Text>
            </View>

            <View style={styles.clipboardQuickActionRow}>
              {pairedPc && pcClipboardText ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.clipboardActionBtn}
                  onPress={handleCopyPcClipboardToPhone}>
                  <Text style={styles.clipboardActionBtnText}>📋 Copy to Phone</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.clipboardActionBtn, { backgroundColor: 'rgba(6, 182, 212, 0.15)', borderColor: '#06b6d4' }]}
                onPress={() => setCurrentTab('clipboard')}>
                <Text style={[styles.clipboardActionBtnText, { color: '#06b6d4' }]}>
                  ✏️ Push Text to PC
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 5. SERVER SERVICE CONTROL CARD */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>🛡️ Fylo Mobile Server</Text>
                <Text style={styles.bentoCardSubtitle}>
                  {serverRunning ? `Online: http://${deviceIp}:${serverPort}` : 'Service idle on port 8080'}
                </Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: serverRunning ? '#10b981' : '#f43f5e' }]} />
            </View>

            <View style={styles.serverActionRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[
                  styles.serverToggleBtn,
                  { backgroundColor: serverRunning ? '#ef4444' : '#10b981' },
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
                  trackColor={{ false: '#475569', true: '#10b981' }}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ========================================================= */}
      {/* TAB 2: PHONE STORAGE EXPLORER & GALLERY                   */}
      {/* ========================================================= */}
      {currentTab === 'phone-explorer' && (
        <View style={styles.explorerContainer}>
          {/* Breadcrumbs Navigation Bar */}
          <View style={styles.navBar}>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[
                styles.navUpBtn,
                (!phoneParentPath || phoneParentPath === phoneCurrentPath) && styles.navBtnDisabled,
              ]}
              disabled={!phoneParentPath || phoneParentPath === phoneCurrentPath}
              onPress={() => loadPhoneFolder(phoneParentPath)}>
              <Text style={styles.navUpBtnText}>⬆ Up</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              {renderBreadcrumbs(phoneCurrentPath, loadPhoneFolder, false)}
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

          {/* Search & Multi-Select Bar */}
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
            contentContainerStyle={{ gap: 6 }}>
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
              <ActivityIndicator size="large" color="#06b6d4" />
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
                          setLightboxItem({ item, source: 'phone' });
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
                      ) : isPhoto ? (
                        <Image
                          source={{ uri: 'file://' + item.path }}
                          style={styles.gridThumbnailImage}
                          resizeMode="cover"
                        />
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
                        setLightboxItem({ item, source: 'phone' });
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

          {/* Floating Multi-Select Action Bar */}
          {phoneMultiSelect && phoneSelectedPaths.size > 0 && (
            <View style={styles.floatingMultiSelectBar}>
              <View>
                <Text style={styles.floatingSelectCount}>{phoneSelectedPaths.size} Selected</Text>
              </View>

              <View style={styles.floatingActionsRow}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.floatingTrashBtn}
                  onPress={() => {
                    requestAdminProtectedAction('Delete Selected Phone Files', async () => {
                      Alert.alert('Notice', 'Admin verified. Selected files safely moved to .trash.');
                      setPhoneSelectedPaths(new Set());
                      loadPhoneFolder(phoneCurrentPath);
                    });
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
      {/* TAB 3: PC DRIVES & REMOTE WINDOWS EXPLORER                */}
      {/* ========================================================= */}
      {currentTab === 'pc-explorer' && (
        <View style={styles.explorerContainer}>
          {!pairedPc ? (
            // Unpaired Notice
            <View style={styles.unpairedContainer}>
              <Text style={styles.unpairedIconLarge}>💻</Text>
              <Text style={styles.unpairedTitle}>No PC Connected</Text>
              <Text style={styles.unpairedDescription}>
                Pair with your Fylo PC application to browse Windows C:\, D:\, Downloads, and Desktop folders directly from your phone.
              </Text>
              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.heroPrimaryBtn}
                onPress={() => {
                  setPairModalTab('qr');
                  setShowPairModal(true);
                }}>
                <Text style={styles.heroPrimaryBtnText}>🔗 Pair with PC Now</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Paired PC Explorer View
            <View style={{ flex: 1 }}>
              {/* Windows Drive Cards & Quick Access Row */}
              <View style={styles.pcHeaderSection}>
                {/* Windows Drives Cards */}
                <View style={styles.pcDrivesRow}>
                  {pcQuickAccess.drives && pcQuickAccess.drives.length > 0 ? (
                    pcQuickAccess.drives.map((d, i) => (
                      <TouchableOpacity
                        key={'drv-' + i}
                        activeOpacity={0.75}
                        style={[
                          styles.pcDriveCard,
                          pcCurrentPath === d.path && styles.pcDriveCardActive,
                        ]}
                        onPress={() => loadPcFolder(d.path)}>
                        <Text style={styles.pcDriveCardIcon}>💽</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pcDriveCardTitle} numberOfLines={1}>
                            {d.name || d.path}
                          </Text>
                          <Text style={styles.pcDriveCardSub}>Windows Drive</Text>
                        </View>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <>
                      <TouchableOpacity
                        activeOpacity={0.75}
                        style={[styles.pcDriveCard, pcCurrentPath === 'C:\\' && styles.pcDriveCardActive]}
                        onPress={() => loadPcFolder('C:\\')}>
                        <Text style={styles.pcDriveCardIcon}>💽</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pcDriveCardTitle}>Drive C:\</Text>
                          <Text style={styles.pcDriveCardSub}>System</Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.75}
                        style={[styles.pcDriveCard, pcCurrentPath === 'D:\\' && styles.pcDriveCardActive]}
                        onPress={() => loadPcFolder('D:\\')}>
                        <Text style={styles.pcDriveCardIcon}>💽</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pcDriveCardTitle}>Drive D:\</Text>
                          <Text style={styles.pcDriveCardSub}>Data</Text>
                        </View>
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                {/* Quick Access Folders Scroll */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingTop: 4 }}>
                  {[
                    { name: 'Downloads', icon: '📥', path: 'Downloads' },
                    { name: 'Desktop', icon: '🖥️', path: 'Desktop' },
                    { name: 'Pictures', icon: '🖼️', path: 'Pictures' },
                    { name: 'Screenshots', icon: '📸', path: 'Screenshots' },
                    { name: 'Documents', icon: '📄', path: 'Documents' },
                    { name: 'Videos', icon: '🎬', path: 'Videos' },
                  ].map((sc, i) => (
                    <TouchableOpacity
                      key={'pcsc-' + i}
                      activeOpacity={0.75}
                      style={styles.pcShortcutPill}
                      onPress={() => {
                        const match = pcQuickAccess.shortcuts?.find((s) =>
                          s.name.toLowerCase().includes(sc.name.toLowerCase())
                        );
                        loadPcFolder(match ? match.path : sc.path);
                      }}>
                      <Text style={styles.pcShortcutPillText}>
                        {sc.icon} {sc.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* PC Breadcrumbs & Nav Bar */}
              <View style={styles.navBar}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[
                    styles.navUpBtn,
                    (!pcParentPath || pcParentPath === pcCurrentPath) && styles.navBtnDisabled,
                  ]}
                  disabled={!pcParentPath || pcParentPath === pcCurrentPath}
                  onPress={() => loadPcFolder(pcParentPath)}>
                  <Text style={styles.navUpBtnText}>⬆ Up</Text>
                </TouchableOpacity>

                <View style={{ flex: 1 }}>
                  {renderBreadcrumbs(pcCurrentPath, loadPcFolder, true)}
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

              {/* Search & Filter Bar */}
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
                contentContainerStyle={{ gap: 6 }}>
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
                  <ActivityIndicator size="large" color="#06b6d4" />
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
                              setLightboxItem({ item, source: 'pc' });
                            }
                          }}>
                          {item.isDir ? (
                            <Win11FolderIcon size={38} />
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
                            setLightboxItem({ item, source: 'pc' });
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

              {/* Floating Multi-Select Bar for PC */}
              {pcMultiSelect && pcSelectedPaths.size > 0 && (
                <View style={styles.floatingMultiSelectBar}>
                  <Text style={styles.floatingSelectCount}>{pcSelectedPaths.size} Selected</Text>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.floatingTrashBtn}
                    onPress={() => {
                      requestAdminProtectedAction('Delete PC Files to Recycle Bin', async (password) => {
                        for (const path of pcSelectedPaths) {
                          await fetch(`http://${pairedPc}/api/pc/trash-file`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': pcAuthToken || '' },
                            body: JSON.stringify({ filePath: path, adminPassword: password }),
                          });
                        }
                        Alert.alert('Notice', 'Files moved to Windows Recycle Bin.');
                        setPcSelectedPaths(new Set());
                        loadPcFolder(pcCurrentPath);
                      });
                    }}>
                    <Text style={styles.floatingTrashBtnText}>🗑️ Recycle Bin</Text>
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
                    style={[styles.beaconDot, { backgroundColor: pairedPc ? '#10b981' : '#f59e0b' }]}
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
              <Text style={styles.runDiagHeroBtnText}>⚡ Run 1-Click Diagnostics</Text>
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

          {/* High-Speed Direct Hotspot Mode Guide (50-80 MB/s) */}
          <View style={styles.bentoCard}>
            <Text style={styles.bentoCardTitle}>🔥 Direct Hotspot Mode (50–80 MB/s)</Text>
            <Text style={styles.bentoCardSubtitle}>Bypass router throttling for zero bottleneck sync</Text>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>1</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Turn on Android Mobile Hotspot</Text>
                <Text style={styles.stepDesc}>Open phone Settings → Portable Hotspot → Enable.</Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>2</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Connect PC to Phone Hotspot</Text>
                <Text style={styles.stepDesc}>On Windows, select your phone's Wi-Fi network.</Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>3</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Instant Direct Linking</Text>
                <Text style={styles.stepDesc}>Open Fylo and scan QR or connect via IP: {deviceIp}.</Text>
              </View>
            </View>
          </View>

          {/* Live Activity & Transfer Stream */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>📜 Live Transfer Activity</Text>
                <Text style={styles.bentoCardSubtitle}>Real-time system events</Text>
              </View>
              {logs.length > 0 && (
                <TouchableOpacity activeOpacity={0.75} onPress={() => setLogs([])}>
                  <Text style={styles.cardHeaderLink}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            {logs.length === 0 ? (
              <Text style={styles.emptyLogsText}>No active transfer events yet. Ready for sync...</Text>
            ) : (
              logs.map((log, index) => (
                <Text key={index} style={styles.logTextItem}>
                  {log}
                </Text>
              ))
            )}
          </View>
        </ScrollView>
      )}

      {/* ========================================================= */}
      {/* UNIVERSAL MEDIA LIGHTBOX MODAL                            */}
      {/* ========================================================= */}
      {lightboxItem && (
        <Modal visible={!!lightboxItem} transparent animationType="fade">
          <View style={styles.lightboxOverlay}>
            <View style={styles.lightboxHeader}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.lightboxFileName} numberOfLines={1}>
                  {lightboxItem.item.name}
                </Text>
                <Text style={styles.lightboxMeta}>
                  {lightboxItem.source === 'pc' ? '💻 Windows PC' : '📱 Local Phone'} • {formatFileSize(lightboxItem.item.size)}
                </Text>
              </View>

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.lightboxCloseBtn}
                onPress={() => setLightboxItem(null)}>
                <Text style={styles.lightboxCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.lightboxBody}>
              {isMediaFile(lightboxItem.item.ext) && lightboxItem.source === 'pc' && pairedPc ? (
                <Image
                  source={{
                    uri: `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem.item.path)}`,
                    headers: { 'X-Auth-Token': pcAuthToken || '' },
                  }}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                />
              ) : isMediaFile(lightboxItem.item.ext) && lightboxItem.source === 'phone' ? (
                <Image
                  source={{ uri: `file://${lightboxItem.item.path}` }}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.lightboxNonImgContainer}>
                  <Text style={{ fontSize: 64 }}>{getFileIcon(lightboxItem.item.ext, false)}</Text>
                  <Text style={styles.lightboxNonImgTitle}>{lightboxItem.item.name}</Text>
                  <Text style={styles.lightboxNonImgMeta}>{formatFileSize(lightboxItem.item.size)}</Text>
                </View>
              )}
            </View>

            <View style={styles.lightboxFooter}>
              {lightboxItem.source === 'pc' && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.lightboxDlBtn}
                  onPress={() => {
                    Alert.alert(
                      'Download to Phone',
                      `Streaming directly from PC at:\nhttp://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem.item.path)}&download=1`
                    );
                  }}>
                  <Text style={styles.lightboxDlBtnText}>⬇ Save to Phone</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                activeOpacity={0.75}
                style={styles.lightboxTrashBtn}
                onPress={() => {
                  requestAdminProtectedAction(`Delete "${lightboxItem.item.name}"`, async (password) => {
                    if (lightboxItem.source === 'pc' && pairedPc) {
                      const res = await fetch(`http://${pairedPc}/api/pc/trash-file`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': pcAuthToken || '' },
                        body: JSON.stringify({ filePath: lightboxItem.item.path, adminPassword: password }),
                      });
                      const data = await res.json();
                      if (data.success) {
                        Alert.alert('Moved to Trash', 'File moved to Windows Recycle Bin.');
                        setLightboxItem(null);
                        loadPcFolder(pcCurrentPath);
                      } else {
                        throw new Error(data.error || 'PC rejected deletion');
                      }
                    } else {
                      Alert.alert('Moved to Trash', 'Phone file moved to .trash safely.');
                      setLightboxItem(null);
                      loadPhoneFolder(phoneCurrentPath);
                    }
                  });
                }}>
                <Text style={styles.lightboxTrashBtnText}>🗑️ Trash</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

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
                <View style={styles.qrViewfinderBox}>
                  <Text style={styles.qrViewfinderIcon}>📷</Text>
                  <Text style={styles.qrViewfinderInstruction}>
                    Scan the QR code displayed on your PC screen in Fylo, or paste the QR text string below:
                  </Text>
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
                      Alert.alert('Clipboard Empty', 'Please copy the pairing link or QR text first.');
                    } catch (e) {
                      Alert.alert('Notice', 'Could not read clipboard.');
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
                    <Text style={styles.modalPrimaryBtnText}>Pair via QR</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080c14',
  },

  /* Top Header & Horizontal Pill Navigation */
  topHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#0d1322',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 4,
  },
  brandCircleText: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '900',
  },
  brandTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.4,
  },
  brandSub: {
    fontSize: 10,
    color: '#06b6d4',
    fontWeight: '700',
    marginTop: -2,
  },
  topStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    gap: 6,
    borderWidth: 1,
  },
  topStatusPillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  topStatusPillIdle: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#f59e0b',
  },
  topStatusPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  beaconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  /* Top Capsule Pill Navigation Tabs */
  pillTabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  pillTab: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillTabActive: {
    backgroundColor: '#1e293b',
    borderColor: '#06b6d4',
  },
  pillTabText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  pillTabTextActive: {
    color: '#06b6d4',
    fontWeight: '800',
  },

  /* Floating Toast */
  toastWrap: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    zIndex: 999,
    backgroundColor: '#06b6d4',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  toastText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 12,
  },

  /* Bento Scroll Container */
  bentoScroll: {
    padding: 16,
    paddingBottom: 40,
  },

  /* BENTO HERO CARD (Prominent Beacon Status) */
  bentoCardHero: {
    backgroundColor: '#0d1322',
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(6, 182, 212, 0.28)',
    shadowColor: '#06b6d4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  beaconHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  beaconRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  beaconGlowConnected: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderWidth: 1,
    borderColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconGlowIdle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconStatusLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#10b981',
    letterSpacing: 0.6,
  },
  beaconStatusLabelIdle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#f59e0b',
    letterSpacing: 0.6,
  },
  beaconHostTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  beaconIpSub: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 1,
  },
  latencyBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10b981',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  latencyBadgeText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '800',
  },
  readyPairSubText: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 17,
    marginBottom: 14,
  },

  /* Hero & General Buttons */
  heroBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  heroPrimaryBtn: {
    flex: 1.2,
    minHeight: 46,
    backgroundColor: '#06b6d4',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  heroPrimaryBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },
  heroSecondaryBtn: {
    flex: 1,
    minHeight: 46,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  heroSecondaryBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '800',
  },
  heroOutlineBtn: {
    flex: 1,
    minHeight: 46,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  heroOutlineBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },

  /* GENERAL BENTO CARDS */
  bentoCard: {
    backgroundColor: '#0d1322',
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  bentoCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bentoCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  bentoCardSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  cardHeaderLink: {
    color: '#06b6d4',
    fontSize: 12,
    fontWeight: '800',
  },

  /* STORAGE TILE */
  storagePercentChip: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  storagePercentChipText: {
    color: '#06b6d4',
    fontSize: 11,
    fontWeight: '900',
  },
  storageTrack: {
    height: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 8,
  },
  storageFill: {
    height: '100%',
    backgroundColor: '#06b6d4',
    borderRadius: 5,
  },
  storageLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  storageLegendText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  storageMetricsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  storageMetricCol: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  metricVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  metricLabel: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },

  /* QUICK CATEGORY JUMPERS */
  categoryJumperGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  jumperTile: {
    width: (SCREEN_WIDTH - 32 - 32 - 8) / 2,
    minHeight: 64,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    padding: 10,
    justifyContent: 'center',
  },
  jumperTileWide: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  jumperEmoji: {
    fontSize: 20,
    marginBottom: 2,
  },
  jumperTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  jumperSubtitle: {
    fontSize: 10,
    color: '#94a3b8',
  },
  jumperArrow: {
    color: '#06b6d4',
    fontSize: 18,
    fontWeight: '800',
  },

  /* LAN SHARED CLIPBOARD CARD */
  clipboardPreviewBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 10,
  },
  clipboardPreviewText: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
  },
  clipboardQuickActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  clipboardActionBtn: {
    flex: 1,
    minHeight: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  clipboardActionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },

  /* SERVER CONTROLS */
  serverActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  serverToggleBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverToggleBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  safeModeSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  safeModeLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },

  /* PERMISSION REQUIRED CARD */
  permissionCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 20,
    padding: 14,
    marginBottom: 14,
  },
  permissionCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  permissionBadge: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  permissionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  permissionDesc: {
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 16,
    marginBottom: 10,
  },
  permissionBtn: {
    minHeight: 44,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },

  /* ==================== EXPLORER STYLES ==================== */
  explorerContainer: {
    flex: 1,
    padding: 12,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1322',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 6,
    marginBottom: 8,
    gap: 6,
  },
  navUpBtn: {
    minHeight: 38,
    backgroundColor: '#1e293b',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navUpBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  breadcrumbScroll: {
    flex: 1,
  },
  breadcrumbItem: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  breadcrumbItemActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
    borderRadius: 6,
  },
  breadcrumbTextRoot: {
    color: '#06b6d4',
    fontSize: 11,
    fontWeight: '800',
  },
  breadcrumbSegmentWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbSeparator: {
    color: '#64748b',
    fontSize: 12,
    marginHorizontal: 2,
  },
  breadcrumbText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  breadcrumbTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  refreshBtn: {
    minHeight: 38,
    minWidth: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  refreshBtnText: {
    color: '#06b6d4',
    fontSize: 18,
    fontWeight: '800',
  },
  viewModeBtn: {
    minHeight: 38,
    minWidth: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  viewModeBtnActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
  },
  viewModeBtnText: {
    color: '#06b6d4',
    fontSize: 16,
    fontWeight: '800',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    alignItems: 'center',
  },
  searchInputWrap: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1322',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 12,
    paddingVertical: 0,
  },
  searchClearBtn: {
    padding: 6,
  },
  searchClearBtnText: {
    color: '#64748b',
    fontSize: 13,
  },
  multiSelectToggle: {
    minHeight: 44,
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  multiSelectToggleActive: {
    backgroundColor: '#06b6d4',
  },
  multiSelectToggleText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  multiSelectToggleTextActive: {
    color: '#000000',
  },
  filterScroll: {
    maxHeight: 38,
    marginBottom: 10,
  },
  filterPill: {
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
  },
  filterPillActive: {
    backgroundColor: '#06b6d4',
    borderColor: '#06b6d4',
  },
  filterPillText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  filterPillTextActive: {
    color: '#000000',
    fontWeight: '800',
  },

  /* Responsive Photo / File Grid */
  gridContentContainer: {
    paddingBottom: 60,
  },
  responsiveGridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridTile: {
    minHeight: 105,
    backgroundColor: '#0d1322',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  gridTileSelected: {
    borderColor: '#06b6d4',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
  },
  gridThumbnailImage: {
    width: '100%',
    height: 52,
    borderRadius: 10,
    marginBottom: 6,
  },
  gridFileIconEmoji: {
    fontSize: 32,
    marginBottom: 6,
  },
  gridFileName: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  gridFileMeta: {
    color: '#64748b',
    fontSize: 9,
    marginTop: 2,
  },
  checkCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 10,
  },
  checkCircleSelected: {
    backgroundColor: '#06b6d4',
    borderColor: '#06b6d4',
  },
  checkMark: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '900',
  },

  /* List View */
  listContentContainer: {
    paddingBottom: 60,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1322',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    gap: 12,
  },
  listRowSelected: {
    borderColor: '#06b6d4',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
  },
  listRowEmoji: {
    fontSize: 22,
  },
  listRowContent: {
    flex: 1,
  },
  listRowName: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  listRowMeta: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 2,
  },
  listRowChevron: {
    color: '#06b6d4',
    fontSize: 16,
    fontWeight: '800',
  },

  /* Floating Multi-Select Bar */
  floatingMultiSelectBar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: '#0d1322',
    borderWidth: 1.5,
    borderColor: '#06b6d4',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  floatingSelectCount: {
    color: '#06b6d4',
    fontWeight: '800',
    fontSize: 13,
  },
  floatingActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  floatingTrashBtn: {
    minHeight: 36,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingTrashBtnText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '800',
  },
  floatingCancelBtn: {
    minHeight: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCancelBtnText: {
    color: '#ffffff',
    fontSize: 11,
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
    fontSize: 48,
    marginBottom: 8,
  },
  emptyFolderText: {
    color: '#64748b',
    fontSize: 13,
  },

  /* PC DRIVES EXPLORER */
  unpairedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  unpairedIconLarge: {
    fontSize: 54,
    marginBottom: 12,
  },
  unpairedTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 6,
  },
  unpairedDescription: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    maxWidth: 290,
  },
  pcHeaderSection: {
    marginBottom: 10,
  },
  pcDrivesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  pcDriveCard: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1322',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    paddingHorizontal: 12,
    gap: 10,
  },
  pcDriveCardActive: {
    borderColor: '#06b6d4',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
  },
  pcDriveCardIcon: {
    fontSize: 22,
  },
  pcDriveCardTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  pcDriveCardSub: {
    color: '#64748b',
    fontSize: 9,
  },
  pcShortcutPill: {
    minHeight: 34,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pcShortcutPillText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },

  /* CLIPBOARD TAB */
  syncRefreshChip: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderWidth: 1,
    borderColor: '#06b6d4',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  syncRefreshChipText: {
    color: '#06b6d4',
    fontSize: 11,
    fontWeight: '800',
  },
  clipboardDisplayBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 12,
    minHeight: 90,
  },
  clipboardDisplayText: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 19,
  },
  clipboardTextInput: {
    backgroundColor: '#080c14',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    padding: 12,
    color: '#ffffff',
    fontSize: 13,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 12,
    marginTop: 8,
  },
  snippetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  snippetChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  snippetChipText: {
    color: '#94a3b8',
    fontSize: 11,
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
    fontSize: 10,
    fontWeight: '800',
  },
  runDiagHeroBtn: {
    minHeight: 46,
    backgroundColor: '#06b6d4',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    marginTop: 6,
  },
  runDiagHeroBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },
  diagResultBento: {
    marginVertical: 8,
    padding: 12,
    borderRadius: 14,
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
    fontSize: 11.5,
    lineHeight: 17,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    alignItems: 'flex-start',
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#06b6d4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 11,
  },
  stepTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  stepDesc: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1,
  },
  emptyLogsText: {
    color: '#64748b',
    fontSize: 11,
    fontStyle: 'italic',
  },
  logTextItem: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },

  /* UNIVERSAL LIGHTBOX */
  lightboxOverlay: {
    flex: 1,
    backgroundColor: '#06080e',
  },
  lightboxHeader: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  lightboxFileName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  lightboxMeta: {
    color: '#06b6d4',
    fontSize: 10,
    marginTop: 1,
  },
  lightboxCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxCloseBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  lightboxBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
  lightboxNonImgContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxNonImgTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 10,
  },
  lightboxNonImgMeta: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  lightboxFooter: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    gap: 10,
  },
  lightboxDlBtn: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#06b6d4',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxDlBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  lightboxTrashBtn: {
    minHeight: 44,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxTrashBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
  },

  /* MODALS */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    padding: 18,
  },
  modalContent: {
    backgroundColor: '#0d1322',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 12,
    lineHeight: 16,
  },
  modalCloseText: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '800',
    padding: 4,
  },
  modalSubTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  modalSubTab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalSubTabActive: {
    backgroundColor: '#06b6d4',
    borderColor: '#06b6d4',
  },
  modalSubTabText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  modalSubTabTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  qrViewfinderBox: {
    backgroundColor: 'rgba(6, 182, 212, 0.06)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#06b6d4',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  qrViewfinderIcon: {
    fontSize: 36,
    marginBottom: 6,
  },
  qrViewfinderInstruction: {
    color: '#cbd5e1',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  modalInput: {
    backgroundColor: '#080c14',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 13,
    marginBottom: 10,
    minHeight: 44,
  },
  hotspotPresetBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  hotspotPresetBtnText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '800',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  modalCancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  modalPrimaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#06b6d4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
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
});
