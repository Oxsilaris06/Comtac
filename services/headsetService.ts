import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription, DeviceEventEmitter } from 'react-native';
import KeyEvent from 'react-native-keyevent';

const { HeadsetModule } = NativeModules;

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
    private mediaSubscription: EmitterSubscription | null = null;

    constructor() {}

    public init() {
        this.cleanup();
        
        // 1. Démarrer le Module Natif (MediaSession)
        if (HeadsetModule && HeadsetModule.startSession) {
            console.log("[Headset] Starting Native Media Session");
            HeadsetModule.startSession();
        }

        this.setupKeyEventListener(); // Via Accessibility (Backup)
        this.setupMediaSessionListener(); // Via HeadsetModule (Prioritaire)
        this.setupConnectionListener();
    }

    private cleanup() {
        if (this.subscription) {
            this.subscription.remove();
            this.subscription = null;
        }
        if (this.mediaSubscription) {
            this.mediaSubscription.remove();
            this.mediaSubscription = null;
        }
        KeyEvent.removeKeyDownListener();
        
        // Arrêt propre du module natif si besoin (optionnel, on veut souvent le garder actif)
        // if (HeadsetModule) HeadsetModule.stopSession();
    }

    public setCommandCallback(callback: CommandCallback) { this.onCommand = callback; }
    public setConnectionCallback(callback: ConnectionCallback) { this.onConnectionChange = callback; }

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

    // --- ECOUTEUR 1 : Native HeadsetModule (MediaSession) ---
    private setupMediaSessionListener() {
        this.mediaSubscription = DeviceEventEmitter.addListener('COMTAC_MEDIA_EVENT', (keyCode: number) => {
            console.log("[Headset] Native Media Event received:", keyCode);
            // On traite l'événement immédiatement
            this.processKeyCode(keyCode, 'MEDIA_SESSION');
        });
    }

    // --- ECOUTEUR 2 : Accessibility Service (Backup) ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                this.processKeyCode(keyEvent.keyCode, 'ACCESSIBILITY');
            });
        }
    }

    private processKeyCode(keyCode: number, sourceName: string) {
        // On ignore Vol Down
        if (keyCode === KEY_CODES.VOLUME_DOWN) return;

        // Double Volume Up Logic
        if (keyCode === KEY_CODES.VOLUME_UP) {
            const now = Date.now();
            if (now - this.lastVolumeUpTime < 400) {
                this.triggerCommand(`DOUBLE_VOL_UP_${sourceName}`);
                this.lastVolumeUpTime = 0;
            } else {
                this.lastVolumeUpTime = now;
            }
            return;
        }

        const validKeys = Object.values(KEY_CODES);
        if (validKeys.includes(keyCode)) {
            this.triggerCommand(`KEY_${keyCode}_${sourceName}`);
        }
    }

    public triggerCommand(source: string) {
        const now = Date.now();
        if (now - this.lastCommandTime < 300) return;

        this.lastCommandTime = now;
        if (this.onCommand) this.onCommand(source);
    }
}

export const headsetService = new HeadsetService();
