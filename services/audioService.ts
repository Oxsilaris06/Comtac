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

      // 2. Liaison HeadsetService
      headsetService.setCommandCallback((source) => {
          this.toggleVox(); 
      });
      
      headsetService.setConnectionCallback((isConnected, type) => {
          console.log(`[Audio] Routing Update: ${type}`);
          if(isConnected) {
              InCallManager.setForceSpeakerphoneOn(false);
              this.updateNotification(this.currentRoomId, `Casque Actif (${type})`);
          } else {
              InCallManager.setForceSpeakerphoneOn(true);
              this.updateNotification(this.currentRoomId, `Haut-Parleur Actif`);
          }
          this.refreshMediaFocus();
      });

      // 3. Configuration Audio Initiale
      try {
          InCallManager.start({ media: 'audio' });
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 4. Setup MusicControl (PRIORITÉ BLUETOOTH)
      this.forceBluetoothPriority();

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
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  private notifyListeners() {
      this.listeners.forEach(cb => cb(this.mode));
  }

  // --- METHODE PUBLIQUE DE FORÇAGE (Appelée par App.tsx) ---
  public forceBluetoothPriority() {
      this.setupMusicControl();
  }

  // --- GESTION MUSIQUE / BLUETOOTH ---
  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
             // CRITIQUE : On stop pour forcer le système à nous redonner la main
             // Utile après l'usage de la Caméra ou WebRTC qui volent le focus
             MusicControl.stopControl();
             MusicControl.enableBackgroundMode(true);
             
             const commands = [
                 'play', 'pause', 'stop', 'togglePlayPause', 
                 'nextTrack', 'previousTrack', 
                 'seekForward', 'seekBackward',
                 'skipForward', 'skipBackward'
             ];
             commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
             
             MusicControl.enableControl('closeNotification', false, { when: 'never' });
             MusicControl.handleAudioInterruptions(true);

             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], () => {
                 headsetService.triggerCommand('BLUETOOTH_' + cmd);
             }));

             // On rétablit la notification avec l'état actuel
             this.updateNotification(this.currentRoomId !== 'Déconnecté' ? this.currentRoomId : 'Prêt');
          }
      } catch (e) { }
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
          notificationIcon: 'icon' 
      });
      this.refreshMediaFocus();
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

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => { this.refreshMediaFocus(); }, 5000);
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
