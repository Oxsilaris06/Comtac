import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription } from 'react-native';
import KeyEvent from 'react-native-keyevent';

const KEY_CODES = {
    VOLUME_UP: 24,
    VOLUME_DOWN: 25,
    HEADSET_HOOK: 79,     
    MEDIA_PLAY_PAUSE: 85,
    MEDIA_STOP: 86,
    MEDIA_NEXT: 87,
    MEDIA_PREVIOUS: 88,
    MEDIA_PLAY: 126,
    MEDIA_PAUSE: 127
};

type CommandCallback = (source: string) => void;
type ConnectionCallback = (isConnected: boolean, type: string) => void;

class HeadsetService {
    private lastCommandTime: number = 0;
    
    // État des touches physiques pour le PTT simultané
    private volUpPressed: boolean = false;
    private volDownPressed: boolean = false;
    private isPhysicalPttActive: boolean = false;

    private onCommand?: CommandCallback;
    private onConnectionChange?: ConnectionCallback;
    
    public isHeadsetConnected: boolean = false;
    private eventEmitter: NativeEventEmitter | null = null;
    private subscription: EmitterSubscription | null = null;

    constructor() {}

    public init() {
        this.cleanup();
        this.setupKeyEventListener();
        this.setupConnectionListener();
    }

    private cleanup() {
        if (this.subscription) {
            this.subscription.remove();
            this.subscription = null;
        }
        if (Platform.OS === 'android') {
             KeyEvent.removeKeyDownListener();
             KeyEvent.removeKeyUpListener();
        }
    }

    public setCommandCallback(callback: CommandCallback) { this.onCommand = callback; }
    public setConnectionCallback(callback: ConnectionCallback) { this.onConnectionChange = callback; }

    // --- 1. DÉTECTION ROUTAGE (InCallManager) ---
    private setupConnectionListener() {
        if (NativeModules.InCallManager) {
            this.eventEmitter = new NativeEventEmitter(NativeModules.InCallManager);
            
            this.subscription = this.eventEmitter.addListener('onAudioDeviceChanged', (data) => {
                let deviceObj = data;
                if (typeof data === 'string') {
                    try { deviceObj = JSON.parse(data); } catch (e) { return; }
                }
                if (!deviceObj) return;

                const current = deviceObj.selectedAudioDevice || deviceObj.availableAudioDeviceList?.[0] || 'Speaker';
                
                // Liste exhaustive des périphériques "Privés"
                const headsetTypes = ['Bluetooth', 'WiredHeadset', 'Earpiece', 'Headset', 'CarAudio', 'USB_HEADSET', 'AuxLine'];
                const connected = headsetTypes.some(t => current.includes(t)) && current !== 'Speaker' && current !== 'Phone';

                // Mise à jour de l'état local
                this.isHeadsetConnected = connected;
                
                // Notification au service audio
                if (this.onConnectionChange) this.onConnectionChange(connected, current);
            });
        }
    }

    // --- 2. INTERCEPTION BOUTONS PHYSIQUES ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            // A. Pression (Down)
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                const code = keyEvent.keyCode;

                // Gestion Volume PTT (Simultané)
                if (code === KEY_CODES.VOLUME_UP) this.volUpPressed = true;
                if (code === KEY_CODES.VOLUME_DOWN) this.volDownPressed = true;

                // Si les deux sont appuyés et qu'on n'a pas encore déclenché le PTT
                if (this.volUpPressed && this.volDownPressed && !this.isPhysicalPttActive) {
                    this.isPhysicalPttActive = true;
                    this.triggerCommand('PHYSICAL_PTT_START');
                    return; // On ne traite pas le reste
                }

                // Si PTT physique actif, on ignore les autres commandes volume
                if (this.isPhysicalPttActive) return;

                // Commandes Casque Bluetooth (Toggle VOX)
                if (
                    code === KEY_CODES.HEADSET_HOOK || 
                    code === KEY_CODES.MEDIA_PLAY_PAUSE || 
                    code === KEY_CODES.MEDIA_PLAY || 
                    code === KEY_CODES.MEDIA_PAUSE
                ) {
                    this.triggerCommand('HEADSET_TOGGLE_VOX');
                }
            });

            // B. Relâchement (Up)
            KeyEvent.onKeyUpListener((keyEvent: { keyCode: number, action: number }) => {
                const code = keyEvent.keyCode;

                if (code === KEY_CODES.VOLUME_UP) this.volUpPressed = false;
                if (code === KEY_CODES.VOLUME_DOWN) this.volDownPressed = false;

                // Si on était en mode PTT et qu'on relâche L'UN des deux boutons
                if (this.isPhysicalPttActive && (!this.volUpPressed || !this.volDownPressed)) {
                    this.isPhysicalPttActive = false;
                    this.triggerCommand('PHYSICAL_PTT_END');
                }
            });
        }
    }

    // --- 3. GATEKEEPER ---
    public triggerCommand(source: string) {
        // Pas de debounce pour le PTT start/end car il faut être réactif
        if (source === 'PHYSICAL_PTT_START' || source === 'PHYSICAL_PTT_END') {
            if (this.onCommand) this.onCommand(source);
            return;
        }

        const now = Date.now();
        // Debounce pour le Toggle VOX (éviter double commande BT + MusicControl)
        if (now - this.lastCommandTime < 400) {
            return;
        }

        this.lastCommandTime = now;
        if (this.onCommand) {
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();
