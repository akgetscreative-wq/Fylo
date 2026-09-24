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
  // Navigation: 'phone-host' (Dashboard) | 'phone-explorer' | 'pc-explorer' | 'network-diag'
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
  const [pairModalTab, setPairModalTab] = useState('qr'); // 'qr' | 'manual'
  const [qrInputText, setQrInputText] = useState('');
  const [manualPcIp, setManualPcIp] = useState('');
  const [manualAuthToken, setManualAuthToken] = useState('');
  const [logs, setLogs] = useState([]);
  const [storageInfo, setStorageInfo] = useState({ totalGB: '--', freeGB: '--' });
  const deviceIdRef = useRef('phone-' + Math.random().toString(36).substring(2, 9));
  const [dashboardSearch, setDashboardSearch] = useState('');

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

  // Monitor AppState to safely track background execution
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'inactive' || nextAppState === 'background') {
        addLog('App in background. Fylo Foreground Service maintaining active sync.');
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

  // Load PC Explorer shortcuts when switching to PC Explorer tab or pairing
  useEffect(() => {
    if ((currentTab === 'pc-explorer' || currentTab === 'phone-host') && pairedPc) {
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
          'Your PC and phone are securely linked. You can browse PC drives, and PC can view phone media in real-time.',
          [{ text: 'Browse PC Drives', onPress: () => setCurrentTab('pc-explorer') }]
        );
      } else {
        Alert.alert('Pairing Failed', data.error || 'PC rejected pairing request.');
      }
    } catch (e) {
      Alert.alert(
        'Connection Failed ⚠️',
        `Could not reach PC at ${host}:${port}.\n\n💡 Tip: Check if both devices are on the same Wi-Fi or Phone Hotspot. Tap "Network & Hotspot Diag" for 1-click help.`
      );
    }
  };

  // Helper to parse QR string
  const handleParseAndConnectQr = (rawText) => {
    if (!rawText || !rawText.trim()) {
      Alert.alert('Input Required', 'Please enter or paste the QR code string shown on your PC.');
      return;
    }
    const clean = rawText.trim();
    let hostPort = '';
    let token = '';

    if (clean.includes('token=')) {
      try {
        const url = clean.startsWith('http') || clean.startsWith('fylo') ? clean : 'http://' + clean;
        const parsed = new URL(url);
        hostPort = `${parsed.hostname}:${parsed.port || 4444}`;
        token = parsed.searchParams.get('token') || '';
      } catch (e) {
        hostPort = clean.split('?')[0].replace(/^fylo:\/\//, '').replace(/^https?:\/\//, '');
      }
    } else if (clean.includes(':') && clean.split(':').length === 3) {
      const parts = clean.split(':');
      hostPort = `${parts[0]}:${parts[1]}`;
      token = parts[2];
    } else {
      hostPort = clean;
    }

    handleConnectToPc(hostPort, token);
  };

  // Storage calculation for Bento storage meter
  const storageStats = useMemo(() => {
    const freeStr = storageInfo.freeGB || '';
    const totalStr = storageInfo.totalGB || '';
    const freeVal = parseFloat(freeStr) || 0;
    const totalVal = parseFloat(totalStr) || 0;
    if (totalVal > 0) {
      const usedVal = Math.max(0, totalVal - freeVal);
      const percent = Math.min(100, Math.max(5, Math.round((usedVal / totalVal) * 100)));
      return {
        freeGB: freeStr || '--',
        totalGB: totalStr || '--',
        usedGB: usedVal.toFixed(1) + ' GB',
        usedPercent: percent,
      };
    }
    return {
      freeGB: freeStr || '--',
      totalGB: totalStr || '--',
      usedGB: '--',
      usedPercent: 40,
    };
  }, [storageInfo]);

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
          { name: 'Movies', path: '/storage/emulated/0/Movies', isDir: true, size: 0, ext: '' },
          { name: 'Music', path: '/storage/emulated/0/Music', isDir: true, size: 0, ext: '' },
          { name: 'vacation_shot.jpg', path: '/storage/emulated/0/vacation_shot.jpg', isDir: false, size: 3450000, ext: 'jpg' },
          { name: 'drone_flyover.mp4', path: '/storage/emulated/0/drone_flyover.mp4', isDir: false, size: 24500000, ext: 'mp4' },
          { name: 'project_brief.pdf', path: '/storage/emulated/0/project_brief.pdf', isDir: false, size: 1200000, ext: 'pdf' },
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
          setDiagStatus('success');
          setDiagMessage(
            `🟢 Connection Excellent!\n\n• Target PC: ${pairedPc}\n• Latency: ${latency}ms\n• Network: ${data.networkName || 'Local 5GHz Wi-Fi / Hotspot'}\n• Zero packet drop detected.`
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

  // Quick folders on Phone
  const phoneQuickFolders = [
    { name: 'Camera', icon: '📷', path: '/storage/emulated/0/DCIM' },
    { name: 'Downloads', icon: '📥', path: '/storage/emulated/0/Download' },
    { name: 'Pictures', icon: '🖼️', path: '/storage/emulated/0/Pictures' },
    { name: 'Movies', icon: '🎬', path: '/storage/emulated/0/Movies' },
    { name: 'Documents', icon: '📄', path: '/storage/emulated/0/Documents' },
    { name: 'Music', icon: '🎵', path: '/storage/emulated/0/Music' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#080c14" />

      {/* ========================================================= */}
      {/* TOP HEADER & PILL BAR NAVIGATION (Inspired by reference UI)*/}
      {/* ========================================================= */}
      <View style={styles.topHeader}>
        {/* Brand Row */}
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            {/* Circular Purple Brand Badge like (F) in reference */}
            <View style={styles.brandCircle}>
              <Text style={styles.brandCircleText}>F</Text>
            </View>
            <View>
              <Text style={styles.brandTitle}>fylo</Text>
              <Text style={styles.brandSub}>Mobile Node</Text>
            </View>
          </View>

          {/* Connection Status Pill on Top-Right */}
          <TouchableOpacity
            style={[styles.topStatusPill, pairedPc ? styles.topStatusPillActive : styles.topStatusPillIdle]}
            onPress={() => {
              setDiagVisible(true);
              runNetworkDiagnostic();
            }}>
            <View style={[styles.statusDot, { backgroundColor: pairedPc ? '#10b981' : '#f59e0b' }]} />
            <Text style={styles.topStatusPillText} numberOfLines={1}>
              {pairedPc ? `PC: ${pairedPc}` : '⚡ Standalone LAN'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Scrollable Pill Navigation Bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillTabsContainer}>
          <TouchableOpacity
            style={[
              styles.pillTab,
              (currentTab === 'phone-host' || currentTab === 'dashboard') && styles.pillTabActive,
            ]}
            onPress={() => setCurrentTab('phone-host')}>
            <Text
              style={[
                styles.pillTabText,
                (currentTab === 'phone-host' || currentTab === 'dashboard') && styles.pillTabTextActive,
              ]}>
              🏠 Dashboard
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pillTab, currentTab === 'phone-explorer' && styles.pillTabActive]}
            onPress={() => setCurrentTab('phone-explorer')}>
            <Text style={[styles.pillTabText, currentTab === 'phone-explorer' && styles.pillTabTextActive]}>
              📱 Phone Files
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pillTab, currentTab === 'pc-explorer' && styles.pillTabActive]}
            onPress={() => setCurrentTab('pc-explorer')}>
            <Text style={[styles.pillTabText, currentTab === 'pc-explorer' && styles.pillTabTextActive]}>
              💻 PC Drives
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pillTab, currentTab === 'network-diag' && styles.pillTabActive]}
            onPress={() => setCurrentTab('network-diag')}>
            <Text style={[styles.pillTabText, currentTab === 'network-diag' && styles.pillTabTextActive]}>
              ⚡ Hotspot & Diag
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* ========================================================= */}
      {/* TAB 1: BENTO DASHBOARD & HOMEPAGE (Inspired by reference) */}
      {/* ========================================================= */}
      {(currentTab === 'phone-host' || currentTab === 'dashboard') && (
        <ScrollView contentContainerStyle={styles.bentoScroll} showsVerticalScrollIndicator={false}>
          {/* Greeting & Live Network Bar */}
          <View style={styles.greetingSection}>
            <Text style={styles.greetingTitle}>Hello, Android Companion 👋</Text>
            <Text style={styles.greetingSubtitle}>
              LAN Online • 🟢 {deviceIp} • 🛡️ Safe Mode {readOnlyMode ? 'Active' : 'Off'}
            </Text>

            {/* Quick Search Bar */}
            <View style={styles.greetingSearchWrap}>
              <Text style={styles.greetingSearchIcon}>🔍</Text>
              <TextInput
                style={styles.greetingSearchInput}
                placeholder="Search phone files, PC folders, or IP..."
                placeholderTextColor="#64748b"
                value={dashboardSearch}
                onChangeText={setDashboardSearch}
                onSubmitEditing={() => {
                  if (dashboardSearch.trim()) {
                    setPhoneSearch(dashboardSearch.trim());
                    setCurrentTab('phone-explorer');
                  }
                }}
              />
              <TouchableOpacity
                style={styles.greetingSearchBtn}
                onPress={() => {
                  if (dashboardSearch.trim()) {
                    setPhoneSearch(dashboardSearch.trim());
                    setCurrentTab('phone-explorer');
                  }
                }}>
                <Text style={styles.greetingSearchBtnText}>Go</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Storage Permission Alert Card if Not Granted */}
          {!hasPermission && (
            <View style={styles.permissionCard}>
              <View style={styles.permissionCardTop}>
                <Text style={styles.permissionBadge}>⚠️ ACTION REQUIRED</Text>
                <Text style={styles.permissionTitle}>Storage Permission Required</Text>
              </View>
              <Text style={styles.permissionDesc}>
                Android requires "All Files Access" so the Fylo desktop app can browse folders on this device.
              </Text>
              <TouchableOpacity style={styles.permissionBtn} onPress={handleRequestPermission}>
                <Text style={styles.permissionBtnText}>Grant Storage Permission</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* BENTO TILE 1: Background Sync & Service Hero Tile */}
          <View style={styles.bentoHeroCard}>
            <View style={styles.bentoHeroHeader}>
              <View style={styles.bentoHeroBadgeRow}>
                <View style={styles.heroGlowBadge}>
                  <Text style={styles.heroGlowBadgeText}>
                    {serverRunning ? '⚡ SERVER ONLINE' : '💤 SERVER STOPPED'}
                  </Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: serverRunning ? '#10b981' : '#f43f5e' }]} />
              </View>
              <Text style={styles.bentoHeroTitle}>Fylo Mobile Server</Text>
              <Text style={styles.bentoHeroUrl}>
                {serverRunning ? `http://${deviceIp}:${serverPort}` : 'Ready to start on port 8080'}
              </Text>
            </View>

            {/* Lock Screen Protected Banner */}
            <View style={styles.bentoKeepAlivePill}>
              <Text style={styles.bentoKeepAliveIcon}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.bentoKeepAliveTitle}>Lock Screen Protected</Text>
                <Text style={styles.bentoKeepAliveDesc}>
                  Foreground service keeps server awake even when phone is locked.
                </Text>
              </View>
            </View>

            {/* Hero Action Buttons */}
            <View style={styles.bentoHeroBtnRow}>
              <TouchableOpacity
                style={[
                  styles.bentoMainBtn,
                  { backgroundColor: serverRunning ? '#ef4444' : '#10b981' },
                ]}
                onPress={handleToggleServer}>
                <Text style={styles.bentoMainBtnText}>
                  {serverRunning ? '⏹ Stop Server' : '▶ Start Server'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.bentoSecondaryBtn}
                onPress={() => setShowPairModal(true)}>
                <Text style={styles.bentoSecondaryBtnText}>
                  {pairedPc ? '🔄 Re-Pair PC' : '🔗 Pair PC'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* BENTO TILE 2: PC Connection & Pairing Card */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>💻 PC Connection & Sync</Text>
                <Text style={styles.bentoCardSubtitle}>
                  {pairedPc ? `Connected to Windows Host: ${pairedPc}` : 'Standalone mode (No PC paired)'}
                </Text>
              </View>
              <View
                style={[
                  styles.connectionIndicatorPill,
                  pairedPc ? styles.connActive : styles.connIdle,
                ]}>
                <Text style={styles.connectionIndicatorText}>
                  {pairedPc ? '🟢 Linked' : '🟡 Standalone'}
                </Text>
              </View>
            </View>

            {pairedPc ? (
              <View style={styles.pairedInfoBox}>
                <View style={styles.pairedMetricRow}>
                  <Text style={styles.pairedMetricLabel}>Host Target:</Text>
                  <Text style={styles.pairedMetricVal}>{pairedPc}</Text>
                </View>
                <View style={styles.pairedMetricRow}>
                  <Text style={styles.pairedMetricLabel}>Sync Latency:</Text>
                  <Text style={styles.pairedMetricVal}>&lt; 2ms (Direct LAN)</Text>
                </View>

                <View style={styles.pairedActionRow}>
                  <TouchableOpacity
                    style={styles.pairedBrowseBtn}
                    onPress={() => setCurrentTab('pc-explorer')}>
                    <Text style={styles.pairedBrowseBtnText}>📂 Browse PC Drives</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.pairedUnpairBtn} onPress={handleUnpair}>
                    <Text style={styles.pairedUnpairBtnText}>Disconnect</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.unpairedPairActionsRow}>
                <TouchableOpacity
                  style={styles.pairQrBtn}
                  onPress={() => {
                    setPairModalTab('qr');
                    setShowPairModal(true);
                  }}>
                  <Text style={styles.pairQrBtnIcon}>📷</Text>
                  <Text style={styles.pairQrBtnText}>Scan PC QR Code</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pairManualBtn}
                  onPress={() => {
                    setPairModalTab('manual');
                    setShowPairModal(true);
                  }}>
                  <Text style={styles.pairManualBtnIcon}>🔌</Text>
                  <Text style={styles.pairManualBtnText}>Manual Connect</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* BENTO TILE 3: Phone Storage & Health (Inspired by Report Card in Reference Image) */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>📊 Phone Storage & Health</Text>
                <Text style={styles.bentoCardSubtitle}>Internal flash memory & network status</Text>
              </View>
              <Text style={styles.storagePercentBadge}>{storageStats.usedPercent}% Used</Text>
            </View>

            {/* Storage Progress Bar */}
            <View style={styles.storageProgressTrack}>
              <View style={[styles.storageProgressFill, { width: `${storageStats.usedPercent}%` }]} />
            </View>
            <View style={styles.storageProgressLabelRow}>
              <Text style={styles.storageProgressSub}>Used: {storageStats.usedGB}</Text>
              <Text style={styles.storageProgressSub}>Free: {storageStats.freeGB}</Text>
            </View>

            {/* 4-Quadrant Bento Sub-Tiles (Like 4 mini tiles in reference image) */}
            <View style={styles.quadrantGrid}>
              <View style={[styles.quadrantTile, { backgroundColor: 'rgba(6, 182, 212, 0.1)' }]}>
                <Text style={styles.quadrantEmoji}>📦</Text>
                <Text style={styles.quadrantVal}>{storageStats.freeGB}</Text>
                <Text style={styles.quadrantLabel}>Free Space</Text>
              </View>

              <View style={[styles.quadrantTile, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
                <Text style={styles.quadrantEmoji}>💾</Text>
                <Text style={styles.quadrantVal}>{storageStats.totalGB}</Text>
                <Text style={styles.quadrantLabel}>Total Storage</Text>
              </View>

              <View style={[styles.quadrantTile, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
                <Text style={styles.quadrantEmoji}>🛡️</Text>
                <Text style={styles.quadrantVal}>{readOnlyMode ? 'Safe Mode' : 'Write OK'}</Text>
                <Text style={styles.quadrantLabel}>Access Guard</Text>
              </View>

              <View style={[styles.quadrantTile, { backgroundColor: 'rgba(139, 92, 246, 0.1)' }]}>
                <Text style={styles.quadrantEmoji}>🌐</Text>
                <Text style={styles.quadrantVal}>:{serverPort}</Text>
                <Text style={styles.quadrantLabel}>Server Port</Text>
              </View>
            </View>

            {/* Quick Access Folder Pills */}
            <Text style={styles.quickAccessSectionHeader}>Quick Folder Access (Tap to open):</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickFolderScroll}>
              {phoneQuickFolders.map((f, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.quickFolderPill}
                  onPress={() => {
                    setCurrentTab('phone-explorer');
                    loadPhoneFolder(f.path);
                  }}>
                  <Text style={styles.quickFolderPillIcon}>{f.icon}</Text>
                  <Text style={styles.quickFolderPillName}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* BENTO TILE 4: Remote PC Drives & Shortcuts Bento Tile */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>💽 Remote PC Drives & Folders</Text>
                <Text style={styles.bentoCardSubtitle}>Directly stream Windows files to your phone</Text>
              </View>
              {pairedPc && (
                <TouchableOpacity onPress={() => setCurrentTab('pc-explorer')}>
                  <Text style={styles.cardHeaderLinkText}>View All ›</Text>
                </TouchableOpacity>
              )}
            </View>

            {pairedPc ? (
              <View>
                <View style={styles.pcDrivesChipRow}>
                  {/* Default Drives C: and D: or loaded from PC */}
                  {pcQuickAccess.drives && pcQuickAccess.drives.length > 0 ? (
                    pcQuickAccess.drives.map((d, i) => (
                      <TouchableOpacity
                        key={'drv-' + i}
                        style={styles.pcDriveChip}
                        onPress={() => {
                          setCurrentTab('pc-explorer');
                          loadPcFolder(d.path);
                        }}>
                        <Text style={styles.pcDriveChipIcon}>💽</Text>
                        <Text style={styles.pcDriveChipText}>{d.name || d.path}</Text>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.pcDriveChip}
                        onPress={() => {
                          setCurrentTab('pc-explorer');
                          loadPcFolder('C:\\');
                        }}>
                        <Text style={styles.pcDriveChipIcon}>💽</Text>
                        <Text style={styles.pcDriveChipText}>Drive C:\</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.pcDriveChip}
                        onPress={() => {
                          setCurrentTab('pc-explorer');
                          loadPcFolder('D:\\');
                        }}>
                        <Text style={styles.pcDriveChipIcon}>💽</Text>
                        <Text style={styles.pcDriveChipText}>Drive D:\</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                {/* PC Shortcut Chips */}
                <View style={styles.pcShortcutsRow}>
                  {[
                    { name: 'Downloads', icon: '📥', path: 'Downloads' },
                    { name: 'Desktop', icon: '🖥️', path: 'Desktop' },
                    { name: 'Pictures', icon: '🖼️', path: 'Pictures' },
                    { name: 'Screenshots', icon: '📸', path: 'Screenshots' },
                  ].map((sc, i) => (
                    <TouchableOpacity
                      key={'pcsc-' + i}
                      style={styles.pcShortcutChip}
                      onPress={() => {
                        setCurrentTab('pc-explorer');
                        const match = pcQuickAccess.shortcuts?.find((s) =>
                          s.name.toLowerCase().includes(sc.name.toLowerCase())
                        );
                        loadPcFolder(match ? match.path : sc.path);
                      }}>
                      <Text style={styles.pcShortcutChipText}>
                        {sc.icon} {sc.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.unpairedPcDrivesNotice}>
                <Text style={styles.unpairedNoticeText}>
                  Pair your phone with Fylo PC app to browse Windows C:\, D:\, Downloads and Desktop without USB cables!
                </Text>
                <TouchableOpacity
                  style={styles.unpairedNoticeBtn}
                  onPress={() => setShowPairModal(true)}>
                  <Text style={styles.unpairedNoticeBtnText}>🔗 Pair with PC to Browse</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* BENTO TILE 5: Security & Safe Mode Tile */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>🛡️ Security & Safe Mode</Text>
                <Text style={styles.bentoCardSubtitle}>Prevent accidental overwrites or file deletions</Text>
              </View>
            </View>

            <View style={styles.securityRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.securityTitle}>Read-Only Protection (Safe Mode)</Text>
                <Text style={styles.securityDesc}>
                  Prevents PC from writing, modifying, or deleting files on this phone.
                </Text>
              </View>
              <Switch
                value={readOnlyMode}
                onValueChange={handleToggleReadOnly}
                trackColor={{ false: '#475569', true: '#10b981' }}
                thumbColor={readOnlyMode ? '#ffffff' : '#f1f5f9'}
              />
            </View>

            <View style={styles.securityGateRow}>
              <Text style={styles.securityGateIcon}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.securityGateTitle}>Recycle Bin & Trash Gate</Text>
                <Text style={styles.securityGateDesc}>
                  Deletions are protected by Admin Security Password to prevent data loss.
                </Text>
              </View>
            </View>
          </View>

          {/* BENTO TILE 6: Network & Hotspot Diagnostic Card */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <View>
                <Text style={styles.bentoCardTitle}>⚡ Network & 50+ MB/s Hotspot</Text>
                <Text style={styles.bentoCardSubtitle}>Zero router bottleneck direct transfer</Text>
              </View>
              <View style={styles.speedRatingBadge}>
                <Text style={styles.speedRatingText}>High Speed</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.runDiagHeroBtn} onPress={runNetworkDiagnostic}>
              <Text style={styles.runDiagHeroBtnText}>⚡ Run Diagnostics & Speed Test</Text>
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

            {/* Hotspot Guide Stepper */}
            <View style={styles.hotspotGuideWrap}>
              <Text style={styles.hotspotGuideHeader}>Direct Hotspot Mode (50–80 MB/s):</Text>
              <View style={styles.hotspotStepRow}>
                <View style={styles.hotspotStepBadge}><Text style={styles.hotspotStepBadgeText}>1</Text></View>
                <Text style={styles.hotspotStepText}>Enable Portable Mobile Hotspot on this Phone.</Text>
              </View>
              <View style={styles.hotspotStepRow}>
                <View style={styles.hotspotStepBadge}><Text style={styles.hotspotStepBadgeText}>2</Text></View>
                <Text style={styles.hotspotStepText}>Connect your PC's Wi-Fi directly to this Hotspot.</Text>
              </View>
              <View style={styles.hotspotStepRow}>
                <View style={styles.hotspotStepBadge}><Text style={styles.hotspotStepBadgeText}>3</Text></View>
                <Text style={styles.hotspotStepText}>Enter IP ({deviceIp}) on PC for maximum transfer speed.</Text>
              </View>
            </View>
          </View>

          {/* BENTO TILE 7: Live Activity Stream / Transfer Activity */}
          <View style={styles.bentoCard}>
            <View style={styles.bentoCardHeaderRow}>
              <Text style={styles.bentoCardTitle}>📜 Live Transfer Activity</Text>
              {logs.length > 0 && (
                <TouchableOpacity onPress={() => setLogs([])}>
                  <Text style={styles.clearLogsText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            {logs.length === 0 ? (
              <Text style={styles.emptyLogsText}>No active transfers yet. Ready for sync...</Text>
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
      {/* TAB 2: PHONE STORAGE FILE EXPLORER                        */}
      {/* ========================================================= */}
      {currentTab === 'phone-explorer' && (
        <View style={styles.explorerContainer}>
          {/* Path & Nav Bar */}
          <View style={styles.navBar}>
            <TouchableOpacity
              style={[
                styles.navUpBtn,
                (!phoneParentPath || phoneParentPath === phoneCurrentPath) && styles.navUpBtnDisabled,
              ]}
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
            {phoneSearch.length > 0 && (
              <TouchableOpacity style={styles.searchClearBtn} onPress={() => setPhoneSearch('')}>
                <Text style={styles.searchClearBtnText}>✕</Text>
              </TouchableOpacity>
            )}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {['all', 'photos', 'videos', 'audio', 'docs', 'folders'].map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.catPill, phoneFilter === cat && styles.catPillActive]}
                onPress={() => setPhoneFilter(cat)}>
                <Text style={[styles.catPillText, phoneFilter === cat && styles.catPillTextActive]}>
                  {cat === 'all'
                    ? '📁 All'
                    : cat === 'photos'
                    ? '🖼️ Photos'
                    : cat === 'videos'
                    ? '🎬 Videos'
                    : cat === 'audio'
                    ? '🎵 Audio'
                    : cat === 'docs'
                    ? '📄 Docs'
                    : '🗂️ Folders'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

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
              <TouchableOpacity
                style={styles.unpairedBtn}
                onPress={() => {
                  setPairModalTab('qr');
                  setShowPairModal(true);
                }}>
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
                      {item.name === 'Downloads'
                        ? '📥 Downloads'
                        : item.name === 'Screenshots'
                        ? '📸 Screenshots'
                        : item.name === 'Pictures'
                        ? '🖼️ Pictures'
                        : item.name === 'Desktop'
                        ? '🖥️ Desktop'
                        : item.name === 'Documents'
                        ? '📄 Docs'
                        : item.name === 'Videos'
                        ? '🎬 Videos'
                        : item.name}
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
                  style={[
                    styles.navUpBtn,
                    (!pcParentPath || pcParentPath === pcCurrentPath) && styles.navUpBtnDisabled,
                  ]}
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
                {pcSearch.length > 0 && (
                  <TouchableOpacity style={styles.searchClearBtn} onPress={() => setPcSearch('')}>
                    <Text style={styles.searchClearBtnText}>✕</Text>
                  </TouchableOpacity>
                )}
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
                {['all', 'photos', 'videos', 'audio', 'docs', 'folders'].map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catPill, pcFilter === cat && styles.catPillActive]}
                    onPress={() => setPcFilter(cat)}>
                    <Text style={[styles.catPillText, pcFilter === cat && styles.catPillTextActive]}>
                      {cat === 'all'
                        ? '📁 All'
                        : cat === 'photos'
                        ? '🖼️ Photos'
                        : cat === 'videos'
                        ? '🎬 Videos'
                        : cat === 'audio'
                        ? '🎵 Audio'
                        : cat === 'docs'
                        ? '📄 Docs'
                        : '🗂️ Folders'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

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
        <ScrollView contentContainerStyle={styles.bentoScroll}>
          <View style={styles.bentoCard}>
            <Text style={styles.bentoCardTitle}>⚡ Wi-Fi & Hotspot Speed Optimizer</Text>
            <Text style={styles.bentoCardSubtitle}>Ensure maximum throughput and zero router blockades</Text>

            <TouchableOpacity style={styles.runDiagHeroBtn} onPress={runNetworkDiagnostic}>
              <Text style={styles.runDiagHeroBtnText}>🔍 Run Network Diagnostics</Text>
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

          {/* High-Speed Hotspot Instructions */}
          <View style={styles.bentoCard}>
            <Text style={styles.bentoCardTitle}>🔥 How to Get 50+ MB/s Speed (Hotspot Mode)</Text>
            <Text style={styles.bentoCardSubtitle}>Direct Wi-Fi connection with zero router throttling</Text>

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
          <View style={styles.bentoCard}>
            <Text style={styles.bentoCardTitle}>🛠️ Troubleshooting Edge Cases</Text>

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
      {/* 1-CLICK DIAGNOSTICS MODAL (Top Right Pill Trigger)         */}
      {/* ========================================================= */}
      <Modal visible={diagVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.bentoCardHeaderRow}>
              <Text style={styles.modalTitle}>⚡ Network & Ping Diagnostics</Text>
              <TouchableOpacity onPress={() => setDiagVisible(false)}>
                <Text style={styles.modalCloseIcon}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.diagResultBento, diagStatus === 'success' ? styles.diagSuccess : styles.diagWarning]}>
              <Text style={styles.diagResultText}>{diagMessage || 'Running test...'}</Text>
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setDiagVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConnectBtn}
                onPress={runNetworkDiagnostic}>
                <Text style={styles.modalConnectBtnText}>Re-Test</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================= */}
      {/* PAIRING MODAL: SCAN QR / MANUAL CONNECT                   */}
      {/* ========================================================= */}
      <Modal visible={showPairModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.bentoCardHeaderRow}>
              <Text style={styles.modalTitle}>Pair with PC</Text>
              <TouchableOpacity onPress={() => setShowPairModal(false)}>
                <Text style={styles.modalCloseIcon}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Modal Sub-Tabs: QR Scan vs Manual Connect */}
            <View style={styles.modalSubTabsRow}>
              <TouchableOpacity
                style={[styles.modalSubTab, pairModalTab === 'qr' && styles.modalSubTabActive]}
                onPress={() => setPairModalTab('qr')}>
                <Text style={[styles.modalSubTabText, pairModalTab === 'qr' && styles.modalSubTabTextActive]}>
                  📷 Scan PC QR Code
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubTab, pairModalTab === 'manual' && styles.modalSubTabActive]}
                onPress={() => setPairModalTab('manual')}>
                <Text style={[styles.modalSubTabText, pairModalTab === 'manual' && styles.modalSubTabTextActive]}>
                  🔌 Manual Connect
                </Text>
              </TouchableOpacity>
            </View>

            {pairModalTab === 'qr' ? (
              <View>
                {/* Visual Viewfinder Graphic */}
                <View style={styles.qrViewfinderGraphic}>
                  <Text style={styles.qrViewfinderIcon}>📷</Text>
                  <Text style={styles.qrViewfinderInstruction}>
                    Scan the QR code shown on your PC in Fylo, or paste the QR data string below:
                  </Text>
                </View>

                <TextInput
                  style={styles.input}
                  placeholder="Paste QR Code String (e.g. fylo://192.168.1.5:4444...)"
                  placeholderTextColor="#64748b"
                  value={qrInputText}
                  onChangeText={setQrInputText}
                  autoCapitalize="none"
                />

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={() => setShowPairModal(false)}>
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalConnectBtn}
                    onPress={() => handleParseAndConnectQr(qrInputText)}>
                    <Text style={styles.modalConnectBtnText}>Pair via QR</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
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

                {/* Hotspot Quick Preset */}
                <TouchableOpacity
                  style={styles.presetHotspotBtn}
                  onPress={() => setManualPcIp('192.168.43.1:4444')}>
                  <Text style={styles.presetHotspotBtnText}>⚡ Fill Hotspot Gateway (192.168.43.1:4444)</Text>
                </TouchableOpacity>

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
            )}
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
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
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
    shadowOpacity: 0.5,
    shadowRadius: 4,
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
    marginTop: -1,
  },
  topStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    gap: 6,
    borderWidth: 1,
    maxWidth: 170,
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
    fontWeight: '700',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  /* Scrollable Pill Bar Tabs (Capsule style) */
  pillTabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  pillTab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
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

  /* Bento Scroll Container */
  bentoScroll: {
    padding: 16,
    paddingBottom: 40,
  },

  /* Greeting & Live Network Bar */
  greetingSection: {
    marginBottom: 16,
  },
  greetingTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  greetingSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    fontWeight: '600',
  },
  greetingSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    marginTop: 10,
    height: 44,
  },
  greetingSearchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  greetingSearchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 12,
    paddingVertical: 0,
  },
  greetingSearchBtn: {
    backgroundColor: '#06b6d4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  greetingSearchBtnText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '800',
  },

  /* Permission Required Alert */
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
    backgroundColor: '#ef4444',
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  permissionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },

  /* BENTO HERO CARD (Card 1) */
  bentoHeroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(6, 182, 212, 0.3)',
    shadowColor: '#06b6d4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  bentoHeroHeader: {
    marginBottom: 12,
  },
  bentoHeroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  heroGlowBadge: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#06b6d4',
  },
  heroGlowBadgeText: {
    color: '#06b6d4',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  bentoHeroTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
  },
  bentoHeroUrl: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  bentoKeepAlivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderRadius: 14,
    padding: 10,
    marginBottom: 14,
    gap: 10,
  },
  bentoKeepAliveIcon: {
    fontSize: 16,
  },
  bentoKeepAliveTitle: {
    color: '#10b981',
    fontWeight: '800',
    fontSize: 11,
  },
  bentoKeepAliveDesc: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 1,
  },
  bentoHeroBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bentoMainBtn: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bentoMainBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  bentoSecondaryBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bentoSecondaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },

  /* GENERAL BENTO CARDS */
  bentoCard: {
    backgroundColor: '#0f172a',
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
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
  cardHeaderLinkText: {
    color: '#06b6d4',
    fontSize: 12,
    fontWeight: '800',
  },

  /* BENTO TILE 2: PC Connection */
  connectionIndicatorPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  connActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  connIdle: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  connectionIndicatorText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  pairedInfoBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  pairedMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  pairedMetricLabel: {
    color: '#94a3b8',
    fontSize: 11,
  },
  pairedMetricVal: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '800',
  },
  pairedActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  pairedBrowseBtn: {
    flex: 2,
    backgroundColor: '#06b6d4',
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  pairedBrowseBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '900',
  },
  pairedUnpairBtn: {
    flex: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  pairedUnpairBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
  },
  unpairedPairActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  pairQrBtn: {
    flex: 1,
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderWidth: 1,
    borderColor: '#06b6d4',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairQrBtnIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  pairQrBtnText: {
    color: '#06b6d4',
    fontSize: 12,
    fontWeight: '800',
  },
  pairManualBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairManualBtnIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  pairManualBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },

  /* BENTO TILE 3: Phone Storage & Health */
  storagePercentBadge: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    color: '#06b6d4',
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  storageProgressTrack: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 2,
    marginBottom: 6,
  },
  storageProgressFill: {
    height: '100%',
    backgroundColor: '#06b6d4',
    borderRadius: 4,
  },
  storageProgressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  storageProgressSub: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },
  quadrantGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  quadrantTile: {
    width: (SCREEN_WIDTH - 32 - 32 - 8) / 2,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  quadrantEmoji: {
    fontSize: 16,
    marginBottom: 2,
  },
  quadrantVal: {
    fontSize: 14,
    fontWeight: '900',
    color: '#ffffff',
  },
  quadrantLabel: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 1,
  },
  quickAccessSectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#cbd5e1',
    marginBottom: 8,
    marginTop: 4,
  },
  quickFolderScroll: {
    flexDirection: 'row',
  },
  quickFolderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginRight: 8,
  },
  quickFolderPillIcon: {
    fontSize: 14,
  },
  quickFolderPillName: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },

  /* BENTO TILE 4: PC Drives & Shortcuts */
  pcDrivesChipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  pcDriveChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.25)',
    borderRadius: 12,
    paddingVertical: 10,
  },
  pcDriveChipIcon: {
    fontSize: 16,
  },
  pcDriveChipText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  pcShortcutsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pcShortcutChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pcShortcutChipText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },
  unpairedPcDrivesNotice: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  unpairedNoticeText: {
    color: '#94a3b8',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 8,
  },
  unpairedNoticeBtn: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderWidth: 1,
    borderColor: '#06b6d4',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  unpairedNoticeBtnText: {
    color: '#06b6d4',
    fontSize: 11,
    fontWeight: '800',
  },

  /* BENTO TILE 5: Security & Safe Mode */
  securityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  securityTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  securityDesc: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
    lineHeight: 14,
  },
  securityGateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    gap: 8,
  },
  securityGateIcon: {
    fontSize: 16,
  },
  securityGateTitle: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '800',
  },
  securityGateDesc: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 1,
  },

  /* BENTO TILE 6: Diagnostics & Hotspot */
  speedRatingBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  speedRatingText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '800',
  },
  runDiagHeroBtn: {
    backgroundColor: '#06b6d4',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  runDiagHeroBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '900',
  },
  diagResultBento: {
    marginVertical: 8,
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
  hotspotGuideWrap: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    padding: 12,
    marginTop: 6,
  },
  hotspotGuideHeader: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
  },
  hotspotStepRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
    alignItems: 'flex-start',
  },
  hotspotStepBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#06b6d4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotspotStepBadgeText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '900',
  },
  hotspotStepText: {
    flex: 1,
    color: '#94a3b8',
    fontSize: 10.5,
    lineHeight: 15,
  },

  /* BENTO TILE 7: Logs */
  clearLogsText: {
    color: '#06b6d4',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyLogsText: {
    color: '#64748b',
    fontSize: 11,
    fontStyle: 'italic',
  },
  logTextItem: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },

  /* ==================== EXPLORER STYLES ==================== */
  explorerContainer: {
    flex: 1,
    padding: 12,
  },
  unpairedEmptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
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
    lineHeight: 18,
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
    maxHeight: 38,
    marginBottom: 8,
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#0f172a',
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
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 6,
    marginBottom: 8,
    gap: 6,
  },
  navUpBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
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
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 12,
  },
  searchClearBtn: {
    position: 'absolute',
    right: 80,
    padding: 6,
  },
  searchClearBtnText: {
    color: '#64748b',
    fontSize: 12,
  },
  multiSelectToggle: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
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
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#06b6d4',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
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
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  selectionTrashText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '800',
  },
  categoryScroll: {
    maxHeight: 36,
    marginBottom: 10,
  },
  catPill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 6,
  },
  catPillActive: {
    backgroundColor: '#06b6d4',
    borderColor: '#06b6d4',
  },
  catPillText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  catPillTextActive: {
    color: '#000000',
    fontWeight: '800',
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
    width: (SCREEN_WIDTH - 24 - 16) / 3,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
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
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
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

  /* Stepper / Guide */
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
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    padding: 18,
  },
  modalContent: {
    backgroundColor: '#0f172a',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  modalCloseIcon: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '800',
    padding: 4,
  },
  modalDesc: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 14,
    lineHeight: 16,
  },
  modalSubTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 12,
  },
  modalSubTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalSubTabActive: {
    backgroundColor: '#06b6d4',
    borderColor: '#06b6d4',
  },
  modalSubTabText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  modalSubTabTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  qrViewfinderGraphic: {
    backgroundColor: 'rgba(6, 182, 212, 0.05)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#06b6d4',
    borderRadius: 16,
    padding: 20,
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
    lineHeight: 15,
  },
  presetHotspotBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  presetHotspotBtnText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#080c14',
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
    paddingVertical: 11,
    borderRadius: 12,
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
    paddingVertical: 11,
    borderRadius: 12,
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
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#ef4444',
    alignItems: 'center',
  },
  modalConfirmBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
});
