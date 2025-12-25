import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription } from 'react-native';
import KeyEvent from 'react-native-keyevent';

const KEY_CODES = {
    VOLUME_UP: 24, VOLUME_DOWN: 25, HEADSET_HOOK: 79,     
    MEDIA_PLAY_PAUSE: 85, MEDIA_NEXT: 87, MEDIA_PREVIOUS: 88,
    MEDIA_PLAY: 126, MEDIA_PAUSE: 127, MEDIA_STOP: 86
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
        // On retire aussi les listeners KeyEvent si possible (bien que singleton)
        if (Platform.OS === 'android') {
             KeyEvent.removeKeyDownListener();
        }
    }

    public setCommandCallback(callback: CommandCallback) { this.onCommand = callback; }
    public setConnectionCallback(callback: ConnectionCallback) { this.onConnectionChange = callback; }

    // --- 1. DÉTECTION AUDIO ROBUSTE ---
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

                // On évite le spam de logs/events si l'état ne change pas vraiment
                if (this.isHeadsetConnected !== connected) {
                    this.isHeadsetConnected = connected;
                    console.log(`[Headset] Device Switch: ${current} (Headset=${connected})`);
                    if (this.onConnectionChange) this.onConnectionChange(connected, current);
                }
            });
        }
    }

    // --- 2. BOUTONS PHYSIQUES (Priorité Haute) ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                if (keyEvent.keyCode === KEY_CODES.VOLUME_DOWN) return;

                // VOLUME UP = Double Clic Tactique
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

                // MEDIA KEYS = Simple Clic
                const validKeys = Object.values(KEY_CODES);
                if (validKeys.includes(keyEvent.keyCode)) {
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                }
            });
        }
    }

    // --- 3. GATEKEEPER (Anti-Conflit) ---
    public triggerCommand(source: string) {
        const now = Date.now();
        // Debounce plus agressif (300ms) pour éviter qu'un bouton Bluetooth 
        // ne déclenche à la fois MusicControl ET KeyEvent
        if (now - this.lastCommandTime < 300) {
            console.log(`[Headset] Ignored duplicate from ${source}`);
            return;
        }

        this.lastCommandTime = now;
        if (this.onCommand) {
            console.log(`[Headset] Valid Command from ${source}`);
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();
