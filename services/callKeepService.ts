import RNCallKeep from 'react-native-callkeep';
import { Platform, AppState } from 'react-native';
import uuid from 'react-native-uuid';

class CallKeepService {
  private currentCallId: string | null = null;
  private isSetup: boolean = false;
  private listeners: any = {};

  constructor() {
    this.setup();
  }

  async setup() {
    if (this.isSetup) return;

    const options = {
      ios: {
        appName: 'ComTac',
        imageName: 'sim_icon',
        supportsVideo: false,
        maximumCallGroups: '1',
        maximumCallsPerCallGroup: '1',
      },
      android: {
        alertTitle: 'Permissions requises',
        alertDescription: 'ComTac a besoin de l\'accès aux comptes téléphoniques pour gérer les appels.',
        cancelButton: 'Annuler',
        okButton: 'ok',
        imageName: 'phone_account_icon',
        additionalPermissions: [],
        // Options critiques pour la fiabilité
        foregroundService: {
          channelId: 'com.tactical.comtac.call',
          channelName: 'Appels Tactiques',
          notificationTitle: 'ComTac Ops',
          notificationIcon: 'ic_launcher',
        },
        selfManaged: true, // IMPORTANT: Permet de gérer notre propre UI (pas l'écran d'appel Android stock)
      },
    };

    try {
      await RNCallKeep.setup(options);
      RNCallKeep.setAvailable(true);
      this.isSetup = true;
      this.registerEvents();
      console.log('[CallKeep] Setup done');
    } catch (err) {
      console.error('[CallKeep] Setup error:', err);
    }
  }

  private registerEvents() {
    // Événement déclenché par le bouton du casque (Si supporté par le casque/Android)
    RNCallKeep.addEventListener('didToggleMute', ({ muted, callUUID }) => {
        console.log('[CallKeep] Headset Toggle Mute:', muted);
        if (this.listeners.onMuteToggle) this.listeners.onMuteToggle(muted);
    });

    // Événement déclenché par le bouton "Raccrocher" du casque (souvent le bouton principal)
    // On peut le détourner pour agir comme un "Toggle Mute" ou pour quitter le salon
    RNCallKeep.addEventListener('endCall', ({ callUUID }) => {
        console.log('[CallKeep] End Call Request');
        // Si on veut que le bouton raccroche vraiment :
        this.endCall(); 
        if (this.listeners.onEndCall) this.listeners.onEndCall();
    });
    
    // Gérer l'audio routing (Bluetooth connecté/déconnecté)
    RNCallKeep.addEventListener('didChangeAudioRoute', (output) => {
        console.log('[CallKeep] Audio Route Changed:', output);
    });
  }

  // Démarre un "Appel" aux yeux d'Android (Verrouille le mode Audio)
  startCall(roomId: string, roomName: string) {
    if (this.currentCallId) return; // Déjà en appel
    
    const callUUID = uuid.v4() as string;
    this.currentCallId = callUUID;

    console.log(`[CallKeep] Starting call ${callUUID} for room ${roomName}`);
    
    // 1. On signale l'appel sortant
    RNCallKeep.startCall(callUUID, roomId, roomName, 'generic', false);
    
    // 2. On le connecte immédiatement (c'est un salon, pas une sonnerie)
    RNCallKeep.setCurrentCallActive(callUUID);
    
    // 3. On force le mode Audio correct (Speaker ou Bluetooth)
    // Note: CallKeep gère le Bluetooth SCO automatiquement ici
  }

  endCall() {
    if (this.currentCallId) {
      console.log('[CallKeep] Ending call');
      RNCallKeep.endCall(this.currentCallId);
      this.currentCallId = null;
    }
  }

  // Met à jour l'état Mute au niveau système
  setMuted(muted: boolean) {
    if (this.currentCallId) {
      RNCallKeep.setMutedCall(this.currentCallId, muted);
    }
  }

  // Callbacks pour lier avec AudioService
  setListeners(callbacks: { onMuteToggle?: (muted: boolean) => void, onEndCall?: () => void }) {
    this.listeners = callbacks;
  }
}

export const callKeepService = new CallKeepService();
