import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription } from 'react-native';
import KeyEvent from 'react-native-keyevent';

const KEY_CODES = {
    VOLUME_UP: 24,
    VOLUME_DOWN: 25,
    // Codes critiques pour le Bluetooth
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
    
    // État pour le PTT Volume Simultané
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

    // --- 1. DÉTECTION CONNEXION ---
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

    // --- 2. INTERCEPTION BOUTONS PHYSIQUES ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            // PRESSION
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                const code = keyEvent.keyCode;

                // Logique PTT Physique (Volume Up + Down)
                if (code === KEY_CODES.VOLUME_UP) this.volUpPressed = true;
                if (code === KEY_CODES.VOLUME_DOWN) this.volDownPressed = true;

                if (this.volUpPressed && this.volDownPressed && !this.isPhysicalPttActive) {
                    this.isPhysicalPttActive = true;
                    this.triggerCommand('PHYSICAL_PTT_START');
                    return;
                }
                if (this.isPhysicalPttActive) return;

                // Logique Bluetooth / Média
                // On accepte TOUS les codes possibles
                const isMedia = [
                    KEY_CODES.HEADSET_HOOK, KEY_CODES.MEDIA_PLAY_PAUSE, 
                    KEY_CODES.MEDIA_PLAY, KEY_CODES.MEDIA_PAUSE, KEY_CODES.MEDIA_STOP
                ].includes(code);

                if (isMedia) {
                    this.triggerCommand('HEADSET_TOGGLE_VOX');
                }
            });

            // RELÂCHEMENT
            KeyEvent.onKeyUpListener((keyEvent: { keyCode: number, action: number }) => {
                const code = keyEvent.keyCode;
                if (code === KEY_CODES.VOLUME_UP) this.volUpPressed = false;
                if (code === KEY_CODES.VOLUME_DOWN) this.volDownPressed = false;

                if (this.isPhysicalPttActive && (!this.volUpPressed || !this.volDownPressed)) {
                    this.isPhysicalPttActive = false;
                    this.triggerCommand('PHYSICAL_PTT_END');
                }
            });
        }
    }

    // --- 3. GATEKEEPER ---
    public triggerCommand(source: string) {
        if (source.includes('PHYSICAL_PTT')) {
            if (this.onCommand) this.onCommand(source);
            return;
        }

        const now = Date.now();
        // Debounce 300ms pour éviter doublons (BT + MusicControl)
        if (now - this.lastCommandTime < 300) return;

        this.lastCommandTime = now;
        if (this.onCommand) this.onCommand(source);
    }
}

export const headsetService = new HeadsetService();
