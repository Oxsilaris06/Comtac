import { NativeEventEmitter, NativeModules } from 'react-native';
import KeyEvent from 'react-native-keyevent';
import { VolumeManager } from 'react-native-volume-manager';

// KeyCodes
const KEY_CODES = {
    VOLUME_UP: 24,
    // Volume Down ignoré
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

    // --- DETECTION CONNEXION ---
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

    // --- INTERCEPTION TOUCHES ---
    private setupKeyEventListener() {
        KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
            const now = Date.now();

            // 1. VOLUME UP (Double Clic)
            if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) {
                if (now - this.lastVolumeUpTime < 500) {
                    this.triggerCommand('DOUBLE_VOL_UP');
                    this.lastVolumeUpTime = 0;
                    // Reset volume au cas où
                    setTimeout(() => VolumeManager.setVolume(1.0), 100);
                } else {
                    this.lastVolumeUpTime = now;
                }
                return;
            }

            // 2. VOLUME DOWN (Ignoré)
            if (keyEvent.keyCode === 25) return;

            // 3. COMMANDES BLUETOOTH / MEDIA
            const validKeys = Object.values(KEY_CODES);
            if (validKeys.includes(keyEvent.keyCode)) {
                // Anti-rebond 400ms
                if (now - this.lastActionTime > 400) {
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                    this.lastActionTime = now;
                }
            }
        });
    }

    private triggerCommand(source: string) {
        if (this.onCommand) {
            console.log(`[Headset] Command: ${source}`);
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();
