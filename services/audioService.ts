
import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  keepAliveTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true; // Évite les double-init

    try {
      console.log("[Audio] Initializing...");

      // 1. HEADSET LISTENER
      headsetService.setCommandCallback((source) => { this.toggleVox(); });
      headsetService.setConnectionCallback((isConnected, type) => { this.handleRouteUpdate(isConnected, type); });
      headsetService.init();

      // 2. CONFIG SYSTEME
      // On wrap InCallManager dans un try/catch car il peut crash sur certains Androids
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true);
          
          if (!headsetService.isHeadsetConnected) {
              InCallManager.setForceSpeakerphoneOn(true);
          }
      } catch (e) {
          console.warn("[Audio] InCallManager start warning:", e);
      }

      // 3. MICRO
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error (getUserMedia)", e);
        return false; // Échec critique si pas de micro
      }

      // 4. MODULES SECONDAIRES
      this.setupMusicControl();
      this.setupVox();
      this.startKeepAlive();

      try { await VolumeManager.setVolume(0.8); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // ... (Reste du code identique)
  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Route: Headset=${isConnected} (${type})`);
      if(isConnected) {
          InCallManager.setForceSpeakerphoneOn(false); 
          this.updateNotification(`Casque (${type})`);
      } else {
          InCallManager.setForceSpeakerphoneOn(true); 
          this.updateNotification(`Haut-Parleur`);
      }
      setTimeout(() => this.refreshMediaFocus(), 500);
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  private setupMusicControl() {
      if (Platform.OS !== 'android') return;
      try {
          MusicControl.stopControl();
          MusicControl.enableBackgroundMode(true);
          const commands = ['play', 'pause', 'stop', 'togglePlayPause', 'nextTrack', 'previousTrack'];
          commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
          MusicControl.enableControl('closeNotification', false, { when: 'never' });
          commands.forEach(cmd => {
            MusicControl.on(Command[cmd as keyof typeof Command], () => {
                headsetService.triggerCommand('BLUETOOTH_AVRCP');
            });
          });
          this.updateNotification('Prêt');
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING, elapsedTime: 0 });
      }
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    this.updateNotification();
    this.notifyListeners();
  }

  updateNotification(extraInfo?: string) {
      const isVox = this.mode === 'vox';
      MusicControl.setNowPlaying({
          title: `Radio Tactique`,
          artist: isVox ? 'VOX ON (Parlez)' : 'PTT (Appuyez)',
          album: extraInfo || (isVox ? 'Micro Ouvert' : 'En attente'), 
          duration: 0, 
          color: isVox ? 0xFFef4444 : 0xFF3b82f6,
          isPlaying: true, 
          notificationIcon: 'ic_launcher' 
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

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => { this.refreshMediaFocus(); }, 15000);
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    if (this.stream) this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    if(this.mode === 'vox') this.updateNotification();
  }
  
  // Fonction pour mute le son entrant (quand on parle en PTT)
  muteIncoming(mute: boolean) {
      // TODO: Implémenter si on stocke les remoteStreams
  }
  
  playStream(remoteStream: MediaStream) {
       // TODO: Implémenter le stockage des streams
  }

  startMetering(callback: (level: number) => void) {
      // Simulation simple pour l'UI, RNSoundLevel fait le vrai travail pour le VOX
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
