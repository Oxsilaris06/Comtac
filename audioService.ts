import { mediaDevices, MediaStream } from 'react-native-webrtc';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { Platform } from 'react-native';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  // Seuil VOX en décibels (ajustable)
  // -160 (silence absolu) à 0 (très fort). -35/-40 est bon pour la voix.
  voxThreshold: number = -40; 
  voxHoldTime: number = 1000; // Temps de maintien (ms)
  voxTimer: any = null;

  async init(): Promise<boolean> {
    try {
      // 1. Initialiser le stream WebRTC
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: false
      }) as MediaStream;
      
      this.stream = stream;
      this.setTx(false);

      // 2. Initialiser le contrôle Bluetooth (Casque)
      this.initBluetoothControls();

      // 3. Initialiser le monitoring VOX Natif
      // Note: Sur Android, RNSoundLevel peut entrer en conflit avec WebRTC
      // s'ils essaient d'ouvrir le micro en même temps.
      // On wrap dans un try/catch pour ne pas faire planter l'app.
      try {
        RNSoundLevel.start();
        RNSoundLevel.onNewFrame = (data) => {
          this.handleVoxFrame(data.value);
        };
      } catch (e) {
        console.warn("Erreur VOX Natif (Conflit micro probable sur Android):", e);
      }

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- GESTION BLUETOOTH (PTT Physique) ---
  initBluetoothControls() {
    MusicControl.enableBackgroundMode(true);
    
    // On fait croire au système qu'on joue de la musique pour capturer les boutons
    MusicControl.setNowPlaying({
      title: 'COM TAC',
      artwork: 'https://via.placeholder.com/150', // Dummy
      artist: 'Canal Sécurisé',
      album: 'Active',
      genre: 'Tactical',
      duration: 0,
      description: 'Radio Tactique',
      date: '2024-01-01',
      rating: true,
      notificationIcon: 'my_custom_icon'
    });

    // Activer les contrôles
    MusicControl.enableControl('play', true);
    MusicControl.enableControl('pause', true);
    MusicControl.enableControl('stop', true);
    MusicControl.enableControl('togglePlayPause', true);

    // Mapping des boutons casque -> PTT
    // Appui bouton = Toggle TX
    const togglePTT = () => {
      // Si en mode VOX, le bouton force le mute/unmute
      // Si en mode PTT, le bouton agit comme un latch (verrouillage)
      this.setTx(!this.isTx); 
      // Mettre à jour l'état visuel du lecteur (facultatif mais propre)
      MusicControl.updatePlayback({
        state: this.isTx ? MusicControl.STATE_PLAYING : MusicControl.STATE_PAUSED
      });
    };

    MusicControl.on(Command.play, togglePTT);
    MusicControl.on(Command.pause, togglePTT);
    MusicControl.on(Command.togglePlayPause, togglePTT);
    MusicControl.on(Command.stop, () => this.setTx(false));
  }

  // --- LOGIQUE VOX NATIVE ---
  handleVoxFrame(decibels: number) {
    if (this.mode !== 'vox') return;

    // Logique VAD (Voice Activity Detection)
    if (decibels > this.voxThreshold) {
      // Voix détectée
      if (!this.isTx) {
        this.setTx(true);
      }
      // Reset du timer de maintien
      if (this.voxTimer) clearTimeout(this.voxTimer);
      this.voxTimer = setTimeout(() => {
        this.setTx(false);
      }, this.voxHoldTime);
    }
  }

  // --- GESTION TRANSMISSION ---
  setTx(state: boolean) {
    if (this.isTx === state) return; // Évite les boucles
    
    this.isTx = state;
    
    // Hardware Mute/Unmute
    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => {
        track.enabled = state; 
      });
    }

    // Feedback Haptique (Vibration) pour confirmer l'action sans regarder
    // (Nécessite d'importer Haptics dans ce fichier ou de passer un callback, 
    // ici on assume que l'UI réagira au state change via App.tsx polling ou event)
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    if (this.mode === 'ptt') {
      this.setTx(false); // Sécurité
      if (this.voxTimer) clearTimeout(this.voxTimer);
    }
  }

  // Pour l'interface UI (Simulé ou réel selon dispo)
  startMetering(callback: (level: number) => void) {
    // On utilise les données natives de RNSoundLevel si disponibles
    // Sinon on renvoie 0
    const interval = setInterval(() => {
       // Note: RNSoundLevel envoie des events, ici on poll juste pour l'UI si besoin
       // Mais la vraie logique est dans onNewFrame
       callback(this.isTx ? 1 : 0); // Simple indicateur On/Off pour l'UI
    }, 100);
  }

  playStream(remoteStream: MediaStream) {
    console.log("[Audio] Playing remote stream", remoteStream.id);
  }
}

export const audioService = new AudioService();