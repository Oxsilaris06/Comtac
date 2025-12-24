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

  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];

  async init(): Promise<boolean> {
    try {
      // 1. Audio / Micro (STRICTEMENT OFF AU DÉPART)
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);
      this.mode = 'ptt';

      // 2. Commandes Physiques (Priorité Absolue via Accessibilité)
      headsetService.setCommandCallback((source) => {
          this.toggleVox(); 
      });
      
      // 3. Routage Audio
      headsetService.setConnectionCallback((isConnected, type) => {
          console.log(`[Audio] Route Update: ${type}`);
          if(isConnected) {
              InCallManager.setForceSpeakerphoneOn(false);
              this.updateNotification(this.currentRoomId, `Casque: ${type}`);
          } else {
              InCallManager.setForceSpeakerphoneOn(true);
              this.updateNotification(this.currentRoomId, `Haut-Parleur`);
          }
      });

      // 4. Configuration Audio (Mode COMMUNICATION assumé)
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 5. Notification Visuelle (Juste pour l'affichage)
      this.setupMusicControl();

      // 6. Vox
      this.setupVox();
      
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  private notifyListeners() {
      this.listeners.forEach(cb => cb(this.mode));
  }

  // --- UI ONLY : NOTIFICATION ---
  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
             MusicControl.enableBackgroundMode(true);
             
             const commands = ['play', 'pause', 'stop', 'togglePlayPause'];
             commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
             
             MusicControl.enableControl('closeNotification', false, { when: 'never' });
             
             // Redirection vers HeadsetService pour déduplication
             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], () => {
                 headsetService.triggerCommand('BLUETOOTH_' + cmd);
             }));

             this.updateNotification('Prêt');
          }
      } catch (e) { }
  }

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
          isPlaying: true, 
          isSeekable: false,
          // CRITIQUE: Utiliser 'ic_launcher' (icône standard Expo) pour éviter le crash
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
      } catch (e) { }
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
  }

  muteIncoming(mute: boolean) {
      this.remoteStreams.forEach(rs => {
          rs.getAudioTracks().forEach(t => { t.enabled = !mute; });
      });
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
