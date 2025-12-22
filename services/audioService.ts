import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';

// IMPORTS NETTOYÉS
import RNSoundLevel from 'react-native-sound-level';

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

      // --- SETUP VOX (Conservation de la détection vocale) ---
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
    // Simulation simple du vumètre pour l'interface
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }

  playStream(remoteStream: MediaStream) { 
      // Placeholder pour future implémentation audio
  }
}

export const audioService = new AudioService();
