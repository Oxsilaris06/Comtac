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
      console.log("[AudioService] Init Start...");

      // 1. LIASION HEADSET (Entrées)
      // On le fait en premier pour être sûr d'avoir les callbacks prêts
      try {
          headsetService.setCommandCallback((source) => { 
              if (source === 'PHYSICAL_PTT_START') this.setTx(true);
              else if (source === 'PHYSICAL_PTT_END') this.setTx(false);
              else this.toggleVox();
          });
          headsetService.setConnectionCallback((isConnected, type) => { 
              this.forceAudioRouting(isConnected);
          });
          headsetService.init();
      } catch (e) { console.warn("HeadsetService Error", e); }

      // 2. SETUP CALLKEEP
      // Important : Les permissions Notifications ont déjà été demandées dans App.tsx
      await this.setupCallKeep();

      // 3. MICROPHONE (L'app a déjà la permission via App.tsx)
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
        console.error("Micro Error (getUserMedia)", e);
        // On continue même si WebRTC fail, pour au moins avoir CallKeep actif
      }

      // 4. LANCEMENT APPEL VIRTUEL (Pour le Bluetooth HFP)
      this.startDummyCall();

      // 5. CONFIG SYSTEME AUDIO (InCallManager)
      // On le lance APRES CallKeep pour éviter les conflits de focus audio
      try {
          InCallManager.start({ media: 'audio', auto: true, ringback: '' }); 
          InCallManager.setKeepScreenOn(true);
          InCallManager.setMicrophoneMute(false);
          
          // Petit délai pour laisser l'OS digérer
          setTimeout(() => {
              this.forceAudioRouting(headsetService.isHeadsetConnected);
          }, 1000);
      } catch (e) { console.warn("InCallManager Error", e); }

      this.setupVox();
      try { await VolumeManager.setVolume(0.8); } catch (e) {}

      this.isInitialized = true;
      console.log("[AudioService] Init OK");
      return true;
    } catch (err) {
      console.error("[AudioService] Init CRITICAL ERROR:", err);
      return false;
    }
  }

  // --- CALLKEEP ---
  private async setupCallKeep() {
      if (Platform.OS !== 'android') return;

      try {
          // On suppose que les permissions ont été gérées dans App.tsx
          await RNCallKeep.setup({
              ios: { appName: 'ComTac' },
              android: {
                  alertTitle: 'Permissions requises',
                  alertDescription: 'ComTac a besoin de gérer les appels pour le bouton Bluetooth',
                  cancelButton: 'Annuler',
                  okButton: 'ok',
                  imageName: 'ic_launcher', 
                  additionalPermissions: [],
                  foregroundService: {
                      channelId: 'com.tactical.comtac',
                      channelName: 'Service Radio',
                      notificationTitle: 'ComTac Radio Active',
                      notificationIcon: 'ic_launcher',
                  },
                  selfManaged: true 
              },
          });
          
          RNCallKeep.setAvailable(true);

          RNCallKeep.addEventListener('answerCall', () => this.toggleVox());
          RNCallKeep.addEventListener('endCall', () => this.startDummyCall());
          RNCallKeep.addEventListener('didToggleMute', () => {
              console.log("[CallKeep] Toggle Mute -> VOX Toggle");
              this.toggleVox();
          });

      } catch (e) {
          console.error("CallKeep Setup Failed", e);
      }
  }

  private startDummyCall() {
      try {
          this.currentCallId = uuid.v4() as string;
          const handle = "ComTac Radio";
          // On retarde un peu le startCall pour ne pas bloquer le thread principal au boot
          setTimeout(() => {
              RNCallKeep.startCall(this.currentCallId, handle, handle, 'generic', false);
              RNCallKeep.reportConnectedOutgoingCallWithUUID(this.currentCallId);
              RNCallKeep.setMutedCall(this.currentCallId, false);
          }, 500);
      } catch (e) {
          console.warn("Dummy Call Failed", e);
      }
  }

  // --- ROUTAGE ---
  private forceAudioRouting(isHeadset: boolean) {
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
    
    try {
        if (this.mode === 'vox') InCallManager.startRingtone('_BUNDLE_', [100]); 
        else InCallManager.startRingtone('_BUNDLE_', [100, 50, 100]); 
        setTimeout(() => InCallManager.stopRingtone(), 300);
    } catch (e) {}

    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    
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

  private startKeepAlive() {}

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    if (this.stream) this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
