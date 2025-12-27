import { mediaDevices, MediaStream } from 'react-native-webrtc';
import RNSoundLevel from 'react-native-sound-level';
import { VolumeManager } from 'react-native-volume-manager';
import { headsetService } from './headsetService';
import MusicControl from 'react-native-music-control';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  // VAD
  private noiseFloor: number = -60;
  private voxHoldTime: number = 1000; 
  private voxTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;
  private isSessionActive = false; // Flag pour savoir si on est en ligne
  private musicControlReady = false; // Flag pour éviter les appels prématurés

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing (Pure Media Mode)...");

      // 1. Initialiser Headset Service (Events)
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Cmd:", source);
          this.toggleVox(); 
      });
      headsetService.init();

      // 2. Acquisition Micro (Avant tout)
      try {
        const stream = await mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                autoGainControl: true,
                noiseSuppression: true,
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: true
            },
            video: false 
        }) as MediaStream;
        
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error", e);
        return false;
      }

      // 3. Démarrage VAD
      this.setupAdaptiveVAD();
      
      try { await VolumeManager.setVolume(1.0); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // Appelé quand le salon est créé ou rejoint, MAIS on attend la connexion réelle
  public startSession() {
      this.isSessionActive = true;
      console.log("[Audio] Session Started (Logic Only)");
      // On ne lance PAS MusicControl ici pour éviter le crash au scan/connexion
  }

  // Appelé quand la connexion P2P est établie (stable)
  public activateMusicControl() {
      if (!this.isSessionActive) return;
      
      console.log("[Audio] Activating Music Control (Safe Time)");
      this.musicControlReady = true;
      this.updateNotification();
      
      setTimeout(() => {
          try {
              // Cet appel lance la notif et le Foreground Service
              MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
          } catch (e) {
              console.warn("[Audio] MusicControl start error", e);
          }
      }, 500);
  }

  // Appelé lors d'une nouvelle connexion pour éviter le conflit
  public pauseFocus() {
      console.log("[Audio] Pausing Focus for New Connection");
      try {
          if (this.musicControlReady) {
             MusicControl.updatePlayback({ state: MusicControl.STATE_PAUSED });
          }
      } catch (e) {}
  }

  public resumeFocus() {
      console.log("[Audio] Resuming Focus");
      if (!this.isSessionActive) return;
      setTimeout(() => {
          try {
              if (this.musicControlReady) {
                  MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
              }
          } catch (e) {}
      }, 1000); // Délai de sécurité
  }

  public stopSession() {
      this.isSessionActive = false;
      this.musicControlReady = false;
      try {
          MusicControl.stopControl();
      } catch (e) {}
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    this.updateNotification();
    this.notifyListeners(); 
    return this.mode === 'vox'; 
  }

  updateNotification() {
      if (!this.musicControlReady) return;
      const isVox = this.mode === 'vox';
      headsetService.forceNotificationUpdate(isVox, this.isTx);
  }

  private setupAdaptiveVAD() {
      try {
        RNSoundLevel.start();
        RNSoundLevel.onNewFrame = (data: any) => {
            if (this.mode !== 'vox') return;

            const level = data.value;
            if (level < this.noiseFloor) {
                this.noiseFloor = level;
            } else {
                this.noiseFloor = (this.noiseFloor * 0.99) + (level * 0.01);
            }

            const dynamicThreshold = Math.min(Math.max(this.noiseFloor + 15, -45), -10);
            
            if (level > dynamicThreshold) {
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
    if (this.stream) this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    if(this.mode === 'vox') this.updateNotification();
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  // Stubs
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
