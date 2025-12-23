import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
// Import du nouveau module dédié
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
  lastToggleTime: number = 0;
  keepAliveTimer: any = null;

  async init(): Promise<boolean> {
    try {
      // 1. Audio / Micro
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // 2. Initialisation du Module Casque Dédié
      // On lui donne le callback : "Quand tu détectes un truc, lance safeToggle()"
      headsetService.setCommandCallback((source) => {
          console.log('[AudioService] Command received from:', source);
          this.safeToggle();
      });
      
      // Optionnel : Réagir à la connexion du casque
      headsetService.setConnectionCallback((isConnected, type) => {
          if(isConnected) this.updateNotification(this.currentRoomId, `Casque Connecté (${type})`);
      });

      // 3. Configuration Audio (Boost Sonore)
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 4. Setup MusicControl (Boutons Bluetooth & Background)
      this.setupMusicControl();

      // 5. Triggers VOX
      this.setupVox();

      // 6. KeepAlive (Heartbeat)
      this.startKeepAlive();

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- GESTION BLUETOOTH / BACKGROUND (MusicControl) ---
  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
             // Reset pour garantir la prise de focus
             MusicControl.stopControl();
             MusicControl.enableBackgroundMode(true);
             
             // Activation de TOUTES les commandes pour capter n'importe quel clic casque
             const commands = [
                 'play', 'pause', 'stop', 'togglePlayPause', 
                 'nextTrack', 'previousTrack', 
                 'seekForward', 'seekBackward',
                 'skipForward', 'skipBackward'
             ];
             commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
             
             MusicControl.enableControl('closeNotification', false, { when: 'never' });
             
             // Gestion agressive du Focus Audio
             MusicControl.handleAudioInterruptions(true);

             // On mappe TOUT vers la bascule unique via safeToggle
             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], () => this.safeToggle()));

             this.updateNotification('Prêt');
          }
      } catch (e) { }
  }

  // --- FONCTION DE BASCULE SÉCURISÉE (ANTI-REBOND GLOBAL) ---
  private safeToggle() {
      const now = Date.now();
      // Délai de 500ms entre deux bascules pour éviter les doubles déclenchements involontaires
      if (now - this.lastToggleTime > 500) { 
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
          isPlaying: true, 
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
    
    // Sécurité PTT : Coupure immédiate
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    this.updateNotification();
    return this.mode === 'vox';
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
