import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
// On garde KeyEvent en backup pour le foreground
import KeyEvent from 'react-native-keyevent';

class AudioService {
  stream: MediaStream | null = null;
  remoteStreams: MediaStream[] = []; 
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  currentRoomId: string = 'Déconnecté';
  
  // Logique de contrôle
  lastVolume: number = 0;
  lastVolumeUpTime: number = 0;
  lastToggleTime: number = 0;
  keepAliveTimer: any = null;

  async init(): Promise<boolean> {
    try {
      // 1. Audio / Micro
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // 2. Setup KeyEvent (Boutons Physiques Foreground)
      this.setupKeyEvents();

      // 3. Configuration Audio (Boost Sonore)
      try {
          // On force le mode AUDIO (et non video) pour essayer de garder un profil mixte
          // Tout en forçant le Speakerphone pour la puissance
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 4. Setup MusicControl (Boutons Bluetooth & Background)
      // IMPORTANT : On le fait APRÈS InCallManager pour reprendre le focus des boutons
      this.setupMusicControl();

      // 5. Triggers
      this.setupVox();
      this.setupVolumeTrigger();

      // 6. KeepAlive (Heartbeat)
      this.startKeepAlive();

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- GESTION BOUTONS PHYSIQUES (FOREGROUND) ---
  private setupKeyEvents() {
      // Écoute directe des touches matérielles quand l'app est active
      const RELEVANT_KEYS = [24, 25, 79, 85, 87, 88, 126, 127]; // VolUp, VolDown, Headset, Media...
      KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
          if (RELEVANT_KEYS.includes(keyEvent.keyCode)) {
              // Pour KeyEvent, on filtre manuellement le Volume Down ici si besoin, 
              // mais pour la bascule VOX on veut souvent juste un bouton d'action.
              // Ici on laisse la bascule se faire pour les boutons médias/casque.
              if (keyEvent.keyCode !== 25) { // On ignore Volume Down (25) pour la bascule
                  this.safeToggle();
              }
          }
      });
  }

  // --- GESTION BLUETOOTH / BACKGROUND ---
  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
             // Reset pour garantir la prise de focus
             MusicControl.stopControl();
             MusicControl.enableBackgroundMode(true);
             
             // Activation de TOUTES les commandes pour capter n'importe quel clic casque
             const commands = [
                 'play', 'pause', 'stop', 'togglePlayPause', 
                 'nextTrack', 'previousTrack', // Souvent les mieux gérés par les casques
                 'seekForward', 'seekBackward',
                 'skipForward', 'skipBackward'
             ];
             commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
             
             MusicControl.enableControl('closeNotification', false, { when: 'never' });
             
             // Gestion agressive du Focus Audio
             MusicControl.handleAudioInterruptions(true);

             // On mappe TOUT vers la bascule unique
             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], () => this.safeToggle()));

             // On initialise l'état
             this.updateNotification('Prêt');
          }
      } catch (e) { }
  }

  // --- GESTION VOLUME (DOUBLE CLIC VOLUME UP) ---
  private setupVolumeTrigger() {
      try {
          VolumeManager.getVolume().then(v => { this.lastVolume = typeof v === 'number' ? v : 0.5; });

          VolumeManager.addVolumeListener((result) => {
              const currentVol = result.volume;
              const now = Date.now();

              // CORRECTIF : On ne réagit que si le volume AUGMENTE (Up)
              // Ou si on est déjà au max (1) et qu'on essaie encore d'augmenter (reste à 1)
              const isVolumeUp = currentVol > this.lastVolume || (currentVol === 1 && this.lastVolume === 1);

              if (isVolumeUp) {
                  // Si clic rapide (<600ms) = DOUBLE CLIC
                  if (now - this.lastVolumeUpTime < 600) {
                      this.safeToggle(); // Action !
                      this.lastVolumeUpTime = 0; // Reset
                      
                      // On remet le volume à fond pour annuler l'effet et préparer le prochain clic
                      setTimeout(() => VolumeManager.setVolume(1.0), 100);
                  } else {
                      // Premier clic
                      this.lastVolumeUpTime = now;
                  }
              }
              
              this.lastVolume = currentVol;
          });
      } catch (e) { }
  }

  // --- FONCTION DE BASCULE SÉCURISÉE (ANTI-REBOND GLOBAL) ---
  private safeToggle() {
      const now = Date.now();
      // Délai de 500ms entre deux bascules pour éviter les doubles déclenchements involontaires
      if (now - this.lastToggleTime > 500) { 
          this.toggleVox();
          this.lastToggleTime = now;
      }
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

  updateNotification(roomId?: string) {
      if (roomId) this.currentRoomId = roomId;
      
      const isVox = this.mode === 'vox';
      const text = isVox ? 'VOX ACTIF' : 'PTT (Manuel)';
      const color = isVox ? 0xFFef4444 : 0xFF3b82f6;

      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${text}`,
          album: 'Mode Tactique', 
          duration: 0, 
          color: color,
          // CRITIQUE : Toujours "Playing" pour que le Bluetooth reste actif
          isPlaying: true, 
          isSeekable: false,
          notificationIcon: 'icon' 
      });
      
      // On force l'état PLAYING pour le système
      MusicControl.updatePlayback({
          state: MusicControl.STATE_PLAYING,
          elapsedTime: 0 
      });
  }

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => {
          // On rafraîchit l'état "Lecture" toutes les 5s pour empêcher le système de tuer le service
          MusicControl.updatePlayback({
              state: MusicControl.STATE_PLAYING,
              elapsedTime: Date.now() 
          });
      }, 5000);
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Si on repasse en PTT, on COUPE le micro immédiatement (Sécurité)
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    this.updateNotification();
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
