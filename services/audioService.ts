import { mediaDevices, MediaStream } from 'react-native-webrtc';

// Chargement défensif des modules natifs
let RNSoundLevel: any;
let MusicControl: any, Command: any;

try {
  RNSoundLevel = require('react-native-sound-level').default;
  const MC = require('react-native-music-control');
  MusicControl = MC.default;
  Command = MC.Command;
} catch (e) {
  console.warn("Audio Natif non dispo (Mode dégradé activé)");
}

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

      // --- BLUETOOTH ---
      if (MusicControl) {
        try {
            MusicControl.enableBackgroundMode(true);
            MusicControl.setNowPlaying({
                title: 'COM TAC',
                artist: 'Canal Actif',
                album: 'Tactical',
                duration: 0,
                color: 0xFF3b82f6,
                notificationIcon: 'play'
            });
            
            // Activation complète des commandes
            MusicControl.enableControl('play', true);
            MusicControl.enableControl('pause', true);
            MusicControl.enableControl('stop', false);
            MusicControl.enableControl('togglePlayPause', true);
            MusicControl.enableControl('nextTrack', true); // Certains casques utilisent ça
            MusicControl.enableControl('previousTrack', true);

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
            MusicControl.on(Command.nextTrack, toggle);
            MusicControl.on(Command.previousTrack, toggle);
        } catch(e) { console.log("Err Bluetooth:", e); }
      }

      // --- VOX ---
      if (RNSoundLevel) {
        try {
            RNSoundLevel.start();
            RNSoundLevel.onNewFrame = (data: any) => {
                if (this.mode === 'vox' && data.value > this.voxThreshold) {
                    if (!this.isTx) this.setTx(true);
                    if (this.voxTimer) clearTimeout(this.voxTimer);
                    this.voxTimer = setTimeout(() => this.setTx(false), this.voxHoldTime);
                }
            };
        } catch(e) { console.log("Err VOX:", e); }
      }

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

  playStream(remoteStream: MediaStream) {
    // Géré par WebRTC
  }
}

export const audioService = new AudioService();
