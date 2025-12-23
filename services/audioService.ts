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
  
  // Variables Logiques
  lastVolume: number = 0;
  lastVolumeUpTime: number = 0;
  lastToggleTime: number = 0;
  
  // Timer pour maintenir le focus Media actif
  keepAliveTimer: any = null;

  async init(): Promise<boolean> {
    try {
      // ÉTAPE 1 : Démarrer le moteur WebRTC (Micro)
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // ÉTAPE 2 : Forcer la configuration Audio "Media/Haut-Parleur"
      try {
          // MODIFICATION CRITIQUE : 
          // On utilise 'audio' (et non video) mais on force le mode 'media' via setSpeakerphoneOn
          // pour éviter que l'OS ne bascule en mode "In-Communication" exclusif.
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
          
          // Boost Volume Système
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // ÉTAPE 3 : Prendre le Focus "Musique/AVRCP" (CRITIQUE : EN DERNIER)
      this.setupMusicControl();

      // ÉTAPE 4 : Setup des Triggers annexes (VOX & Volume Physique)
      this.setupVox();
      this.setupVolumeTrigger();

      // ÉTAPE 5 : Lancer le Heartbeat pour maintenir le focus Media
      this.startKeepAlive();

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
             MusicControl.enableBackgroundMode(true);
             
             // Activation massive de toutes les commandes pour capter tous les casques
             const commands = ['play', 'pause', 'stop', 'nextTrack', 'previousTrack', 'togglePlayPause', 'seekForward', 'seekBackward'];
             commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
             
             // Verrouillage du service
             MusicControl.enableControl('closeNotification', false, { when: 'never' });
             
             // Gestion agressive du Focus Audio : 
             MusicControl.handleAudioInterruptions(true);

             // Fonction de bascule unique (Toggle)
             const safeToggle = () => { 
                 const now = Date.now();
                 // Anti-rebond 500ms
                 if (now - this.lastToggleTime > 500) { 
                     this.toggleVox();
                     this.lastToggleTime = now;
                 }
             }; 
             
             // Mapping
             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], safeToggle));

             // Initialisation visuelle
             this.updateNotification('En attente...');
          }
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private setupVox() {
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
  }

  private setupVolumeTrigger() {
      try {
          VolumeManager.getVolume().then(v => { this.lastVolume = typeof v === 'number' ? v : 0.5; });

          VolumeManager.addVolumeListener((result) => {
              const currentVol = result.volume;
              const now = Date.now();

              // Si changement de volume détecté (indique une interaction physique)
              if (currentVol !== this.lastVolume) {
                  // Détection Double Clic (<600ms)
                  if (now - this.lastVolumeUpTime < 600) {
                      const safeNow = Date.now();
                      if (safeNow - this.lastToggleTime > 500) {
                          this.toggleVox(); 
                          this.lastToggleTime = safeNow;
                      }
                      this.lastVolumeUpTime = 0; 
                      // Force le volume au max (Feedback tactique)
                      setTimeout(() => VolumeManager.setVolume(1.0), 100);
                  } else {
                      this.lastVolumeUpTime = now;
                  }
              }
              this.lastVolume = currentVol;
          });
      } catch (e) { }
  }

  // --- COEUR DU SYSTÈME : NOTIFICATION & STATE ---
  
  updateNotification(roomId?: string) {
      if (roomId) this.currentRoomId = roomId;
      
      const isVox = this.mode === 'vox';
      const text = isVox ? 'VOX ACTIF' : 'PTT (Manuel)';
      const color = isVox ? 0xFFef4444 : 0xFF3b82f6;

      // On force la mise à jour des métadonnées
      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${text}`,
          album: 'Mode Tactique', 
          duration: 0, 
          color: color,
          isPlaying: true, // TOUJOURS TRUE pour AVRCP
          isSeekable: false,
          notificationIcon: 'icon' 
      });
      
      // On réaffirme l'état "Playing" au système Android
      MusicControl.updatePlayback({
          state: MusicControl.STATE_PLAYING,
          elapsedTime: 0 // Reset timer pour montrer de l'activité
      });
  }

  // Heartbeat : Rappelle toutes les 5s à Android qu'on est une app de musique
  // Cela évite que le profil HFP (Appel) ne reprenne le dessus sur le profil AVRCP (Média)
  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => {
          // On ne change pas le texte, on rafraîchit juste l'état interne
          MusicControl.updatePlayback({
              state: MusicControl.STATE_PLAYING,
              elapsedTime: Date.now() // Fake progress
          });
      }, 5000);
  }

  // --- LOGIQUE METIER ---

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Sécurité PTT : Coupure immédiate
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    this.updateNotification(); // Met à jour l'UI système
    return this.mode === 'vox';
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

  startMetering(callback: (level: number) => void) {
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
