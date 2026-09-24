import React, { useState, useEffect, useRef } from 'react';
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

const Win11FolderIcon = () => (
  <View style={styles.win11FolderWrap}>
    <View style={styles.win11FolderBackTab} />
    <View style={styles.win11FolderBack} />
    <View style={styles.win11FolderFront} />
  </View>
);

export default function App() {
  const [currentTab, setCurrentTab] = useState('server'); // 'server' | 'pc-explorer'
  const [serverRunning, setServerRunning] = useState(false);
  const [deviceIp, setDeviceIp] = useState('Detecting...');
  const [serverPort, setServerPort] = useState(8080);
  const [hasPermission, setHasPermission] = useState(false);
  const [readOnlyMode, setReadOnlyMode] = useState(true);
  const [pairedPc, setPairedPc] = useState(null);
  const [showPairModal, setShowPairModal] = useState(false);
  const [manualPcIp, setManualPcIp] = useState('');
  const [manualAuthToken, setManualAuthToken] = useState('');
  const [logs, setLogs] = useState([]);
  const [storageInfo, setStorageInfo] = useState({ totalGB: '--', freeGB: '--' });
  const deviceIdRef = useRef('phone-' + Math.random().toString(36).substring(2, 9));

  // PC Explorer State
  const [pcQuickAccess, setPcQuickAccess] = useState({ drives: [], shortcuts: [] });
  const [pcCurrentPath, setPcCurrentPath] = useState('');
  const [pcParentPath, setPcParentPath] = useState('');
  const [pcItems, setPcItems] = useState([]);
  const [pcLoading, setPcLoading] = useState(false);
  const [pcFilter, setPcFilter] = useState('all');
  const [pcPreviewItem, setPcPreviewItem] = useState(null);

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 25)]);
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Heartbeat loop while paired with PC (prevents PC from timing out the phone)
  useEffect(() => {
    if (!pairedPc) return;

    let failCount = 0;
    const heartbeatTimer = setInterval(async () => {
      try {
        const res = await fetch(`http://${pairedPc}/api/mobile/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
  }, [pairedPc, storageInfo, readOnlyMode]);

  // When switching to PC Explorer tab and paired, load quick access
  useEffect(() => {
    if (currentTab === 'pc-explorer' && pairedPc) {
      loadPcQuickAccess();
    }
  }, [currentTab, pairedPc]);

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
          await FyloModule.startServer(serverPort, readOnlyMode, manualAuthToken || '');
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceIdRef.current }),
      });
    } catch (e) {}
    addLog(`Unpaired from ${pairedPc}`);
    setPairedPc(null);
  };

  const handleConnectToPc = async (pcIp, token) => {
    if (!pcIp) {
      Alert.alert('Missing IP', 'Please enter your PC local IP address.');
      return;
    }

    let cleanIp = pcIp.trim().replace(/^https?:\/\//, '');
    let host = cleanIp.split(':')[0];
    let port = cleanIp.includes(':') ? cleanIp.split(':')[1] : '3000';

    try {
      addLog(`Pairing with PC at ${host}:${port}...`);
      if (token && FyloModule && FyloModule.setAuthToken) {
        await FyloModule.setAuthToken(token.trim());
      }

      const payload = {
        deviceId: deviceIdRef.current,
        deviceName: Platform.constants?.Model || 'Android Device',
        model: Platform.constants?.Brand || 'Android',
        ip: deviceIp,
        port: serverPort,
        authToken: token ? token.trim() : '',
        readOnly: readOnlyMode,
        storage: {
          total: storageInfo.totalGB || 'Unknown',
          free: storageInfo.freeGB || 'Unknown',
        },
        battery: 95,
      };

      const res = await fetch(`http://${host}:${port}/api/mobile/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPairedPc(`${host}:${port}`);
        setShowPairModal(false);
        addLog(`Successfully paired with PC (${host})!`);
        Alert.alert('Paired!', 'PC can now browse this phone, and you can browse PC files in the "Browse PC" tab.');
      } else {
        Alert.alert('Pairing Failed', data.error || 'PC rejected pairing request.');
      }
    } catch (e) {
      Alert.alert('Connection Failed', `Could not connect to PC at ${host}:${port}. Verify both devices are on the same Wi-Fi or Hotspot.`);
    }
  };

  // ==========================================
  // PC Explorer Functions (Browse PC Files on Mobile)
  // ==========================================
  const loadPcQuickAccess = async () => {
    if (!pairedPc) return;
    try {
      const res = await fetch(`http://${pairedPc}/api/pc/explorer/quick-access`);
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

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setPcCurrentPath(data.path);
        setPcParentPath(data.parent);
        setPcItems(data.items || []);
      } else {
        Alert.alert('Error', 'Could not open folder on PC');
      }
    } catch (err) {
      Alert.alert('Network Error', 'Failed to reach PC: ' + err.message);
    } finally {
      setPcLoading(false);
    }
  };

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

  // Filtered PC items
  const filteredPcItems = pcItems.filter((item) => {
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#090a0f" />

      {/* Main Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.logo}>fylo</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>v4.0 Mobile</Text>
          </View>
        </View>

        {/* Tab Switcher */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, currentTab === 'server' && styles.tabButtonActive]}
            onPress={() => setCurrentTab('server')}>
            <Text style={[styles.tabButtonText, currentTab === 'server' && styles.tabButtonTextActive]}>
              📱 Phone Host
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, currentTab === 'pc-explorer' && styles.tabButtonActive]}
            onPress={() => setCurrentTab('pc-explorer')}>
            <Text style={[styles.tabButtonText, currentTab === 'pc-explorer' && styles.tabButtonTextActive]}>
              💻 Browse PC
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* TAB 1: PHONE HOST SERVER VIEW */}
      {currentTab === 'server' && (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Permission Banner */}
          {!hasPermission && (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>⚠️ Storage Permission Required</Text>
              <Text style={styles.permissionDesc}>
                Android 11-15 requires "All Files Access" so the Fylo desktop app can browse folders on this device.
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
              <View style={[styles.statusDot, { backgroundColor: serverRunning ? '#2ed573' : '#ff4757' }]} />
            </View>

            <View style={styles.serverActionRow}>
              <TouchableOpacity
                style={[styles.mainBtn, { backgroundColor: serverRunning ? '#ff4757' : '#00d2d3' }]}
                onPress={handleToggleServer}>
                <Text style={styles.mainBtnText}>{serverRunning ? 'Stop Server' : 'Start Server'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pairBtn} onPress={() => setShowPairModal(true)}>
                <Text style={styles.pairBtnText}>{pairedPc ? 'Re-Pair PC' : 'Pair with PC'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Screen Lock Keep-Alive Notice */}
          <View style={styles.keepAliveCard}>
            <Text style={styles.keepAliveIcon}>🔒</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.keepAliveTitle}>Lock Screen Protected</Text>
              <Text style={styles.keepAliveDesc}>
                Background foreground service keeps Wi-Fi & server awake even when phone screen turns off.
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
                trackColor={{ false: '#767577', true: '#00d2d3' }}
                thumbColor={readOnlyMode ? '#ffffff' : '#f4f3f4'}
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

      {/* TAB 2: BROWSE PC FILESYSTEM VIEW */}
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
              {/* Quick Access Shortcuts Shelf */}
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

              {/* Files & Folders List */}
              {pcLoading ? (
                <View style={styles.centerLoading}>
                  <ActivityIndicator size="large" color="#00d2d3" />
                  <Text style={styles.loadingText}>Loading PC folder...</Text>
                </View>
              ) : filteredPcItems.length === 0 ? (
                <View style={styles.centerLoading}>
                  <Text style={styles.emptyFolderText}>Folder is empty</Text>
                </View>
              ) : (
                <ScrollView contentContainerStyle={styles.fileListContent}>
                  {filteredPcItems.map((item, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.fileRow}
                      onPress={() => {
                        if (item.isDir) {
                          loadPcFolder(item.path);
                        } else {
                          const ext = (item.ext || '').toLowerCase();
                          if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
                            setPcPreviewItem(item);
                          } else {
                            Alert.alert(
                              item.name,
                              `Size: ${formatFileSize(item.size)}\nType: ${item.ext.toUpperCase()}`,
                              [
                                { text: 'Close', style: 'cancel' },
                                {
                                  text: 'View in Gallery',
                                  onPress: () => setPcPreviewItem(item),
                                },
                              ]
                            );
                          }
                        }
                      }}>
                      {item.isDir ? (
                        <Win11FolderIcon />
                      ) : (
                        <Text style={styles.fileRowIcon}>{getFileIcon(item.ext, item.isDir)}</Text>
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
                  ))}
                </ScrollView>
              )}
            </View>
          )}
        </View>
      )}

      {/* Full-Screen Media Lightbox Modal on Phone (Instant Viewing!) */}
      {pcPreviewItem && (
        <Modal visible={!!pcPreviewItem} transparent animationType="fade">
          <View style={styles.galleryModalOverlay}>
            <View style={styles.galleryHeader}>
              <Text style={styles.galleryFileName} numberOfLines={1}>
                {pcPreviewItem.name}
              </Text>
              <TouchableOpacity style={styles.galleryCloseBtn} onPress={() => setPcPreviewItem(null)}>
                <Text style={styles.galleryCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.galleryBody}>
              {['jpg', 'jpeg', 'png', 'webp', 'gif'].includes((pcPreviewItem.ext || '').toLowerCase()) ? (
                <Image
                  source={{
                    uri: `http://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(pcPreviewItem.path)}`,
                  }}
                  style={styles.galleryImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.galleryNonImgContainer}>
                  <Text style={{ fontSize: 64 }}>{getFileIcon(pcPreviewItem.ext, false)}</Text>
                  <Text style={styles.galleryNonImgTitle}>{pcPreviewItem.name}</Text>
                  <Text style={styles.galleryNonImgMeta}>{formatFileSize(pcPreviewItem.size)}</Text>
                </View>
              )}
            </View>

            <View style={styles.galleryFooter}>
              <TouchableOpacity
                style={styles.galleryDlBtn}
                onPress={() => {
                  Alert.alert('Download', `File stream ready at:\nhttp://${pairedPc}/api/pc/explorer/file?path=${encodeURIComponent(pcPreviewItem.path)}&download=1`);
                }}>
                <Text style={styles.galleryDlBtnText}>⬇ Save to Phone</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Manual / QR Pairing Modal */}
      <Modal visible={showPairModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Pair with PC</Text>
            <Text style={styles.modalDesc}>
              Enter the IP and Port displayed on your PC screen in Fylo (e.g. 192.168.1.5:3000):
            </Text>

            <TextInput
              style={styles.input}
              placeholder="e.g. 192.168.1.5:3000"
              placeholderTextColor="#747d8c"
              value={manualPcIp}
              onChangeText={setManualPcIp}
              autoCapitalize="none"
            />

            <TextInput
              style={styles.input}
              placeholder="Auth Token (optional if on same LAN)"
              placeholderTextColor="#747d8c"
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
    backgroundColor: '#090a0f',
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  logo: {
    fontSize: 26,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -1,
  },
  badge: {
    backgroundColor: 'rgba(0, 210, 211, 0.15)',
    borderWidth: 1,
    borderColor: '#00d2d3',
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  badgeText: {
    color: '#00d2d3',
    fontSize: 11,
    fontWeight: '800',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#141826',
    borderRadius: 14,
    padding: 3,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 11,
  },
  tabButtonActive: {
    backgroundColor: '#00d2d3',
  },
  tabButtonText: {
    color: '#a4b0be',
    fontSize: 12,
    fontWeight: '800',
  },
  tabButtonTextActive: {
    color: '#000000',
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 40,
  },
  permissionCard: {
    backgroundColor: 'rgba(255, 165, 2, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 2, 0.3)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  permissionTitle: {
    color: '#ffa502',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  permissionDesc: {
    color: '#ced6e0',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  permissionBtn: {
    backgroundColor: '#ffa502',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  permissionBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 12,
  },
  card: {
    backgroundColor: 'rgba(20, 24, 38, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#a4b0be',
    marginTop: 2,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  serverActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  mainBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  pairBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  keepAliveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(46, 213, 115, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(46, 213, 115, 0.25)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  keepAliveIcon: {
    fontSize: 20,
  },
  keepAliveTitle: {
    color: '#2ed573',
    fontWeight: '800',
    fontSize: 12,
  },
  keepAliveDesc: {
    color: '#a4b0be',
    fontSize: 11,
    marginTop: 1,
    lineHeight: 15,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  settingLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  settingDesc: {
    fontSize: 11,
    color: '#a4b0be',
    marginTop: 2,
  },
  storageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  storageLabel: {
    color: '#a4b0be',
    fontSize: 12,
    fontWeight: '600',
  },
  storageVal: {
    color: '#00d2d3',
    fontSize: 13,
    fontWeight: '800',
  },
  emptyLogs: {
    color: '#747d8c',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 6,
  },
  logText: {
    color: '#a4b0be',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  unpairBtn: {
    backgroundColor: 'rgba(255, 71, 87, 0.15)',
    borderWidth: 1,
    borderColor: '#ff4757',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  unpairBtnText: {
    color: '#ff4757',
    fontSize: 11,
    fontWeight: '700',
  },

  /* PC Explorer Styles */
  explorerContainer: {
    flex: 1,
    padding: 14,
  },
  unpairedEmptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  unpairedIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  unpairedTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
  },
  unpairedDesc: {
    fontSize: 13,
    color: '#a4b0be',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 24,
    maxWidth: 320,
  },
  unpairedBtn: {
    backgroundColor: '#00d2d3',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 16,
  },
  unpairedBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  quickAccessScroll: {
    maxHeight: 46,
    marginBottom: 10,
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#141826',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 8,
    justifyContent: 'center',
  },
  quickChipActive: {
    borderColor: '#00d2d3',
    backgroundColor: 'rgba(0, 210, 211, 0.15)',
  },
  quickChipText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141826',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 6,
    marginBottom: 10,
    gap: 8,
  },
  navUpBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  navUpBtnDisabled: {
    opacity: 0.3,
  },
  navUpBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  pathScroll: {
    flex: 1,
  },
  pathText: {
    color: '#a4b0be',
    fontSize: 12,
    fontWeight: '700',
  },
  refreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  refreshBtnText: {
    color: '#00d2d3',
    fontSize: 18,
    fontWeight: '800',
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  catPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  catPillActive: {
    backgroundColor: '#00d2d3',
  },
  catPillText: {
    color: '#a4b0be',
    fontSize: 11,
    fontWeight: '700',
  },
  catPillTextActive: {
    color: '#000000',
  },
  fileListContent: {
    paddingBottom: 30,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141826',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    gap: 12,
  },
  fileRowIcon: {
    fontSize: 22,
  },
  fileRowDetails: {
    flex: 1,
  },
  fileRowName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  fileRowMeta: {
    color: '#747d8c',
    fontSize: 11,
    marginTop: 2,
  },
  fileRowChevron: {
    color: '#00d2d3',
    fontSize: 16,
    fontWeight: '800',
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    color: '#a4b0be',
    marginTop: 10,
    fontSize: 12,
  },
  emptyFolderText: {
    color: '#747d8c',
    fontSize: 14,
    fontStyle: 'italic',
  },
  win11FolderWrap: {
    width: 28,
    height: 24,
    justifyContent: 'flex-end',
    position: 'relative',
  },
  win11FolderBackTab: {
    position: 'absolute',
    top: 0,
    left: 1,
    width: 12,
    height: 6,
    backgroundColor: '#d97706',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  win11FolderBack: {
    position: 'absolute',
    top: 4,
    left: 0,
    width: 28,
    height: 18,
    backgroundColor: '#f59e0b',
    borderRadius: 3,
  },
  win11FolderFront: {
    width: 28,
    height: 13,
    backgroundColor: '#fbbf24',
    borderRadius: 3,
  },

  /* Lightbox Modal */
  galleryModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(6, 8, 14, 0.96)',
  },
  galleryHeader: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  galleryFileName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
    marginRight: 12,
  },
  galleryCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 71, 87, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryCloseBtnText: {
    color: '#ff4757',
    fontSize: 16,
    fontWeight: '800',
  },
  galleryBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
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
    fontSize: 16,
    fontWeight: '800',
    marginTop: 14,
  },
  galleryNonImgMeta: {
    color: '#a4b0be',
    fontSize: 13,
    marginTop: 4,
  },
  galleryFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  galleryDlBtn: {
    backgroundColor: '#00d2d3',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  galleryDlBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },

  /* Modals */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#141826',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 13,
    color: '#a4b0be',
    marginBottom: 16,
    lineHeight: 18,
  },
  input: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 14,
    marginBottom: 12,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  modalConnectBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#00d2d3',
    alignItems: 'center',
  },
  modalConnectBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 14,
  },
});
