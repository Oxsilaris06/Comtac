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
  private isCallKeepReady = false; // Sécurité anti-crash

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing...");

      // 1. Initialisation Séquentielle (CRITIQUE pour éviter le crash)
      await this.setupCallKeep();

      // 2. Setup Headset
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Cmd received:", source);
          this.toggleVox(); 
      });
      headsetService.setConnectionCallback((isConnected, type) => { 
          this.handleRouteUpdate(isConnected, type); 
      });
      headsetService.init();

      // 3. Config Audio Initiale
      try {
          // On prépare l'audio mais on ne force pas tout de suite
          InCallManager.start({ media: 'audio' }); 
          InCallManager.setKeepScreenOn(true);
      } catch (e) { console.warn("InCallManager setup warning", e); }

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
      try { await VolumeManager.setVolume(1.0); } catch (e) {}

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error("[Audio] Fatal Init Error:", err);
      return false;
    }
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
                console.log('[CallKeep] Setup done, accepted:', accepted);
                RNCallKeep.setAvailable(true);
                this.isCallKeepReady = true;
                resolve();
            }).catch(err => {
                console.error('[CallKeep] Setup Promise Error:', err);
                resolve(); // On continue même si erreur pour ne pas bloquer l'app
            });

            RNCallKeep.addEventListener('endCall', () => this.stopSession());
            RNCallKeep.addEventListener('answerCall', () => {}); 
            
            // Backup events
            RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ muted }) => {
                if(this.currentCallId) RNCallKeep.setMutedCall(this.currentCallId, false);
                this.toggleVox();
            });
            
          } catch (err) {
            console.error('[CallKeep] Setup Try/Catch Error:', err);
            resolve();
          }
      });
  }

  public startSession(roomName: string = "Tactical Net") {
      if (!this.isCallKeepReady) {
          console.warn("[Audio] CallKeep not ready yet, waiting...");
          // Petit délai de secours si l'UI va trop vite
          setTimeout(() => this.startSession(roomName), 500);
          return;
      }

      if (this.currentCallId) return;

      try {
          const newId = uuid.v4() as string;
          this.currentCallId = newId;
          
          console.log("[Audio] Starting Session Call:", newId);
          RNCallKeep.startCall(newId, 'ComTac', roomName, 'generic', false);
          
          if (Platform.OS === 'android') {
              RNCallKeep.reportConnectedOutgoingCallWithUUID(newId);
          }
          
          this.enforceAudioRoute();
          this.updateNotification();
          
          // On force MusicControl à s'afficher APRES CallKeep
          setTimeout(() => {
              headsetService.forceNotificationUpdate(this.mode === 'vox', this.isTx);
          }, 1000);

      } catch (e) {
          console.error("[Audio] StartSession Error:", e);
      }
  }

  public stopSession() {
      if (!this.currentCallId) return;
      try {
          console.log("[Audio] Stopping Session");
          RNCallKeep.endCall(this.currentCallId);
          this.currentCallId = null;
          MusicControl.stopControl(); // Stop propre
      } catch (e) { console.warn("Stop session error", e); }
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
      console.log(`[Audio] Route changed: ${type} (${isConnected})`);
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
      
      try {
        RNCallKeep.updateDisplay(this.currentCallId, `ComTac: ${statusText}`, 'Radio Tactique');
      } catch (e) {}
      
      // Mise à jour synchro de la notif musique
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
