import { Platform } from 'react-native';
// On importe directement le module natif.
// Si TypeScript souligne en rouge, ce n'est pas grave, le build Android passera.
import { mediaDevices, MediaStream } from 'react-native-webrtc'; 

class AudioService {
  public stream: MediaStream | null = null;
  public mode: 'ptt' | 'vox' = 'ptt';
  public isTx = false;

  async init() {
    try {
      const constraints = {
        audio: true, // Simplifié pour la compatibilité maximale
        video: false
      };

      // Cast explicite pour éviter les erreurs de typage TS strict
      this.stream = await mediaDevices.getUserMedia(constraints) as MediaStream;
      
      // Mute initial (Mode écoute seule par défaut)
      this.setTx(false);
      
      return true;
    } catch (e) {
      console.error("AudioService: Échec init micro:", e);
      return false;
    }
  }

  setTx(active: boolean) {
    this.isTx = active;
    if (this.stream) {
      // En WebRTC natif, activer/désactiver la piste coupe réellement l'envoi de paquets
      this.stream.getAudioTracks().forEach((track: any) => {
        track.enabled = active;
      });
    }
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    return this.mode;
  }

  playStream(remoteStream: any) {
    // En React Native WebRTC, le composant RTCView ou le système gère la sortie.
    // Cette fonction est gardée pour la compatibilité de l'interface.
    console.debug("AudioService: Flux distant connecté au système natif");
  }

  startMetering(callback: (level: number) => void) {
    // Simulation du VU-mètre (car l'analyse audio temps réel native est complexe sans module dédié)
    const interval = setInterval(() => {
      if (this.isTx) {
        // Simule une voix qui module (entre 0.4 et 0.8)
        callback(0.4 + Math.random() * 0.4);
      } else {
        // Silence ou léger bruit de fond
        callback(Math.random() * 0.05);
      }
    }, 100);
    return () => clearInterval(interval);
  }

  getVolume() {
    return this.isTx ? 0.6 : 0;
  }
}

export const audioService = new AudioService();