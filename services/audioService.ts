import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';
import uuid from 'react-native-uuid';

// UUID Constant pour la session d'appel
const CALL_UUID = '00000000-0000-0000-0000-000000000001';

type AudioRoute = 'SPEAKER' | 'EARPIECE' | 'BLUETOOTH' | 'WIRED_HEADSET';

class AudioService {
  stream: MediaStream | null = null;
  remoteStreams: MediaStream[] = []; 
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  currentRoomId: string = 'Déconnecté';
  
  // État du routage audio
  private currentRoute: AudioRoute = 'SPEAKER';
  private availableHeadset: string | null = null; // 'Bluetooth' ou 'WiredHeadset' ou null

  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];

  async init(): Promise<boolean> {
    try {
      // 1. Initialisation Audio
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // 2. Setup CallKeep
      this.setupCallKeep();

      // 3. Liaison HeadsetService (Commandes Physiques)
      headsetService.setCommandCallback((source) => {
          console.log('[AudioService] Physical Command:', source);
          this.toggleVox(); 
      });

      // 4. Routage Audio Automatique (Détection branchement)
      headsetService.setConnectionCallback((isConnected, type) => {
          console.log(`[Audio] Hardware Change: Connected=${isConnected}, Type=${type}`);
          
          this.availableHeadset = isConnected ? type : null;

          // Si un casque est branché ou débranché, on reset le cycle sur le mode logique par défaut
          if (isConnected) {
              // Si c'est du Bluetooth, on bascule sur Bluetooth, sinon Wired
              this.setAudioRoute(type === 'Bluetooth' ? 'BLUETOOTH' : 'WIRED_HEADSET');
          } else {
              // Plus de casque, on repasse sur Haut-Parleur (Mode Talkie)
              this.setAudioRoute('SPEAKER');
          }
      });

      // 5. Config Initiale Système
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true); 
          // Par sécurité, on force le HP au démarrage avant détection
          this.setAudioRoute('SPEAKER');
      } catch (e) { console.log("Audio Config Error:", e); }

      // 6. Vox
      this.setupVox();

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- NOUVELLE FONCTION : CYCLE DE ROUTAGE MANUEL ---
  // À relier à un bouton "Haut-Parleur / Casque" dans l'interface
  public cycleAudioOutput() {
      let nextRoute: AudioRoute = 'SPEAKER';

      if (this.currentRoute === 'SPEAKER') {
          // Vers mode Discret
          if (this.availableHeadset === 'Bluetooth') nextRoute = 'BLUETOOTH';
          else if (this.availableHeadset === 'WiredHeadset') nextRoute = 'WIRED_HEADSET';
          else nextRoute = 'EARPIECE'; // Pas de casque, on passe à l'oreille (Combiné)
      } 
      else if (this.currentRoute === 'BLUETOOTH') {
          // Si on est en Bluetooth, on peut vouloir forcer le Combiné ou revenir au Speaker
          nextRoute = 'EARPIECE'; 
      }
      else if (this.currentRoute === 'WIRED_HEADSET') {
          // Si filaire, le cycle est simple : Casque <-> Speaker
          nextRoute = 'SPEAKER';
      }
      else if (this.currentRoute === 'EARPIECE') {
          // Depuis le combiné, retour au Haut-Parleur
          nextRoute = 'SPEAKER';
      }

      this.setAudioRoute(nextRoute);
  }

  // Application technique du routage
  private setAudioRoute(route: AudioRoute) {
      console.log(`[AudioService] Switching to route: ${route}`);
      
      switch (route) {
          case 'SPEAKER':
              InCallManager.setForceSpeakerphoneOn(true);
              this.updateNotification(this.currentRoomId, "Haut-Parleur Actif");
              break;
          
          case 'EARPIECE':
              InCallManager.setForceSpeakerphoneOn(false);
              // Force la sortie combiné même si BT est là (si supporté par l'OS)
              InCallManager.chooseAudioRoute('EARPIECE'); 
              this.updateNotification(this.currentRoomId, "Combiné (Discret)");
              break;

          case 'BLUETOOTH':
              InCallManager.setForceSpeakerphoneOn(false);
              InCallManager.chooseAudioRoute('BLUETOOTH');
              this.updateNotification(this.currentRoomId, "Bluetooth Actif");
              break;

          case 'WIRED_HEADSET':
              InCallManager.setForceSpeakerphoneOn(false);
              InCallManager.chooseAudioRoute('WIRED_HEADSET');
              this.updateNotification(this.currentRoomId, "Casque Filaire");
              break;
      }
      
      this.currentRoute = route;
  }

  // NOTE: La méthode setupCallKeep manquait dans le snippet précédent
  private setupCallKeep() {
      // (Intégration existante conservée)
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    this.notifyListeners();
    // On met à jour la notif pour refléter le mode VOX/PTT, en gardant l'info de route
    this.updateNotification(this.currentRoomId); 
    return this.mode === 'vox';
  }

  // --- UI SUBSCRIPTION ---
  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  private notifyListeners() {
      this.listeners.forEach(cb => cb(this.mode));
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

  // Mise à jour de la notif pour inclure l'info de route si fournie, sinon garde l'état VOX
  updateNotification(roomId?: string, extraInfo?: string) {
      if (roomId) this.currentRoomId = roomId;
      
      const isVox = this.mode === 'vox';
      const text = isVox ? 'VOX ACTIF' : 'PTT (Manuel)';
      const color = isVox ? 0xFFef4444 : 0xFF3b82f6;
      
      // Si extraInfo n'est pas fourni, on affiche la route actuelle comme sous-titre par défaut
      const subtitle = extraInfo || `Sortie : ${this.currentRoute}`;

      MusicControl.setNowPlaying({
          title: `Salon #${this.currentRoomId}`,
          artist: `ComTac : ${text}`,
          album: subtitle, 
          duration: 0, 
          color: color,
          isPlaying: true, 
          isSeekable: false,
          notificationIcon: 'icon' 
      });
  }
}

export const audioService = new AudioService();
