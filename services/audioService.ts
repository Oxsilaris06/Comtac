import { mediaDevices, MediaStream } from 'react-native-webrtc';

// Chargement sécurisé des modules natifs
let RNSoundLevel: any;
let MusicControl: any, Command: any;
try {
  RNSoundLevel = require('react-native-sound-level').default;
  const MCModule = require('react-native-music-control');
  MusicControl = MCModule.default;
  Command = MCModule.Command;
} catch (e) { console.log("Audio Natif non disponible (mode WebRTC pur)"); }

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  // Paramètres VOX
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  async init(): Promise<boolean> {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // --- 1. CONFIGURATION BLUETOOTH (Casques Tactiques) ---
      if (MusicControl) {
        MusicControl.enableBackgroundMode(true);
        MusicControl.setNowPlaying({
          title: 'COM TAC',
          artist: 'Canal Actif',
          album: 'Tactical',
          duration: 0, 
          color: 0xFF3b82f6,
          notificationIcon: 'play' // Assurez-vous d'avoir une icône ou laissez par défaut
        });
        
        // Active tous les contrôles possibles pour intercepter le bouton du casque
        MusicControl.enableControl('play', true);
        MusicControl.enableControl('pause', true);
        MusicControl.enableControl('stop', false);
        MusicControl.enableControl('togglePlayPause', true);

        const toggleHandler = () => {
            this.setTx(!this.isTx); 
            // Feedback visuel sur le lecteur du téléphone
            MusicControl.updatePlayback({
                state: !this.isTx ? MusicControl.STATE_PLAYING : MusicControl.STATE_PAUSED,
                elapsedTime: 0
            });
        };

        MusicControl.on(Command.play, toggleHandler);
        MusicControl.on(Command.pause, toggleHandler);
        MusicControl.on(Command.togglePlayPause, toggleHandler);
      }

      // --- 2. CONFIGURATION VOX (Natif) ---
      if (RNSoundLevel) {
        try {
            RNSoundLevel.start();
            RNSoundLevel.onNewFrame = (data: any) => {
                // data.value est en décibels (ex: -160 à 0)
                if (this.mode === 'vox' && data.value > this.voxThreshold) {
                    if (!this.isTx) this.setTx(true);
                    
                    if (this.voxTimer) clearTimeout(this.voxTimer);
                    this.voxTimer = setTimeout(() => this.setTx(false), this.voxHoldTime);
                }
            };
        } catch(e) { console.warn("Erreur démarrage RNSoundLevel", e); }
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
    
    // Mute hardware réel via WebRTC
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

  // Polling pour l'UI (App.tsx) - Permet de voir quand le VOX active le micro
  startMetering(callback: (level: number) => void) {
    setInterval(() => {
       callback(this.isTx ? 1 : 0);
    }, 200);
  }

  playStream(remoteStream: MediaStream) {
    // Géré automatiquement par WebRTC InCallManager
  }
}

export const audioService = new AudioService();