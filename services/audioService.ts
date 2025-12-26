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

      // 2. Headset Listener
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Headset Command:", source);
          // Toute touche reconnue (Mute, Play, Hook) bascule le mode
          this.toggleVox(); 
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      
      headsetService.init();

      // 3. Audio Config
      try {
          // On démarre en mode audio "Voice Call" pour la priorité
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true);
          
          // Force Speaker si pas de casque au démarrage
          if (!headsetService.isHeadsetConnected) {
              InCallManager.setForceSpeakerphoneOn(true);
          } else {
              InCallManager.setForceSpeakerphoneOn(false);
          }
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
      try { await VolumeManager.setVolume(0.8); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  private setupCallKeep() {
      try {
        const options = {
          ios: { appName: 'ComTac', includesCallsInRecents: false },
          android: {
            alertTitle: 'Permissions Requises',
            alertDescription: 'ComTac a besoin d\'accéder à vos appels',
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
        
        // --- CORRECTIF CRITIQUE BLUETOOTH ---
        // Quand on appuie sur MUTE sur le casque :
        RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ muted, callUUID }) => {
            // 1. On force IMMEDIATEMENT le système à rester "Unmuted"
            // Cela empêche Android de couper le canal Bluetooth SCO et de repasser sur le Speaker
            if (this.currentCallId) {
                RNCallKeep.setMutedCall(this.currentCallId, false);
            }
            // 2. On bascule notre logique interne (VOX / PTT)
            this.toggleVox();
        });
        
        // Même logique pour le bouton "Hold"
        RNCallKeep.addEventListener('didToggleHoldCallAction', ({ hold, callUUID }) => {
             if (this.currentCallId) {
                RNCallKeep.setOnHold(this.currentCallId, false);
            }
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
      
      this.updateNotification();
  }

  public stopSession() {
      if (!this.currentCallId) return;
      RNCallKeep.endCall(this.currentCallId);
      this.currentCallId = null;
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Route Update: Connected=${isConnected} Type=${type}`);
      // Sécurité : On force le routing correct via InCallManager
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
    
    // Si on passe en PTT, on coupe l'émission immédiatement
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    
    // Feedback Haptique ou Sonore pourrait être ajouté ici
    this.updateNotification();
    this.notifyListeners();
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
  
  // Stubs pour compatibilité
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
