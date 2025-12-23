import { NativeEventEmitter, NativeModules } from 'react-native';
import KeyEvent from 'react-native-keyevent';
import { VolumeManager } from 'react-native-volume-manager';
import MusicControl, { Command } from 'react-native-music-control';

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
    private lastCommandTime: number = 0; // Deduplication
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
            if (keyEvent.keyCode === KEY_CODES.VOLUME_DOWN) return;

            if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) {
                const now = Date.now();
                if (now - this.lastVolumeUpTime < 500) {
                    this.triggerCommand('DOUBLE_VOL_UP');
                    this.lastVolumeUpTime = 0;
                    setTimeout(() => VolumeManager.setVolume(1.0), 100);
                } else {
                    this.lastVolumeUpTime = now;
                }
                return;
            }

            const validKeys = Object.values(KEY_CODES);
            if (validKeys.includes(keyEvent.keyCode)) {
                this.triggerCommand(`KEY_${keyEvent.keyCode}`);
            }
        });
    }

    // Appelé aussi depuis AudioService pour centraliser
    public triggerCommand(source: string) {
        const now = Date.now();
        // DEDUPLICATION : On ignore les commandes trop rapprochées (400ms)
        // Cela gère le cas où MusicControl et KeyEvent reçoivent la même commande en même temps
        if (now - this.lastCommandTime < 400) {
            return;
        }

        if (this.onCommand) {
            console.log(`[Headset] Command Executed: ${source}`);
            this.onCommand(source);
            this.lastCommandTime = now;
        }
    }
}

export const headsetService = new HeadsetService();
