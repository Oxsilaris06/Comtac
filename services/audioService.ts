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
  
  // VAD
  private noiseFloor: number = -60;
  private voxHoldTime: number = 1000; 
  private voxTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;
  private isSessionActive = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing (Stable Mode)...");

      // 1. Setup Headset
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Cmd:", source);
          this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      headsetService.init();

      // 2. Audio Config (InCallManager)
      try {
          // On n'active pas l'audio tout de suite pour éviter le crash
          // On le prépare juste
          InCallManager.setKeepScreenOn(true);
      } catch (e) { console.warn("InCallManager error", e); }

      // 3. Micro
      try {
        const stream = await mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                autoGainControl: true,
                noiseSuppression: true
            },
            video: false 
        }) as MediaStream;
        
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error", e);
        return false;
      }

      this.setupAdaptiveVAD();
      try { await VolumeManager.setVolume(1.0); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  public startSession(roomName: string = "Tactical Net") {
      this.isSessionActive = true;
      this.updateNotification();

      // CRASH FIX: On attend que la connexion soit établie (via le délai dans App.tsx)
      // pour activer InCallManager et MusicControl
      try {
          InCallManager.start({ media: 'video' }); // 'video' mode est moins agressif que 'audio'
          this.enforceAudioRoute();
      } catch(e) {}
      
      // On lance le service MusicControl après un délai
      setTimeout(() => {
          if (this.isSessionActive) {
              try {
                  MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
              } catch (e) {}
          }
      }, 1000);
  }

  public stopSession() {
      this.isSessionActive = false;
      try {
          MusicControl.stopControl();
          InCallManager.stop();
      } catch (e) {}
  }

  private enforceAudioRoute() {
      if (headsetService.isHeadsetConnected) {
          InCallManager.setForceSpeakerphoneOn(false);
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
      if (this.isSessionActive) {
          headsetService.forceNotificationUpdate(isVox, this.isTx);
      }
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
  
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
