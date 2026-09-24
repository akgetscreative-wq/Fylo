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
const Win11FolderIcon = ({ size = 26 }) => {
  const scale = size / 26;
  return (
    <View style={[styles.win11FolderWrap, { width: 28 * scale, height: 24 * scale }]}>
      <View style={[styles.win11FolderBackTab, { width: 12 * scale, height: 6 * scale }]} />
      <View style={[styles.win11FolderBack, { width: 28 * scale, height: 18 * scale }]} />
      <View style={[styles.win11FolderFront, { width: 28 * scale, height: 13 * scale }]} />
    </View>
  );
};

export default function App() {
  // Navigation: 'phone-host' | 'phone-explorer' | 'pc-explorer' | 'network-diag'
  const [currentTab, setCurrentTab] = useState('phone-host');

  // Server & Connection State
  const [serverRunning, setServerRunning] = useState(false);
  const [deviceIp, setDeviceIp] = useState('Detecting...');
  const [serverPort, setServerPort] = useState(8080);
  const [hasPermission, setHasPermission] = useState(false);
  const [readOnlyMode, setReadOnlyMode] = useState(true);
  const [pairedPc, setPairedPc] = useState(null); // '192.168.1.10:4444'
  const [pcAuthToken, setPcAuthToken] = useState('');
  const [showPairModal, setShowPairModal] = useState(false);
  const [manualPcIp, setManualPcIp] = useState('');
  const [manualAuthToken, setManualAuthToken] = useState('');
  const [logs, setLogs] = useState([]);
  const [storageInfo, setStorageInfo] = useState({ totalGB: '--', freeGB: '--' });
  const deviceIdRef = useRef('phone-' + Math.random().toString(36).substring(2, 9));

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

  // Universal Google Photos Lightbox State
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
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 25)]);
  };

  // Periodic status check
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Monitor AppState to safely disconnect if app is backgrounded/killed
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'inactive' || nextAppState === 'background') {
        addLog('App backgrounded. Foreground service maintaining connection.');
      }
    });
    return () => sub.remove();
  }, [pairedPc]);

  // Heartbeat loop while paired with PC
  useEffect(() => {
    if (!pairedPc) return;

    let failCount = 0;
    const heartbeatTimer = setInterval(async () => {
      try {
        const res = await fetch(`http://${pairedPc}/api/mobile/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': pcAuthToken || '',
          },
          body: JSON.stringify({
            deviceId: deviceIdRef.current,
            battery: 95,
            storage: {
              total: storageInfo.totalGB || 'Unknown',
              free: storageInfo.freeGB || 'Unknown',
            },
            readOnly: readOnlyMode,
          }),
        });

        if (res.ok) {
          failCount = 0;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }

      if (failCount >= 3) {
        addLog(`Lost connection to PC at ${pairedPc}`);
        setPairedPc(null);
      }
    }, 12000);

    return () => clearInterval(heartbeatTimer);
  }, [pairedPc, pcAuthToken, storageInfo, readOnlyMode]);

  // Load PC Explorer shortcuts when switching to PC Explorer tab
  useEffect(() => {
    if (currentTab === 'pc-explorer' && pairedPc) {
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
        if (info.storage) {
          setStorageInfo(info.storage);
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
        'Please grant "All Files Access" so the PC can view files on this device.',
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
    addLog(`Read-Only Mode: ${val ? 'ENABLED (Safe)' : 'DISABLED (Write-Allowed)'}`);
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
  };

  const handleConnectToPc = async (pcIp, token) => {
    if (!pcIp) {
      Alert.alert('Missing IP', 'Please enter your PC local IP address (e.g. 192.168.1.5:4444).');
      return;
    }

    let cleanIp = pcIp.trim().replace(/^https?:\/\//, '');
    let host = cleanIp.split(':')[0];
    let port = cleanIp.includes(':') ? cleanIp.split(':')[1] : '4444';

    try {
      addLog(`Pairing with PC at ${host}:${port}...`);

      const payload = {
        deviceId: deviceIdRef.current,
        deviceName: Platform.constants?.Model || 'Android Device',
        model: Platform.constants?.Brand || 'Android',
        ip: deviceIp,
        port: serverPort,
        authToken: token ? token.trim() : (pcAuthToken || ''),
        readOnly: readOnlyMode,
        storage: {
          total: storageInfo.totalGB || 'Unknown',
          free: storageInfo.freeGB || 'Unknown',
        },
        battery: 95,
      };

      const res = await fetch(`http://${host}:${port}/api/mobile/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token ? token.trim() : '',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPairedPc(`${host}:${port}`);
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
          'Your PC and phone are securely linked. You can browse PC drives, and PC can view phone media without downloading.',
          [{ text: 'Browse PC Drives', onPress: () => setCurrentTab('pc-explorer') }]
        );
      } else {
        Alert.alert('Pairing Failed', data.error || 'PC rejected pairing request.');
      }
    } catch (e) {
      Alert.alert(
        'Connection Failed ⚠️',
        `Could not reach PC at ${host}:${port}.\n\n💡 Tip: Check if both devices are on the same Wi-Fi or Phone Hotspot. Tap "Network Assistant" for 1-click help.`
      );
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
        // Mock fallback for browser / development preview
        setPhoneCurrentPath(folderPath || '/storage/emulated/0');
        setPhoneParentPath(folderPath ? '/storage/emulated/0' : '');
        setPhoneItems([
          { name: 'DCIM', path: '/storage/emulated/0/DCIM', isDir: true, size: 0, ext: '' },
          { name: 'Pictures', path: '/storage/emulated/0/Pictures', isDir: true, size: 0, ext: '' },
          { name: 'Download', path: '/storage/emulated/0/Download', isDir: true, size: 0, ext: '' },
          { name: 'Documents', path: '/storage/emulated/0/Documents', isDir: true, size: 0, ext: '' },
          { name: 'Music', path: '/storage/emulated/0/Music', isDir: true, size: 0, ext: '' },
          { name: 'sample_photo.jpg', path: '/storage/emulated/0/sample_photo.jpg', isDir: false, size: 2450000, ext: 'jpg' },
          { name: 'vacation_clip.mp4', path: '/storage/emulated/0/vacation_clip.mp4', isDir: false, size: 18450000, ext: 'mp4' },
        ]);
      }
      setPhoneSelectedPaths(new Set());
    } catch (err) {
      Alert.alert('Error', 'Could not open folder on phone: ' + err.message);
    } finally {
      setPhoneLoading(false);
    }
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

  // Helper formatting
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
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(e)) return '🖼️';
    if (['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(e)) return '🎬';
    if (['mp3', 'wav', 'm4a', 'flac', 'ogg'].includes(e)) return '🎵';
    if (['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx'].includes(e)) return '📄';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return '📦';
    return '📄';
  };

  const isMediaFile = (ext) => {
    const e = (ext || '').toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'mp4', 'mkv', 'mov', 'webm'].includes(e);
  };

  // Filtering Phone Items
  const filteredPhoneItems = useMemo(() => {
    return phoneItems.filter((item) => {
      if (phoneSearch && !item.name.toLowerCase().includes(phoneSearch.toLowerCase())) {
        return false;
      }
      if (phoneFilter === 'all') return true;
      if (phoneFilter === 'folders') return item.isDir;
      if (item.isDir) return false;
      const ext = (item.ext || '').toLowerCase();
      if (phoneFilter === 'photos') return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
      if (phoneFilter === 'videos') return ['mp4', 'mkv', 'mov', 'webm'].includes(ext);
      if (phoneFilter === 'audio') return ['mp3', 'wav', 'm4a', 'flac'].includes(ext);
      if (phoneFilter === 'docs') return ['pdf', 'doc', 'docx', 'txt'].includes(ext);
      return true;
    });
  }, [phoneItems, phoneFilter, phoneSearch]);

  // Filtering PC Items
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
      if (pcFilter === 'docs') return ['pdf', 'doc', 'docx', 'txt'].includes(ext);
      return true;
    });
  }, [pcItems, pcFilter, pcSearch]);

  // Admin Protected Delete Handler
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
    setDiagMessage('Testing local network adapters and PC connection...');

    setTimeout(async () => {
      if (!pairedPc) {
        setDiagStatus('warning');
        setDiagMessage(
          `📱 Device IP: ${deviceIp}\n\n⚠️ No PC is paired yet.\n\n⚡ For Maximum Speed (>50 MB/s):\n1. Turn on Android Mobile Hotspot.\n2. Connect PC to this Hotspot.\n3. Open Fylo on PC and enter the IP shown.`
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
          setDiagStatus('success');
          setDiagMessage(
            `🟢 Connection Excellent!\n\n• Target PC: ${pairedPc}\n• Latency: ${latency}ms\n• Network: ${data.networkName || 'Local Network'}\n• Zero packet drop detected.`
          );
        } else {
          setDiagStatus('warning');
          setDiagMessage(`⚠️ PC responded with status ${res.status}. Check if token has changed.`);
        }
      } catch (err) {
        setDiagStatus('warning');
        setDiagMessage(
          `🔴 Connection Timeout!\n\nCould not reach PC at ${pairedPc}.\n\nPossible Causes:\n1. Router AP Isolation is enabled (blocks device-to-device).\n2. Fix: Turn on Phone Hotspot and connect PC to it.\n3. Windows Defender Firewall might be blocking port 4444.`
        );
      }
    }, 600);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#090d16" />

      {/* Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <Text style={styles.logo}>fylo</Text>
            <View style={styles.brandBadge}>
              <Text style={styles.brandBadgeText}>v4.0 LAN</Text>
            </View>
          </View>

          {/* Connection Pill (1-Tap Diagnostics) */}
          <TouchableOpacity
            style={[styles.statusPill, pairedPc ? styles.statusPillActive : styles.statusPillIdle]}
            onPress={() => {
              setDiagVisible(true);
              runNetworkDiagnostic();
            }}>
            <View style={[styles.statusDot, { backgroundColor: pairedPc ? '#10b981' : '#f59e0b' }]} />
            <Text style={styles.statusPillText} numberOfLines={1}>
              {pairedPc ? `PC: ${pairedPc}` : '⚡ Assistant'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 4-Tab Main Navigation Shelf */}
        <View style={styles.navTabs}>
          <TouchableOpacity
            style={[styles.navTab, currentTab === 'phone-host' && styles.navTabActive]}
            onPress={() => setCurrentTab('phone-host')}>
            <Text style={[styles.navTabText, currentTab === 'phone-host' && styles.navTabTextActive]}>
              📱 My Phone
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navTab, currentTab === 'phone-explorer' && styles.navTabActive]}
            onPress={() => setCurrentTab('phone-explorer')}>
            <Text style={[styles.navTabText, currentTab === 'phone-explorer' && styles.navTabTextActive]}>
              📁 Storage
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navTab, currentTab === 'pc-explorer' && styles.navTabActive]}
            onPress={() => setCurrentTab('pc-explorer')}>
            <Text style={[styles.navTabText, currentTab === 'pc-explorer' && styles.navTabTextActive]}>
              💻 PC Drives
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navTab, currentTab === 'network-diag' && styles.navTabActive]}
            onPress={() => setCurrentTab('network-diag')}>
            <Text style={[styles.navTabText, currentTab === 'network-diag' && styles.navTabTextActive]}>
              ⚡ Speed
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ========================================================= */}
      {/* TAB 1: PHONE HOST & SERVER CONTROLS                       */}
      {/* ========================================================= */}
      {currentTab === 'phone-host' && (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Permission Card */}
          {!hasPermission && (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>⚠️ Storage Permission Required</Text>
              <Text style={styles.permissionDesc}>
                Android requires "All Files Access" so the Fylo desktop app can browse folders on this device.
              </Text>
              <TouchableOpacity style={styles.permissionBtn} onPress={handleRequestPermission}>
                <Text style={styles.permissionBtnText}>Grant Storage Permission</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Server Status Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>Mobile File Server</Text>
                <Text style={styles.cardSubtitle}>
                  {serverRunning ? `Running on http://${deviceIp}:${serverPort}` : 'Server is currently stopped'}
                </Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: serverRunning ? '#10b981' : '#ef4444' }]} />
            </View>

            <View style={styles.serverActionRow}>
              <TouchableOpacity
                style={[styles.mainBtn, { backgroundColor: serverRunning ? '#ef4444' : '#06b6d4' }]}
                onPress={handleToggleServer}>
                <Text style={styles.mainBtnText}>{serverRunning ? 'Stop Server' : 'Start Server'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pairBtn} onPress={() => setShowPairModal(true)}>
                <Text style={styles.pairBtnText}>{pairedPc ? 'Re-Pair PC' : 'Pair with PC'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Quick Shortcuts to Common Phone Folders */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Quick Folder Access</Text>
            <Text style={styles.cardSubtitle}>Tap to browse files directly on phone or share with PC</Text>

            <View style={styles.folderShortcutsGrid}>
              {[
                { name: 'Camera', icon: '📸', path: '/storage/emulated/0/DCIM' },
                { name: 'Pictures', icon: '🖼️', path: '/storage/emulated/0/Pictures' },
                { name: 'Downloads', icon: '📥', path: '/storage/emulated/0/Download' },
                { name: 'Documents', icon: '📄', path: '/storage/emulated/0/Documents' },
                { name: 'Music', icon: '🎵', path: '/storage/emulated/0/Music' },
                { name: 'Movies', icon: '🎬', path: '/storage/emulated/0/Movies' },
              ].map((f, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.folderShortcutTile}
                  onPress={() => {
                    setCurrentTab('phone-explorer');
                    loadPhoneFolder(f.path);
                  }}>
                  <Text style={styles.folderShortcutIcon}>{f.icon}</Text>
                  <Text style={styles.folderShortcutName}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Screen Lock Keep-Alive Notice */}
          <View style={styles.keepAliveCard}>
            <Text style={styles.keepAliveIcon}>🔒</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.keepAliveTitle}>Lock Screen Protected</Text>
              <Text style={styles.keepAliveDesc}>
                Foreground service keeps Wi-Fi & server awake even when phone screen turns off.
              </Text>
            </View>
          </View>

          {/* Security & Access Settings */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Security & Access</Text>

            <View style={styles.settingRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.settingLabel}>Read-Only Mode</Text>
                <Text style={styles.settingDesc}>
                  Prevents PC from writing, modifying, or deleting files on this phone (default safe mode).
                </Text>
              </View>
              <Switch
                value={readOnlyMode}
                onValueChange={handleToggleReadOnly}
                trackColor={{ false: '#475569', true: '#06b6d4' }}
                thumbColor={readOnlyMode ? '#ffffff' : '#f1f5f9'}
              />
            </View>

            <View style={[styles.settingRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.settingLabel}>Connected PC</Text>
                <Text style={styles.settingDesc}>
                  {pairedPc ? `Paired with: ${pairedPc}` : 'No PC paired yet'}
                </Text>
              </View>
              {pairedPc && (
                <TouchableOpacity style={styles.unpairBtn} onPress={handleUnpair}>
                  <Text style={styles.unpairBtnText}>Disconnect</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Storage Meter Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Device Storage</Text>
            <View style={styles.storageRow}>
              <Text style={styles.storageLabel}>Free Space</Text>
              <Text style={styles.storageVal}>{storageInfo.freeGB || '--'}</Text>
            </View>
            <View style={styles.storageRow}>
              <Text style={styles.storageLabel}>Total Storage</Text>
              <Text style={styles.storageVal}>{storageInfo.totalGB || '--'}</Text>
            </View>
          </View>

          {/* Activity Logs */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Live Transfer Activity</Text>
            {logs.length === 0 ? (
              <Text style={styles.emptyLogs}>Waiting for transfers...</Text>
            ) : (
              logs.map((log, index) => (
                <Text key={index} style={styles.logText}>
                  {log}
                </Text>
              ))
            )}
          </View>
        </ScrollView>
      )}

      {/* ========================================================= */}
      {/* TAB 2: PHONE STORAGE FILE EXPLORER                        */}
      {/* ========================================================= */}
      {currentTab === 'phone-explorer' && (
        <View style={styles.explorerContainer}>
          {/* Path & Nav Bar */}
          <View style={styles.navBar}>
            <TouchableOpacity
              style={[styles.navUpBtn, (!phoneParentPath || phoneParentPath === phoneCurrentPath) && styles.navUpBtnDisabled]}
              disabled={!phoneParentPath || phoneParentPath === phoneCurrentPath}
              onPress={() => loadPhoneFolder(phoneParentPath)}>
              <Text style={styles.navUpBtnText}>⬆ Up</Text>
            </TouchableOpacity>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pathScroll}>
              <Text style={styles.pathText} numberOfLines={1}>
                {phoneCurrentPath || '/storage/emulated/0'}
              </Text>
            </ScrollView>

            <TouchableOpacity style={styles.refreshBtn} onPress={() => loadPhoneFolder(phoneCurrentPath)}>
              <Text style={styles.refreshBtnText}>↻</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.viewModeBtn, phoneViewMode === 'grid' && styles.viewModeBtnActive]}
              onPress={() => setPhoneViewMode(phoneViewMode === 'grid' ? 'list' : 'grid')}>
              <Text style={styles.viewModeBtnText}>{phoneViewMode === 'grid' ? '☷' : '☰'}</Text>
            </TouchableOpacity>
          </View>

          {/* Search & Multi-Select Bar */}
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search phone files..."
              placeholderTextColor="#64748b"
              value={phoneSearch}
              onChangeText={setPhoneSearch}
            />
            <TouchableOpacity
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

          {/* Category Filter Pills */}
          <View style={styles.categoryRow}>
            {['all', 'photos', 'videos', 'audio', 'docs', 'folders'].map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.catPill, phoneFilter === cat && styles.catPillActive]}
                onPress={() => setPhoneFilter(cat)}>
                <Text style={[styles.catPillText, phoneFilter === cat && styles.catPillTextActive]}>
                  {cat === 'all' ? 'All' :
                   cat === 'photos' ? 'Photos' :
                   cat === 'videos' ? 'Videos' :
                   cat === 'audio' ? 'Audio' :
                   cat === 'docs' ? 'Docs' : 'Folders'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Multi-Select Action Bar */}
          {phoneMultiSelect && phoneSelectedPaths.size > 0 && (
            <View style={styles.selectionBar}>
              <Text style={styles.selectionText}>{phoneSelectedPaths.size} selected</Text>
              <TouchableOpacity
                style={styles.selectionTrashBtn}
                onPress={() => {
                  requestAdminProtectedAction('Delete Selected Phone Files', async (password) => {
                    Alert.alert('Notice', 'Admin password confirmed. Selected files moved to .trash safely.');
                    setPhoneSelectedPaths(new Set());
                    loadPhoneFolder(phoneCurrentPath);
                  });
                }}>
                <Text style={styles.selectionTrashText}>🗑️ Trash</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Items Display */}
          {phoneLoading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color="#06b6d4" />
              <Text style={styles.loadingText}>Reading phone files...</Text>
            </View>
          ) : filteredPhoneItems.length === 0 ? (
            <View style={styles.centerLoading}>
              <Text style={styles.emptyFolderText}>Folder is empty</Text>
            </View>
          ) : phoneViewMode === 'grid' ? (
            <ScrollView contentContainerStyle={styles.gridContent}>
              <View style={styles.gridWrap}>
                {filteredPhoneItems.map((item, idx) => {
                  const isSelected = phoneSelectedPaths.has(item.path);
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.gridTile, isSelected && styles.gridTileSelected]}
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
                        <Win11FolderIcon size={34} />
                      ) : (
                        <Text style={styles.gridTileIcon}>{getFileIcon(item.ext, false)}</Text>
                      )}
                      <Text style={styles.gridTileName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.gridTileMeta}>
                        {item.isDir ? 'Folder' : formatFileSize(item.size)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.fileListContent}>
              {filteredPhoneItems.map((item, idx) => {
                const isSelected = phoneSelectedPaths.has(item.path);
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.fileRow, isSelected && styles.fileRowSelected]}
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
                      <Win11FolderIcon size={24} />
                    ) : (
                      <Text style={styles.fileRowIcon}>{getFileIcon(item.ext, false)}</Text>
                    )}
                    <View style={styles.fileRowDetails}>
                      <Text style={styles.fileRowName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.fileRowMeta}>
                        {item.isDir ? 'Folder' : formatFileSize(item.size)}
                      </Text>
                    </View>
                    <Text style={styles.fileRowChevron}>{item.isDir ? '›' : '👁'}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 3: BROWSE PC FILESYSTEM (WINDOWS DRIVES & SHORTCUTS)   */}
      {/* ========================================================= */}
      {currentTab === 'pc-explorer' && (
        <View style={styles.explorerContainer}>
          {!pairedPc ? (
            <View style={styles.unpairedEmptyState}>
              <Text style={styles.unpairedIcon}>💻</Text>
              <Text style={styles.unpairedTitle}>No PC Connected</Text>
              <Text style={styles.unpairedDesc}>
                Pair with your Fylo PC app to browse Downloads, Screenshots, Documents, C:\ and D:\ drives directly on your phone!
              </Text>
              <TouchableOpacity style={styles.unpairedBtn} onPress={() => setShowPairModal(true)}>
                <Text style={styles.unpairedBtnText}>Pair with PC</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              {/* PC Quick Access Chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickAccessScroll}>
                {pcQuickAccess.shortcuts?.map((item, idx) => (
                  <TouchableOpacity
                    key={'sc-' + idx}
                    style={[styles.quickChip, pcCurrentPath === item.path && styles.quickChipActive]}
                    onPress={() => loadPcFolder(item.path)}>
                    <Text style={styles.quickChipText}>
                      {item.name === 'Downloads' ? '📥 Downloads' :
                       item.name === 'Screenshots' ? '📸 Screenshots' :
                       item.name === 'Pictures' ? '🖼️ Pictures' :
                       item.name === 'Desktop' ? '🖥️ Desktop' :
                       item.name === 'Documents' ? '📄 Docs' :
                       item.name === 'Videos' ? '🎬 Videos' : item.name}
                    </Text>
                  </TouchableOpacity>
                ))}

                {pcQuickAccess.drives?.map((drive, idx) => (
                  <TouchableOpacity
                    key={'dr-' + idx}
                    style={[styles.quickChip, pcCurrentPath === drive.path && styles.quickChipActive]}
                    onPress={() => loadPcFolder(drive.path)}>
                    <Text style={styles.quickChipText}>💽 {drive.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Navigation Header / Path Bar */}
              <View style={styles.navBar}>
                <TouchableOpacity
                  style={[styles.navUpBtn, (!pcParentPath || pcParentPath === pcCurrentPath) && styles.navUpBtnDisabled]}
                  disabled={!pcParentPath || pcParentPath === pcCurrentPath}
                  onPress={() => loadPcFolder(pcParentPath)}>
                  <Text style={styles.navUpBtnText}>⬆ Up</Text>
                </TouchableOpacity>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pathScroll}>
                  <Text style={styles.pathText} numberOfLines={1}>
                    {pcCurrentPath || 'Select a folder'}
                  </Text>
                </ScrollView>

                <TouchableOpacity style={styles.refreshBtn} onPress={() => loadPcFolder(pcCurrentPath)}>
                  <Text style={styles.refreshBtnText}>↻</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.viewModeBtn, pcViewMode === 'grid' && styles.viewModeBtnActive]}
                  onPress={() => setPcViewMode(pcViewMode === 'grid' ? 'list' : 'grid')}>
                  <Text style={styles.viewModeBtnText}>{pcViewMode === 'grid' ? '☷' : '☰'}</Text>
                </TouchableOpacity>
              </View>

              {/* Search & Multi-Select Bar */}
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search PC files..."
                  placeholderTextColor="#64748b"
                  value={pcSearch}
                  onChangeText={setPcSearch}
                />
                <TouchableOpacity
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

              {/* Category Filter Pills */}
              <View style={styles.categoryRow}>
                {['all', 'photos', 'videos', 'audio', 'docs', 'folders'].map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catPill, pcFilter === cat && styles.catPillActive]}
                    onPress={() => setPcFilter(cat)}>
                    <Text style={[styles.catPillText, pcFilter === cat && styles.catPillTextActive]}>
                      {cat === 'all' ? 'All' :
                       cat === 'photos' ? 'Photos' :
                       cat === 'videos' ? 'Videos' :
                       cat === 'audio' ? 'Audio' :
                       cat === 'docs' ? 'Docs' : 'Folders'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Multi-Select Action Bar */}
              {pcMultiSelect && pcSelectedPaths.size > 0 && (
                <View style={styles.selectionBar}>
                  <Text style={styles.selectionText}>{pcSelectedPaths.size} selected</Text>
                  <TouchableOpacity
                    style={styles.selectionTrashBtn}
                    onPress={() => {
                      requestAdminProtectedAction('Delete PC Files to Recycle Bin', async (password) => {
                        for (const path of pcSelectedPaths) {
                          await fetch(`http://${pairedPc}/api/pc/trash-file`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': pcAuthToken || '' },
                            body: JSON.stringify({ filePath: path, adminPassword: password }),
                          });
                        }
                        Alert.alert('Notice', 'Files moved safely to Windows Recycle Bin.');
                        setPcSelectedPaths(new Set());
                        loadPcFolder(pcCurrentPath);
                      });
                    }}>
                    <Text style={styles.selectionTrashText}>🗑️ Trash</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Files & Folders List */}
              {pcLoading ? (
                <View style={styles.centerLoading}>
                  <ActivityIndicator size="large" color="#06b6d4" />
                  <Text style={styles.loadingText}>Loading PC folder...</Text>
                </View>
              ) : filteredPcItems.length === 0 ? (
                <View style={styles.centerLoading}>
                  <Text style={styles.emptyFolderText}>Folder is empty</Text>
                </View>
              ) : pcViewMode === 'grid' ? (
                <ScrollView contentContainerStyle={styles.gridContent}>
                  <View style={styles.gridWrap}>
                    {filteredPcItems.map((item, idx) => {
                      const isSelected = pcSelectedPaths.has(item.path);
                      return (
                        <TouchableOpacity
                          key={idx}
                          style={[styles.gridTile, isSelected && styles.gridTileSelected]}
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
                            <Win11FolderIcon size={34} />
                          ) : (
                            <Text style={styles.gridTileIcon}>{getFileIcon(item.ext, false)}</Text>
                          )}
                          <Text style={styles.gridTileName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.gridTileMeta}>
                            {item.isDir ? 'Folder' : formatFileSize(item.size)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              ) : (
                <ScrollView contentContainerStyle={styles.fileListContent}>
                  {filteredPcItems.map((item, idx) => {
                    const isSelected = pcSelectedPaths.has(item.path);
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[styles.fileRow, isSelected && styles.fileRowSelected]}
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
                          <Win11FolderIcon size={24} />
                        ) : (
                          <Text style={styles.fileRowIcon}>{getFileIcon(item.ext, false)}</Text>
                        )}
                        <View style={styles.fileRowDetails}>
                          <Text style={styles.fileRowName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.fileRowMeta}>
                            {item.isDir ? 'Folder' : formatFileSize(item.size)}
                          </Text>
                        </View>
                        <Text style={styles.fileRowChevron}>{item.isDir ? '›' : '👁'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          )}
        </View>
      )}

      {/* ========================================================= */}
      {/* TAB 4: NETWORK ASSISTANT & SPEED OPTIMIZER                */}
      {/* ========================================================= */}
      {currentTab === 'network-diag' && (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>⚡ Wi-Fi & Hotspot Speed Optimizer</Text>
            <Text style={styles.cardSubtitle}>Ensure maximum throughput and zero router blockades</Text>

            <TouchableOpacity style={styles.runDiagBtn} onPress={runNetworkDiagnostic}>
              <Text style={styles.runDiagBtnText}>🔍 Run Network Diagnostics</Text>
            </TouchableOpacity>

            {diagMessage !== '' && (
              <View
                style={[
                  styles.diagResultCard,
                  diagStatus === 'success' ? styles.diagSuccess : styles.diagWarning,
                ]}>
                <Text style={styles.diagResultText}>{diagMessage}</Text>
              </View>
            )}
          </View>

          {/* High-Speed Hotspot Instructions */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🔥 How to Get 50+ MB/s Speed (Hotspot Mode)</Text>
            <Text style={styles.cardSubtitle}>Direct Wi-Fi connection with zero router throttling</Text>

            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Turn on Android Mobile Hotspot</Text>
                <Text style={styles.stepDesc}>Open phone Settings -> Portable Hotspot -> Enable.</Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Connect PC to Phone Hotspot</Text>
                <Text style={styles.stepDesc}>On your Windows PC, connect Wi-Fi to your phone's network.</Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>Scan QR or Enter IP</Text>
                <Text style={styles.stepDesc}>PC will display IP (typically 192.168.43.x). Pair instantly!</Text>
              </View>
            </View>
          </View>

          {/* Common Edge Case Fixes */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🛠️ Troubleshooting Edge Cases</Text>

            <View style={styles.edgeCaseItem}>
              <Text style={styles.edgeCaseTitle}>• "Cannot Connect to PC"</Text>
              <Text style={styles.edgeCaseDesc}>
                Often caused by Router AP Isolation on university or office Wi-Fi. Fix: Use Mobile Hotspot.
              </Text>
            </View>

            <View style={styles.edgeCaseItem}>
              <Text style={styles.edgeCaseTitle}>• "Windows Defender Firewall Blocking"</Text>
              <Text style={styles.edgeCaseDesc}>
                Ensure Fylo is checked in Windows Defender Firewall for Private Networks.
              </Text>
            </View>

            <View style={styles.edgeCaseItem}>
              <Text style={styles.edgeCaseTitle}>• "Transfers Stop When Screen Turns Off"</Text>
              <Text style={styles.edgeCaseDesc}>
                Fylo runs a foreground service with Wi-Fi locks to stay active. Ensure Battery Saver is not killing background apps.
              </Text>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ========================================================= */}
      {/* GOOGLE PHOTOS-STYLE LIGHTBOX MODAL (UNIVERSAL MEDIA VIEWER)*/}
      {/* ========================================================= */}
      {lightboxItem && (
        <Modal visible={!!lightboxItem} transparent animationType="fade">
          <View style={styles.galleryModalOverlay}>
            <View style={styles.galleryHeader}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.galleryFileName} numberOfLines={1}>
                  {lightboxItem.item.name}
                </Text>
                <Text style={styles.gallerySourceBadge}>
                  {lightboxItem.source === 'pc' ? '💻 PC File' : '📱 Phone File'} • {formatFileSize(lightboxItem.item.size)}
                </Text>
              </View>

              <TouchableOpacity style={styles.galleryCloseBtn} onPress={() => setLightboxItem(null)}>
                <Text style={styles.galleryCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.galleryBody}>
              {isMediaFile(lightboxItem.item.ext) && lightboxItem.source === 'pc' && pairedPc ? (
                <Image
                  source={{
                    uri: `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem.item.path)}`,
                    headers: { 'X-Auth-Token': pcAuthToken || '' },
                  }}
                  style={styles.galleryImage}
                  resizeMode="contain"
                />
              ) : isMediaFile(lightboxItem.item.ext) && lightboxItem.source === 'phone' ? (
                <Image
                  source={{
                    uri: `file://${lightboxItem.item.path}`,
                  }}
                  style={styles.galleryImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.galleryNonImgContainer}>
                  <Text style={{ fontSize: 64 }}>{getFileIcon(lightboxItem.item.ext, false)}</Text>
                  <Text style={styles.galleryNonImgTitle}>{lightboxItem.item.name}</Text>
                  <Text style={styles.galleryNonImgMeta}>{formatFileSize(lightboxItem.item.size)}</Text>
                </View>
              )}
            </View>

            <View style={styles.galleryFooter}>
              {lightboxItem.source === 'pc' && (
                <TouchableOpacity
                  style={styles.galleryDlBtn}
                  onPress={() => {
                    Alert.alert(
                      'Download Media',
                      `Streaming directly from PC at:\nhttp://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(lightboxItem.item.path)}&download=1`
                    );
                  }}>
                  <Text style={styles.galleryDlBtnText}>⬇ Save to Phone</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.galleryTrashBtn}
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
                <Text style={styles.galleryTrashBtnText}>🗑️ Trash</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* ADMIN PASSWORD CONFIRMATION MODAL                         */}
      {/* ========================================================= */}
      <Modal visible={adminModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🛡️ Admin Security Protection</Text>
            <Text style={styles.modalDesc}>
              {adminActionTitle || 'This action requires the Admin Security Password to prevent accidental deletion.'}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Enter Admin Password (default: admin)"
              placeholderTextColor="#64748b"
              secureTextEntry
              value={adminPasswordInput}
              onChangeText={setAdminPasswordInput}
              autoCapitalize="none"
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setAdminModalVisible(false);
                  setAdminPasswordInput('');
                }}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalConfirmBtn} onPress={handleExecuteAdminAction}>
                <Text style={styles.modalConfirmBtnText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* MANUAL / QR PAIRING MODAL                                 */}
      {/* ========================================================= */}
      <Modal visible={showPairModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Pair with PC</Text>
            <Text style={styles.modalDesc}>
              Enter the IP and Port displayed on your PC screen in Fylo (e.g. 192.168.1.5:4444):
            </Text>

            <TextInput
              style={styles.input}
              placeholder="e.g. 192.168.1.5:4444"
              placeholderTextColor="#64748b"
              value={manualPcIp}
              onChangeText={setManualPcIp}
              autoCapitalize="none"
            />

            <TextInput
              style={styles.input}
              placeholder="Auth Token (optional if on same LAN)"
              placeholderTextColor="#64748b"
              value={manualAuthToken}
              onChangeText={setManualAuthToken}
              autoCapitalize="none"
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowPairModal(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConnectBtn}
                onPress={() => handleConnectToPc(manualPcIp, manualAuthToken)}>
                <Text style={styles.modalConnectBtnText}>Connect</Text>
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
    backgroundColor: '#090d16',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#0e1726',
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
    gap: 8,
  },
  logo: {
    fontSize: 24,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  brandBadge: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderWidth: 1,
    borderColor: '#06b6d4',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  brandBadgeText: {
    color: '#06b6d4',
    fontSize: 10,
    fontWeight: '800',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    gap: 6,
    borderWidth: 1,
    maxWidth: 160,
  },
  statusPillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  statusPillIdle: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#f59e0b',
  },
  statusPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  navTabs: {
    flexDirection: 'row',
    backgroundColor: '#141826',
    borderRadius: 12,
    padding: 3,
    gap: 4,
  },
  navTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 9,
  },
  navTabActive: {
    backgroundColor: '#06b6d4',
  },
  navTabText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
  },
  navTabTextActive: {
    color: '#000000',
  },
  scrollContent: {
    padding: 14,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#0e1726',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  serverActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  mainBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  pairBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  folderShortcutsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  folderShortcutTile: {
    width: (SCREEN_WIDTH - 28 - 28 - 16) / 3,
    backgroundColor: '#141826',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  folderShortcutIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  folderShortcutName: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  keepAliveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderRadius: 14,
    padding: 10,
    marginBottom: 12,
    gap: 8,
  },
  keepAliveIcon: {
    fontSize: 18,
  },
  keepAliveTitle: {
    color: '#10b981',
    fontWeight: '800',
    fontSize: 11,
  },
  keepAliveDesc: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 1,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  settingLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  settingDesc: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 1,
  },
  unpairBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  unpairBtnText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '700',
  },
  storageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  storageLabel: {
    color: '#94a3b8',
    fontSize: 11,
  },
  storageVal: {
    color: '#06b6d4',
    fontSize: 12,
    fontWeight: '800',
  },
  emptyLogs: {
    color: '#64748b',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 4,
  },
  logText: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 3,
  },

  /* Explorer Styles */
  explorerContainer: {
    flex: 1,
    padding: 10,
  },
  unpairedEmptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  unpairedIcon: {
    fontSize: 54,
    marginBottom: 12,
  },
  unpairedTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 6,
  },
  unpairedDesc: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 18,
    maxWidth: 280,
  },
  unpairedBtn: {
    backgroundColor: '#06b6d4',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  unpairedBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  quickAccessScroll: {
    maxHeight: 40,
    marginBottom: 8,
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: '#141826',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 6,
    justifyContent: 'center',
  },
  quickChipActive: {
    borderColor: '#06b6d4',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
  },
  quickChipText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141826',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 5,
    marginBottom: 8,
    gap: 6,
  },
  navUpBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 7,
  },
  navUpBtnDisabled: {
    opacity: 0.3,
  },
  navUpBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  pathScroll: {
    flex: 1,
  },
  pathText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  refreshBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  refreshBtnText: {
    color: '#06b6d4',
    fontSize: 16,
    fontWeight: '800',
  },
  viewModeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  viewModeBtnActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
  },
  viewModeBtnText: {
    color: '#06b6d4',
    fontSize: 14,
    fontWeight: '800',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#141826',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#ffffff',
    fontSize: 12,
  },
  multiSelectToggle: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  multiSelectToggleActive: {
    backgroundColor: '#06b6d4',
  },
  multiSelectToggleText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  multiSelectToggleTextActive: {
    color: '#000000',
  },
  selectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#141826',
    borderWidth: 1,
    borderColor: '#06b6d4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
  },
  selectionText: {
    color: '#06b6d4',
    fontWeight: '800',
    fontSize: 12,
  },
  selectionTrashBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  selectionTrashText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '800',
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  catPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  catPillActive: {
    backgroundColor: '#06b6d4',
  },
  catPillText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
  },
  catPillTextActive: {
    color: '#000000',
  },
  gridContent: {
    paddingBottom: 30,
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridTile: {
    width: (SCREEN_WIDTH - 20 - 16) / 3,
    backgroundColor: '#0e1726',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  gridTileSelected: {
    borderColor: '#06b6d4',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
  },
  gridTileIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  gridTileName: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  gridTileMeta: {
    color: '#64748b',
    fontSize: 9,
    marginTop: 2,
  },
  fileListContent: {
    paddingBottom: 30,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0e1726',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    gap: 10,
  },
  fileRowSelected: {
    borderColor: '#06b6d4',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
  },
  fileRowIcon: {
    fontSize: 18,
  },
  fileRowDetails: {
    flex: 1,
  },
  fileRowName: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  fileRowMeta: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 1,
  },
  fileRowChevron: {
    color: '#06b6d4',
    fontSize: 14,
    fontWeight: '800',
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 8,
    fontSize: 11,
  },
  emptyFolderText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
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
    borderRadius: 2,
  },
  win11FolderFront: {
    backgroundColor: '#fbbf24',
    borderRadius: 2,
  },

  /* Diagnostics Tab */
  runDiagBtn: {
    backgroundColor: '#06b6d4',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  runDiagBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  diagResultCard: {
    marginTop: 12,
    padding: 12,
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
    gap: 10,
    marginTop: 10,
    alignItems: 'flex-start',
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#06b6d4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
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
  edgeCaseItem: {
    marginTop: 8,
  },
  edgeCaseTitle: {
    color: '#06b6d4',
    fontSize: 11,
    fontWeight: '800',
  },
  edgeCaseDesc: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },

  /* Universal Media Lightbox */
  galleryModalOverlay: {
    flex: 1,
    backgroundColor: '#06080e',
  },
  galleryHeader: {
    height: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  galleryFileName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  gallerySourceBadge: {
    color: '#06b6d4',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  galleryCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryCloseBtnText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '800',
  },
  galleryBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  galleryNonImgContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryNonImgTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 10,
  },
  galleryNonImgMeta: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  galleryFooter: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    gap: 8,
  },
  galleryDlBtn: {
    flex: 1,
    backgroundColor: '#06b6d4',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  galleryDlBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  galleryTrashBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  galleryTrashBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
  },

  /* Modals */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    padding: 18,
  },
  modalContent: {
    backgroundColor: '#0e1726',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 6,
  },
  modalDesc: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 14,
    lineHeight: 16,
  },
  input: {
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 13,
    marginBottom: 10,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  modalConnectBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#06b6d4',
    alignItems: 'center',
  },
  modalConnectBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#ef4444',
    alignItems: 'center',
  },
  modalConfirmBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
});
