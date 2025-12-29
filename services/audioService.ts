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

      // 1. Configuration de la Session Musicale (Notification & Contrôles)
      this.setupMusicControl();

      // 2. Headset Listener (Commandes BT via Module Natif & Accessibility)
      // Cela reste notre couche basse pour intercepter les touches spécifiques (Vol+/-)
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Headset Command Received:", source);
          // Si on reçoit une commande physique, on s'assure que le son sort au bon endroit
          if (this.isSessionActive) {
             this.enforceAudioRoute();
          }
          this.toggleVox(); 
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          console.log(`[Audio] Headset Changed: ${isConnected} (${type})`);
          this.handleRouteUpdate(isConnected, type); 
      });
      
      // Init du module natif
      headsetService.init();

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
      
      // Force le volume au max pour être sûr d'entendre
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
      // InCallManager gère le basculement entre le profil A2DP (Musique, pas de micro)
      // et le profil SCO (Appel, micro basse qualité mais temps réel).
      // Pour une app "Talkie Walkie", on VEUT du SCO quand un casque est là.
      
      if (headsetService.isHeadsetConnected) {
          console.log("[Audio] Enforcing Bluetooth SCO");
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          console.log("[Audio] Enforcing Speakerphone");
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  // --- REMPLACEMENT DE CALLKEEP PAR MUSIC CONTROL ---
  private setupMusicControl() {
      // Configure les contrôles disponibles sur l'écran verrouillé / notification
      MusicControl.enableBackgroundMode(true);
      
      // On active tout ce qui peut ressembler à un bouton sur un casque
      MusicControl.enableControl('play', true);
      MusicControl.enableControl('pause', true);
      MusicControl.enableControl('stop', true);
      MusicControl.enableControl('nextTrack', true);     // Souvent mappé sur double clic
      MusicControl.enableControl('previousTrack', true); // Souvent mappé sur triple clic
      
      // Gestion des événements
      MusicControl.on(Command.play, () => { this.toggleVox(); });
      MusicControl.on(Command.pause, () => { this.toggleVox(); });
      MusicControl.on(Command.togglePlayPause, () => { this.toggleVox(); });
      MusicControl.on(Command.nextTrack, () => { this.toggleVox(); });
      MusicControl.on(Command.previousTrack, () => { this.toggleVox(); });
      MusicControl.on(Command.stop, () => { this.stopSession(); });
  }

  public async startSession(roomName: string = "Tactical Net") {
      if (this.isSessionActive) return;
      
      try {
        console.log("[Audio] Starting Audio Session (Music Mode)");
        this.isSessionActive = true;

        // 1. Afficher la notification "Music" (Garde l'app en vie)
        MusicControl.setNowPlaying({
            title: roomName,
            artwork: require('../assets/icon.png'), // Assurez-vous que l'image existe ou retirez la ligne
            artist: 'ComTac Ops',
            album: 'Radio Secure',
            genre: 'Tactical',
            duration: 0, // Live stream
            description: 'Canal Actif',
            color: 0xFF3b82f6, // Bleu ComTac
            isLiveStream: true,
        });
        
        // On dit à Android qu'on "Joue" de la musique
        MusicControl.updatePlayback({
            state: MusicControl.STATE_PLAYING,
            elapsedTime: 0 
        });

        // 2. Activer le moteur Audio VoIP (InCallManager)
        // C'est lui qui va activer le micro en mode "Communication" (Echo cancellation, etc.)
        // Le mode 'audio' est standard pour la VoIP. 'video' peut parfois aider si 'audio' coupe.
        InCallManager.start({ media: 'audio' });
        InCallManager.setKeepScreenOn(true); // Empêche le CPU de dormir
        
        // 3. Forcer le routage immédiat
        setTimeout(() => {
            this.enforceAudioRoute();
            this.updateNotification();
        }, 500);

      } catch (e) {
          console.error("[Audio] CRITICAL: Failed to start session", e);
          // Tentative de fallback
          this.startInCallManagerFallback();
      }
  }

  private startInCallManagerFallback() {
      try {
          console.log("[Audio] Fallback Start...");
          InCallManager.start({ media: 'audio' });
          InCallManager.setKeepScreenOn(true);
          this.enforceAudioRoute(); 
      } catch (e) {}
  }

  public stopSession() {
      if (!this.isSessionActive) return;
      try {
        MusicControl.stopControl(); // Retire la notif
        InCallManager.stop();
      } catch(e) {}
      this.isSessionActive = false;
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
      // Re-apply routing logic
      this.enforceAudioRoute();
      this.updateNotification();
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
    
    // Si on repasse en PTT, on coupe l'émission immédiatement
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    
    this.updateNotification();
    this.notifyListeners(); 
    return this.mode === 'vox'; 
  }

  updateNotification() {
      if (!this.isSessionActive) return;
      
      const isVox = this.mode === 'vox';
      const statusText = isVox ? `VOX ACTIF ${this.isTx ? '🔴' : '⚪'}` : 'PTT (Appuyez)';
      
      // On met à jour le texte de la notification média
      MusicControl.updatePlayback({
          state: MusicControl.STATE_PLAYING,
          title: "ComTac: " + statusText
      });
  }

  private setupVox() {
      try {
        RNSoundLevel.start();
        RNSoundLevel.onNewFrame = (data: any) => {
            // Logique VOX
            if (this.mode === 'vox' && data.value > this.voxThreshold) {
                if (!this.isTx) this.setTx(true);
                
                // Debounce pour éviter de couper la parole trop vite
                if (this.voxTimer) clearTimeout(this.voxTimer);
                this.voxTimer = setTimeout(() => this.setTx(false), this.voxHoldTime);
            }
        };
      } catch (e) {}
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    
    // Active/Désactive physiquement les pistes audio du micro
    if (this.stream) {
        this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
    
    // Feedback visuel
    if(this.mode === 'vox' && this.isSessionActive) this.updateNotification();
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  muteIncoming(mute: boolean) {
      // TODO: Implémenter mute des pistes distantes si nécessaire
  }
  
  playStream(remoteStream: MediaStream) {
      // InCallManager gère la sortie (Speaker/BT), WebRTC gère le décodage.
      // Rien de spécial à faire ici sauf si on voulait mixer l'audio.
  }
}

export const audioService = new AudioService();
