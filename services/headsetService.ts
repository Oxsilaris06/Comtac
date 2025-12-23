import { NativeEventEmitter, NativeModules } from 'react-native';
import KeyEvent from 'react-native-keyevent';

// Définition des touches physiques
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

    // --- 2. GESTION TOUCHES PHYSIQUES (KeyEvent) ---
    private setupKeyEventListener() {
        KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
            
            // CAS 1 : VOLUME DOWN -> ON BLOQUE ABSOLUMENT
            if (keyEvent.keyCode === KEY_CODES.VOLUME_DOWN) {
                return; // On ne fait RIEN.
            }

            // CAS 2 : VOLUME UP -> GESTION DOUBLE CLIC
            if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) {
                const now = Date.now();
                // Si le délai entre deux appuis est < 500ms
                if (now - this.lastVolumeUpTime < 500) {
                    this.triggerCommand('DOUBLE_VOL_UP');
                    this.lastVolumeUpTime = 0; // Reset pour éviter triple clic
                } else {
                    this.lastVolumeUpTime = now;
                }
                return; // On ne déclenche pas d'autre action
            }

            // CAS 3 : BOUTONS MEDIA / CASQUE -> DÉCLENCHEMENT DIRECT
            const validKeys = Object.values(KEY_CODES);
            if (validKeys.includes(keyEvent.keyCode)) {
                this.triggerCommand(`KEY_${keyEvent.keyCode}`);
            }
        });
    }

    private triggerCommand(source: string) {
        if (this.onCommand) {
            console.log(`[HeadsetService] Commande reçue: ${source}`);
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();
