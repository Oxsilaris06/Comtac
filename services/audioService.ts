import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';

class AudioService {
  stream: MediaStream | null = null;
  remoteStreams: MediaStream[] = []; 
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  // VOX Settings
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  // Notification Data
  currentRoomId: string = 'Déconnecté';

  // Volume Trigger Data
  lastVolume: number = 0;
  lastVolumeUpTime: number = 0;

  async init(): Promise<boolean> {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // --- CONFIGURATION NOTIFICATION PERMANENTE ---
      try {
          if (Platform.OS === 'android') {
             MusicControl.enableBackgroundMode(true);
             this.updateNotification('En attente...'); // État initial
             
             // Setup boutons notification (optionnel mais recommandé)
             MusicControl.enableControl('play', true);
             MusicControl.enableControl('pause', true);
             const toggle = () => { this.toggleVox(); }; 
             MusicControl.on(Command.play, toggle);
             MusicControl.on(Command.pause, toggle);
          }
      } catch (e) { }

      // --- SETUP VOX (Détection Voix) ---
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

      // --- SETUP DOUBLE CLIC VOLUME (Trigger Hardware) ---
      try {
          // On récupère le volume initial
          const vol = await VolumeManager.getVolume();
          this.lastVolume = typeof vol === 'number' ? vol : 0.5;

          VolumeManager.addVolumeListener((result) => {
              const currentVol = result.volume;
              const now = Date.now();

              // Si le volume augmente
              if (currentVol > this.lastVolume) {
                  // Si le dernier "Volume Up" était il y a moins de 600ms
                  if (now - this.lastVolumeUpTime < 600) {
                      this.toggleVox(); // ACTION !
                      this.lastVolumeUpTime = 0; // Reset pour éviter triple clic
                  } else {
                      this.lastVolumeUpTime = now;
                  }
              }
              this.lastVolume = currentVol;
          });
      } catch (e) { console.log("Volume Listener Error", e); }

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- MISE A JOUR NOTIFICATION ---
  updateNotification(roomId?: string) {
      if (roomId) this.currentRoomId = roomId;
      
      const voxStateText = this.mode === 'vox' ? 'VOX ACTIF' : 'PTT (Manuel)';
      
      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac en ligne (${voxStateText})`,
          album: 'Réseau Tactique',
          duration: 0, 
          color: this.mode === 'vox' ? 0xFFef4444 : 0xFF3b82f6, // Rouge si VOX, Bleu sinon
          isPlaying: this.mode === 'vox', 
          isSeekable: false,
          notificationIcon: 'icon' // Utilise l'icône de l'app par défaut
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
    // 1. Changement de mode
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // 2. Gestion Micro : Si on passe en PTT, on COUPE immédiatement (Demandé)
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    // 3. Mise à jour Notification pour refléter l'état
    this.updateNotification();
    
    return this.mode === 'vox'; // Retourne l'état pour l'UI
  }

  startMetering(callback: (level: number) => void) {
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
