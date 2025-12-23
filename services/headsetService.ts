import { NativeEventEmitter, NativeModules } from 'react-native';
import KeyEvent from 'react-native-keyevent';

// Liste des codes touches interceptés par notre Service Accessibilité
const KEY_CODES = {
    VOLUME_UP: 24,
    // Note: Volume Down (25) est filtré directement en Java, on ne le recevra jamais ici
    HEADSET_HOOK: 79,     
    MEDIA_PLAY_PAUSE: 85,
    MEDIA_NEXT: 87,
    MEDIA_PREVIOUS: 88,
    MEDIA_PLAY: 126,
    MEDIA_PAUSE: 127
};

type CommandCallback = (source: string) => void;
type ConnectionCallback = (isConnected: boolean, type: string) => void;

class HeadsetService {
    private lastActionTime: number = 0;
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

    // --- 1. DÉTECTION CONNEXION CASQUE ---
    private setupConnectionListener() {
        const eventEmitter = new NativeEventEmitter(NativeModules.InCallManager);
        eventEmitter.addListener('onAudioDeviceChanged', (data) => {
            const current = data.selectedAudioDevice;
            const connected = current === 'Bluetooth' || current === 'WiredHeadset';

            if (this.isHeadsetConnected !== connected) {
                this.isHeadsetConnected = connected;
                if (this.onConnectionChange) {
                    this.onConnectionChange(connected, current);
                }
            }
        });
    }

    // --- 2. GESTION DES COMMANDES (Reçoit les events du Service Accessibilité) ---
    private setupKeyEventListener() {
        KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
            const now = Date.now();
            
            // Si on reçoit Volume Down par miracle, on l'ignore
            if (keyEvent.keyCode === 25) return;

            // Filtre de touches valides
            const validKeys = Object.values(KEY_CODES);
            if (validKeys.includes(keyEvent.keyCode)) {
                
                // Anti-rebond simple (400ms) pour éviter les doubles déclenchements
                if (now - this.lastActionTime > 400) {
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                    this.lastActionTime = now;
                }
            }
        });
    }

    private triggerCommand(source: string) {
        if (this.onCommand) {
            console.log(`[HeadsetService] Action: ${source}`);
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();
