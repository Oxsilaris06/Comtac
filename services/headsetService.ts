import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription } from 'react-native';
import KeyEvent from 'react-native-keyevent';

const KEY_CODES = {
    VOLUME_UP: 24, 
    VOLUME_DOWN: 25, 
    HEADSET_HOOK: 79,     
    MEDIA_PLAY_PAUSE: 85, 
    MEDIA_NEXT: 87, 
    MEDIA_PREVIOUS: 88,
    MEDIA_PLAY: 126, 
    MEDIA_PAUSE: 127, 
    MEDIA_STOP: 86,
    MUTE: 91
};

type CommandCallback = (source: string) => void;
type ConnectionCallback = (isConnected: boolean, type: string) => void;

class HeadsetService {
    private lastVolumeUpTime: number = 0;
    private lastCommandTime: number = 0;
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
    }

    public setCommandCallback(callback: CommandCallback) { this.onCommand = callback; }
    public setConnectionCallback(callback: ConnectionCallback) { this.onConnectionChange = callback; }

    // --- 1. DÉTECTION AUDIO ---
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
                
                // On détecte explicitement tout ce qui n'est pas le HP ou le téléphone
                const headsetTypes = ['Bluetooth', 'WiredHeadset', 'Earpiece', 'Headset', 'CarAudio', 'USB_HEADSET', 'AuxLine'];
                const connected = headsetTypes.some(t => current.includes(t)) && current !== 'Speaker' && current !== 'Phone';

                console.log("[HeadsetService] Device changed:", current, "Connected:", connected);

                this.isHeadsetConnected = connected;
                if (this.onConnectionChange) this.onConnectionChange(connected, current);
            });
        }
    }

    // --- 2. BOUTONS PHYSIQUES ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                // On ignore Vol Down
                if (keyEvent.keyCode === KEY_CODES.VOLUME_DOWN) return;

                // Double Volume Up Logic
                if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) {
                    const now = Date.now();
                    if (now - this.lastVolumeUpTime < 400) {
                        this.triggerCommand('DOUBLE_VOL_UP');
                        this.lastVolumeUpTime = 0;
                    } else {
                        this.lastVolumeUpTime = now;
                    }
                    return;
                }

                // Pour toutes les autres touches (Mute, Play, Next...)
                // Comme on retourne TRUE dans le Java, l'action par défaut (changer piste) est annulée
                // et on arrive ici.
                const validKeys = Object.values(KEY_CODES);
                if (validKeys.includes(keyEvent.keyCode)) {
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                }
            });
        }
    }

    public triggerCommand(source: string) {
        const now = Date.now();
        if (now - this.lastCommandTime < 300) return; // Debounce

        this.lastCommandTime = now;
        if (this.onCommand) this.onCommand(source);
    }
}

export const headsetService = new HeadsetService();
