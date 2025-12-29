import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import MusicControl, { Command } from 'react-native-music-control'; // Ajouté pour l'UI et Boutons BT
import { headsetService } from './headsetService';
import { callKeepService } from './callKeepService';

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
      console.log("[Audio] Initializing Hybrid Service...");

      headsetService.init();

      // 1. Setup CallKeep (Le "Moteur" Système)
      // Il gère la priorité système absolue
      callKeepService.setListeners({
          onMuteToggle: (muted) => {
              // Certains casques envoient cette commande (souvent appui long)
              console.log("[Audio] CallKeep CMD: Toggle VOX");
              this.toggleVox();
              callKeepService.setMuted(false);
          },
          onEndCall: () => {
              this.stopSession();
          }
      });

      // 2. Setup MusicControl (L'Interface Riche & Boutons Play/Pause)
      // C'est lui qui va afficher la "Grosse Notification" et intercepter les boutons "Musique"
      this.setupMusicControl();

      // 3. Setup Hardware Keys (Backup Accessibilité)
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Hardware CMD:", source);
          if (this.isSessionActive) this.enforceAudioRoute();
          this.toggleVox();
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          console.log(`[Audio] Headset Changed: ${isConnected} (${type})`);
          this.handleRouteUpdate(isConnected, type); 
      });

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

  // --- INTERFACE RICHE (MCPTT STYLE) ---
  private setupMusicControl() {
      MusicControl.enableBackgroundMode(true);
      
      // On active TOUTES les commandes pour maximiser les chances d'interception
      MusicControl.enableControl('play', true);
      MusicControl.enableControl('pause', true);
      MusicControl.enableControl('stop', true);
      MusicControl.enableControl('nextTrack', true);     
      MusicControl.enableControl('previousTrack', true); 
      MusicControl.enableControl('togglePlayPause', true); 

      const triggerSwitch = () => {
          console.log("[Audio] MusicControl CMD: Toggle VOX");
          this.toggleVox();
      };

      // Le bouton Play/Pause du casque déclenchera ça
      MusicControl.on(Command.play, triggerSwitch);
      MusicControl.on(Command.pause, triggerSwitch);
      MusicControl.on(Command.togglePlayPause, triggerSwitch);
      MusicControl.on(Command.nextTrack, triggerSwitch);
      MusicControl.on(Command.previousTrack, triggerSwitch);
      
      MusicControl.on(Command.stop, () => { this.stopSession(); });
  }

  private updateMusicNotification(roomName: string) {
      const isVox = this.mode === 'vox';
      // On triche un peu : "Playing" = VOX ON, "Paused" = PTT
      // Cela change l'icône dans la notif et sur l'écran de verrouillage
      const state = isVox ? MusicControl.STATE_PLAYING : MusicControl.STATE_PAUSED;
      
      MusicControl.setNowPlaying({
          title: isVox ? "VOX ACTIF (ÉCOUTE...)" : "PTT: APPUYEZ POUR PARLER",
          artwork: require('../assets/icon.png'), // Assurez-vous que l'icône existe
          artist: 'CANAL: ' + roomName,
          album: 'ComTac Ops Network',
          genre: 'Tactical',
          duration: 0,
          description: isVox ? 'Parlez maintenant' : 'Mode Silence',
          color: isVox ? 0xFFef4444 : 0xFF3b82f6, // Rouge / Bleu
          isLiveStream: true,
      });

      MusicControl.updatePlayback({
          state: state,
          elapsedTime: 0 
      });
  }

  private enforceAudioRoute() {
      if (headsetService.isHeadsetConnected) {
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  public async startSession(roomName: string = "Tactical Net") {
      if (this.isSessionActive) return;
      
      try {
        console.log("[Audio] Starting Hybrid Session...");
        this.isSessionActive = true;

        // 1. Démarrer CallKeep (Fondation Système)
        // Crée la petite notif appel, prend le SCO, empêche le kill
        callKeepService.startCall("room_1", roomName);

        // 2. Démarrer MusicControl (Interface Riche)
        // Crée la GROSSE notif avec boutons, intercepte Play/Pause
        this.updateMusicNotification(roomName);

        // 3. Démarrer VoIP
        InCallManager.start({ media: 'audio' });
        InCallManager.setKeepScreenOn(true);
        
        setTimeout(() => { this.enforceAudioRoute(); }, 1000);

      } catch (e) {
          console.error("[Audio] CRITICAL: Failed to start session", e);
          this.stopSession();
      }
  }

  public stopSession() {
      if (!this.isSessionActive) return;
      try {
        callKeepService.endCall(); // Tue l'appel système
        MusicControl.stopControl(); // Tue la notif riche
        InCallManager.stop();
      } catch(e) {}
      this.isSessionActive = false;
      this.setTx(false);
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
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
    
    // Mettre à jour l'UI Riche (Notification)
    if (this.isSessionActive) {
        // On récupère le nom du salon via une variable locale ou on met un defaut
        this.updateMusicNotification("Tactical Net"); 
    }

    this.notifyListeners(); 
    return this.mode === 'vox'; 
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
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
