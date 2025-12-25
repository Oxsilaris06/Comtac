import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform, Vibration } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';
import { VolumeManager } from 'react-native-volume-manager';

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

      // 1. HEADSET SERVICE
      headsetService.setCommandCallback((source) => { 
          if (source === 'PHYSICAL_PTT_START') {
              this.setTx(true);
          } else if (source === 'PHYSICAL_PTT_END') {
              this.setTx(false);
          } else {
              // Toggle VOX/PTT pour les commandes BT
              this.toggleVox(); 
          }
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      
      headsetService.init();

      // 2. CONFIG AUDIO (InCallManager)
      try {
          // Mode 'audio' pour VoIP
          InCallManager.start({ media: 'audio', auto: true, ringback: '' }); 
          InCallManager.setKeepScreenOn(true);
          InCallManager.setMicrophoneMute(false);
          
          // Routage initial basé sur l'état détecté par headsetService
          this.handleRouteUpdate(headsetService.isHeadsetConnected, 'Initial');
      } catch (e) {
          console.warn("[Audio] InCallManager Error:", e);
      }

      // 3. MICRO
      try {
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: true
            },
            video: false
        };
        const stream = await mediaDevices.getUserMedia(constraints) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error", e);
        return false;
      }

      // 4. MUSIC CONTROL (UI Lockscreen)
      this.setupMusicControl();
      this.setupVox();
      this.startKeepAlive();
      
      try { await VolumeManager.setVolume(0.8); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- ROUTAGE AUDIO STRICT ---
  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Routing Update -> Headset: ${isConnected} (${type})`);
      
      if(isConnected) {
          // CASQUE : Son dans les oreilles
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false);
          this.updateNotification(`Casque (${type})`);
      } else {
          // PAS DE CASQUE : Son sur haut-parleur (Talkie)
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          this.updateNotification(`Haut-Parleur`);
      }
      
      // Petit délai pour laisser le focus se faire
      setTimeout(() => this.refreshMediaFocus(), 500);
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
          // On active le background mode pour les notifs
          // IMPORTANT: handleAudioInterruptions(true) permet de reprendre la main sur les notifs
          MusicControl.enableBackgroundMode(true);
          MusicControl.handleAudioInterruptions(true); 
          
          MusicControl.enableControl('play', true);
          MusicControl.enableControl('pause', true);
          MusicControl.enableControl('togglePlayPause', true);
          MusicControl.enableControl('closeNotification', false, { when: 'never' });
          
          // Les clics sur la notif passent par HeadsetService (pour le debounce)
          const trigger = () => headsetService.triggerCommand('MEDIA_UI_EVENT');
          
          MusicControl.on(Command.play, trigger);
          MusicControl.on(Command.pause, trigger);
          MusicControl.on(Command.togglePlayPause, trigger);

          this.updateNotification('Prêt');
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING, elapsedTime: 0 });
      }
  }

  toggleVox() {
    // Si on utilise le PTT Physique, on ignore le toggle
    if (this.isTx && this.mode === 'ptt') return;

    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Feedback Sonore & Tactile (Demandé par l'utilisateur)
    Vibration.vibrate(100); 
    // Petit bip système pour confirmer dans l'oreille
    try {
        if (this.mode === 'vox') {
            // Son montant (Activation)
            InCallManager.startRingtone('_BUNDLE_', [100]); 
            setTimeout(() => InCallManager.stopRingtone(), 200);
        } else {
            // Son descendant (Désactivation)
            InCallManager.startRingtone('_BUNDLE_', [100]); 
            setTimeout(() => InCallManager.stopRingtone(), 200);
        }
    } catch (e) {}

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
          isPlaying: true, 
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
