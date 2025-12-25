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

      // 1. HEADSET SERVICE (Gère désormais TOUS les boutons physiques)
      headsetService.setCommandCallback((source) => { 
          // Que ce soit un bouton BT, Filaire ou Volume, on toggle le VOX
          this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      headsetService.init();

      // 2. CONFIG SYSTEME (Mode Communication)
      try {
          // On démarre en mode AUDIO (VoIP)
          InCallManager.start({ media: 'audio', auto: true, ringback: '' }); 
          InCallManager.setKeepScreenOn(true);
          InCallManager.setMicrophoneMute(false);
          
          // Initialisation du routage
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

      // 4. MUSIC CONTROL (Affichage UI uniquement)
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

  // --- ROUTAGE AUDIO ---
  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Routing Update -> Headset: ${isConnected} (${type})`);
      
      if(isConnected) {
          // CASQUE : On désactive le HP externe
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false);
          this.updateNotification(`Casque (${type})`);
      } else {
          // HP : On force le HP externe (Talkie)
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          this.updateNotification(`Haut-Parleur`);
      }
      
      setTimeout(() => this.refreshMediaFocus(), 1000);
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  // --- GESTION NOTIFICATION & UI ---
  private setupMusicControl() {
      if (Platform.OS !== 'android') return;
      try {
          // On arrête tout contrôle précédent pour repartir propre
          MusicControl.stopControl();
          
          // On active le mode background pour garder le service vivant
          MusicControl.enableBackgroundMode(true);
          
          // On active UNIQUEMENT Play/Pause pour l'interaction TACTILE sur l'écran verrouillé
          MusicControl.enableControl('play', true);
          MusicControl.enableControl('pause', true);
          MusicControl.enableControl('togglePlayPause', true);
          
          // On désactive le reste pour éviter la confusion
          MusicControl.enableControl('stop', false);
          MusicControl.enableControl('nextTrack', false);
          MusicControl.enableControl('previousTrack', false);
          
          MusicControl.enableControl('closeNotification', false, { when: 'never' });
          
          // Handler pour les CLICS TACTILES sur la notif
          const trigger = () => {
              // On passe par headsetService pour bénéficier du debounce global
              // Cela évite le conflit si le bouton physique déclenche aussi MusicControl
              headsetService.triggerCommand('NOTIFICATION_UI_TOUCH');
          };
          
          MusicControl.on(Command.play, trigger);
          MusicControl.on(Command.pause, trigger);
          MusicControl.on(Command.togglePlayPause, trigger);

          this.updateNotification('Prêt');
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          // Keep Alive: on simule une lecture pour ne pas être tué par Android
          MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING, elapsedTime: 0 });
      }
  }

  toggleVox() {
    // Protection anti-conflit PTT tactile vs Bouton physique
    if (this.isTx && this.mode === 'ptt') {
        console.log("[Audio] Toggle ignoré car PTT tactile maintenu");
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
      const stateText = isVox ? 'VOX ON (Parlez)' : 'PTT (Appuyez)';
      
      MusicControl.setNowPlaying({
          title: `Radio Tactique`,
          artist: stateText,
          album: extraInfo || (isVox ? 'Micro Ouvert' : 'En attente'), 
          duration: 0, 
          color: isVox ? 0xFFef4444 : 0xFF3b82f6,
          isPlaying: true, // Toujours à true pour garder la notif active
          notificationIcon: 'ic_launcher' 
      });
  }

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
      } catch (e) {}
  }

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => { this.refreshMediaFocus(); }, 15000);
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    
    if (this.stream) {
        this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
    
    if(this.mode === 'vox') this.updateNotification();
  }
  
  // Stubs
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
