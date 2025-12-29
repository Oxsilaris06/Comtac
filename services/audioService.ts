import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import uuid from 'react-native-uuid';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';
import { focusService } from './focusService'; // Import du nouveau service

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  isSessionActive: boolean = false;
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing...");

      // 1. Initialisation des services de bas niveau
      headsetService.init();
      
      // Configuration des callbacks Focus (Gestion des interruptions)
      focusService.setCallbacks(
          () => { 
              console.log("[Audio] Focus LOST -> Stopping TX");
              this.setTx(false); // Sécurité immédiate
          },
          () => {
              console.log("[Audio] Focus GAINED -> Ready");
              if (this.isSessionActive) this.enforceAudioRoute();
          }
      );

      // Listener Commandes Physiques
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Headset Native Command:", source);
          // Si on reçoit une commande, c'est qu'on a le contrôle
          if (this.isSessionActive) this.enforceAudioRoute();
          this.toggleVox();
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          console.log(`[Audio] Headset Changed: ${isConnected} (${type})`);
          this.handleRouteUpdate(isConnected, type); 
      });

      // 2. Music Control
      this.setupMusicControl();

      // 3. Préparation Micro
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error", e);
        return false;
      }

      this.setupVox();
      
      try { await VolumeManager.setVolume(1.0); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- GESTION ROUTAGE AUDIO (Améliorée) ---
  private enforceAudioRoute() {
      // Cette fonction doit être appelée souvent pour contrer les changements de l'OS
      if (headsetService.isHeadsetConnected) {
          console.log("[Audio] Enforcing Bluetooth SCO (High Priority)");
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          console.log("[Audio] Enforcing Speakerphone");
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  // --- MUSIC CONTROL ---
  private setupMusicControl() {
      MusicControl.enableBackgroundMode(true);
      MusicControl.enableControl('play', true);
      MusicControl.enableControl('pause', true);
      MusicControl.enableControl('stop', true);
      MusicControl.enableControl('nextTrack', true);     
      MusicControl.enableControl('previousTrack', true); 
      MusicControl.enableControl('togglePlayPause', true); 

      const triggerSwitch = () => {
          console.log("[Audio] MusicControl Command Received");
          this.toggleVox();
      };

      MusicControl.on(Command.play, triggerSwitch);
      MusicControl.on(Command.pause, triggerSwitch);
      MusicControl.on(Command.togglePlayPause, triggerSwitch);
      MusicControl.on(Command.nextTrack, triggerSwitch);
      MusicControl.on(Command.previousTrack, triggerSwitch);
      MusicControl.on(Command.stop, () => { this.stopSession(); });
      MusicControl.on(Command.closeNotification, () => { this.stopSession(); });
  }

  public async startSession(roomName: string = "Tactical Net") {
      if (this.isSessionActive) return;
      
      try {
        console.log("[Audio] Starting Audio Session...");
        
        // 1. DEMANDE DE FOCUS EXPLICITE (CRITIQUE)
        // On demande le focus AVANT de lancer l'audio VoIP
        const focusGranted = await focusService.requestFocus();
        if (!focusGranted) {
            console.warn("[Audio] Focus request denied by OS");
            // On continue quand même, mais avec risque
        }

        this.isSessionActive = true;
        this.updateNotification(roomName);

        // 2. Démarrage du moteur VoIP
        // Le mode 'audio' peut parfois basculer le mode Android en MODE_IN_COMMUNICATION
        // Ce qui est nécessaire pour le Bluetooth SCO (Micro)
        InCallManager.start({ media: 'audio' });
        InCallManager.setKeepScreenOn(true);
        
        // 3. Routage agressif
        setTimeout(() => { this.enforceAudioRoute(); }, 500);
        setTimeout(() => { this.enforceAudioRoute(); }, 1500); // 2eme passe de sécurité

      } catch (e) {
          console.error("[Audio] CRITICAL: Failed to start session", e);
          this.startInCallManagerFallback();
      }
  }

  private startInCallManagerFallback() {
      try {
          InCallManager.start({ media: 'audio' });
          InCallManager.setKeepScreenOn(true);
          this.enforceAudioRoute(); 
      } catch (e) {}
  }

  public stopSession() {
      if (!this.isSessionActive) return;
      try {
        MusicControl.stopControl();
        InCallManager.stop();
        focusService.abandonFocus(); // On rend la main proprement
      } catch(e) {}
      this.isSessionActive = false;
      this.setTx(false);
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
      // Si un nouveau périphérique arrive, on force le routage immédiatement
      setTimeout(() => this.enforceAudioRoute(), 500);
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    console.log("[Audio] Toggle VOX ->", this.mode);
    
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    
    this.updateNotification();
    this.notifyListeners(); 
    return this.mode === 'vox'; 
  }

  updateNotification(customTitle?: string) {
      if (!this.isSessionActive) return;
      
      const isVox = this.mode === 'vox';
      const playbackState = isVox ? MusicControl.STATE_PLAYING : MusicControl.STATE_PAUSED;
      
      MusicControl.setNowPlaying({
          title: customTitle || (isVox ? "VOX: ACTIVÉ (Écoute...)" : "PTT: Mode Manuel"),
          artwork: require('../assets/icon.png'),
          artist: 'ComTac Ops',
          album: 'Canal Sécurisé',
          genre: 'Tactical',
          duration: 0,
          description: isVox ? 'Parlez pour transmettre' : 'Appuyez pour parler',
          color: isVox ? 0xFFef4444 : 0xFF3b82f6,
          isLiveStream: true,
      });

      MusicControl.updatePlayback({
          state: playbackState,
          elapsedTime: 0 
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

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    
    if (this.stream) {
        this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
    
    if (this.isSessionActive && this.mode === 'vox') {
         MusicControl.updatePlayback({
             state: MusicControl.STATE_PLAYING,
             speed: state ? 1.1 : 1.0, 
             elapsedTime: 0
         });
    }
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
