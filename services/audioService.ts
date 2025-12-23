import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import InCallManager from 'react-native-incall-manager';
import RNCallKeep from 'react-native-callkeep';
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
      this.setupCallKeep();

      // 3. Liaison HeadsetService (Backup Physique Volume Up)
      // HeadsetService continue d'écouter le Volume Up via Accessibilité
      headsetService.setCommandCallback((source) => {
          console.log('[AudioService] Physical Command:', source);
          this.toggleVox(); 
      });

      // 4. Routage Audio (Géré par InCallManager + CallKeep)
      headsetService.setConnectionCallback((isConnected, type) => {
          if(isConnected) {
              InCallManager.setForceSpeakerphoneOn(false);
          } else {
              InCallManager.setForceSpeakerphoneOn(true);
          }
      });

      // 5. Config Initiale
      try {
          InCallManager.start({ media: 'audio' }); 
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

  private setupCallKeep() {
      try {
          RNCallKeep.setup({
              ios: { appName: 'ComTac' },
              android: {
                  alertTitle: 'Permissions requises',
                  alertDescription: 'ComTac nécessite l\'accès aux appels pour gérer le Bluetooth',
                  cancelButton: 'Annuler',
                  okButton: 'OK',
                  imageName: 'phone_account_icon',
                  additionalPermissions: [],
                  // CRITIQUE : Self Managed pour ne pas remplacer l'appli téléphone native
                  selfManaged: true, 
                  foregroundService: {
                      channelId: 'com.tactical.comtac',
                      channelName: 'Foreground Service',
                      notificationTitle: 'ComTac Actif',
                      notificationIcon: 'Path to the resource icon of the notification',
                  },
              },
          });

          // Écouteur MUTE du casque Bluetooth (HFP)
          // Quand on appuie sur le bouton du casque en mode appel, ça envoie un Toggle Mute
          RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ muted }) => {
              // Muted = Micro coupé (PTT)
              // Unmuted = Micro ouvert (VOX)
              const newMode = !muted ? 'vox' : 'ptt';
              if (this.mode !== newMode) {
                  this.toggleVox();
              }
          });

          RNCallKeep.addEventListener('endCall', () => {
             // Si l'utilisateur raccroche via l'interface système, on quitte
             // (Logique à connecter avec App.tsx si besoin)
          });

          // On lance l'appel fictif pour activer le mode HFP
          this.startCallSession();

      } catch (e) {
          console.log("CallKeep Setup Error:", e);
      }
  }

  public startCallSession() {
      // On déclare un appel sortant pour activer le profil Bluetooth HFP
      try {
          RNCallKeep.startCall(CALL_UUID, 'ComTac', 'ComTac Radio');
          RNCallKeep.setMutedCall(CALL_UUID, true); // On commence en MUTE (PTT)
      } catch(e) {
          console.log("Start Call Error", e);
      }
  }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Synchro avec CallKeep (l'état Mute du système)
    const isMuted = this.mode === 'ptt';
    RNCallKeep.setMutedCall(CALL_UUID, isMuted);

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
