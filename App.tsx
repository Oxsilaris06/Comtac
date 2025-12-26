import './polyfills'; 
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, BackHandler, ScrollView, ActivityIndicator, PermissionsAndroid
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Peer from 'peerjs';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import * as Battery from 'expo-battery';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Magnetometer } from 'expo-sensors';
import NetInfo from '@react-native-community/netinfo';
import { Audio } from 'expo-av';
import * as SplashScreen from 'expo-splash-screen'; // NOUVEAU

import { UserData, OperatorStatus, OperatorRole, ViewType, PingData } from './types';
import { CONFIG, STATUS_COLORS } from './constants';
import { audioService } from './services/audioService';
import OperatorCard from './components/OperatorCard';
import TacticalMap from './components/TacticalMap';
import PrivacyConsentModal from './components/PrivacyConsentModal';
import OperatorActionModal from './components/OperatorActionModal';

// Empêche l'écran blanc de cacher le splash screen trop tôt
SplashScreen.preventAutoHideAsync().catch(() => {});

const generateShortId = () => Math.random().toString(36).substring(2, 10).toUpperCase();

const App: React.FC = () => {
  // ... (Hooks et State identiques à avant)
  useKeepAwake();
  const [permission, requestPermission] = useCameraPermissions();

  const [user, setUser] = useState<UserData>({
    id: '', callsign: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR, isTx: false,
    joinedAt: Date.now(), bat: 100, head: 0, lat: 0, lng: 0 
  });

  const [view, setView] = useState<ViewType>('login');
  const [peers, setPeers] = useState<Record<string, UserData>>({});
  const [pings, setPings] = useState<PingData[]>([]);
  const [bannedPeers, setBannedPeers] = useState<string[]>([]);
  
  const [hostId, setHostId] = useState<string>('');
  const [loginInput, setLoginInput] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [pingMsgInput, setPingMsgInput] = useState('');

  const [silenceMode, setSilenceMode] = useState(false);
  const [isPingMode, setIsPingMode] = useState(false);
  const [mapMode, setMapMode] = useState<'dark' | 'light' | 'satellite'>('dark');
  const [showTrails, setShowTrails] = useState(true);
  const [showPings, setShowPings] = useState(true);
  const [voxActive, setVoxActive] = useState(false);
  
  const [showQRModal, setShowQRModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showPingModal, setShowPingModal] = useState(false);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [tempPingLoc, setTempPingLoc] = useState<any>(null);
  const [privatePeerId, setPrivatePeerId] = useState<string | null>(null);

  const [hasConsent, setHasConsent] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  
  const [isServicesReady, setIsServicesReady] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');
  const [appIsReady, setAppIsReady] = useState(false); // Pour le splash screen

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Record<string, any>>({});
  const lastLocationRef = useRef<any>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null);

  // Initialisation UI (Cache le splash screen quand prêt)
  useEffect(() => {
      async function prepare() {
          try {
              // Chargement des préférences, etc.
              const saved = await AsyncStorage.getItem(CONFIG.TRIGRAM_STORAGE_KEY);
              if (saved) setLoginInput(saved);
          } catch (e) {
              console.warn(e);
          } finally {
              setAppIsReady(true);
              await SplashScreen.hideAsync();
          }
      }
      prepare();
  }, []);

  // --- START SERVICES ---
  const startServices = async () => {
    if (!hasConsent || isServicesReady) return;
    try {
        if (Platform.OS === 'android') {
            if (Platform.Version >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
            if (Platform.Version >= 31) await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
            ]);
        }
        await Audio.requestPermissionsAsync();
        
        await audioService.init(); 

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
             Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 }, (loc) => {
                 setUser(prev => ({...prev, lat: loc.coords.latitude, lng: loc.coords.longitude}));
                 setGpsStatus('OK');
             });
        }
        setIsServicesReady(true);
    } catch (e) { console.error("Init Error", e); }
  };

  useEffect(() => {
      if (hasConsent && user.callsign && view !== 'login') startServices();
  }, [hasConsent, view]); 

  // --- LOGIQUE METIER STANDARD ---
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const offline = !state.isConnected || !state.isInternetReachable;
      if (isOffline && !offline && view !== 'login' && hostId) {
          showToast("Reconnexion...", "info");
          setTimeout(() => { if (user.role === OperatorRole.HOST) initPeer(OperatorRole.HOST); else initPeer(OperatorRole.OPR, hostId); }, 2000);
      }
      setIsOffline(!!offline);
    });
    return unsubscribe;
  }, [isOffline, view, hostId, user.role]);

  useEffect(() => { const sub = audioService.subscribe((mode) => setVoxActive(mode === 'vox')); return sub; }, []);
  useEffect(() => { Battery.getBatteryLevelAsync().then(l => setUser(u => ({ ...u, bat: Math.floor(l * 100) }))); const sub = Battery.addBatteryLevelListener(({ batteryLevel }) => setUser(u => ({ ...u, bat: Math.floor(batteryLevel * 100) }))); return () => sub && sub.remove(); }, []);
  useEffect(() => { Magnetometer.setUpdateInterval(100); const sub = Magnetometer.addListener((data) => { let angle = Math.atan2(data.y, data.x) * (180 / Math.PI); angle = angle - 90; if (angle < 0) angle = 360 + angle; setUser(prev => { if (Math.abs(prev.head - angle) > 2) return { ...prev, head: Math.floor(angle) }; return prev; }); }); return () => sub && sub.remove(); }, []);
  
  // Back Handler
  useEffect(() => { const backAction = () => { if (selectedOperatorId) { setSelectedOperatorId(null); return true; } if (showQRModal) { setShowQRModal(false); return true; } if (showScanner) { setShowScanner(false); return true; } if (view === 'ops' || view === 'map') { Alert.alert("Déconnexion", user.role === OperatorRole.HOST ? "Fermer le salon ?" : "Quitter ?", [{ text: "Non", style: "cancel" }, { text: "QUITTER", onPress: handleLogout }]); return true; } return false; }; const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction); return () => backHandler.remove(); }, [view, user.role, selectedOperatorId, showQRModal, showScanner]);

  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type });
    if (type === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleLogout = () => {
      if (peerRef.current) peerRef.current.destroy();
      setPeers({}); setPings([]); setHostId(''); setView('login');
      audioService.setTx(false); setVoxActive(false);
      audioService.updateNotification("Déconnecté");
      setBannedPeers([]);
      setIsServicesReady(false);
  };

  const copyToClipboard = async () => { if (user.id) { await Clipboard.setStringAsync(user.id); showToast("ID Copié"); } };

  const broadcast = useCallback((data: any) => {
    if (!data.type && data.user) data = { type: 'UPDATE', user: data.user };
    data.from = user.id; 
    Object.values(connectionsRef.current).forEach((conn: any) => { if (conn.open) conn.send(data); });
  }, [user.id]);

  const mergePeer = useCallback((newPeer: UserData) => {
    setPeers(prev => {
        const next = { ...prev };
        const oldId = Object.keys(next).find(key => next[key].callsign === newPeer.callsign && key !== newPeer.id);
        if (oldId) delete next[oldId];
        next[newPeer.id] = newPeer;
        return next;
    });
  }, []);

  const handleData = useCallback((data: any, fromId: string) => {
    if (data.from === user.id) return;
    if (data.user && data.user.id === user.id) return;

    switch (data.type) {
      case 'UPDATE': case 'FULL': case 'UPDATE_USER':
        if (data.user && data.user.id !== user.id) mergePeer(data.user);
        break;
      case 'SYNC': case 'SYNC_PEERS':
        const list = data.list || (data.peers ? Object.values(data.peers) : []);
        if (list.length > 0) { list.forEach((u: UserData) => { if(u.id && u.id !== user.id) mergePeer(u); }); }
        if (data.silence !== undefined) setSilenceMode(data.silence);
        break;
      case 'PING':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPings(prev => [...prev, data.ping]);
        showToast(`PING: ${data.ping.msg}`);
        break;
      case 'PING_MOVE': 
        setPings(prev => prev.map(p => p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p));
        break;
      case 'PING_DELETE': 
        setPings(prev => prev.filter(p => p.id !== data.id));
        break;
      case 'SILENCE':
        setSilenceMode(data.state);
        showToast(data.state ? "SILENCE ACTIF" : "FIN SILENCE");
        break;
      case 'PRIVATE_REQ':
        Alert.alert("Appel Privé", `Demande de ${data.from}`, [
            { text: "Refuser", style: "cancel" },
            { text: "Accepter", onPress: () => {
                const conn = connectionsRef.current[data.from];
                if (conn) conn.send({ type: 'PRIVATE_ACK', from: user.id });
                enterPrivateMode(data.from);
            }}
        ]);
        break;
      case 'PRIVATE_ACK': enterPrivateMode(data.from); showToast("Canal Privé"); break;
      case 'PRIVATE_END': leavePrivateMode(); showToast("Fin Canal Privé"); break;
      case 'KICK': 
        if (peerRef.current) peerRef.current.destroy(); 
        Alert.alert("Exclu", "Vous avez été exclu."); 
        handleLogout(); 
        break;
    }
  }, [user.id, showToast, mergePeer]);

  const enterPrivateMode = (targetId: string) => {
      setPrivatePeerId(targetId);
      setUser(u => ({ ...u, status: OperatorStatus.BUSY }));
      broadcast({ type: 'UPDATE', user: { ...user, status: OperatorStatus.BUSY } });
  };

  const leavePrivateMode = () => {
      setPrivatePeerId(null);
      setUser(u => ({ ...u, status: OperatorStatus.CLEAR }));
      broadcast({ type: 'UPDATE', user: { ...user, status: OperatorStatus.CLEAR } });
  };

  const handleKickUser = (targetId: string) => {
      const conn = connectionsRef.current[targetId];
      if (conn) conn.send({ type: 'KICK', from: user.id });
      setBannedPeers(prev => [...prev, targetId]);
      if (conn) conn.close();
      delete connectionsRef.current[targetId];
      setPeers(prev => { const next = {...prev}; delete next[targetId]; return next; });
      setSelectedOperatorId(null);
      showToast("Utilisateur Banni");
  };

  const handleRequestPrivate = (targetId: string) => {
      const conn = connectionsRef.current[targetId];
      if(conn) {
          conn.send({ type: 'PRIVATE_REQ', from: user.id });
          showToast("Demande envoyée");
      }
      setSelectedOperatorId(null);
  };

  const initPeer = useCallback((initialRole: OperatorRole, targetHostId?: string) => {
    if (peerRef.current) peerRef.current.destroy();
    const myId = initialRole === OperatorRole.HOST ? generateShortId() : undefined;
    const p = new Peer(myId, CONFIG.PEER_CONFIG as any);
    peerRef.current = p;

    p.on('open', (pid) => {
      setUser(prev => ({ ...prev, id: pid }));
      if (initialRole === OperatorRole.HOST) {
        setHostId(pid);
        audioService.updateNotification(pid);
        showToast(`HÔTE: ${pid}`);
      } else if (targetHostId) {
        connectToHost(targetHostId);
      }
    });

    p.on('connection', (conn) => {
      if (bannedPeers.includes(conn.peer)) { conn.close(); return; }
      connectionsRef.current[conn.peer] = conn;
      conn.on('data', (data: any) => handleData(data, conn.peer));
      conn.on('open', () => {
        if (user.role === OperatorRole.HOST || initialRole === OperatorRole.HOST) {
          const list = Object.values(peers); list.push(user);
          conn.send({ type: 'SYNC', list: list, silence: silenceMode });
          pings.forEach(ping => conn.send({ type: 'PING', ping }));
        }
      });
      conn.on('close', () => {
          setPeers(prev => { const next = {...prev}; delete next[conn.peer]; return next; });
      });
    });

    p.on('call', (call) => {
      if (!audioService.stream) return;
      call.answer(audioService.stream);
      call.on('stream', (rs) => audioService.playStream(rs));
    });
    
    p.on('error', (err) => { if (err.type === 'peer-unavailable' || err.type === 'network') {} });
  }, [peers, user, handleData, showToast, silenceMode, pings, bannedPeers]);

  const connectToHost = useCallback((targetId: string) => {
    if (!peerRef.current || !audioService.stream) return;
    if (hostId && connectionsRef.current[hostId]) connectionsRef.current[hostId].close();

    setHostId(targetId);
    audioService.updateNotification(targetId);
    
    const conn = peerRef.current.connect(targetId);
    connectionsRef.current[targetId] = conn;
    
    conn.on('open', () => {
      showToast(`CONNECTÉ À ${targetId}`);
      conn.send({ type: 'FULL', user: user });
      const call = peerRef.current!.call(targetId, audioService.stream!);
      call.on('stream', (rs) => audioService.playStream(rs));
    });
    
    conn.on('data', (data: any) => handleData(data, targetId));
    conn.on('close', () => { if (view === 'ops' || view === 'map') handleHostDisconnect(); else showToast("Déconnecté", "error"); });
    conn.on('error', () => handleHostDisconnect());
  }, [user, handleData, showToast, hostId, view]);

  const handleLogin = async () => {
    const tri = loginInput.toUpperCase();
    if (tri.length < 2) return;
    try { await AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, tri); } catch (e) {}
    setUser(prev => ({ ...prev, callsign: tri }));
    setView('menu');
  };

  const joinSession = (id?: string) => {
    const finalId = id || hostInput.toUpperCase();
    if (!finalId) return;
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

  if (!appIsReady) {
      return null; // On affiche rien tant que l'app n'est pas prête (Splash est affiché par Expo)
  }

  // --- RENDER UI (Identique) ---
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
        <View style={{flexDirection: 'row', justifyContent:'space-between', alignItems:'center', marginBottom: 20}}>
            <Text style={styles.sectionTitle}>DÉPLOIEMENT</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 5}}>
                {isServicesReady ? <MaterialIcons name="check-circle" size={16} color="#22c55e" /> : <ActivityIndicator size="small" color="#3b82f6" />}
                {gpsStatus === 'OK' ? <MaterialIcons name="gps-fixed" size={16} color="#22c55e" /> : <MaterialIcons name="gps-not-fixed" size={16} color="#eab308" />}
            </View>
            <TouchableOpacity onPress={handleLogout} style={{padding: 10}}>
                <MaterialIcons name="power-settings-new" size={24} color="#ef4444" />
            </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => { const role = OperatorRole.HOST; setUser(prev => ({ ...prev, role })); initPeer(role); setView('ops'); }} style={styles.menuCard}>
          <MaterialIcons name="add-circle" size={40} color="#3b82f6" />
          <View style={{marginLeft: 20}}>
            <Text style={styles.menuCardTitle}>Créer Salon</Text>
            <Text style={styles.menuCardSubtitle}>Hôte / Chef</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.divider} />
        <View style={styles.joinHeader}>
            <Text style={styles.sectionTitle}>REJOINDRE</Text>
            <TouchableOpacity onPress={() => setShowScanner(true)} style={styles.scanBtn}>
                <MaterialIcons name="qr-code-scanner" size={16} color="#3b82f6" /><Text style={styles.scanBtnText}>SCANNER</Text>
            </TouchableOpacity>
        </View>
        <TextInput 
            style={styles.inputBox} placeholder="ID CANAL..." placeholderTextColor="#52525b"
            value={hostInput} onChangeText={setHostInput} autoCapitalize="characters"
        />
        <TouchableOpacity onPress={() => joinSession()} style={styles.joinBtn}>
            <Text style={styles.joinBtnText}>REJOINDRE</Text>
        </TouchableOpacity>
        {loadingStep !== '' && !isServicesReady && <Text style={{color: '#eab308', textAlign: 'center', marginTop: 20, fontSize: 12}}>{loadingStep}</Text>}
      </View>
    </SafeAreaView>
  );

  const renderDashboard = () => (
    <View style={{flex: 1}}>
      <View style={{backgroundColor: '#09090b'}}>
          <SafeAreaView style={styles.header}>
            <View style={styles.headerContent}>
              <TouchableOpacity onPress={() => setView('menu')} style={{padding: 8, marginRight: 10}}>
                  <MaterialIcons name="arrow-back" size={24} color="#a1a1aa" />
              </TouchableOpacity>
              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                <MaterialIcons name="satellite" size={20} color="#3b82f6" />
                <Text style={styles.headerTitle}> COM<Text style={{color: '#3b82f6'}}>TAC</Text></Text>
              </View>
              <TouchableOpacity onPress={() => setView(view === 'map' ? 'ops' : 'map')} style={[styles.navBtn, view === 'map' ? styles.navBtnActive : null]}>
                <MaterialIcons name="map" size={16} color={view === 'map' ? 'white' : '#a1a1aa'} />
                <Text style={[styles.navBtnText, view === 'map' ? {color:'white'} : null]}>MAP</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
          {silenceMode && (<View style={styles.silenceBanner}><Text style={styles.silenceText}>SILENCE RADIO</Text></View>)}
          {privatePeerId && (<View style={[styles.silenceBanner, {backgroundColor: '#a855f7'}]}><Text style={styles.silenceText}>CANAL PRIVÉ ACTIF</Text></View>)}
          {isOffline && (<View style={[styles.silenceBanner, {backgroundColor: '#ef4444'}]}><Text style={styles.silenceText}>CONNEXION PERDUE - RECONNEXION...</Text></View>)}
      </View>

      <View style={styles.mainContent}>
        {view === 'ops' ? (
          <ScrollView contentContainerStyle={styles.grid}>
             <OperatorCard user={user} isMe style={{ width: '100%' }} />
             {Object.values(peers).filter(p => p.id !== user.id).map(p => (
                 <TouchableOpacity key={p.id} onLongPress={() => setSelectedOperatorId(p.id)} activeOpacity={0.8} style={{ width: '48%', marginBottom: 10 }}>
                    <OperatorCard user={p} me={user} style={{ width: '100%' }} />
                 </TouchableOpacity>
             ))}
          </ScrollView>
        ) : (
          <View style={{flex: 1}}>
            <TacticalMap 
              me={user} peers={peers} pings={pings} 
              mapMode={mapMode} showTrails={showTrails} pingMode={isPingMode}
              showPings={showPings} isHost={user.role === OperatorRole.HOST}
              onPing={(loc) => { setTempPingLoc(loc); setShowPingModal(true); }}
              onPingMove={(p) => { 
                setPings(prev => prev.map(pi => pi.id === p.id ? p : pi));
                broadcast({ type: 'PING_MOVE', id: p.id, lat: p.lat, lng: p.lng }); 
              }}
              onPingDelete={(id) => {
                setPings(prev => prev.filter(p => p.id !== id));
                broadcast({ type: 'PING_DELETE', id: id });
              }}
            />
            <View style={styles.mapControls}>
                <TouchableOpacity onPress={() => setMapMode(m => m === 'dark' ? 'light' : m === 'light' ? 'satellite' : 'dark')} style={styles.mapBtn}>
                    <MaterialIcons name={mapMode === 'dark' ? 'dark-mode' : mapMode === 'light' ? 'light-mode' : 'satellite'} size={24} color="#d4d4d8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowTrails(!showTrails)} style={styles.mapBtn}>
                    <MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color="#d4d4d8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowPings(!showPings)} style={styles.mapBtn}>
                    <MaterialIcons name={showPings ? 'location-on' : 'location-off'} size={24} color="#d4d4d8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setIsPingMode(!isPingMode)} style={[styles.mapBtn, isPingMode ? {backgroundColor: '#dc2626', borderColor: '#f87171'} : null]}>
                    <MaterialIcons name="ads-click" size={24} color="white" />
                </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.statusRow}>
            {user.role === OperatorRole.HOST ? (
               <TouchableOpacity onPress={() => { const ns = !silenceMode; setSilenceMode(ns); broadcast({ type: 'SILENCE', state: ns }); if(ns) {setVoxActive(false); audioService.setTx(false);} }} style={[styles.statusBtn, silenceMode ? {backgroundColor: '#ef4444'} : {borderColor: '#ef4444'}]}>
                   <Text style={[styles.statusBtnText, silenceMode ? {color:'white'} : {color: '#ef4444'}]}>SILENCE</Text>
               </TouchableOpacity>
            ) : null}
            {privatePeerId && (
                <TouchableOpacity onPress={() => { const conn = connectionsRef.current[privatePeerId]; if(conn) conn.send({type: 'PRIVATE_END'}); leavePrivateMode(); }} style={[styles.statusBtn, {borderColor: '#a855f7'}]}>
                    <Text style={[styles.statusBtnText, {color: '#a855f7'}]}>QUITTER PRIVÉ</Text>
                </TouchableOpacity>
            )}
            {!privatePeerId && [OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                <TouchableOpacity key={s} onPress={() => { setUser(prev => { const updated = { ...prev, status: s }; broadcast({ type: 'UPDATE', user: updated }); return updated; }); }} style={[styles.statusBtn, user.status === s ? { backgroundColor: STATUS_COLORS[s], borderColor: 'white' } : null]}>
                    <Text style={[styles.statusBtnText, user.status === s ? {color:'white'} : null]}>{s}</Text>
                </TouchableOpacity>
            ))}
        </View>
        <View style={styles.controlsRow}>
            <TouchableOpacity onPress={() => { const newVox = audioService.toggleVox(); setVoxActive(newVox); }} style={[styles.voxBtn, voxActive ? {backgroundColor:'#16a34a'} : null]}>
                <MaterialIcons name={voxActive ? 'mic' : 'mic-none'} size={24} color={voxActive ? 'white' : '#a1a1aa'} />
            </TouchableOpacity>
            <TouchableOpacity onPressIn={() => { if(silenceMode && user.role !== OperatorRole.HOST) return; if(!voxActive) { if (user.role !== OperatorRole.HOST) audioService.muteIncoming(true); audioService.setTx(true); setUser(prev => { const u = {...prev, isTx:true}; broadcast({type:'UPDATE', user:u}); return u; }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } }} onPressOut={() => { if(!voxActive) { audioService.setTx(false); if (user.role !== OperatorRole.HOST) audioService.muteIncoming(false); setUser(prev => { const u = {...prev, isTx:false}; broadcast({type:'UPDATE', user:u}); return u; }); } }} style={[styles.pttBtn, user.isTx ? {backgroundColor: '#2563eb'} : null, silenceMode && user.role !== OperatorRole.HOST ? {opacity:0.5} : null]} disabled={silenceMode && user.role !== OperatorRole.HOST}>
                <MaterialIcons name="mic" size={40} color={user.isTx ? 'white' : '#3f3f46'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowQRModal(true)} style={styles.qrBtn}>
                <MaterialIcons name="qr-code-2" size={24} color="#d4d4d8" />
            </TouchableOpacity>
        </View>
      </View>

      <OperatorActionModal 
        visible={!!selectedOperatorId}
        targetOperator={selectedOperatorId ? peers[selectedOperatorId] : null}
        currentUserRole={user.role}
        onClose={() => setSelectedOperatorId(null)}
        onPrivateCall={handleRequestPrivate}
        onKick={handleKickUser}
      />

      <Modal visible={showQRModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>MON IDENTITY TAG</Text>
            <QRCode value={user.id || 'NO_ID'} size={200} />
            <TouchableOpacity onPress={copyToClipboard}>
                <Text style={styles.qrId}>{user.id}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowQRModal(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>FERMER</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showScanner} animationType="slide">
        <View style={{flex: 1, backgroundColor: 'black'}}>
          <CameraView 
            style={{flex: 1}} 
            onBarcodeScanned={handleScannerBarCodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ["qr"],
            }}
          />
          <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerClose}>
            <MaterialIcons name="close" size={30} color="white" />
          </TouchableOpacity>
          <View style={{position: 'absolute', bottom: 50, alignSelf: 'center'}}>
             <Text style={{color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: 10}}>Scannez le QR Code de l'Hôte</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={showPingModal} animationType="fade" transparent>
         <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333'}]}>
               <Text style={[styles.modalTitle, {color: 'white'}]}>ENVOYER PING</Text>
               <TextInput 
                  style={styles.pingInput} 
                  placeholder="Message (ex: ENNEMI)" 
                  placeholderTextColor="#71717a"
                  onChangeText={setPingMsgInput}
                  autoFocus
               />
               <View style={{flexDirection: 'row', gap: 10}}>
                   <TouchableOpacity onPress={() => setShowPingModal(false)} style={[styles.modalBtn, {backgroundColor: '#27272a'}]}>
                       <Text style={{color: 'white', fontWeight: 'bold'}}>ANNULER</Text>
                   </TouchableOpacity>
                   <TouchableOpacity onPress={() => {
                       if(tempPingLoc && pingMsgInput) {
                           const newPing: PingData = {
                               id: Math.random().toString(36).substr(2, 9),
                               lat: tempPingLoc.lat, lng: tempPingLoc.lng,
                               msg: pingMsgInput, sender: user.callsign, timestamp: Date.now()
                           };
                           setPings(prev => [...prev, newPing]);
                           broadcast({ type: 'PING', ping: newPing });
                           setShowPingModal(false);
                           setPingMsgInput('');
                           setIsPingMode(false);
                       }
                   }} style={[styles.modalBtn, {backgroundColor: '#ef4444'}]}>
                       <Text style={{color: 'white', fontWeight: 'bold'}}>ENVOYER</Text>
                   </TouchableOpacity>
               </View>
            </View>
         </View>
      </Modal>

      {toast && (
        <View style={[styles.toast, toast.type === 'error' && {backgroundColor: '#ef4444'}]}>
           <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
      
      {/* Composant Modal Consentement */}
      <PrivacyConsentModal onConsentGiven={() => setHasConsent(true)} />
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
