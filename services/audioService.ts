import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  keepAliveTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing...");

      // 1. LIASION HEADSET (Entrées)
      headsetService.setCommandCallback((source) => { 
          // Logique unifiée : Une commande physique = Toggle VOX
          this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      headsetService.init();

      // 2. CONFIG SYSTEME (Sorties)
      try {
          // 'audio' est parfois trop générique, on force des flags pour le VoIP
          InCallManager.start({ media: 'audio', auto: true, ringback: '' }); 
          InCallManager.setKeepScreenOn(true);
          InCallManager.setMicrophoneMute(false); // Sécurité
          
          // Force l'état initial correct
          this.handleRouteUpdate(headsetService.isHeadsetConnected, 'Initial');
      } catch (e) {
          console.warn("[Audio] InCallManager Error:", e);
      }

      // 3. MICRO
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error", e);
        return false;
      }

      // 4. MODULES
      this.setupMusicControl();
      this.setupVox();
      this.startKeepAlive();

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- GESTION DU ROUTAGE AUDIO (CORRIGÉ) ---
  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Routing Update -> Headset: ${isConnected} (${type})`);
      
      if(isConnected) {
          // CASQUE : On force TOUT vers le casque
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false); // Double sécurité
          this.updateNotification(`Casque (${type})`);
      } else {
          // HP : On force TOUT vers le HP
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          this.updateNotification(`Haut-Parleur`);
      }
      
      // Petit délai pour laisser l'OS digérer le changement avant de relancer le focus
      setTimeout(() => this.refreshMediaFocus(), 1000);
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  private setupMusicControl() {
      if (Platform.OS !== 'android') return;
      try {
          MusicControl.stopControl();
          MusicControl.enableBackgroundMode(true);
          
          // On active UNIQUEMENT les commandes basiques pour éviter les conflits
          MusicControl.enableControl('play', true);
          MusicControl.enableControl('pause', true);
          MusicControl.enableControl('togglePlayPause', true);
          
          MusicControl.enableControl('closeNotification', false, { when: 'never' });
          
          // Tous les events Bluetooth redirigent vers HeadsetService qui filtre
          const trigger = () => headsetService.triggerCommand('BLUETOOTH_AVRCP');
          
          MusicControl.on(Command.play, trigger);
          MusicControl.on(Command.pause, trigger);
          MusicControl.on(Command.togglePlayPause, trigger);

          this.updateNotification('Prêt');
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          // Simule une lecture silencieuse pour garder le canal audio ouvert
          MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING, elapsedTime: 0 });
      }
  }

  toggleVox() {
    // Si on est déjà en train de transmettre (via PTT tactile), on ne fait rien pour éviter le conflit
    if (this.isTx && this.mode === 'ptt') {
        console.log("[Audio] Toggle ignoré car TX en cours");
        return;
    }

    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    this.updateNotification();
    this.notifyListeners();
  }

  updateNotification(extraInfo?: string) {
      const isVox = this.mode === 'vox';
      MusicControl.setNowPlaying({
          title: `Radio Tactique`,
          artist: isVox ? 'VOX ON (Parlez)' : 'PTT (Appuyez)',
          album: extraInfo || (isVox ? 'Micro Ouvert' : 'En attente'), 
          duration: 0, 
          color: isVox ? 0xFFef4444 : 0xFF3b82f6,
          isPlaying: true, 
          notificationIcon: 'ic_launcher' 
      });
  }

  private setupVox() {
      try {
        RNSoundLevel.start();
        RNSoundLevel.onNewFrame = (data: any) => {
            // Uniquement si VOX est actif
            if (this.mode === 'vox' && data.value > this.voxThreshold) {
                if (!this.isTx) this.setTx(true);
                
                if (this.voxTimer) clearTimeout(this.voxTimer);
                this.voxTimer = setTimeout(() => this.setTx(false), this.voxHoldTime);
            }
        };
      } catch (e) {}
  }

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => { this.refreshMediaFocus(); }, 15000);
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    
    // Application Mute/Unmute WebRTC
    if (this.stream) {
        this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
    
    // Feedback
    if(this.mode === 'vox') this.updateNotification();
  }

  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  // Stubs pour compatibilité future
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
