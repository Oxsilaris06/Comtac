import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  // VOX Settings
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  keepAliveTimer: any = null;
  
  // Listeners UI
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];

  async init(): Promise<boolean> {
    try {
      console.log("[Audio] Initializing...");

      // 1. SETUP DES LISTENERS HEADSET (CRITIQUE : AVANT START)
      // On s'assure d'être abonné avant que InCallManager ne lance ses événements initiaux
      
      headsetService.setCommandCallback((source) => {
          console.log(`[Audio] Action received from ${source}`);
          this.toggleVox(); 
      });
      
      headsetService.setConnectionCallback((isConnected, type) => {
          this.handleRouteUpdate(isConnected, type);
      });

      // Lancement de l'écoute des événements matériels
      headsetService.init();

      // 2. CONFIGURATION AUDIO SYSTEME
      // start() prépare l'OS à gérer du son "Voice Call" et déclenche onAudioDeviceChanged
      InCallManager.start({ media: 'audio' }); 
      InCallManager.setKeepScreenOn(true);
      
      // Configuration initiale "Pessimiste" (Haut parleur par défaut)
      // Si un casque est déjà branché, le listener headsetService corrigera ça instantanément
      if (!headsetService.isHeadsetConnected) {
          InCallManager.setForceSpeakerphoneOn(true);
      }

      // 3. ACQUISITION MICRO
      // On prend le micro mais on coupe la transmission (Mute)
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false); 

      // 4. SETUP MUSIC CONTROL (Background & Bluetooth Keys)
      this.setupMusicControl();

      // 5. SETUP VOX & KEEPALIVE
      this.setupVox();
      this.startKeepAlive();

      // Volume initial confortable (mais pas forcé à 100% en boucle)
      try {
        await VolumeManager.setVolume(0.8);
      } catch (e) {}

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- GESTION DU ROUTAGE AUDIO ---
  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Routing Update -> Headset: ${isConnected} (${type})`);
      
      if(isConnected) {
          // CASQUE DÉTECTÉ
          // On désactive le speaker forcé pour laisser l'OS router vers le casque/BT
          InCallManager.setForceSpeakerphoneOn(false); 
          this.updateNotification(`Casque (${type})`);
      } else {
          // PAS DE CASQUE
          // On force le haut-parleur externe (Mode Talkie-Walkie)
          InCallManager.setForceSpeakerphoneOn(true); 
          this.updateNotification(`Haut-Parleur`);
      }
      
      // Refresh pour s'assurer que le son ne coupe pas lors du switch
      setTimeout(() => this.refreshMediaFocus(), 500);
  }

  // --- UI SUBSCRIPTION ---
  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  private notifyListeners() {
      this.listeners.forEach(cb => cb(this.mode));
  }

  // --- BACKGROUND & BLUETOOTH BUTTONS ---
  private setupMusicControl() {
      if (Platform.OS !== 'android') return;

      try {
          MusicControl.stopControl();
          MusicControl.enableBackgroundMode(true);
          
          const commands = ['play', 'pause', 'stop', 'togglePlayPause', 'nextTrack', 'previousTrack'];
          commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
          
          MusicControl.enableControl('closeNotification', false, { when: 'never' });
          
          // Redirection vers HeadsetService pour déduplication
          commands.forEach(cmd => {
            MusicControl.on(Command[cmd as keyof typeof Command], () => {
                headsetService.triggerCommand('BLUETOOTH_AVRCP');
            });
          });

          this.updateNotification('Prêt');
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          MusicControl.updatePlayback({ 
              state: MusicControl.STATE_PLAYING, 
              elapsedTime: 0 
          });
      }
  }

  // --- LOGIQUE METIER (PTT/VOX) ---
  toggleVox() {
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
      const text = isVox ? 'VOX ON (Parlez)' : 'PTT (Appuyez)';
      
      MusicControl.setNowPlaying({
          title: `Radio Tactique`,
          artist: text,
          album: extraInfo || (isVox ? 'Micro Ouvert' : 'En attente'), 
          duration: 0, 
          color: isVox ? 0xFFef4444 : 0xFF3b82f6,
          isPlaying: true, 
          notificationIcon: 'ic_launcher' 
      });
  }

  // --- LOGIQUE VOX (Détection Voix) ---
  private setupVox() {
      try {
        RNSoundLevel.start();
        RNSoundLevel.onNewFrame = (data: any) => {
            if (this.mode === 'vox' && data.value > this.voxThreshold) {
                if (!this.isTx) this.setTx(true);
                
                if (this.voxTimer) clearTimeout(this.voxTimer);
                this.voxTimer = setTimeout(() => this.setTx(false), this.voxHoldTime);
            }
        };
      } catch (e) { console.warn("VOX Error", e); }
  }

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      // Intervalle optimisé à 15s (Moins agressif que 5s, suffisant pour Android moderne)
      this.keepAliveTimer = setInterval(() => { this.refreshMediaFocus(); }, 15000);
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    
    // Soft Mute WebRTC
    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
    
    if(this.mode === 'vox') this.updateNotification();
  }
}

export const audioService = new AudioService();
