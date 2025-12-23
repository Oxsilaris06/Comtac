import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
// AJOUT: Module d'interception Hardware
import KeyEvent from 'react-native-keyevent';

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
      // 1. Audio
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // 2. Configuration Hardware Audio
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 3. SETUP HARDWARE KEYEVENTS (La Solution Ultime)
      this.setupKeyEvents();

      // 4. Setup MusicControl (Juste pour la Notif UI et le KeepAlive)
      this.setupMusicControl();

      // 5. Triggers
      this.setupVox();

      // 6. KeepAlive
      this.startKeepAlive();

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  private setupKeyEvents() {
      // Liste des KeyCodes Android pertinents pour un casque tactique/écouteurs
      const RELEVANT_KEYS = [
          24, // VOLUME_UP
          25, // VOLUME_DOWN
          79, // HEADSETHOOK (Bouton principal des kits piétons)
          85, // MEDIA_PLAY_PAUSE
          87, // MEDIA_NEXT
          88, // MEDIA_PREVIOUS
          126, // MEDIA_PLAY
          127, // MEDIA_PAUSE
      ];

      KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
          // On filtre pour ne réagir qu'aux boutons utiles
          if (RELEVANT_KEYS.includes(keyEvent.keyCode)) {
              this.safeToggle();
          }
      });
  }

  // Fonction de bascule sécurisée (Anti-rebond global)
  private safeToggle() {
      const now = Date.now();
      // 400ms d'anti-rebond pour éviter les doubles déclenchements hardware
      if (now - this.lastToggleTime > 400) { 
          this.toggleVox();
          this.lastToggleTime = now;
          
          // Petit hack: Si c'était un bouton volume, on remet le volume à fond
          // pour annuler l'effet de baisse/hausse du système
          setTimeout(() => VolumeManager.setVolume(1.0), 50);
      }
  }

  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
             MusicControl.enableBackgroundMode(true);
             
             // On active tout pour garder le service vivant
             const commands = ['play', 'pause', 'stop', 'nextTrack', 'previousTrack', 'togglePlayPause'];
             commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
             
             MusicControl.enableControl('closeNotification', false, { when: 'never' });
             MusicControl.handleAudioInterruptions(true);

             // On garde quand même les listeners MusicControl en backup
             // (Si KeyEvent rate, MusicControl peut attraper le relais sur certains casques)
             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], () => this.safeToggle()));

             this.updateNotification('En attente...');
          }
      } catch (e) { }
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

  updateNotification(roomId?: string) {
      if (roomId) this.currentRoomId = roomId;
      
      const isVox = this.mode === 'vox';
      const text = isVox ? 'VOX ACTIF' : 'PTT (Manuel)';
      const color = isVox ? 0xFFef4444 : 0xFF3b82f6;

      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${text}`,
          album: 'Mode Tactique', 
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
