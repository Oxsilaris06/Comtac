import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';

class AudioService {
  stream: MediaStream | null = null;
  remoteStreams: MediaStream[] = []; 
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  currentRoomId: string = 'Déconnecté';
  lastVolume: number = 0;
  lastVolumeUpTime: number = 0;

  async init(): Promise<boolean> {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // --- CONFIGURATION AUDIO (BOOST) ---
      try {
          InCallManager.start({ media: 'video' }); 
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          await VolumeManager.setVolume(1.0); 
          InCallManager.setKeepScreenOn(true);
      } catch (e) { console.log("Audio Boost Error:", e); }

      // --- SETUP NOTIFICATION & BLUETOOTH ---
      try {
          if (Platform.OS === 'android') {
             MusicControl.enableBackgroundMode(true);
             
             // CONFIGURATION SPÉCIFIQUE DEMANDÉE :
             // On désactive Play/Pause pour éviter la confusion
             MusicControl.enableControl('play', false);
             MusicControl.enableControl('pause', false);
             MusicControl.enableControl('stop', false);
             
             // On active Suivant/Précédent pour le switch VOX
             MusicControl.enableControl('nextTrack', true);
             MusicControl.enableControl('previousTrack', true);

             // On initialise la notification
             this.updateNotification('En attente...');

             // Mapping des commandes Bluetooth/Notification
             const toggle = () => { this.toggleVox(); }; 
             
             // Les écouteurs Bluetooth envoient ces commandes
             MusicControl.on(Command.nextTrack, toggle);
             MusicControl.on(Command.previousTrack, toggle);
          }
      } catch (e) { }

      // --- SETUP VOX (VAD) ---
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

      // --- SETUP VOLUME TRIGGER (BACKUP) ---
      try {
          const vol = await VolumeManager.getVolume();
          this.lastVolume = typeof vol === 'number' ? vol : 0.5;

          VolumeManager.addVolumeListener((result) => {
              const currentVol = result.volume;
              const now = Date.now();
              if (currentVol > this.lastVolume || (currentVol === 1 && this.lastVolume === 1)) {
                  if (now - this.lastVolumeUpTime < 600) {
                      this.toggleVox(); 
                      this.lastVolumeUpTime = 0; 
                      setTimeout(() => VolumeManager.setVolume(1.0), 100);
                  } else {
                      this.lastVolumeUpTime = now;
                  }
              }
              this.lastVolume = currentVol;
          });
      } catch (e) { }

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  updateNotification(roomId?: string) {
      if (roomId) this.currentRoomId = roomId;
      
      const voxStateText = this.mode === 'vox' ? 'VOX ACTIF' : 'PTT (Manuel)';
      // Rouge (0xFFef4444) si VOX, Bleu (0xFF3b82f6) si PTT
      const color = this.mode === 'vox' ? 0xFFef4444 : 0xFF3b82f6;

      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${voxStateText}`,
          album: 'Switch via Suivant/Précédent', // Aide utilisateur
          duration: 0, 
          color: color,
          isPlaying: true, // Toujours actif pour garder le service vivant
          isSeekable: false,
          notificationIcon: 'icon' 
      });
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

  toggleVox() {
    // Bascule du mode
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // CRITIQUE : Si on passe en PTT, on COUPE le micro immédiatement
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    // Mise à jour visuelle de la notif
    this.updateNotification();
    
    return this.mode === 'vox';
  }

  startMetering(callback: (level: number) => void) {
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
