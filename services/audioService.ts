import { mediaDevices, MediaStream } from 'react-native-webrtc';
import { Platform } from 'react-native';
import RNSoundLevel from 'react-native-sound-level';
import MusicControl, { Command } from 'react-native-music-control';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';
import { headsetService } from './headsetService';

class AudioService {
  stream: MediaStream | null = null;
  isTx: boolean = false;
  mode: 'ptt' | 'vox' = 'ptt';
  
  // VOX Settings
  voxThreshold: number = -35; 
  voxHoldTime: number = 1000; 
  voxTimer: any = null;

  keepAliveTimer: any = null;
  
  // Listeners UI
  private listeners: ((mode: 'ptt' | 'vox') => void)[] = [];

  async init(): Promise<boolean> {
    try {
      console.log("[Audio] Initializing...");

      // 1. SETUP DES LISTENERS HEADSET AVANT DE DÉMARRER L'AUDIO
      // C'est crucial pour capter le premier événement de routage
      
      // A. Gestion des commandes (Bouton -> Toggle VOX)
      headsetService.setCommandCallback((source) => {
          console.log(`[Audio] Action received from ${source}`);
          this.toggleVox(); 
      });
      
      // B. Gestion du Routage (Casque <-> Speaker)
      headsetService.setConnectionCallback((isConnected, type) => {
          this.handleRouteUpdate(isConnected, type);
      });

      // On lance maintenant l'écoute des événements dans HeadsetService
      headsetService.init();

      // 2. CONFIGURATION AUDIO SYSTEME
      // start() prépare l'OS à gérer du son "Voice Call" (HFP Bluetooth)
      InCallManager.start({ media: 'audio' }); 
      InCallManager.setKeepScreenOn(true);
      
      // Configuration initiale "Pessimiste" (Haut parleur par défaut)
      // Le callback setConnectionCallback corrigera ça quelques ms plus tard si un casque est là
      if (!headsetService.isHeadsetConnected) {
          InCallManager.setForceSpeakerphoneOn(true);
      }

      // 3. ACQUISITION MICRO
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
      this.stream = stream;
      this.setTx(false); // Mute initial

      // 4. SETUP MUSIC CONTROL (Background & Bluetooth Keys)
      this.setupMusicControl();

      // 5. SETUP VOX & KEEPALIVE
      this.setupVox();
      this.startKeepAlive(); // Empêche l'app de mourir en background

      // Réglage volume max pour être sûr d'entendre
      await VolumeManager.setVolume(1.0);

      return true;
    } catch (err) {
      console.error("[Audio] Init Error:", err);
      return false;
    }
  }

  // --- GESTION DU ROUTAGE AUDIO ---
  private handleRouteUpdate(isConnected: boolean, type: string) {
      console.log(`[Audio] Routing Update -> Headset: ${isConnected} (${type})`);
      
      if(isConnected) {
          // CASQUE DÉTECTÉ (Bluetooth ou Filaire)
          // IMPORTANT: Désactiver le haut-parleur forcé permet à l'OS de router vers le BT/Casque
          InCallManager.setForceSpeakerphoneOn(false); 
          this.updateNotification(`Casque (${type})`);
      } else {
          // PAS DE CASQUE
          // On force le haut-parleur externe (Mode Talkie-Walkie Mains Libres)
          InCallManager.setForceSpeakerphoneOn(true); 
          this.updateNotification(`Haut-Parleur`);
      }
      
      // Petit hack pour relancer le focus audio si le changement de route a coupé le son
      setTimeout(() => this.refreshMediaFocus(), 500);
  }

  // --- UI SUBSCRIPTION ---
  public subscribe(callback: (mode: 'ptt' | 'vox') => void) {
      this.listeners.push(callback);
      callback(this.mode); // Renvoi immédiat de l'état actuel
      return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  private notifyListeners() {
      this.listeners.forEach(cb => cb(this.mode));
  }

  // --- BACKGROUND & BLUETOOTH BUTTONS ---
  private setupMusicControl() {
      if (Platform.OS !== 'android') return;

      try {
          MusicControl.stopControl();
          // Active le mode background pour que les boutons BT fonctionnent écran éteint
          MusicControl.enableBackgroundMode(true);
          
          // On active toutes les commandes possibles pour maximiser les chances d'interception
          const commands = ['play', 'pause', 'stop', 'togglePlayPause', 'nextTrack', 'previousTrack'];
          commands.forEach(cmd => MusicControl.enableControl(cmd as any, true));
          
          MusicControl.enableControl('closeNotification', false, { when: 'never' });
          
          // IMPORTANT: Redirection vers HeadsetService pour déduplication
          // Si on reçoit "Play" du casque BT, on dit à HeadsetService "C'est une commande !"
          commands.forEach(cmd => {
            MusicControl.on(Command[cmd as keyof typeof Command], () => {
                headsetService.triggerCommand('BLUETOOTH_AVRCP');
            });
          });

          this.updateNotification('Prêt');
      } catch (e) { console.log("MusicControl Error", e); }
  }

  private refreshMediaFocus() {
      if (Platform.OS === 'android') {
          // Simule une lecture en cours pour garder le service vivant
          MusicControl.updatePlayback({ 
              state: MusicControl.STATE_PLAYING, 
              elapsedTime: 0 
          });
      }
  }

  // --- LOGIQUE METIER (PTT/VOX) ---
  toggleVox() {
    this.mode = this.mode === 'ptt' ? 'vox' : 'ptt';
    
    // Si on repasse en PTT, on coupe immédiatement le micro
    if (this.mode === 'ptt') {
        this.setTx(false);
        if (this.voxTimer) clearTimeout(this.voxTimer);
    }

    this.updateNotification();
    this.notifyListeners();
  }

  updateNotification(extraInfo?: string) {
      const isVox = this.mode === 'vox';
      const text = isVox ? 'VOX ON (Parlez)' : 'PTT (Appuyez)';
      
      // Mise à jour visuelle de la notif Android
      MusicControl.setNowPlaying({
          title: `Radio Tactique`,
          artist: text,
          album: extraInfo || (isVox ? 'Micro Ouvert' : 'En attente'), 
          duration: 0, 
          color: isVox ? 0xFFef4444 : 0xFF3b82f6, // Rouge si TX, Bleu si Veille
          isPlaying: true, 
          notificationIcon: 'ic_launcher' 
      });
  }

  // --- LOGIQUE VOX (Détection Voix) ---
  private setupVox() {
      RNSoundLevel.start();
      RNSoundLevel.onNewFrame = (data: any) => {
          if (this.mode === 'vox' && data.value > this.voxThreshold) {
              if (!this.isTx) this.setTx(true);
              
              // Timer de maintien (Hystérésis)
              if (this.voxTimer) clearTimeout(this.voxTimer);
              this.voxTimer = setTimeout(() => this.setTx(false), this.voxHoldTime);
          }
      };
  }

  private startKeepAlive() {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      // Intervalle de 15s (5s est trop agressif et peut être tué par l'OS)
      this.keepAliveTimer = setInterval(() => { this.refreshMediaFocus(); }, 15000);
  }

  setTx(state: boolean) {
    if (this.isTx === state) return;
    this.isTx = state;
    
    // Soft Mute WebRTC
    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => { track.enabled = state; });
    }
    
    // Feedback visuel dans la notif si changement d'état
    if(this.mode === 'vox') this.updateNotification();
  }
}

export const audioService = new AudioService();
