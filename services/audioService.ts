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

      // 2. Acquisition Micro
      // On le fait avant tout le reste pour être sûr d'avoir la permission
      try {
        const stream = await mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                autoGainControl: true,
                noiseSuppression: true,
                // Android-specific constraints
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
      
      // 4. Volume
      try { await VolumeManager.setVolume(1.0); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  public startSession(roomName: string = "Tactical Net") {
      this.updateNotification();
      
      // On lance le service MusicControl APRES avoir acquis le micro
      // Cela évite la SecurityException sur Android 14
      setTimeout(() => {
          try {
              // Cet appel lance la notif et le Foreground Service
              MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
          } catch (e) {
              console.warn("[Audio] MusicControl start error", e);
          }
      }, 500);
  }

  public stopSession() {
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
      const isVox = this.mode === 'vox';
      headsetService.forceNotificationUpdate(isVox, this.isTx);
  }

  private setupAdaptiveVAD() {
      try {
        RNSoundLevel.start();
        RNSoundLevel.onNewFrame = (data: any) => {
            if (this.mode !== 'vox') return;

            const level = data.value;
            // Algo simple d'adaptation
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
  
  // Stubs (plus utilisés)
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
