import { Platform } from 'react-native';
import KeyEvent from 'react-native-keyevent';
import MusicControl, { Command } from 'react-native-music-control';

const KEY_CODES = {
    VOLUME_UP: 24, VOLUME_DOWN: 25, HEADSET_HOOK: 79,     
    MEDIA_PLAY_PAUSE: 85, MEDIA_NEXT: 87, MEDIA_PREVIOUS: 88,
    MEDIA_PLAY: 126, MEDIA_PAUSE: 127, MEDIA_STOP: 86, MUTE: 91
};

type CommandCallback = (source: string) => void;

class HeadsetService {
    private lastVolumeUpTime: number = 0;
    private lastCommandTime: number = 0;
    private onCommand?: CommandCallback;
    
    // On ne peut plus détecter le hardware sans InCallManager de façon fiable
    // On considère par défaut que c'est connecté si on reçoit des events
    public isHeadsetConnected: boolean = true; 

    constructor() {}

    public init() {
        this.cleanup();
        this.setupMusicControl(); 
        this.setupKeyEventListener();
    }

    private setupMusicControl() {
        MusicControl.enableBackgroundMode(true);
        MusicControl.handleAudioInterruptions(true); 
        
        MusicControl.enableControl('play', true);
        MusicControl.enableControl('pause', true);
        MusicControl.enableControl('stop', false);
        MusicControl.enableControl('nextTrack', true);
        MusicControl.enableControl('previousTrack', true);
        MusicControl.enableControl('togglePlayPause', true);

        MusicControl.setNowPlaying({
            title: 'ComTac',
            artwork: require('../assets/icon.png'), 
            artist: 'PTT Ready',
            color: 0x3b82f6,
            notificationIcon: 'ic_launcher',
            isLiveStream: true
        });

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
        
        // On initialise en Paused pour ne pas prendre le focus audio au démarrage de l'app
        // Le focus sera pris lors de startSession()
        MusicControl.updatePlayback({ state: MusicControl.STATE_PAUSED });
    }

    public forceNotificationUpdate(isVox: boolean, isTx: boolean) {
        MusicControl.updatePlayback({
            state: MusicControl.STATE_PLAYING,
            title: `ComTac: ${isVox ? (isTx ? "TX..." : "VOX ON") : "PTT"}`,
            artist: isVox ? "Mode Mains Libres" : "Appuyez pour parler"
        });
    }

    private cleanup() {
        KeyEvent.removeKeyDownListener();
    }

    public setCommandCallback(callback: CommandCallback) { this.onCommand = callback; }
    // Stub vide pour compatibilité
    public setConnectionCallback(callback: any) {} 

    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
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
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                }
            });
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
