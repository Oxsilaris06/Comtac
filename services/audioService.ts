import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';

class AudioService {
  stream: MediaStream | null = null;
  remoteStreams: MediaStream[] = []; 
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  currentRoomId: string = 'Déconnecté';
  keepAliveTimer: any = null;
  lastToggleTime: number = 0;

  // Listeners pour l'UI
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];

  async init(): Promise<boolean> {
    try {
      // 1. Démarrage Micro (DÉSACTIVÉ PAR DÉFAUT)
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false); // <--- CRITIQUE : MICRO OFF

      // 2. Liaison HeadsetService (Commandes Hardware)
      headsetService.setCommandCallback((source) => {
          this.safeToggle();
      });
      
      headsetService.setConnectionCallback((isConnected, type) => {
          if(isConnected) this.updateNotification(this.currentRoomId, `Audio: ${type}`);
      });

      // 3. Configuration Audio (Boost & Priorité)
      try {
          // On force 'audio' pour la compatibilité, mais avec Speakerphone
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 4. Setup MusicControl (PRIORITÉ BLUETOOTH)
      // Doit être fait APRES InCallManager
      this.setupMusicControl();

      // 5. Vox & KeepAlive
      this.setupVox();
      this.startKeepAlive();

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- UI SUBSCRIPTION ---
  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      return () => {
          this.listeners = this.listeners.filter(l => l !== callback);
      };
  }

  private notifyListeners() {
      this.listeners.forEach(cb => cb(this.mode));
  }

  // --- GESTION MUSIQUE / BLUETOOTH ---
  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
             MusicControl.stopControl(); // Reset propre
             MusicControl.enableBackgroundMode(true);
             
             // On active TOUT pour capter n'importe quelle télécommande
             const commands = [
                 'play', 'pause', 'stop', 'togglePlayPause', 
                 'nextTrack', 'previousTrack', 
                 'seekForward', 'seekBackward',
                 'skipForward', 'skipBackward'
             ];
             commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
             
             MusicControl.enableControl('closeNotification', false, { when: 'never' });
             MusicControl.handleAudioInterruptions(true);

             // Mapping Universel
             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], () => this.safeToggle()));

             this.updateNotification('Prêt');
          }
      } catch (e) { }
  }

  private safeToggle() {
      const now = Date.now();
      if (now - this.lastToggleTime > 400) { 
          this.toggleVox();
          this.lastToggleTime = now;
      }
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
      } catch (e) { }
  }

  updateNotification(roomId?: string, extraInfo?: string) {
      if (roomId) this.currentRoomId = roomId;
      
      const isVox = this.mode === 'vox';
      const text = isVox ? 'VOX ACTIF' : 'PTT (Manuel)';
      const color = isVox ? 0xFFef4444 : 0xFF3b82f6;
      const subtitle = extraInfo || 'Mode Tactique';

      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${text}`,
          album: subtitle, 
          duration: 0, 
          color: color,
          isPlaying: true, // TOUJOURS TRUE pour garder le focus AVRCP
          isSeekable: false,
          notificationIcon: 'icon' 
      });
      
      MusicControl.updatePlayback({
          state: MusicControl.STATE_PLAYING,
          elapsedTime: 0 
      });
  }

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => {
          MusicControl.updatePlayback({
              state: MusicControl.STATE_PLAYING,
              elapsedTime: Date.now() 
          });
      }, 5000);
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // WORKFLOW : Si PTT, on coupe tout de suite
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    this.updateNotification();
    this.notifyListeners(); // Mise à jour UI instantanée
    return this.mode === 'vox';
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
  }

  playStream(remoteStream: MediaStream) { 
      if (remoteStream.id === this.stream?.id) return;
      this.remoteStreams.push(remoteStream);
  }

  startMetering(callback: (level: number) => void) {
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
