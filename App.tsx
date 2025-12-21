import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  Dimensions, SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Peer from 'peerjs';
import QRCode from 'react-native-qrcode-svg';
import { CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

// Assurez-vous que vos types sont à jour dans types.ts
import { 
  UserData, OperatorStatus, OperatorRole, ViewType, PingData 
} from './types';
import { CONFIG, STATUS_COLORS } from './constants';
import { audioService } from './services/audioService';
import OperatorCard from './components/OperatorCard';
import TacticalMap from './components/TacticalMap';

const App: React.FC = () => {
  useKeepAwake();

  // --- ÉTATS EXISTANTS ---
  const [view, setView] = useState<ViewType>('login');
  const [user, setUser] = useState<UserData>({
    id: '', callsign: '', role: OperatorRole.OPR,
    status: OperatorStatus.CLEAR, isTx: false,
    joinedAt: Date.now(), bat: 100, head: 0
  });
  const [peers, setPeers] = useState<Record<string, UserData>>({});
  const [pings, setPings] = useState<PingData[]>([]);
  const [hostId, setHostId] = useState<string>('');
  
  const [loginInput, setLoginInput] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [pingMsgInput, setPingMsgInput] = useState('');

  // --- NOUVEAUX ÉTATS (Fonctionnalités V14) ---
  const [silenceMode, setSilenceMode] = useState(false); // Mode Silence Radio
  const [isPingMode, setIsPingMode] = useState(false);
  const [mapMode, setMapMode] = useState<'dark' | 'light'>('dark');
  const [showTrails, setShowTrails] = useState(true);
  const [voxActive, setVoxActive] = useState(false);
  
  const [showQRModal, setShowQRModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showPingModal, setShowPingModal] = useState(false);
  const [tempPingLoc, setTempPingLoc] = useState<any>(null);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Record<string, any>>({});
  const lastLocationRef = useRef<any>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null);

  // --- LOGIQUE TOAST ---
  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type });
    if (type === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else Haptics.selectionAsync();
    setTimeout(() => setToast(null), 3000);
  }, []);

  // --- RÉSEAU (Broadcast & Handler) ---
  const broadcast = useCallback((data: any) => {
    Object.values(connectionsRef.current).forEach((conn: any) => {
      if (conn.open) conn.send(data);
    });
  }, []);

  const handleData = useCallback((data: any, fromId: string) => {
    switch (data.type) {
      case 'UPDATE_USER':
        setPeers(prev => ({ ...prev, [fromId]: data.user }));
        break;
      case 'SYNC_PEERS':
        setPeers(data.peers);
        break;
      case 'PING':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPings(prev => [...prev, data.ping]);
        showToast(`CIBLE: ${data.ping.msg}`);
        break;
      case 'UPDATE_PING':
        setPings(prev => prev.map(p => p.id === data.ping.id ? data.ping : p));
        break;
      case 'DELETE_PING':
        setPings(prev => prev.filter(p => p.id !== data.pingId));
        break;
      case 'SILENCE': // Nouveau : Synchro du Silence Radio
        setSilenceMode(data.state);
        showToast(data.state ? "SILENCE RADIO ACTIF" : "FIN DU SILENCE");
        break;
    }
  }, [showToast]);

  // --- PEERJS INIT ---
  const initPeer = useCallback((initialRole: OperatorRole, targetHostId?: string) => {
    if (peerRef.current) peerRef.current.destroy();

    const p = new Peer(undefined, CONFIG.PEER_CONFIG as any);
    peerRef.current = p;

    p.on('open', (pid) => {
      setUser(prev => ({ ...prev, id: pid }));
      if (initialRole === OperatorRole.HOST) {
        setHostId(pid);
        showToast(`SESSION HOST: ${pid}`);
      } else if (targetHostId) {
        connectToHost(targetHostId);
      }
    });

    p.on('connection', (conn) => {
      connectionsRef.current[conn.peer] = conn;
      conn.on('data', (data: any) => handleData(data, conn.peer));
      conn.on('open', () => {
        if (initialRole === OperatorRole.HOST) {
          // Sync initiale + État Silence
          conn.send({ type: 'SYNC_PEERS', peers });
          if(silenceMode) conn.send({ type: 'SILENCE', state: true });
        }
      });
    });

    p.on('call', (call) => {
      if (!audioService.stream) return;
      call.answer(audioService.stream);
      call.on('stream', (remoteStream) => {
        audioService.playStream(remoteStream);
      });
    });
    
    p.on('error', (err) => showToast(`ERR: ${err.type}`, 'error'));
  }, [peers, handleData, showToast, silenceMode]);

  const connectToHost = useCallback((targetId: string) => {
    if (!peerRef.current || !audioService.stream) return;
    
    const conn = peerRef.current.connect(targetId);
    connectionsRef.current[targetId] = conn;
    
    conn.on('open', () => {
      showToast("CONNECTÉ AU QG");
      conn.send({ type: 'UPDATE_USER', user });
      const call = peerRef.current!.call(targetId, audioService.stream!);
      call.on('stream', (remoteStream) => {
        audioService.playStream(remoteStream);
      });
    });
    
    conn.on('data', (data: any) => handleData(data, targetId));
  }, [user, handleData, showToast]);

  const setStatus = (s: OperatorStatus) => {
    setUser(prev => {
      const u = { ...prev, status: s };
      broadcast({ type: 'UPDATE_USER', user: u });
      return u;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // --- SERVICES (Audio, GPS) ---
  const startServices = async () => {
    const audioOk = await audioService.init();
    if (!audioOk) showToast("ERREUR MICRO", "error");
    
    // Logique VAD (Voice Activity Detection)
    audioService.startMetering((level) => {
      if (audioService.mode === 'vox' && !silenceMode) { // VAD coupé en silence
        const shouldTx = level > CONFIG.VAD_THRESHOLD;
        if (shouldTx !== audioService.isTx) {
          audioService.setTx(shouldTx);
          setUser(prev => {
            const u = { ...prev, isTx: shouldTx };
            broadcast({ type: 'UPDATE_USER', user: u });
            return u;
          });
        }
      }
    });

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return showToast("GPS REQUIS", "error");

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 },
      (loc) => {
        const { latitude, longitude, heading, speed } = loc.coords;
        setUser(prev => {
          const newHead = (speed && speed > 0.5 && heading !== null) ? heading : prev.head;
          const newUser = { ...prev, lat: latitude, lng: longitude, head: newHead || prev.head };
          
          if (!lastLocationRef.current || 
              Math.abs(latitude - lastLocationRef.current.lat) > 0.0001 || 
              Math.abs(longitude - lastLocationRef.current.lng) > 0.0001) {
            broadcast({ type: 'UPDATE_USER', user: newUser });
            lastLocationRef.current = { lat: latitude, lng: longitude };
          }
          return newUser;
        });
      }
    );
  };

  // --- ACTIONS UTILISATEUR ---
  const handleLogin = async () => {
    const tri = loginInput.toUpperCase();
    if (tri.length < 2) return showToast("Trigramme trop court", "error");
    setUser(prev => ({ ...prev, callsign: tri }));
    await startServices();
    setView('menu');
  };

  const createSession = () => {
    const role = OperatorRole.HOST;
    setUser(prev => ({ ...prev, role }));
    initPeer(role);
    setView('ops');
  };

  const joinSession = (id?: string) => {
    const finalId = id || hostInput.toUpperCase();
    if (!finalId) return showToast("ID Manquant", "error");
    setHostId(finalId);
    const role = OperatorRole.OPR;
    setUser(prev => ({ ...prev, role }));
    initPeer(role, finalId);
    setView('ops');
  };

  const handleScannerBarCodeScanned = ({ data }: any) => {
    setShowScanner(false);
    setHostInput(data);
    setTimeout(() => joinSession(data), 500);
  };

  // --- NOUVEAU : LOGIQUE PING & SILENCE ---

  const handleLongPressMap = (e: any) => {
    // Appelé par TacticalMap lors d'un appui long
    const coord = e.nativeEvent.coordinate;
    setTempPingLoc({ lat: coord.latitude, lng: coord.longitude });
    setShowPingModal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const confirmPing = () => {
    const msg = pingMsgInput || "CIBLE";
    if (tempPingLoc) {
        const ping: PingData = {
          id: Date.now().toString(), lat: tempPingLoc.lat, lng: tempPingLoc.lng,
          msg, sender: user.callsign, timestamp: Date.now() // Ajout timestamp
        };
        setPings(prev => [...prev, ping]);
        broadcast({ type: 'PING', ping });
    }
    setIsPingMode(false);
    setShowPingModal(false);
    setTempPingLoc(null);
    setPingMsgInput('');
  };

  const toggleSilence = () => {
    // Seul le Host peut activer le silence
    if (user.role !== OperatorRole.HOST) return showToast("Hôte requis", "error");
    
    const newState = !silenceMode;
    setSilenceMode(newState);
    broadcast({ type: 'SILENCE', state: newState });
    showToast(newState ? "SILENCE RADIO ACTIVÉ" : "SILENCE DÉSACTIVÉ");
    
    // Si on active le silence, on coupe l'audio local
    if (newState) {
        setVoxActive(false);
        audioService.setTx(false);
        setUser(prev => ({...prev, isTx: false}));
    }
  };

  const handlePTTPressIn = () => {
    if (silenceMode && user.role !== OperatorRole.HOST) {
        showToast("SILENCE RADIO EN COURS", "error");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
    }

    if (!voxActive) { 
        audioService.setTx(true); 
        setUser(prev => { 
            const u = {...prev, isTx:true}; 
            broadcast({type:'UPDATE_USER', user:u}); 
            return u; 
        }); 
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); 
    }
  };

  const handlePTTPressOut = () => {
    if (!voxActive) { 
        audioService.setTx(false); 
        setUser(prev => { 
            const u = {...prev, isTx:false}; 
            broadcast({type:'UPDATE_USER', user:u}); 
            return u; 
        }); 
    }
  };

  // --- RENDERERS ---

  const renderLogin = () => (
    <View style={styles.centerContainer}>
      <MaterialIcons name="fingerprint" size={80} color="#3b82f6" style={{opacity: 0.8, marginBottom: 30}} />
      <Text style={styles.title}>COM<Text style={{color: '#3b82f6'}}>TAC</Text> v14</Text>
      <TextInput 
        style={styles.input} placeholder="TRIGRAMME" placeholderTextColor="#52525b"
        maxLength={5} value={loginInput} onChangeText={setLoginInput} autoCapitalize="characters"
      />
      <TouchableOpacity onPress={handleLogin} style={styles.loginBtn}>
        <Text style={styles.loginBtnText}>CONNEXION</Text>
      </TouchableOpacity>
    </View>
  );

  const renderMenu = () => (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.menuContainer}>
        <Text style={styles.sectionTitle}>DÉPLOIEMENT OPÉRATIONNEL</Text>
        <TouchableOpacity onPress={createSession} style={styles.menuCard}>
          <MaterialIcons name="add-circle" size={40} color="#3b82f6" />
          <View style={{marginLeft: 20}}>
            <Text style={styles.menuCardTitle}>Créer Salon</Text>
            <Text style={styles.menuCardSubtitle}>Hôte / Chef de groupe</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.divider} />
        <View style={styles.joinHeader}>
            <Text style={styles.sectionTitle}>REJOINDRE CANAL</Text>
            <TouchableOpacity onPress={() => setShowScanner(true)} style={styles.scanBtn}>
                <MaterialIcons name="qr-code-scanner" size={16} color="#3b82f6" />
                <Text style={styles.scanBtnText}>SCANNER</Text>
            </TouchableOpacity>
        </View>
        <TextInput 
            style={styles.inputBox} placeholder="ID CANAL..." placeholderTextColor="#52525b"
            value={hostInput} onChangeText={setHostInput} autoCapitalize="characters"
        />
        <TouchableOpacity onPress={() => joinSession()} style={styles.joinBtn}>
            <Text style={styles.joinBtnText}>REJOINDRE</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const renderDashboard = () => (
    <View style={{flex: 1}}>
      {/* HEADER AVEC BANDEAU SILENCE */}
      <View style={{backgroundColor: '#09090b'}}>
          <SafeAreaView style={styles.header}>
            <View style={styles.headerContent}>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <MaterialIcons name="satellite" size={20} color="#3b82f6" />
                <Text style={styles.headerTitle}> COM<Text style={{color: '#3b82f6'}}>TAC</Text></Text>
              </View>
              <TouchableOpacity 
                onPress={() => setView(view === 'map' ? 'ops' : 'map')}
                style={[styles.navBtn, view === 'map' ? styles.navBtnActive : null]}
              >
                <MaterialIcons name="map" size={16} color={view === 'map' ? 'white' : '#a1a1aa'} />
                <Text style={[styles.navBtnText, view === 'map' ? {color:'white'} : null]}>MAP</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
          {silenceMode && (
             <View style={styles.silenceBanner}>
                <Text style={styles.silenceText}>SILENCE RADIO ACTIF - ÉCOUTE SEULE</Text>
             </View>
          )}
      </View>

      <View style={styles.mainContent}>
        {view === 'ops' ? (
          <View style={styles.grid}>
             <OperatorCard user={user} isMe />
             {Object.values(peers).map(p => <OperatorCard key={p.id} user={p} me={user} />)}
          </View>
        ) : (
          <View style={{flex: 1}}>
            {/* CARTE AVEC PROPS MIS À JOUR */}
            <TacticalMap 
              isDarkMode={mapMode === 'dark'}
              user={user}
              pings={pings}
              onLongPress={handleLongPressMap}
              // Compatibilité rétroactive si votre TacticalMap supporte encore ces props:
              peers={peers} 
              showTrails={showTrails}
            />
            
            <View style={styles.mapControls}>
                <TouchableOpacity onPress={() => setMapMode(m => m === 'dark' ? 'light' : 'dark')} style={styles.mapBtn}>
                    <MaterialIcons name={mapMode === 'dark' ? 'light-mode' : 'dark-mode'} size={24} color="#d4d4d8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowTrails(!showTrails)} style={styles.mapBtn}>
                    <MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color="#d4d4d8" />
                </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        {/* BARRE DE STATUT + BOUTON SILENCE (HÔTE SEULEMENT) */}
        <View style={styles.statusRow}>
            {user.role === OperatorRole.HOST ? (
               <TouchableOpacity 
                  onPress={toggleSilence}
                  style={[styles.statusBtn, silenceMode ? {backgroundColor: '#ef4444', borderColor: '#fff'} : {borderColor: '#ef4444'}]}
               >
                   <Text style={[styles.statusBtnText, silenceMode ? {color:'white'} : {color: '#ef4444'}]}>SILENCE</Text>
               </TouchableOpacity>
            ) : null}

            {[OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                <TouchableOpacity 
                    key={s} onPress={() => setStatus(s)}
                    style={[styles.statusBtn, user.status === s ? { backgroundColor: STATUS_COLORS[s], borderColor: 'white' } : null]}
                >
                    <Text style={[styles.statusBtnText, user.status === s ? {color:'white'} : null]}>{s}</Text>
                </TouchableOpacity>
            ))}
        </View>

        <View style={styles.controlsRow}>
            <TouchableOpacity 
                onPress={() => { setVoxActive(!voxActive); audioService.toggleVox(); }}
                style={[styles.voxBtn, voxActive ? {backgroundColor:'#16a34a', borderColor:'#4ade80'} : null]}
            >
                <MaterialIcons name={voxActive ? 'mic' : 'mic-none'} size={24} color={voxActive ? 'white' : '#a1a1aa'} />
            </TouchableOpacity>

            <TouchableOpacity
                onPressIn={handlePTTPressIn}
                onPressOut={handlePTTPressOut}
                style={[
                    styles.pttBtn, 
                    user.isTx ? {backgroundColor: '#2563eb', borderColor: 'white'} : null,
                    silenceMode && user.role !== OperatorRole.HOST ? {borderColor: '#333', opacity: 0.5} : null
                ]}
                disabled={silenceMode && user.role !== OperatorRole.HOST}
            >
                <MaterialIcons name="mic" size={40} color={user.isTx ? 'white' : '#3f3f46'} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowQRModal(true)} style={styles.qrBtn}>
                <MaterialIcons name="qr-code-2" size={24} color="#d4d4d8" />
            </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#050505" />
      {view === 'login' && renderLogin()}
      {view === 'menu' && renderMenu()}
      {(view === 'ops' || view === 'map') && renderDashboard()}

      <Modal visible={showQRModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>ID OPÉRATEUR</Text>
                <QRCode value={user.id || 'N/A'} size={200} />
                <Text style={styles.qrId}>{user.id}</Text>
                <TouchableOpacity onPress={() => setShowQRModal(false)} style={styles.closeBtn}>
                    <Text style={styles.closeBtnText}>FERMER</Text>
                </TouchableOpacity>
            </View>
        </View>
      </Modal>

      <Modal visible={showScanner} animationType="slide">
        <View style={{flex: 1, backgroundColor: 'black'}}>
             <CameraView style={{flex: 1}} onBarcodeScanned={handleScannerBarCodeScanned} barcodeScannerSettings={{barcodeTypes: ["qr"]}} />
             <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerClose}>
                <MaterialIcons name="close" size={30} color="white" />
             </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={showPingModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {backgroundColor: '#18181b'}]}>
                <Text style={[styles.modalTitle, {color: 'white'}]}>NOUVEAU PING</Text>
                <TextInput style={styles.pingInput} placeholder="NOM DU PING..." placeholderTextColor="#71717a" value={pingMsgInput} onChangeText={setPingMsgInput} autoFocus />
                <View style={{flexDirection: 'row', gap: 10}}>
                    <TouchableOpacity onPress={() => setShowPingModal(false)} style={[styles.modalBtn, {backgroundColor: '#27272a'}]}>
                        <Text style={{color: '#a1a1aa', fontWeight:'bold'}}>ANNULER</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={confirmPing} style={[styles.modalBtn, {backgroundColor: '#2563eb'}]}>
                        <Text style={{color: 'white', fontWeight:'bold'}}>ENVOYER</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
      </Modal>

      {toast && (
        <View style={[styles.toast, toast.type === 'error' ? {backgroundColor: '#7f1d1d'} : null]}>
            <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  title: { fontSize: 32, fontWeight: '900', color: 'white', letterSpacing: 5, marginBottom: 50 },
  input: { width: '100%', borderBottomWidth: 2, borderBottomColor: '#27272a', fontSize: 30, color: 'white', textAlign: 'center', padding: 10 },
  loginBtn: { marginTop: 50, width: '100%', backgroundColor: '#2563eb', padding: 20, borderRadius: 16, alignItems: 'center' },
  loginBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  safeArea: { flex: 1, backgroundColor: '#050505', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 },
  menuContainer: { flex: 1, padding: 24 },
  sectionTitle: { color: '#71717a', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 15 },
  menuCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181b', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  menuCardTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  menuCardSubtitle: { color: '#71717a', fontSize: 12 },
  divider: { height: 1, backgroundColor: '#27272a', marginVertical: 30 },
  joinHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  scanBtnText: { color: '#3b82f6', fontWeight: 'bold', fontSize: 12 },
  inputBox: { backgroundColor: '#18181b', borderRadius: 16, padding: 20, fontSize: 20, color: 'white', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', marginBottom: 15 },
  joinBtn: { backgroundColor: '#27272a', padding: 20, borderRadius: 16, alignItems: 'center' },
  joinBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  header: { backgroundColor: '#09090b', borderBottomWidth: 1, borderBottomColor: '#27272a', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 },
  headerContent: { height: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  headerTitle: { color: 'white', fontWeight: '900', fontSize: 18 },
  navBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: '#27272a', gap: 5, backgroundColor: '#18181b' },
  navBtnActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  navBtnText: { color: '#a1a1aa', fontSize: 10, fontWeight: 'bold' },
  silenceBanner: { backgroundColor: '#ef4444', padding: 8, alignItems: 'center', width: '100%' },
  silenceText: { color: 'white', fontWeight: 'bold', fontSize: 12, letterSpacing: 1 },
  mainContent: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 12 },
  footer: { backgroundColor: '#050505', borderTopWidth: 1, borderTopColor: '#27272a', paddingBottom: 40 },
  statusRow: { flexDirection: 'row', padding: 12, gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statusBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  statusBtnText: { color: '#71717a', fontSize: 10, fontWeight: 'bold' },
  controlsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 30, marginTop: 10 },
  voxBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#27272a' },
  pttBtn: { width: 90, height: 90, borderRadius: 30, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#27272a' },
  qrBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#27272a' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 30 },
  modalContent: { width: '100%', backgroundColor: 'white', padding: 24, borderRadius: 24, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20 },
  qrId: { marginTop: 20, fontSize: 10, backgroundColor: '#f4f4f5', padding: 8, borderRadius: 4 },
  closeBtn: { marginTop: 20, backgroundColor: '#2563eb', width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
  closeBtnText: { color: 'white', fontWeight: 'bold' },
  scannerClose: { position: 'absolute', top: 50, right: 20, padding: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  mapControls: { position: 'absolute', top: 16, right: 16, gap: 12 },
  mapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  pingInput: { width: '100%', backgroundColor: 'black', color: 'white', padding: 16, borderRadius: 12, textAlign: 'center', fontSize: 18, marginBottom: 20 },
  modalBtn: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
  toast: { position: 'absolute', top: 50, alignSelf: 'center', backgroundColor: '#1e3a8a', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, zIndex: 9999 },
  toastText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
});

export default App;
