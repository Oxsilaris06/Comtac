
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import KeyEvent from 'react-native-keyevent';
import MusicControl, { Command } from 'react-native-music-control';

const KEY_CODES = {
    VOLUME_UP: 24, VOLUME_DOWN: 25, HEADSET_HOOK: 79,     
    MEDIA_PLAY_PAUSE: 85, MEDIA_NEXT: 87, MEDIA_PREVIOUS: 88,
    MEDIA_PLAY: 126, MEDIA_PAUSE: 127, MEDIA_STOP: 86, MUTE: 91
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
    private subscription: any = null;

    constructor() {}

    public init() {
        this.cleanup();
        this.setupMusicControl(); 
        this.setupKeyEventListener(); // PRIMARY INPUT (Via Accessibility)
        this.setupConnectionListener();
    }

    private setupMusicControl() {
        MusicControl.enableBackgroundMode(true);
        // Important : On active les contrôles pour la NOTIFICATION
        // Mais on sait que quand 2 membres sont connectés, ces events ne marcheront pas
        // C'est KeyEventListener qui prendra le relais
        MusicControl.enableControl('play', true);
        MusicControl.enableControl('pause', true);
        MusicControl.enableControl('stop', false);
        MusicControl.enableControl('nextTrack', true);
        MusicControl.enableControl('previousTrack', true);
        MusicControl.enableControl('togglePlayPause', true);

        const handler = (action: string) => { 
            console.log("[Headset] MusicControl Event:", action);
            this.triggerCommand(action);
            MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
        };

        MusicControl.on(Command.play, () => handler('MEDIA_PLAY'));
        MusicControl.on(Command.pause, () => handler('MEDIA_PAUSE'));
        MusicControl.on(Command.togglePlayPause, () => handler('MEDIA_TOGGLE'));
        MusicControl.on(Command.nextTrack, () => handler('MEDIA_NEXT'));
        MusicControl.on(Command.previousTrack, () => handler('MEDIA_PREV'));
        
        this.forceNotificationUpdate(false, false);
    }

    public forceNotificationUpdate(isVox: boolean, isTx: boolean) {
        MusicControl.setNowPlaying({
            title: 'ComTac',
            artwork: require('../assets/icon.png'), 
            artist: isVox ? (isTx ? "TX EN COURS..." : "VOX ACTIF") : "MODE PTT",
            color: isTx ? 0xff0000 : 0x3b82f6,
            notificationIcon: 'ic_launcher',
            isLiveStream: true
        });
        MusicControl.updatePlayback({
            state: MusicControl.STATE_PLAYING, // Toujours Playing
            elapsedTime: 0
        });
    }

    private cleanup() {
        if (this.subscription) { this.subscription.remove(); this.subscription = null; }
        KeyEvent.removeKeyDownListener();
    }

    public setCommandCallback(callback: CommandCallback) { this.onCommand = callback; }
    public setConnectionCallback(callback: ConnectionCallback) { this.onConnectionChange = callback; }

    private setupConnectionListener() {
        if (NativeModules.InCallManager) {
            this.eventEmitter = new NativeEventEmitter(NativeModules.InCallManager);
            this.subscription = this.eventEmitter.addListener('onAudioDeviceChanged', (data) => {
                let deviceObj = data;
                if (typeof data === 'string') { try { deviceObj = JSON.parse(data); } catch (e) { return; } }
                if (!deviceObj) return;
                const current = deviceObj.selectedAudioDevice || deviceObj.availableAudioDeviceList?.[0] || 'Speaker';
                const headsetTypes = ['Bluetooth', 'WiredHeadset', 'Earpiece', 'Headset', 'CarAudio', 'USB_HEADSET', 'AuxLine'];
                const connected = headsetTypes.some(t => current.includes(t)) && current !== 'Speaker' && current !== 'Phone';
                this.isHeadsetConnected = connected;
                if (this.onConnectionChange) this.onConnectionChange(connected, current);
            });
        }
    }

    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                // LOGIQUE PRIMAIRE (Fonctionne même en appel/VoIP)
                if (keyEvent.keyCode === 25) return; 
                if (keyEvent.keyCode === 24) { 
                    const now = Date.now();
                    if (now - this.lastVolumeUpTime < 400) {
                        this.triggerCommand('DOUBLE_VOL_UP');
                        this.lastVolumeUpTime = 0;
                    } else { this.lastVolumeUpTime = now; }
                    return;
                }
                const validKeys = Object.values(KEY_CODES);
                if (validKeys.includes(keyEvent.keyCode)) {
                    console.log("[Headset] KeyEvent Received:", keyEvent.keyCode);
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                }
            });
        }
    }

    public triggerCommand(source: string) {
        const now = Date.now();
        // Debounce de 300ms pour éviter les doublons (MusicControl + KeyEvent)
        if (now - this.lastCommandTime < 300) return;
        this.lastCommandTime = now;
        if (this.onCommand) this.onCommand(source);
    }
}

export const headsetService = new HeadsetService();
