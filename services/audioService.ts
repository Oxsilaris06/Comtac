import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import uuid from 'react-native-uuid';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  // On remplace l'ID d'appel par un simple flag de session
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

      // 1. D'abord init le HeadsetService (et sa session native potentiellement conflictuelle)
      // On le fait AVANT MusicControl. Ainsi, quand MusicControl s'initialisera ensuite,
      // il prendra le dessus (Focus) pour les commandes boutons, ce qui est ce qu'on veut.
      headsetService.init();

      // Listener de secours (au cas où le natif attraperait quand même quelque chose)
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Headset Native Command:", source);
          if (this.isSessionActive) this.enforceAudioRoute();
          // On ne toggle ici que si MusicControl a raté le coche, pour éviter les doublons
          // Mais généralement MusicControl prendra le relais via ses propres listeners ci-dessous
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          console.log(`[Audio] Headset Changed: ${isConnected} (${type})`);
          this.handleRouteUpdate(isConnected, type); 
      });

      // 2. Configuration de MusicControl (La session "Gagnante")
      this.setupMusicControl();

      // 3. Préparation du Micro (Sans l'activer pour le moment)
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

  // --- GESTION ROUTAGE AUDIO (CRITIQUE POUR BLUETOOTH) ---
  private enforceAudioRoute() {
      if (headsetService.isHeadsetConnected) {
          console.log("[Audio] Enforcing Bluetooth SCO");
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          console.log("[Audio] Enforcing Speakerphone");
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  // --- MUSIC CONTROL (Notification & Boutons) ---
  private setupMusicControl() {
      MusicControl.enableBackgroundMode(true);
      
      // Mappage complet des boutons possibles sur un casque
      MusicControl.enableControl('play', true);
      MusicControl.enableControl('pause', true);
      MusicControl.enableControl('stop', true);
      MusicControl.enableControl('nextTrack', true);     
      MusicControl.enableControl('previousTrack', true); 
      // togglePlayPause est crucial pour beaucoup de casques mono-bouton
      MusicControl.enableControl('togglePlayPause', true); 

      // Une seule action : Basculer le mode VOX
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
      
      // Gestion du "Canardage" (Audio Focus Loss - ex: appel téléphonique entrant, GPS)
      MusicControl.on(Command.closeNotification, () => { this.stopSession(); });
  }

  public async startSession(roomName: string = "Tactical Net") {
      if (this.isSessionActive) return;
      
      try {
        console.log("[Audio] Starting Audio Session (Music Mode)");
        this.isSessionActive = true;

        // Init initial de la notif
        this.updateNotification(roomName);

        // Activer le moteur Audio VoIP
        InCallManager.start({ media: 'audio' });
        InCallManager.setKeepScreenOn(true);
        
        // Forcer le routage
        setTimeout(() => {
            this.enforceAudioRoute();
        }, 500);

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
      } catch(e) {}
      this.isSessionActive = false;
      this.setTx(false);
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
      this.enforceAudioRoute();
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
    
    // IMPORTANT : On met à jour la notif pour refléter l'état
    // Cela permet au bouton du casque de savoir s'il doit envoyer "Pause" ou "Play" la prochaine fois
    this.updateNotification();
    
    this.notifyListeners(); 
    return this.mode === 'vox'; 
  }

  updateNotification(customTitle?: string) {
      if (!this.isSessionActive) return;
      
      const isVox = this.mode === 'vox';
      // État visuel et LOGIQUE (Playing = VOX ON, Paused = PTT/VOX OFF)
      const playbackState = isVox ? MusicControl.STATE_PLAYING : MusicControl.STATE_PAUSED;
      
      MusicControl.setNowPlaying({
          title: customTitle || (isVox ? "VOX: ACTIVÉ (Écoute...)" : "PTT: Mode Manuel"),
          artwork: require('../assets/icon.png'),
          artist: 'ComTac Ops',
          album: 'Canal Sécurisé',
          genre: 'Tactical',
          duration: 0,
          description: isVox ? 'Parlez pour transmettre' : 'Appuyez pour parler',
          color: isVox ? 0xFFef4444 : 0xFF3b82f6, // Rouge si VOX actif, Bleu sinon
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
    
    // Petit feedback visuel dans la notif si on passe en émission
    if (this.isSessionActive && this.mode === 'vox') {
         MusicControl.updatePlayback({
             state: MusicControl.STATE_PLAYING,
             speed: state ? 1.1 : 1.0, // Hack pour forcer un refresh UI mineur
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
