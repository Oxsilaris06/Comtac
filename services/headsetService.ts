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
        this.setupKeyEventListener();
        this.setupConnectionListener();
    }

    private setupMusicControl() {
        MusicControl.enableBackgroundMode(true);
        
        // On active TOUT pour être sûr de capter les clics
        MusicControl.enableControl('play', true);
        MusicControl.enableControl('pause', true);
        MusicControl.enableControl('stop', false);
        MusicControl.enableControl('nextTrack', true);
        MusicControl.enableControl('previousTrack', true);
        MusicControl.enableControl('togglePlayPause', true); // Important pour certains casques

        // Initialisation fictive
        this.forceNotificationUpdate(false, false);

        // Handlers
        MusicControl.on(Command.play, () => { this.handleMediaAction('MEDIA_PLAY'); });
        MusicControl.on(Command.pause, () => { this.handleMediaAction('MEDIA_PAUSE'); });
        MusicControl.on(Command.togglePlayPause, () => { this.handleMediaAction('MEDIA_TOGGLE'); });
        MusicControl.on(Command.nextTrack, () => this.handleMediaAction('MEDIA_NEXT'));
        MusicControl.on(Command.previousTrack, () => this.handleMediaAction('MEDIA_PREV'));
    }

    // Appelée par audioService pour garder la notif à jour
    public forceNotificationUpdate(isVox: boolean, isTx: boolean) {
        const stateStr = isVox ? (isTx ? "TX EN COURS..." : "VOX ACTIF") : "MODE PTT";
        
        MusicControl.setNowPlaying({
            title: 'ComTac Radio',
            artwork: require('../assets/icon.png'), 
            artist: stateStr,
            color: isTx ? 0xff0000 : 0x3b82f6,
            notificationIcon: 'ic_launcher'
        });

        // On alterne Playing/Paused visuellement mais on force l'état interne pour garder le focus
        MusicControl.updatePlayback({
            state: isVox ? MusicControl.STATE_PLAYING : MusicControl.STATE_PAUSED,
            elapsedTime: 0
        });
    }

    private handleMediaAction(action: string) {
        console.log("[Headset] Media Action:", action);
        // On renvoie la commande
        this.triggerCommand(action);
        
        // On force un update pour montrer à l'OS qu'on a réagi
        // (Sinon le bouton peut tourner dans le vide sur l'UI Android)
        // L'update réel sera fait par audioService.updateNotification() en réponse au toggle
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
                if (keyEvent.keyCode === 25) return; // Vol Down ignored
                if (keyEvent.keyCode === 24) { // Vol Up
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
