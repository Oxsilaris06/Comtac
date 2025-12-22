import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';

// IMPORTS STATIQUES OBLIGATOIRES (Stabilité Hermes)
// Si le build échoue ici, c'est que les modules ne sont pas installés (npm install requis)
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  async init(): Promise<boolean> {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // --- SETUP BLUETOOTH (Sécurisé) ---
      try {
          if (Platform.OS === 'android') {
             // Configuration minimale pour éviter le crash "Icon not found"
             MusicControl.enableBackgroundMode(true);
             MusicControl.setNowPlaying({
                title: 'COM TAC',
                artist: 'Canal Actif',
                album: 'Tactical',
                duration: 0, 
                color: 0xFF3b82f6,
                // notificationIcon: 'play' <--- LIGNE SUPPRIMÉE (CAUSE DU CRASH)
                // Android utilisera l'icône de l'app par défaut
             });
             
             MusicControl.enableControl('play', true);
             MusicControl.enableControl('pause', true);
             MusicControl.enableControl('togglePlayPause', true);
             // Stop doit être false sinon Android tue le service parfois
             MusicControl.enableControl('stop', false); 

             const toggle = () => {
                 this.setTx(!this.isTx); 
                 MusicControl.updatePlayback({
                     state: !this.isTx ? MusicControl.STATE_PLAYING : MusicControl.STATE_PAUSED,
                     elapsedTime: 0
                 });
             };

             MusicControl.on(Command.play, toggle);
             MusicControl.on(Command.pause, toggle);
             MusicControl.on(Command.togglePlayPause, toggle);
          }
      } catch (e) { console.log("BT Error:", e); }

      // --- SETUP VOX ---
      try {
          RNSoundLevel.start();
          RNSoundLevel.onNewFrame = (data: any) => {
              if (this.mode === 'vox' && data.value > this.voxThreshold) {
                  if (!this.isTx) this.setTx(true);
                  if (this.voxTimer) clearTimeout(this.voxTimer);
                  this.voxTimer = setTimeout(() => this.setTx(false), this.voxHoldTime);
              }
          };
      } catch (e) { console.log("VOX Error:", e); }

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
  }

  startMetering(callback: (level: number) => void) {
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }

  playStream(remoteStream: MediaStream) { }
}

export const audioService = new AudioService();
