import { mediaDevices, MediaStream } from 'react-native-webrtc';
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

      // --- CONFIGURATION BLUETOOTH SÉCURISÉE ---
      try {
          // On wrap tout pour éviter le crash si le module natif n'est pas prêt
          if (MusicControl) {
              MusicControl.enableBackgroundMode(true);
              MusicControl.setNowPlaying({
                title: 'COM TAC',
                artist: 'Canal Actif',
                album: 'Tactical',
                duration: 0, 
                color: 0xFF3b82f6,
                notificationIcon: 'play' 
              });
              
              MusicControl.enableControl('play', true);
              MusicControl.enableControl('pause', true);
              MusicControl.enableControl('stop', false);
              MusicControl.enableControl('togglePlayPause', true);

              const toggleHandler = () => {
                  this.setTx(!this.isTx); 
                  MusicControl.updatePlayback({
                      state: !this.isTx ? MusicControl.STATE_PLAYING : MusicControl.STATE_PAUSED,
                      elapsedTime: 0
                  });
              };

              MusicControl.on(Command.play, toggleHandler);
              MusicControl.on(Command.pause, toggleHandler);
              MusicControl.on(Command.togglePlayPause, toggleHandler);
          }
      } catch (e) { console.warn("MusicControl Init Failed (Feature disabled):", e); }

      // --- CONFIGURATION VOX ---
      try {
          RNSoundLevel.start();
          RNSoundLevel.onNewFrame = (data: any) => {
              if (this.mode === 'vox' && data.value > this.voxThreshold) {
                  if (!this.isTx) this.setTx(true);
                  if (this.voxTimer) clearTimeout(this.voxTimer);
                  this.voxTimer = setTimeout(() => this.setTx(false), this.voxHoldTime);
              }
          };
      } catch (e) { console.warn("VOX Init Failed:", e); }

      return true;
    } catch (err) {
      console.error("[Audio] Global Init Error:", err);
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
    // Auto-managed
  }
}

export const audioService = new AudioService();
