
import { mediaDevices, MediaStream } from 'react-native-webrtc';
import RNSoundLevel from 'react-native-sound-level';
import InCallManager from 'react-native-incall-manager';
import MusicControl from 'react-native-music-control';
import { tacticalNativeService } from './tacticalNativeService';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt'; // 'ptt' = Silence/Manuel, 'vox' = Micro Actif/Auto
  isSessionActive: boolean = false;
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing (Tactical Native Mode)...");

      // 1. Démarrer le module Kotlin
      await tacticalNativeService.init();

      // 2. Écouter le clic du bouton (Sans timer, sans double clic)
      tacticalNativeService.subscribe((type, value) => {
          if (type === 'COMMAND' && value === 'BUTTON_MAIN') {
              // Clic détecté -> On bascule le mode VOX
              this.toggleVox();
          }
      });

      // 3. Préparer le micro
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error", e);
        return false;
      }
      
      this.setupVox();
      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- SESSION ---
  public startSession(roomName: string = "Tactical Net") {
      if (this.isSessionActive) return;
      console.log("[Audio] Starting Tactical Call");
      
      // Lance le mode natif : Priorité Téléphone & Bluetooth activé
      tacticalNativeService.startTacticalCall(roomName);
      
      this.isSessionActive = true;
      InCallManager.start({ media: 'audio' });
      InCallManager.setKeepScreenOn(true);
      InCallManager.setForceSpeakerphoneOn(false); // Laisser Android gérer le Bluetooth
      
      this.updateNotification();
  }

  public stopSession() {
      if (!this.isSessionActive) return;
      tacticalNativeService.stopTacticalCall();
      InCallManager.stop();
      this.isSessionActive = false;
      this.setTx(false);
  }

  // --- LOGIQUE METIER (1 Clic = Toggle) ---
  toggleVox() {
    // Si on était en PTT (Silence/Standby), on passe en VOX (Actif)
    // Si on était en VOX (Actif), on passe en PTT (Silence/Standby)
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    console.log(`[Audio] Headset Button Pressed. New Mode: ${this.mode}`);

    if (this.mode === 'ptt') {
        // Désactivation immédiate du micro
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    } else {
        // Activation du VOX : Le micro s'ouvrira dès qu'on parle
        // Feedback visuel optionnel ou petit son possible ici
    }

    this.updateNotification();
    this.notifyListeners(); 
    return this.mode === 'vox'; 
  }

  // Permet de changer le TX manuellement (via bouton écran)
  toggleTx() {
      if (this.mode === 'vox') {
          this.mode = 'ptt'; // Quitte le VOX si on appuie sur le bouton écran
          this.notifyListeners();
      }
      this.setTx(!this.isTx);
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    
    if (this.stream) {
        this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
    
    if (this.isSessionActive) this.updateNotification();
  }

  updateNotification() {
      if (!this.isSessionActive) return;
      const isVox = this.mode === 'vox';
      const title = this.isTx ? "🔴 ÉMISSION" : (isVox ? "🟢 VOX ACTIF" : "⚪ STANDBY (MUTE)");
      
      MusicControl.setNowPlaying({
          title: title,
          artwork: require('../assets/icon.png'),
          artist: 'Tactical Net',
          album: isVox ? 'Mode Automatique' : 'Mode Manuel',
          genre: 'Comms',
          duration: 0,
          description: this.isTx ? 'Micro Ouvert' : (isVox ? 'Écoute...' : 'Micro Coupé'),
          color: this.isTx ? 0xFFef4444 : (isVox ? 0xFF22c55e : 0xFF3b82f6),
          isLiveStream: true,
      });
      MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING, elapsedTime: 0 });
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
  
  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
