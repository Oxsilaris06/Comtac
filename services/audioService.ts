import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
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

      // 1. HEADSET SERVICE (Le Chef d'Orchestre des boutons)
      headsetService.setCommandCallback((source) => { 
          // C'est le point d'entrée unique pour toutes les commandes (BT, Tactile, Volume)
          console.log(`[Audio] Toggle Request from ${source}`);
          this.toggleVox(); 
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      
      headsetService.init();

      // 2. CONFIG AUDIO SYSTEME (InCallManager - Priorité Audio)
      try {
          // On force le mode AUDIO pour WebRTC
          InCallManager.start({ media: 'audio', auto: true, ringback: '' }); 
          InCallManager.setKeepScreenOn(true);
          InCallManager.setMicrophoneMute(false);
          
          // Routage initial
          this.handleRouteUpdate(headsetService.isHeadsetConnected, 'Initial');
      } catch (e) {
          console.warn("[Audio] InCallManager Error:", e);
      }

      // 3. MICRO (Avec filtres WebRTC conservés)
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

      // 4. CONFIG UI MEDIA (MusicControl - Priorité Visuelle)
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

  // --- ROUTAGE ---
  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Routing Update -> Headset: ${isConnected} (${type})`);
      if(isConnected) {
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false);
          this.updateNotification(`Casque (${type})`);
      } else {
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

  // --- CONFIGURATION MUSIC CONTROL (MODE HYBRIDE) ---
  private setupMusicControl() {
      if (Platform.OS !== 'android') return;
      try {
          MusicControl.stopControl();
          
          // IMPORTANT : On active le background mode pour intercepter les événements
          // MAIS on désactive "handleAudioInterruptions" pour ne pas couper WebRTC
          MusicControl.enableBackgroundMode(true);
          MusicControl.handleAudioInterruptions(false); 
          
          // On active les commandes standards
          MusicControl.enableControl('play', true);
          MusicControl.enableControl('pause', true);
          MusicControl.enableControl('togglePlayPause', true);
          
          // Désactivation des commandes inutiles
          MusicControl.enableControl('stop', false);
          MusicControl.enableControl('nextTrack', false);
          MusicControl.enableControl('previousTrack', false);
          MusicControl.enableControl('closeNotification', false, { when: 'never' });
          
          // REDIRECTION VERS HEADSET SERVICE
          // Si l'utilisateur clique sur la notif ou si Android envoie une commande Média
          // On passe par headsetService pour gérer le debounce (anti-doublon)
          const trigger = () => headsetService.triggerCommand('MEDIA_CTRL_EVENT');
          
          MusicControl.on(Command.play, trigger);
          MusicControl.on(Command.pause, trigger);
          MusicControl.on(Command.togglePlayPause, trigger);

          this.updateNotification('Prêt');
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          // Astuce : On dit à Android "Je joue de la musique" pour garder le service vivant
          // Mais InCallManager a déjà pris le canal Audio réel, donc pas de conflit sonore.
          MusicControl.updatePlayback({ 
              state: MusicControl.STATE_PLAYING, 
              elapsedTime: 0 
          });
      }
  }

  toggleVox() {
    // Sécurité : Si on appuie sur le PTT tactile, on ignore les commandes physiques
    // pour éviter de couper la parole par erreur.
    if (this.isTx && this.mode === 'ptt') {
        return;
    }

    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Si on repasse en PTT manuel, on coupe le micro immédiatement
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
          isPlaying: true, // Toujours True pour garder les boutons de notif actifs
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
