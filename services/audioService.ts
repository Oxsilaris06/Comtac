import { mediaDevices, MediaStream } from 'react-native-webrtc';
import RNSoundLevel from 'react-native-sound-level';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';
import MusicControl from 'react-native-music-control';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing (No CallKeep)...");

      // 1. Setup Headset
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Cmd:", source);
          this.enforceAudioRoute(); 
          this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      headsetService.init();

      // 2. Audio Config
      try {
          // 'video' mode is sometimes better for background mic without CallKeep
          InCallManager.start({ media: 'video' }); 
          InCallManager.setKeepScreenOn(true);
          this.enforceAudioRoute();
      } catch (e) { console.warn("InCallManager setup warning", e); }

      // 3. Micro
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

  public startSession(roomName: string = "Tactical Net") {
      this.enforceAudioRoute();
      this.updateNotification();
      
      // On force MusicControl pour le background
      setTimeout(() => {
          try {
              MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
          } catch (e) {}
      }, 500);
  }

  public stopSession() {
      try {
          MusicControl.stopControl();
          InCallManager.stop();
      } catch (e) {}
  }

  private enforceAudioRoute() {
      if (headsetService.isHeadsetConnected) {
          InCallManager.setForceSpeakerphoneOn(false);
          // Sans CallKeep, 'Bluetooth' simple suffit souvent
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
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
    if (this.stream) this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    if(this.mode === 'vox') this.updateNotification();
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService(); 
