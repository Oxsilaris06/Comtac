import { NativeEventEmitter, NativeModules } from 'react-native';
import KeyEvent from 'react-native-keyevent';
import { VolumeManager } from 'react-native-volume-manager';

// Mapping des codes touches
const KEY_CODES = {
    VOLUME_UP: 24,
    VOLUME_DOWN: 25,
    HEADSET_HOOK: 79,     
    MEDIA_PLAY_PAUSE: 85,
    MEDIA_NEXT: 87,
    MEDIA_PREVIOUS: 88,
    MEDIA_PLAY: 126,
    MEDIA_PAUSE: 127,
    MEDIA_STOP: 86
};

type CommandCallback = (source: string) => void;
type ConnectionCallback = (isConnected: boolean, type: string) => void;

class HeadsetService {
    private lastVolumeUpTime: number = 0;
    private lastCommandTime: number = 0;
    private onCommand?: CommandCallback;
    private onConnectionChange?: ConnectionCallback;
    
    public isHeadsetConnected: boolean = false;

    constructor() {
        this.init();
    }

    private init() {
        this.setupKeyEventListener();
        this.setupConnectionListener();
    }

    public setCommandCallback(callback: CommandCallback) {
        this.onCommand = callback;
    }

    public setConnectionCallback(callback: ConnectionCallback) {
        this.onConnectionChange = callback;
    }

    // --- 1. DÉTECTION BRANCHEMENT CASQUE ---
    private setupConnectionListener() {
        const eventEmitter = new NativeEventEmitter(NativeModules.InCallManager);
        eventEmitter.addListener('onAudioDeviceChanged', (data) => {
            const current = data.selectedAudioDevice;
            const connected = current === 'Bluetooth' || current === 'WiredHeadset';

            // Mise à jour de l'état interne
            this.isHeadsetConnected = connected;
            
            // Notification au service audio pour le routage
            if (this.onConnectionChange) {
                this.onConnectionChange(connected, current);
            }
            console.log(`[Headset] Route Changed: ${current} (Connected: ${connected})`);
        });
    }

    // --- 2. INTERCEPTION TOUCHES PHYSIQUES (Via KeyEvent / Accessibility) ---
    private setupKeyEventListener() {
        KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
            // Ignorer Volume Down (Réservé système)
            if (keyEvent.keyCode === KEY_CODES.VOLUME_DOWN) return;

            // Gestion Spéciale Volume UP (Double Clic Tactique)
            if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) {
                const now = Date.now();
                if (now - this.lastVolumeUpTime < 500) {
                    this.triggerCommand('DOUBLE_VOL_UP');
                    this.lastVolumeUpTime = 0;
                    // Reset volume visuel si besoin
                    setTimeout(() => VolumeManager.setVolume(1.0), 100);
                } else {
                    this.lastVolumeUpTime = now;
                }
                return;
            }

            // Gestion Boutons Casque / Média (Déclenchement Direct)
            const validKeys = Object.values(KEY_CODES);
            if (validKeys.includes(keyEvent.keyCode)) {
                this.triggerCommand(`KEY_${keyEvent.keyCode}`);
            }
        });
    }

    // --- POINT D'ENTRÉE CENTRALISÉ (DEDUPLICATION) ---
    public triggerCommand(source: string) {
        const now = Date.now();
        // Filtre Anti-Rebond (400ms) pour éviter les doublons si plusieurs services captent l'event
        if (now - this.lastCommandTime < 400) {
            return;
        }

        if (this.onCommand) {
            console.log(`[Headset] Command Validated: ${source}`);
            this.onCommand(source);
            this.lastCommandTime = now;
        }
    }
}

export const headsetService = new HeadsetService();
