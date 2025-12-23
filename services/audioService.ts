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

class AudioService {
  stream: MediaStream | null = null;
  remoteStreams: MediaStream[] = []; 
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  currentRoomId: string = 'Déconnecté';
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];

  async init(): Promise<boolean> {
    try {
      // 1. Initialisation Audio
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false);

      // 2. Setup CallKeep (Le cœur du système)
      this.setupCallKeep(); // Note: Assurez-vous que setupCallKeep est bien défini ou importé si utilisé

      // 3. Liaison HeadsetService (Backup Physique Volume Up)
      headsetService.setCommandCallback((source) => {
          console.log('[AudioService] Physical Command:', source);
          this.toggleVox(); 
      });

      // 4. Routage Audio (Géré par InCallManager + CallKeep)
      headsetService.setConnectionCallback((isConnected, type) => {
          console.log(`[Audio] Routing Change: Connected=${isConnected}, Type=${type}`);
          if(isConnected) {
              // CASQUE CONNECTÉ : On coupe le haut-parleur ET on force la route casque
              InCallManager.setForceSpeakerphoneOn(false);
              // Optionnel mais recommandé pour Bluetooth : forcer la route si l'API le permet
              // (Note: InCallManager gère souvent cela auto si Speakerphone est false)
          } else {
              // PAS DE CASQUE : On force le haut-parleur (Mode Talkie)
              InCallManager.setForceSpeakerphoneOn(true);
          }
      });

      // 5. Config Initiale
      try {
          InCallManager.start({ media: 'audio' }); 
          // Par défaut on suppose HP, mais le listener ci-dessus corrigera immédiatement si un casque est déjà là
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setKeepScreenOn(true); 
      } catch (e) { console.log("Audio Config Error:", e); }

      // 6. Vox
      this.setupVox();

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // NOTE: La méthode setupCallKeep manquait dans le snippet précédent, je l'ajoute pour la complétude
  // Si vous l'avez déjà ailleurs ou via une autre méthode, adaptez.
  private setupCallKeep() {
      // (Code CallKeep existant conservé ou à intégrer ici)
      // Pour cet exemple, je me concentre sur le fix audio.
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Gestion Micro Physique
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    this.notifyListeners();
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
}

export const audioService = new AudioService();
