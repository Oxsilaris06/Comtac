
import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import InCallManager from 'react-native-incall-manager';
import RNCallKeep from 'react-native-callkeep';
import uuid from 'react-native-uuid';
import { headsetService } from './headsetService';
import { VolumeManager } from 'react-native-volume-manager';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;
  private currentCallId: string = '';

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Starting CallKeep Architecture...");

      // 1. HEADSET SERVICE (Boutons Volume PTT)
      headsetService.setCommandCallback((source) => { 
          if (source === 'PHYSICAL_PTT_START') this.setTx(true);
          else if (source === 'PHYSICAL_PTT_END') this.setTx(false);
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.forceAudioRouting(isConnected);
      });
      headsetService.init();

      // 2. CALLKEEP SETUP (Remplacement de MusicControl)
      await this.setupCallKeep();

      // 3. MICRO
      try {
        const constraints = {
            audio: {
                echoCancellation: true, noiseSuppression: true, autoGainControl: true,
                googEchoCancellation: true, googAutoGainControl: true, googNoiseSuppression: true, googHighpassFilter: true
            },
            video: false
        };
        const stream = await mediaDevices.getUserMedia(constraints) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) {
        console.error("Micro Error", e);
        return false;
      }

      // 4. DEMARRAGE DE L'APPEL FICTIF (Pour activer le mode HFP Bluetooth)
      this.startDummyCall();

      // 5. CONFIG INCALL (On s'assure que InCallManager suit)
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true);
          InCallManager.setMicrophoneMute(false);
          // Délai pour laisser CallKeep s'installer
          setTimeout(() => this.forceAudioRouting(headsetService.isHeadsetConnected), 1000);
      } catch (e) {}

      this.setupVox();
      try { await VolumeManager.setVolume(0.8); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- CALLKEEP LOGIC ---
  private async setupCallKeep() {
      if (Platform.OS !== 'android') return;

      try {
          await RNCallKeep.setup({
              ios: { appName: 'ComTac' },
              android: {
                  alertTitle: 'Permissions requises',
                  alertDescription: 'ComTac a besoin de gérer les appels pour le bouton Bluetooth',
                  cancelButton: 'Annuler',
                  okButton: 'ok',
                  imageName: 'phone_account_icon',
                  additionalPermissions: [],
                  foregroundService: {
                      channelId: 'com.tactical.comtac',
                      channelName: 'Foreground service for my app',
                      notificationTitle: 'ComTac Radio Active',
                      notificationIcon: 'ic_launcher',
                  },
                  selfManaged: true // CRITIQUE pour ne pas montrer l'écran d'appel système complet
              },
          });
          
          RNCallKeep.setAvailable(true);

          // ECOUTE DES BOUTONS BLUETOOTH VIA CALLKEEP
          RNCallKeep.addEventListener('answerCall', ({ callUUID }) => {
              // Certains casques envoient "Answer" au lieu de "Mute"
              this.toggleVox();
          });
          
          RNCallKeep.addEventListener('endCall', ({ callUUID }) => {
              // Si le casque raccroche, on relance l'appel immédiatement pour garder la connexion
              this.startDummyCall();
          });

          RNCallKeep.addEventListener('didToggleMute', ({ mute, callUUID }) => {
              // C'est l'événement STANDARD des casques HFP
              console.log("[Audio] CallKeep Toggle Mute Received");
              this.toggleVox();
          });

      } catch (e) {
          console.error("CallKeep Setup Error", e);
      }
  }

  private startDummyCall() {
      // On génère un faux appel entrant/sortant pour verrouiller le focus audio
      this.currentCallId = uuid.v4() as string;
      const handle = "ComTac Radio";
      
      // On simule un appel sortant connecté
      RNCallKeep.startCall(this.currentCallId, handle, handle, 'generic', false);
      RNCallKeep.reportConnectedOutgoingCallWithUUID(this.currentCallId);
      
      // On s'assure que le "Mute" est désactivé au niveau système pour que le micro marche
      RNCallKeep.setMutedCall(this.currentCallId, false);
  }

  // --- ROUTAGE AUDIO ---
  private forceAudioRouting(isHeadset: boolean) {
      console.log(`[Audio] Routing -> Headset: ${isHeadset}`);
      if(isHeadset) {
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false); 
      } else {
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
      }
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  toggleVox() {
    if (this.isTx && this.mode === 'ptt') return;

    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Feedback Sonore via InCallManager (Bip dans le flux audio)
    try {
        if (this.mode === 'vox') InCallManager.startRingtone('_BUNDLE_', [100]); 
        else InCallManager.startRingtone('_BUNDLE_', [100, 50, 100]); // Double bip fin
        setTimeout(() => InCallManager.stopRingtone(), 300);
    } catch (e) {}

    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    
    // Synchro état CallKeep (Optionnel, pour l'affichage voiture)
    if (this.currentCallId) {
        RNCallKeep.setMutedCall(this.currentCallId, this.mode === 'ptt');
    }

    this.notifyListeners();
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

  // Plus besoin de "KeepAlive" timer, CallKeep maintient le service
  private startKeepAlive() {}

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    if (this.stream) this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  // Stubs
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
