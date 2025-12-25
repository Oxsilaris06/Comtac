
import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription } from 'react-native';
import KeyEvent from 'react-native-keyevent';

const KEY_CODES = {
    VOLUME_UP: 24,
    VOLUME_DOWN: 25,
    // Nous écoutons encore ces codes pour les cas où CallKeep n'est pas actif (menu, etc)
    HEADSET_HOOK: 79,     
    MEDIA_PLAY_PAUSE: 85,
};

type CommandCallback = (source: string) => void;
type ConnectionCallback = (isConnected: boolean, type: string) => void;

class HeadsetService {
    private volUpPressed: boolean = false;
    private volDownPressed: boolean = false;
    private isPhysicalPttActive: boolean = false;

    private onCommand?: CommandCallback;
    private onConnectionChange?: ConnectionCallback;
    
    public isHeadsetConnected: boolean = false;
    private eventEmitter: NativeEventEmitter | null = null;
    private subscription: EmitterSubscription | null = null;

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
                
                const headsetTypes = ['Bluetooth', 'WiredHeadset', 'Earpiece', 'Headset', 'CarAudio', 'USB_HEADSET', 'AuxLine'];
                const connected = headsetTypes.some(t => current.includes(t)) && current !== 'Speaker' && current !== 'Phone';

                this.isHeadsetConnected = connected;
                if (this.onConnectionChange) this.onConnectionChange(connected, current);
            });
        }
    }

    // --- 2. INTERCEPTION BOUTONS PHYSIQUES (Focus: VOLUME PTT) ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            // PRESSION
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                const code = keyEvent.keyCode;

                // LOGIQUE PTT PHYSIQUE (VOLUME UP + DOWN)
                if (code === KEY_CODES.VOLUME_UP) this.volUpPressed = true;
                if (code === KEY_CODES.VOLUME_DOWN) this.volDownPressed = true;

                if (this.volUpPressed && this.volDownPressed && !this.isPhysicalPttActive) {
                    this.isPhysicalPttActive = true;
                    if (this.onCommand) this.onCommand('PHYSICAL_PTT_START');
                    return;
                }
                
                // Si on a pas de casque, on peut vouloir utiliser Volume Up comme toggle simple
                if (code === KEY_CODES.VOLUME_UP && !this.isPhysicalPttActive && !this.volDownPressed) {
                    // Optionnel : ajouter une logique ici si vous voulez que VolUp seul fasse quelque chose
                }
            });

            // RELÂCHEMENT
            KeyEvent.onKeyUpListener((keyEvent: { keyCode: number, action: number }) => {
                const code = keyEvent.keyCode;
                if (code === KEY_CODES.VOLUME_UP) this.volUpPressed = false;
                if (code === KEY_CODES.VOLUME_DOWN) this.volDownPressed = false;

                if (this.isPhysicalPttActive && (!this.volUpPressed || !this.volDownPressed)) {
                    this.isPhysicalPttActive = false;
                    if (this.onCommand) this.onCommand('PHYSICAL_PTT_END');
                }
            });
        }
    }
}

export const headsetService = new HeadsetService();
