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

      // --- SETUP NOTIFICATION & BLUETOOTH (ROBUSTE) ---
      try {
          if (Platform.OS === 'android') {
             MusicControl.enableBackgroundMode(true);
             
             // GESTION ROBUSTE : On active une large gamme de contrôles pour capter tous les casques
             // Même si on cible Next/Prev, certains casques envoient Play/Pause
             MusicControl.enableControl('play', true);
             MusicControl.enableControl('pause', true);
             MusicControl.enableControl('nextTrack', true);
             MusicControl.enableControl('previousTrack', true);
             MusicControl.enableControl('togglePlayPause', true); // Bouton unique
             
             // Empêche le système de tuer le service
             MusicControl.enableControl('stop', false);
             MusicControl.enableControl('closeNotification', false, { when: 'never' });

             // Gestion du Focus Audio (Interruption par GPS/Appel)
             MusicControl.handleAudioInterruptions(true);

             this.updateNotification('En attente...');

             const toggle = () => { this.toggleVox(); }; 
             
             // Mapping Multi-Boutons -> Même Action (Switch VOX/PTT)
             MusicControl.on(Command.nextTrack, toggle);
             MusicControl.on(Command.previousTrack, toggle);
             MusicControl.on(Command.play, toggle);
             MusicControl.on(Command.pause, toggle);
             MusicControl.on(Command.togglePlayPause, toggle);
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
      const color = this.mode === 'vox' ? 0xFFef4444 : 0xFF3b82f6;

      // Configuration agressive pour le background
      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${voxStateText}`,
          album: 'Utilisez Suivant/Précédent', 
          duration: 0, 
          color: color,
          // CRITIQUE : Toujours dire "Playing" au système pour garder le CPU/Events actifs
          // même si on ne joue pas de son réel (le stream webrtc est géré à part)
          isPlaying: true, 
          isSeekable: false,
          notificationIcon: 'icon' 
      });
      
      // Force la mise à jour de l'état de lecture
      MusicControl.updatePlayback({
          state: MusicControl.STATE_PLAYING,
          elapsedTime: 0
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
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Si on passe en PTT, on COUPE le micro immédiatement
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    this.updateNotification();
    return this.mode === 'vox';
  }

  startMetering(callback: (level: number) => void) {
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
