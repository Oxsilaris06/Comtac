import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import RNCallKeep from 'react-native-callkeep';
import uuid from 'react-native-uuid';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  // Gestion Session Appel
  currentCallId: string | null = null;
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  keepAliveTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing...");

      // 1. Setup CallKeep (ConnectionService pour Android)
      this.setupCallKeep();

      // 2. HEADSET LISTENER (Via Service Accessibilité)
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Headset Command:", source);
          this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { this.handleRouteUpdate(isConnected, type); });
      headsetService.init();

      // 3. CONFIG AUDIO SYSTEME
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true);
          
          if (!headsetService.isHeadsetConnected) {
              InCallManager.setForceSpeakerphoneOn(true);
          }
      } catch (e) {
          console.warn("[Audio] InCallManager start warning:", e);
      }

      // 4. MICRO
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error (getUserMedia)", e);
        return false;
      }

      // 5. VOX
      this.setupVox();

      try { await VolumeManager.setVolume(0.8); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- LOGIQUE CALLKEEP (OPTIMISÉE BLUETOOTH) ---
  private setupCallKeep() {
      try {
        const options = {
          ios: {
            appName: 'ComTac',
            includesCallsInRecents: false,
          },
          android: {
            alertTitle: 'Permissions Requises',
            alertDescription: 'ComTac a besoin d\'accéder à vos appels pour fonctionner en arrière-plan',
            cancelButton: 'Annuler',
            okButton: 'ok',
            imageName: 'phone_account_icon',
            additionalPermissions: [],
            // Mode Self-Managed: On gère l'UI nous-mêmes
            selfManaged: true, 
            foregroundService: {
              channelId: 'comtac_channel',
              channelName: 'Foreground Service for ComTac',
              notificationTitle: 'ComTac Radio Actif',
              notificationIcon: 'ic_launcher',
            },
          },
        };

        RNCallKeep.setup(options).then(accepted => {
            console.log('[CallKeep] Setup result:', accepted);
            RNCallKeep.setAvailable(true);
        });

        // Listeners obligatoires
        RNCallKeep.addEventListener('endCall', () => this.stopSession());
        RNCallKeep.addEventListener('answerCall', () => {}); 
        
        // --- AJOUT CRITIQUE POUR BLUETOOTH ---
        // Certains casques envoient "Mute" ou "Hold" au lieu de KeyEvents classiques
        // quand on est en mode "Appel". On les mappe sur le Toggle PTT/VOX.
        RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ muted }) => {
            this.toggleVox();
        });
        
        RNCallKeep.addEventListener('didToggleHoldCallAction', ({ hold }) => {
            this.toggleVox();
        });
        
        // Intercepte le bouton "Raccrocher" du casque pour ne pas couper la comm
        // mais plutôt basculer le mode (Optionnel, selon préférence)
        // RNCallKeep.addEventListener('endCall', ... est déjà géré plus haut pour quitter

      } catch (err) {
        console.error('[CallKeep] Setup Error:', err);
      }
  }

  // Appelé quand on rejoint un salon
  public startSession(roomName: string = "Tactical Net") {
      if (this.currentCallId) return;

      const newId = uuid.v4() as string;
      this.currentCallId = newId;

      console.log("[Audio] Starting CallKeep Session:", newId);
      
      // Lance un appel "fictif" qui verrouille le focus audio
      RNCallKeep.startCall(newId, 'ComTac', roomName, 'generic', false);
      
      if (Platform.OS === 'android') {
          // Astuce Android Self-Managed: Signaler l'appel comme connecté
          RNCallKeep.reportConnectedOutgoingCallWithUUID(newId);
      }
      
      this.updateNotification();
  }

  // Appelé quand on quitte
  public stopSession() {
      if (!this.currentCallId) return;
      console.log("[Audio] Ending CallKeep Session");
      RNCallKeep.endCall(this.currentCallId);
      this.currentCallId = null;
  }
  // ----------------------------------

  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Route: Headset=${isConnected} (${type})`);
      if(isConnected) {
          InCallManager.setForceSpeakerphoneOn(false); 
      } else {
          InCallManager.setForceSpeakerphoneOn(true); 
      }
      this.updateNotification();
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    this.updateNotification();
    this.notifyListeners();
  }

  updateNotification() {
      if (!this.currentCallId) return;

      const isVox = this.mode === 'vox';
      // On met à jour l'info de l'appel pour l'utilisateur
      const statusText = isVox ? `VOX ON ${this.isTx ? '(TX)' : ''}` : 'PTT (Appuyez)';
      
      // CallKeep permet d'afficher le nom de l'appelant (ici le statut)
      RNCallKeep.updateDisplay(this.currentCallId, `ComTac: ${statusText}`, 'Radio Tactique');
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
      } catch (e) {}
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    if (this.stream) this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    
    // Si on est en VOX, on met à jour l'affichage de l'appel pour montrer qu'on parle
    if(this.mode === 'vox' && this.currentCallId) this.updateNotification();
  }
  
  muteIncoming(mute: boolean) {
      // TODO: Implémenter si on stocke les remoteStreams
  }
  
  playStream(remoteStream: MediaStream) {
       // TODO: Implémenter le stockage des streams
  }

  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
}

export const audioService = new AudioService();
