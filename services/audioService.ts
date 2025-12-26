import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform, PermissionsAndroid } from 'react-native';
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
  private currentCallId: string = '';
  private isInitialized = false;
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Init CallKeep Architecture...");

      // 1. Headset (Safe)
      try {
          headsetService.setCommandCallback((source) => { 
              if (source.includes('PHYSICAL_PTT')) {
                  this.setTx(source === 'PHYSICAL_PTT_START');
              } else {
                  this.toggleVox();
              }
          });
          headsetService.setConnectionCallback((isConnected, type) => this.forceAudioRouting(isConnected));
          headsetService.init();
      } catch (e) { console.warn("Headset init failed", e); }

      // 2. CallKeep (Critical)
      try {
          await this.setupCallKeep();
      } catch (e) { console.warn("CallKeep init failed", e); }

      // 3. Micro
      try {
        const stream = await mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true, noiseSuppression: true, autoGainControl: true,
                googEchoCancellation: true, googAutoGainControl: true, googNoiseSuppression: true, googHighpassFilter: true
            },
            video: false
        }) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) { console.error("Micro Error", e); }

      // 4. Dummy Call
      this.startDummyCall();

      // 5. InCallManager
      try {
          InCallManager.start({ media: 'audio', auto: true, ringback: '' }); 
          InCallManager.setKeepScreenOn(true);
          InCallManager.setMicrophoneMute(false);
          setTimeout(() => this.forceAudioRouting(headsetService.isHeadsetConnected), 1500);
      } catch (e) { console.warn("InCallManager Error", e); }

      this.setupVox();
      try { await VolumeManager.setVolume(0.8); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Init FATAL Error:", err);
      // On retourne false mais on ne crash pas l'app
      return false;
    }
  }

  private async setupCallKeep() {
      if (Platform.OS !== 'android') return;
      try {
          // On évite le crash si la permission n'est pas encore là
          const hasPerm = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
          if (!hasPerm && Platform.Version >= 33) {
              console.log("[CallKeep] Waiting for permissions...");
              return;
          }

          await RNCallKeep.setup({
              ios: { appName: 'ComTac' },
              android: {
                  alertTitle: 'Permissions',
                  alertDescription: 'Gestion appel requise',
                  cancelButton: 'Annuler',
                  okButton: 'ok',
                  imageName: 'ic_launcher', 
                  additionalPermissions: [],
                  foregroundService: {
                      channelId: 'com.tactical.comtac',
                      channelName: 'Radio Service',
                      notificationTitle: 'ComTac Radio',
                      notificationIcon: 'ic_launcher',
                  },
                  selfManaged: true 
              },
          });
          RNCallKeep.setAvailable(true);
          
          RNCallKeep.addEventListener('answerCall', () => this.toggleVox());
          RNCallKeep.addEventListener('endCall', () => this.startDummyCall());
          RNCallKeep.addEventListener('didToggleMute', ({ mute }) => {
              this.toggleVox();
          });
      } catch (e) { console.error("CallKeep Setup Failed", e); }
  }

  private startDummyCall() {
      try {
          this.currentCallId = uuid.v4() as string;
          RNCallKeep.startCall(this.currentCallId, "ComTac", "ComTac", 'generic', false);
          RNCallKeep.reportConnectedOutgoingCallWithUUID(this.currentCallId);
          RNCallKeep.setMutedCall(this.currentCallId, false);
      } catch (e) { console.warn("StartCall Error", e); }
  }

  private forceAudioRouting(isHeadset: boolean) {
      try {
          if(isHeadset) {
              InCallManager.setForceSpeakerphoneOn(false);
              InCallManager.setSpeakerphoneOn(false); 
          } else {
              InCallManager.setForceSpeakerphoneOn(true);
              InCallManager.setSpeakerphoneOn(true);
          }
      } catch (e) {}
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
        try { RNCallKeep.setMutedCall(this.currentCallId, this.mode === 'ptt'); } catch(e) {}
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
