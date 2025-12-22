import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
// AJOUT: Gestionnaire d'appel pour forcer le Haut-Parleur
import InCallManager from 'react-native-incall-manager';

class AudioService {
  stream: MediaStream | null = null;
  remoteStreams: MediaStream[] = []; 
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  // Notification & Volume
  currentRoomId: string = 'Déconnecté';
  lastVolume: number = 0;
  lastVolumeUpTime: number = 0;

  async init(): Promise<boolean> {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // --- CONFIGURATION AUDIO TACTIQUE (BOOST SON) ---
      try {
          // 1. Démarrer en mode 'video' force l'utilisation du Haut-Parleur (plus fort que 'audio')
          InCallManager.start({ media: 'video' }); 
          
          // 2. Forcer explicitement le Speakerphone
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          
          // 3. Maximiser le volume système (Boost 100%)
          await VolumeManager.setVolume(1.0); 
          
          // 4. Empêcher l'écran de s'éteindre (Optionnel, géré par keep-awake ailleurs)
          InCallManager.setKeepScreenOn(true);
      } catch (e) { console.log("Audio Boost Error:", e); }

      // --- SETUP NOTIFICATION PERMANENTE ---
      try {
          if (Platform.OS === 'android') {
             MusicControl.enableBackgroundMode(true);
             this.updateNotification('En attente...');
             
             MusicControl.enableControl('play', true);
             MusicControl.enableControl('pause', true);
             // On supprime 'stop' pour éviter que l'OS ne tue le service
             MusicControl.enableControl('stop', false); 

             const toggle = () => { this.toggleVox(); }; 
             MusicControl.on(Command.play, toggle);
             MusicControl.on(Command.pause, toggle);
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

      // --- SETUP TRIGGER VOLUME (DOUBLE CLICK) ---
      try {
          const vol = await VolumeManager.getVolume();
          this.lastVolume = typeof vol === 'number' ? vol : 0.5;

          VolumeManager.addVolumeListener((result) => {
              const currentVol = result.volume;
              const now = Date.now();

              // Détection Hausse Volume
              if (currentVol > this.lastVolume || (currentVol === 1 && this.lastVolume === 1)) {
                  // Si clic rapide (<600ms)
                  if (now - this.lastVolumeUpTime < 600) {
                      this.toggleVox(); 
                      this.lastVolumeUpTime = 0; // Reset
                      // On remet le volume à fond après l'action
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

      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${voxStateText}`,
          album: 'Réseau Tactique',
          duration: 0, 
          color: color,
          isPlaying: this.mode === 'vox', 
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
