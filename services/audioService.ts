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
  private isCallKeepReady = false; 

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing...");

      // 1. CallKeep (Moteur Audio)
      await this.setupCallKeep();

      // 2. Headset (Commandes)
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Cmd:", source);
          this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      headsetService.init();

      // 3. InCallManager
      try {
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true);
      } catch (e) { console.warn("InCallManager setup warning", e); }

      // 4. Micro
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

  private async setupCallKeep() {
      return new Promise<void>((resolve) => {
          try {
            const options = {
              ios: { appName: 'ComTac', includesCallsInRecents: false },
              android: {
                alertTitle: 'Permissions',
                alertDescription: 'Requis pour le fonctionnement PTT',
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

            RNCallKeep.setup(options).then(accepted => {
                RNCallKeep.setAvailable(true);
                this.isCallKeepReady = true;
                resolve();
            }).catch(() => resolve());

            RNCallKeep.addEventListener('endCall', () => this.stopSession());
            RNCallKeep.addEventListener('answerCall', () => {}); 
            RNCallKeep.addEventListener('didPerformSetMutedCallAction', () => {
                if(this.currentCallId) RNCallKeep.setMutedCall(this.currentCallId, false);
                this.toggleVox();
            });
          } catch (err) { resolve(); }
      });
  }

  public startSession(roomName: string = "Tactical Net") {
      if (!this.isCallKeepReady) {
          setTimeout(() => this.startSession(roomName), 500);
          return;
      }
      if (this.currentCallId) return;

      try {
          const newId = uuid.v4() as string;
          this.currentCallId = newId;
          
          RNCallKeep.startCall(newId, 'ComTac', roomName, 'generic', false);
          if (Platform.OS === 'android') {
              RNCallKeep.reportConnectedOutgoingCallWithUUID(newId);
          }
          
          this.enforceAudioRoute();
          this.updateNotification();
          
          // RE-ASSERT MUSIC CONTROL (Prend le dessus pour les boutons)
          setTimeout(() => {
              MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
          }, 800);

      } catch (e) {}
  }

  public stopSession() {
      if (!this.currentCallId) return;
      try {
          RNCallKeep.endCall(this.currentCallId);
          this.currentCallId = null;
          MusicControl.stopControl(); 
      } catch (e) {}
  }

  private enforceAudioRoute() {
      if (headsetService.isHeadsetConnected) {
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
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
      
      try { RNCallKeep.updateDisplay(this.currentCallId, `ComTac: ${statusText}`, 'Radio Tactique'); } catch (e) {}
      
      headsetService.forceNotificationUpdate(isVox, this.isTx);
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
