import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import RNCallKeep from 'react-native-callkeep';
import uuid from 'react-native-uuid';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';
import MusicControl from 'react-native-music-control';

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
      
      // Initialisation de CallKeep d'abord
      this.setupCallKeep();

      // Initialisation du HeadsetService (qui configure MusicControl)
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Cmd:", source);
          this.enforceAudioRoute(); 
          this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      
      // On attend un peu que MusicControl soit prêt dans HeadsetService
      headsetService.init();

      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true);
          this.enforceAudioRoute();
      } catch (e) { console.warn("InCallManager error", e); }

      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
        this.stream = stream;
        this.setTx(false); 
      } catch (e) { return false; }

      this.setupVox();
      try { await VolumeManager.setVolume(1.0); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) { return false; }
  }

  private enforceAudioRoute() {
      if (headsetService.isHeadsetConnected) {
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  private setupCallKeep() {
      try {
        const options = {
          ios: { appName: 'ComTac', includesCallsInRecents: false },
          android: {
            alertTitle: 'Permissions',
            alertDescription: 'Requis pour audio',
            cancelButton: 'Annuler',
            okButton: 'ok',
            imageName: 'phone_account_icon',
            additionalPermissions: [],
            selfManaged: true, 
            foregroundService: {
              channelId: 'comtac_channel',
              channelName: 'Service Radio',
              notificationTitle: 'ComTac Radio Actif',
              notificationIcon: 'ic_launcher',
            },
          },
        };

        RNCallKeep.setup(options).then(accepted => RNCallKeep.setAvailable(true));
        RNCallKeep.addEventListener('endCall', () => this.stopSession());
        RNCallKeep.addEventListener('answerCall', () => {}); 
        RNCallKeep.addEventListener('didPerformSetMutedCallAction', () => {
            if (this.currentCallId) RNCallKeep.setMutedCall(this.currentCallId, false);
            this.toggleVox();
        });
        RNCallKeep.addEventListener('didToggleHoldCallAction', () => {
             if (this.currentCallId) RNCallKeep.setOnHold(this.currentCallId, false);
            this.toggleVox();
        });
      } catch (err) {}
  }

  public startSession(roomName: string = "Tactical Net") {
      if (this.currentCallId) return;
      const newId = uuid.v4() as string;
      this.currentCallId = newId;
      
      RNCallKeep.startCall(newId, 'ComTac', roomName, 'generic', false);
      if (Platform.OS === 'android') {
          RNCallKeep.reportConnectedOutgoingCallWithUUID(newId);
      }
      this.enforceAudioRoute();
      this.updateNotification();
      
      // Sécurisation de l'appel MusicControl : on attend un tick pour éviter le conflit initial
      setTimeout(() => {
          try {
              MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
          } catch (e) { console.warn("MusicControl update error", e); }
      }, 500);
  }

  public stopSession() {
      if (!this.currentCallId) return;
      RNCallKeep.endCall(this.currentCallId);
      this.currentCallId = null;
      try {
          MusicControl.updatePlayback({ state: MusicControl.STATE_PAUSED });
      } catch (e) {}
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
      if(isConnected) {
          InCallManager.setForceSpeakerphoneOn(false); 
          if (type.toLowerCase().includes('bluetooth')) InCallManager.chooseAudioRoute('Bluetooth');
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
    return this.mode === 'vox'; 
  }

  updateNotification() {
      if (!this.currentCallId) return;
      const isVox = this.mode === 'vox';
      const statusText = isVox ? `VOX ON ${this.isTx ? '(TX)' : ''}` : 'PTT (Appuyez)';
      
      // CallKeep update
      try {
        RNCallKeep.updateDisplay(this.currentCallId, `ComTac: ${statusText}`, 'Radio Tactique');
      } catch (e) {}
      
      // MusicControl update (sécurisé)
      try {
          MusicControl.updatePlayback({
              state: MusicControl.STATE_PLAYING,
              title: `ComTac: ${statusText}`
          });
      } catch (e) {}
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
