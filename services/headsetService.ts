import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription } from 'react-native';
import KeyEvent from 'react-native-keyevent';
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
        
        // 1. SETUP MUSIC CONTROL (Media Session)
        this.setupMusicControl();

        // 2. SETUP ACCESSIBILITY (Backup)
        this.setupKeyEventListener();
        
        // 3. SETUP AUDIO DETECTION
        this.setupConnectionListener();
    }

    private setupMusicControl() {
        MusicControl.enableBackgroundMode(true);
        
        // On active tous les contrôles
        MusicControl.enableControl('play', true);
        MusicControl.enableControl('pause', true);
        MusicControl.enableControl('stop', true);
        MusicControl.enableControl('nextTrack', true);
        MusicControl.enableControl('previousTrack', true);
        
        // On définit un état fictif pour forcer l'affichage et la prise de focus
        MusicControl.setNowPlaying({
            title: 'ComTac Radio',
            artwork: require('../assets/icon.png'), 
            artist: 'PTT Actif',
            color: 0x3b82f6,
            notificationIcon: 'ic_launcher'
        });

        // Les listeners qui transforment la musique en PTT
        MusicControl.on(Command.play, () => { 
            MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
            this.triggerCommand('MEDIA_PLAY'); 
        });
        
        MusicControl.on(Command.pause, () => { 
            MusicControl.updatePlayback({ state: MusicControl.STATE_PAUSED });
            this.triggerCommand('MEDIA_PAUSE'); 
        });
        
        MusicControl.on(Command.nextTrack, () => this.triggerCommand('MEDIA_NEXT'));
        MusicControl.on(Command.previousTrack, () => this.triggerCommand('MEDIA_PREV'));
        MusicControl.on(Command.stop, () => this.triggerCommand('MEDIA_STOP'));
        
        // Force l'état Playing pour garder le focus
        MusicControl.updatePlayback({
            state: MusicControl.STATE_PLAYING,
            elapsedTime: 0
        });
    }

    private cleanup() {
        if (this.subscription) {
            this.subscription.remove();
            this.subscription = null;
        }
        KeyEvent.removeKeyDownListener();
        // On ne coupe pas MusicControl ici, on le laisse survivre
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

    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                // Ignore Vol Down
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

                const validKeys = Object.values(KEY_CODES);
                if (validKeys.includes(keyEvent.keyCode)) {
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                }
            });
        }
    }

    public triggerCommand(source: string) {
        const now = Date.now();
        // Debounce
        if (now - this.lastCommandTime < 300) return;

        this.lastCommandTime = now;
        if (this.onCommand) this.onCommand(source);
    }
}

export const headsetService = new HeadsetService();
