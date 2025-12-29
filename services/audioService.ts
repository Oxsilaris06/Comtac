import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';
import { callKeepService } from './callKeepService';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  isSessionActive: boolean = false;
  
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;
  
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log("[Audio] Initializing...");

      // 1. Init des services de bas niveau (Accessibility, Hardware buttons)
      headsetService.init();

      // 2. Init CallKeep & Liaison des événements
      callKeepService.setListeners({
          onMuteToggle: (muted) => {
              console.log("[Audio] CallKeep Mute Action -> Toggle VOX");
              this.toggleVox();
              // On force le statut "Unmuted" dans CallKeep pour que le bouton ne reste pas bloqué
              callKeepService.setMuted(false);
          },
          onEndCall: () => {
              console.log("[Audio] CallKeep End Call Action -> Stop Session");
              this.stopSession();
          }
      });

      // Listener Commandes Physiques (Backup via AccessibilityService)
      // Si CallKeep n'attrape pas le bouton (ex: écran verrouillé sur certains devices),
      // le service d'accessibilité le fera.
      headsetService.setCommandCallback((source) => { 
          console.log("[Audio] Headset Accessibility Command:", source);
          if (this.isSessionActive) this.enforceAudioRoute();
          this.toggleVox();
      });
      
      headsetService.setConnectionCallback((isConnected, type) => { 
          console.log(`[Audio] Headset Changed: ${isConnected} (${type})`);
          this.handleRouteUpdate(isConnected, type); 
      });

      // 3. Préparation Micro
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
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  private enforceAudioRoute() {
      // Stratégie hybride : On laisse CallKeep gérer le SCO, 
      // mais on force via InCallManager si nécessaire.
      if (headsetService.isHeadsetConnected) {
          console.log("[Audio] Enforcing Bluetooth SCO");
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.chooseAudioRoute('Bluetooth'); 
      } else {
          console.log("[Audio] Enforcing Speakerphone");
          InCallManager.setForceSpeakerphoneOn(true);
      }
  }

  public async startSession(roomName: string = "Tactical Net") {
      if (this.isSessionActive) return;
      
      try {
        console.log("[Audio] Starting Audio Session (CallKeep Mode)...");
        this.isSessionActive = true;

        // 1. On démarre l'appel système (CallKeep)
        // Cela prend le focus Audio et active le mode communication
        callKeepService.startCall("room_1", roomName);

        // 2. On démarre le moteur VoIP (InCallManager)
        // Il complète CallKeep pour le routage audio spécifique
        InCallManager.start({ media: 'audio' });
        InCallManager.setKeepScreenOn(true);
        
        // 3. Forçage routage initial
        setTimeout(() => { this.enforceAudioRoute(); }, 1000);

      } catch (e) {
          console.error("[Audio] CRITICAL: Failed to start session", e);
          this.stopSession();
      }
  }

  public stopSession() {
      if (!this.isSessionActive) return;
      try {
        callKeepService.endCall();
        InCallManager.stop();
      } catch(e) {}
      this.isSessionActive = false;
      this.setTx(false);
  }

  private handleRouteUpdate(isConnected: boolean, type: string) {
      setTimeout(() => this.enforceAudioRoute(), 500);
  }

  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode);
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }
  private notifyListeners() { this.listeners.forEach(cb => cb(this.mode)); }

  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    console.log("[Audio] Toggle VOX ->", this.mode);
    
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }
    
    // Feedback optionnel : On pourrait "muter" l'appel CallKeep visuellement quand on est en PTT
    // callKeepService.setMuted(this.mode === 'ptt'); 

    this.notifyListeners(); 
    return this.mode === 'vox'; 
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
    
    if (this.stream) {
        this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
  }
  
  startMetering(callback: (level: number) => void) {
      setInterval(() => { callback(this.isTx ? 1 : 0); }, 200);
  }
  
  muteIncoming(mute: boolean) {}
  playStream(remoteStream: MediaStream) {}
}

export const audioService = new AudioService();
