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
      console.log("[Audio] Initializing...");

      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Cmd:", source);
          this.toggleVox(); // Simple toggle, la logique audio suit l'état
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      headsetService.init();

      // On active le micro mais on ne touche PAS à InCallManager tout de suite
      // pour éviter le crash au scan/connexion.
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
    } catch (err) { return false; }
  }

  public startSession(roomName: string = "Tactical Net") {
      // C'est le moment sûr pour démarrer InCallManager
      try {
          InCallManager.start({ media: 'video' }); // 'video' mode is less aggressive on route changes
          InCallManager.setKeepScreenOn(true);
          InCallManager.setSpeakerphoneOn(true); // Default to speaker
          this.enforceAudioRoute(); // Then switch if headset
      } catch (e) { console.warn("InCallManager start error", e); }

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
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
      // Petit délai pour laisser le temps à l'OS de switch
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
