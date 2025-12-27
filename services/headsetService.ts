import MusicControl, { Command } from 'react-native-music-control';

type CommandCallback = (source: string) => void;

class HeadsetService {
    private onCommand?: CommandCallback;
    
    // Sans module natif complexe, on suppose que c'est connecté.
    // L'audio passera par le chemin système par défaut (Casque si connecté, HP sinon).
    public isHeadsetConnected: boolean = true; 

    constructor() {}

    public init() {
        this.setupMusicControl(); 
    }

    private setupMusicControl() {
        MusicControl.enableBackgroundMode(true);
        MusicControl.handleAudioInterruptions(true); 
        
        MusicControl.enableControl('play', true);
        MusicControl.enableControl('pause', true);
        MusicControl.enableControl('stop', false);
        MusicControl.enableControl('nextTrack', true);
        MusicControl.enableControl('previousTrack', true);
        
        // "togglePlayPause" est crucial pour certains casques (AirPods)
        MusicControl.enableControl('togglePlayPause', true); 

        MusicControl.setNowPlaying({
            title: 'ComTac',
            artwork: require('../assets/icon.png'), 
            artist: 'Prêt',
            color: 0x3b82f6,
            notificationIcon: 'ic_launcher',
            isLiveStream: true // Empêche la barre de progression
        });

        const handler = (action: string) => { 
            console.log("[Headset] Event:", action);
            if (this.onCommand) this.onCommand(action);
            
            // Astuce: On force toujours l'état PLAYING pour garder le focus
            // Si on passe en PAUSED, certains téléphones rendent le focus au système
            MusicControl.updatePlayback({ state: MusicControl.STATE_PLAYING });
        };

        MusicControl.on(Command.play, () => handler('MEDIA_PLAY'));
        MusicControl.on(Command.pause, () => handler('MEDIA_PAUSE'));
        MusicControl.on(Command.togglePlayPause, () => handler('MEDIA_TOGGLE'));
        MusicControl.on(Command.nextTrack, () => handler('MEDIA_NEXT'));
        MusicControl.on(Command.previousTrack, () => handler('MEDIA_PREV'));
        
        // État initial neutre mais actif
        MusicControl.updatePlayback({ 
            state: MusicControl.STATE_PLAYING,
            elapsedTime: 0
        });
    }

    public forceNotificationUpdate(isVox: boolean, isTx: boolean) {
        MusicControl.updatePlayback({
            state: MusicControl.STATE_PLAYING,
            title: `ComTac: ${isVox ? (isTx ? "TX..." : "VOX ON") : "PTT"}`,
            artist: isVox ? "Mode Mains Libres" : "Appuyez pour parler"
        });
    }

    public setCommandCallback(callback: CommandCallback) { this.onCommand = callback; }
    public setConnectionCallback(callback: any) {} 
}

export const headsetService = new HeadsetService();
