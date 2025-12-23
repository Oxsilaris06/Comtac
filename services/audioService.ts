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
      // 1. Démarrage Micro (STRICTEMENT OFF AU DÉPART)
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // 2. Liaison HeadsetService (Commandes & Routage)
      headsetService.setCommandCallback((source) => {
          this.toggleVox(); 
      });
      
      headsetService.setConnectionCallback((isConnected, type) => {
          console.log(`[Audio] Routing Update: ${type}`);
          if(isConnected) {
              // Casque connecté : On désactive le haut-parleur forcé
              InCallManager.setForceSpeakerphoneOn(false);
              this.updateNotification(this.currentRoomId, `Casque Actif (${type})`);
          } else {
              // Pas de casque : On force le haut-parleur (Talkie)
              InCallManager.setForceSpeakerphoneOn(true);
              this.updateNotification(this.currentRoomId, `Haut-Parleur Actif`);
          }
          // On s'assure que le focus média est conservé après un changement de route
          this.refreshMediaFocus();
      });

      // 3. Configuration Audio Initiale
      try {
          // Mode 'audio' standard (meilleure compatibilité Bluetooth)
          InCallManager.start({ media: 'audio' });
          // Par défaut on suppose pas de casque -> Speaker
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true);
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 4. Setup MusicControl (Pour Bluetooth & Notif)
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

  // --- UI ---
  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  private notifyListeners() {
      this.listeners.forEach(cb => cb(this.mode));
  }

  // --- MUSIC CONTROL (BACKUP BLUETOOTH) ---
  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
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

             // Redirection vers HeadsetService pour déduplication
             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], () => {
                 headsetService.triggerCommand('BLUETOOTH_' + cmd);
             }));

             this.updateNotification('Prêt');
          }
      } catch (e) { }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING, elapsedTime: 0 });
      }
  }

  // --- LOGIQUE METIER ---
  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Si passage en PTT, coupure immédiate
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
