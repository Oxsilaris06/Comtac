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
      console.log("[Audio] Starting Music Capsule Sequence...");

      // 1. D'ABORD : MUSIC CONTROL (Prise de Focus Prioritaire)
      // On s'assure d'avoir la session média avant tout le reste
      this.setupMusicControl();

      // 2. ENSUITE : HEADSET SERVICE
      headsetService.setCommandCallback((source) => { 
          if (source === 'PHYSICAL_PTT_START') this.setTx(true);
          else if (source === 'PHYSICAL_PTT_END') this.setTx(false);
          else this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          // On force le routage à chaque changement matériel
          this.forceAudioRouting(isConnected);
      });
      headsetService.init();

      // 3. ENFIN : INCALL MANAGER (La couche Audio VoIP)
      try {
          // On démarre l'audio. Attention, cela peut tenter de voler le focus média.
          // 'video' est parfois moins agressif que 'audio' sur le focus bouton
          InCallManager.start({ media: 'video', auto: true, ringback: '' }); 
          InCallManager.setKeepScreenOn(true);
          InCallManager.setMicrophoneMute(false);
      } catch (e) { console.warn("InCall Start Error", e); }

      // 4. ROUTAGE INITIAL FORCÉ (Le Fix du HP bloqué)
      // On attend un peu que InCallManager ait fini de démarrer
      setTimeout(() => {
          this.forceAudioRouting(headsetService.isHeadsetConnected);
      }, 1500);

      // 5. MICRO (Avec filtres)
      try {
        const constraints = {
            audio: {
                echoCancellation: true, noiseSuppression: true, autoGainControl: true,
                googEchoCancellation: true, googAutoGainControl: true, googNoiseSuppression: true, googHighpassFilter: true
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

  // --- ROUTAGE AUDIO EXPLICITE ---
  private forceAudioRouting(isHeadset: boolean) {
      console.log(`[Audio] Forcing Route -> Headset: ${isHeadset}`);
      
      if(isHeadset) {
          // CASQUE : On désactive TOUS les flags de haut-parleur
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false); 
          this.updateNotification(`Casque Actif`);
      } else {
          // HP : On active TOUS les flags de haut-parleur
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          this.updateNotification(`Haut-Parleur`);
      }
      
      // On rafraîchit MusicControl pour être sûr qu'il reste au premier plan
      this.refreshMediaFocus();
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  // --- CAPSULE MUSIQUE ---
  private setupMusicControl() {
      if (Platform.OS !== 'android') return;
      try {
          MusicControl.stopControl();
          // CRITIQUE : handleAudioInterruptions(true) permet à MusicControl de se battre
          // pour garder le focus même si InCallManager essaie de le prendre.
          MusicControl.enableBackgroundMode(true);
          MusicControl.handleAudioInterruptions(true); 
          
          MusicControl.enableControl('play', true);
          MusicControl.enableControl('pause', true);
          MusicControl.enableControl('togglePlayPause', true);
          MusicControl.enableControl('closeNotification', false, { when: 'never' });
          
          // Redirection vers HeadsetService
          const trigger = () => headsetService.triggerCommand('MEDIA_UI_EVENT');
          
          MusicControl.on(Command.play, trigger);
          MusicControl.on(Command.pause, trigger);
          MusicControl.on(Command.togglePlayPause, trigger);

          this.updateNotification('Prêt');
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          // On spamme gentiment le système pour dire "Je suis toujours là"
          MusicControl.updatePlayback({ 
              state: MusicControl.STATE_PLAYING, 
              elapsedTime: 0 
          });
      }
  }

  toggleVox() {
    if (this.isTx && this.mode === 'ptt') return;

    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // FEEDBACK SONORE (Bip dans l'oreille)
    try {
        InCallManager.startRingtone('_BUNDLE_', [150]); 
        setTimeout(() => InCallManager.stopRingtone(), 200);
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
      // Intervalle plus agressif (10s) pour maintenir la capsule Music active
      this.keepAliveTimer = setInterval(() => { this.refreshMediaFocus(); }, 10000);
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    if (this.stream) this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
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
