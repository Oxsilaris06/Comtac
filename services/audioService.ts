import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';

class AudioService {
  stream: MediaStream | null = null;
  remoteStreams: MediaStream[] = []; 
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt'; // INITIALISATION STRICTE PTT
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  currentRoomId: string = 'Déconnecté';
  keepAliveTimer: any = null;
  reclaimFocusTimer: any = null;

  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];

  async init(): Promise<boolean> {
    try {
      // 1. Audio / Micro (STRICTEMENT OFF AU DÉPART)
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);
      this.mode = 'ptt'; // Force PTT au démarrage

      // 2. Liaison HeadsetService
      headsetService.setCommandCallback((source) => {
          console.log('[AudioService] Toggle triggered by:', source);
          this.toggleVox(); 
      });
      
      headsetService.setConnectionCallback((isConnected, type) => {
          console.log(`[Audio] Routing Update: ${type}`);
          if(isConnected) {
              InCallManager.setForceSpeakerphoneOn(false);
              this.updateNotification(this.currentRoomId, `Casque Actif (${type})`);
          } else {
              InCallManager.setForceSpeakerphoneOn(true);
              this.updateNotification(this.currentRoomId, `Haut-Parleur Actif`);
          }
          // CRITIQUE : Après un changement de route, on reprend le focus média
          this.forceBluetoothPriority();
      });

      // 3. Configuration Audio Initiale
      try {
          // Mode 'audio' standard mais avec focus agressif
          InCallManager.start({ media: 'audio' });
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
          await VolumeManager.setVolume(1.0); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 4. Setup MusicControl
      this.forceBluetoothPriority();

      // 5. Vox & KeepAlive
      this.setupVox();
      this.startKeepAlive();

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- UI SUBSCRIPTION ---
  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      // Notifier l'état actuel dès l'abonnement
      callback(this.mode); 
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  private notifyListeners() {
      this.listeners.forEach(cb => cb(this.mode));
  }

  // --- METHODE PUBLIQUE DE FORÇAGE ---
  // À appeler chaque fois que l'environnement change (nouvelle connexion, scan QR...)
  public forceBluetoothPriority() {
      console.log('[AudioService] Forcing Bluetooth Priority...');
      this.setupMusicControl();
      
      // On lance une boucle agressive de reprise de focus pendant 10 secondes
      // Utile lors de l'établissement d'appel WebRTC qui tente de voler le focus plusieurs fois
      if (this.reclaimFocusTimer) clearInterval(this.reclaimFocusTimer);
      let attempts = 0;
      this.reclaimFocusTimer = setInterval(() => {
          this.refreshMediaFocus();
          attempts++;
          if (attempts > 5) clearInterval(this.reclaimFocusTimer);
      }, 2000);
  }

  // --- GESTION MUSIQUE / BLUETOOTH ---
  private setupMusicControl() {
      try {
          if (Platform.OS === 'android') {
             // On réinitialise complètement pour être sûr
             MusicControl.stopControl(); 
             
             MusicControl.enableBackgroundMode(true);
             
             const commands = [
                 'play', 'pause', 'stop', 'togglePlayPause', 
                 'nextTrack', 'previousTrack', 
                 'seekForward', 'seekBackward',
                 'skipForward', 'skipBackward'
             ];
             commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
             
             MusicControl.enableControl('closeNotification', false, { when: 'never' });
             
             // Important : On demande à Android de nous redonner la main si on est interrompu
             MusicControl.handleAudioInterruptions(true);

             commands.forEach(cmd => MusicControl.on(Command[cmd as keyof typeof Command], () => {
                 headsetService.triggerCommand('BLUETOOTH_' + cmd);
             }));

             this.updateNotification(this.currentRoomId !== 'Déconnecté' ? this.currentRoomId : 'Prêt');
          }
      } catch (e) { }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          // Cette commande "fake" rappelle au système que nous sommes actifs
          MusicControl.updatePlayback({ 
              state: MusicControl.STATE_PLAYING, 
              elapsedTime: Date.now() 
          });
      }
  }

  // --- LOGIQUE METIER ---
  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    } else {
        // Feedback Tactile/Sonore (Optionnel mais recommandé pour confirmer l'activation BT)
        // Vibration courte
    }

    console.log(`[AudioService] Mode switched to: ${this.mode}`);
    this.updateNotification();
    this.notifyListeners();
    return this.mode === 'vox';
  }

  updateNotification(roomId?: string, extraInfo?: string) {
      if (roomId) this.currentRoomId = roomId;
      
      const isVox = this.mode === 'vox';
      const text = isVox ? 'VOX ACTIF' : 'PTT (Manuel)';
      const color = isVox ? 0xFFef4444 : 0xFF3b82f6;
      const subtitle = extraInfo || 'Mode Tactique';

      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${text}`,
          album: subtitle, 
          duration: 0, 
          color: color,
          isPlaying: true, // TOUJOURS TRUE
          isSeekable: false,
          notificationIcon: 'icon' 
      });
      this.refreshMediaFocus();
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

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      // On rafraîchit le statut "Playing" toutes les 3s pour contrer le mode Appel de WebRTC
      this.keepAliveTimer = setInterval(() => { this.refreshMediaFocus(); }, 3000);
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
      
      // FIX : Quand un nouveau flux arrive (nouvel utilisateur), WebRTC peut revoler le focus.
      // On force la reprise de la priorité Bluetooth.
      this.forceBluetoothPriority();
  }

  startMetering(callback: (level: number) => void) {
    setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
