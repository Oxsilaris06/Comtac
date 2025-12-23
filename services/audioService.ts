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
  
  // Variables pour la logique de contrôle (Anti-rebond & Double Clic)
  lastVolume: number = 0;
  lastVolumeUpTime: number = 0;
  lastToggleTime: number = 0; // Sécurité anti-spam commandes BT

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

      // --- SETUP COMMANDES UNIVERSELLES (BLUETOOTH & NOTIF) ---
      try {
          if (Platform.OS === 'android') {
             MusicControl.enableBackgroundMode(true);
             
             // 1. ACTIVATION DE TOUTES LES COMMANDES POSSIBLES (AVRCP Catch-All)
             // Cela garantit que peu importe le bouton appuyé, l'événement est capté
             MusicControl.enableControl('play', true);
             MusicControl.enableControl('pause', true);
             MusicControl.enableControl('stop', true);
             MusicControl.enableControl('nextTrack', true);
             MusicControl.enableControl('previousTrack', true);
             MusicControl.enableControl('seekForward', true); // Certains casques utilisent ceci
             MusicControl.enableControl('seekBackward', true);
             MusicControl.enableControl('skipForward', true);
             MusicControl.enableControl('skipBackward', true);
             MusicControl.enableControl('togglePlayPause', true);
             
             // Empêche le système de tuer le service
             MusicControl.enableControl('closeNotification', false, { when: 'never' });

             // Gestion du Focus Audio
             MusicControl.handleAudioInterruptions(true);

             this.updateNotification('En attente...');

             // 2. FONCTION DE BASCULE SÉCURISÉE (DEBOUNCE)
             // Empêche le double déclenchement si le casque envoie "Pause" puis "Play"
             const safeToggle = () => { 
                 const now = Date.now();
                 if (now - this.lastToggleTime > 500) { // 500ms de délai minimum
                     this.toggleVox(); 
                     this.lastToggleTime = now;
                 }
             }; 
             
             // 3. MAPPING ABSOLU DE TOUS LES ÉVÉNEMENTS
             MusicControl.on(Command.play, safeToggle);
             MusicControl.on(Command.pause, safeToggle);
             MusicControl.on(Command.stop, safeToggle);
             MusicControl.on(Command.nextTrack, safeToggle);
             MusicControl.on(Command.previousTrack, safeToggle);
             MusicControl.on(Command.seekForward, safeToggle);
             MusicControl.on(Command.seekBackward, safeToggle);
             MusicControl.on(Command.skipForward, safeToggle);
             MusicControl.on(Command.skipBackward, safeToggle);
             MusicControl.on(Command.togglePlayPause, safeToggle);
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

      // --- SETUP VOLUME TRIGGER (DOUBLE CLIC) ---
      try {
          const vol = await VolumeManager.getVolume();
          this.lastVolume = typeof vol === 'number' ? vol : 0.5;

          VolumeManager.addVolumeListener((result) => {
              const currentVol = result.volume;
              const now = Date.now();

              // Détection Hausse Volume (y compris si déjà au max)
              if (currentVol > this.lastVolume || (currentVol === 1 && this.lastVolume === 1)) {
                  // Si clic rapide (<600ms) = DOUBLE CLIC
                  if (now - this.lastVolumeUpTime < 600) {
                      // On utilise aussi le safeToggle logic ici manuellement
                      if (now - this.lastToggleTime > 500) {
                          this.toggleVox(); 
                          this.lastToggleTime = now;
                      }
                      this.lastVolumeUpTime = 0; // Reset pour éviter triple clic
                      
                      // Remise à niveau du volume (Feedback tactile : le volume reste à fond)
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
          album: 'Appuyez sur un bouton pour changer', 
          duration: 0, 
          color: color,
          // CRITIQUE : Toujours "Playing" pour capturer les événements Bluetooth
          isPlaying: true, 
          isSeekable: false,
          notificationIcon: 'icon' 
      });
      
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
    // 1. Bascule du mode
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // 2. Si on repasse en PTT, sécurité absolue : on coupe le micro
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    // 3. Mise à jour Notification et UI
    this.updateNotification();
    return this.mode === 'vox';
  }

  startMetering(callback: (level: number) => void) {
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
