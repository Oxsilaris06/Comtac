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
  
  currentCallId: string | null = null;
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing...");

      // 1. Setup CallKeep
      this.setupCallKeep();

      // 2. Headset Listener - LE COEUR DU SYSTEME
      // headsetService reçoit l'événement du Java (via react-native-keyevent)
      // Le Java a déjà bloqué l'action système (Suivant/Précédent)
      // Donc ici on exécute juste le Toggle VOX.
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Headset Command Received:", source);
          
          // Sécurité : Si on reçoit une commande, on ré-applique le routing Audio
          // au cas où le système aurait vacillé.
          this.enforceAudioRoute();
          
          this.toggleVox(); 
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      
      headsetService.init();

      // 3. Audio Config & Routing
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true);
          
          // Vérification initiale
          this.enforceAudioRoute();
          
      } catch (e) {
          console.warn("[Audio] InCallManager start warning:", e);
      }

      // 4. Micro
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error", e);
        return false;
      }

      this.setupVox();
      try { await VolumeManager.setVolume(1.0); } catch (e) {} // Max volume pour être sûr

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // Fonction pour forcer brutalement la sortie audio correcte
  private enforceAudioRoute() {
      // Si headsetService dit qu'un casque est là (détecté via Android API)
      if (headsetService.isHeadsetConnected) {
          console.log("[Audio] Enforcing Headset/Bluetooth Route");
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.chooseAudioRoute('Bluetooth'); // Force BT SCO
      } else {
          console.log("[Audio] Enforcing Speaker Route");
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  private setupCallKeep() {
      try {
        const options = {
          ios: { appName: 'ComTac', includesCallsInRecents: false },
          android: {
            alertTitle: 'Permissions',
            alertDescription: 'Accès appel requis',
            cancelButton: 'Annuler',
            okButton: 'ok',
            imageName: 'phone_account_icon',
            additionalPermissions: [],
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
            RNCallKeep.setAvailable(true);
        });

        RNCallKeep.addEventListener('endCall', () => this.stopSession());
        RNCallKeep.addEventListener('answerCall', () => {}); 
        
        // Gestion des événements CallKeep (au cas où le système passe outre l'Accessibilité)
        RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ muted, callUUID }) => {
            if (this.currentCallId) RNCallKeep.setMutedCall(this.currentCallId, false);
            this.toggleVox();
        });
        
        RNCallKeep.addEventListener('didToggleHoldCallAction', ({ hold, callUUID }) => {
             if (this.currentCallId) RNCallKeep.setOnHold(this.currentCallId, false);
            this.toggleVox();
        });
        
      } catch (err) {
        console.error('[CallKeep] Setup Error:', err);
      }
  }

  public startSession(roomName: string = "Tactical Net") {
      if (this.currentCallId) return;
      const newId = uuid.v4() as string;
      this.currentCallId = newId;
      console.log("[Audio] Starting CallKeep Session:", newId);
      RNCallKeep.startCall(newId, 'ComTac', roomName, 'generic', false);
      if (Platform.OS === 'android') {
          RNCallKeep.reportConnectedOutgoingCallWithUUID(newId);
      }
      this.enforceAudioRoute(); // Force route au début de l'appel
      this.updateNotification();
  }

  public stopSession() {
      if (!this.currentCallId) return;
      RNCallKeep.endCall(this.currentCallId);
      this.currentCallId = null;
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Route Update Event: Connected=${isConnected} Type=${type}`);
      // On re-vérifie via notre logique centrale
      this.enforceAudioRoute();
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
    return this.mode === 'vox'; 
  }

  updateNotification() {
      if (!this.currentCallId) return;
      const isVox = this.mode === 'vox';
      const statusText = isVox ? `VOX ON ${this.isTx ? '(TX)' : ''}` : 'PTT (Appuyez)';
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
    if(this.mode === 'vox' && this.currentCallId) this.updateNotification();
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
