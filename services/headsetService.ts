import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription } from 'react-native';
import KeyEvent from 'react-native-keyevent';

// Codes Android Natifs pour les boutons
const KEY_CODES = {
    VOLUME_UP: 24, 
    VOLUME_DOWN: 25, 
    // LE CODE MAGIQUE : 79 est envoyé quand on est en mode "Appel" (InCall)
    HEADSET_HOOK: 79,     
    // LE CODE CLASSIQUE : 85 est envoyé quand on est en mode "Musique"
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
        if (Platform.OS === 'android') {
             // Nettoyage préventif
             KeyEvent.removeKeyDownListener();
        }
    }

    public setCommandCallback(callback: CommandCallback) { this.onCommand = callback; }
    public setConnectionCallback(callback: ConnectionCallback) { this.onConnectionChange = callback; }

    // --- 1. DÉTECTION ROUTAGE (InCallManager) ---
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

                if (this.isHeadsetConnected !== connected) {
                    this.isHeadsetConnected = connected;
                    console.log(`[Headset] Device Switch: ${current} (Headset=${connected})`);
                    if (this.onConnectionChange) this.onConnectionChange(connected, current);
                }
            });
        }
    }

    // --- 2. INTERCEPTION BOUTONS PHYSIQUES (Double Écoute) ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                const code = keyEvent.keyCode;

                // A. Ignorer Volume Down (Réservé système)
                if (code === KEY_CODES.VOLUME_DOWN) return;

                // B. Volume UP = Double Clic Tactique
                if (code === KEY_CODES.VOLUME_UP) {
                    const now = Date.now();
                    if (now - this.lastVolumeUpTime < 400) {
                        this.triggerCommand('DOUBLE_VOL_UP');
                        this.lastVolumeUpTime = 0;
                    } else {
                        this.lastVolumeUpTime = now;
                    }
                    return;
                }

                // C. BOUTON PRINCIPAL CASQUE (LE CŒUR DU SYSTÈME)
                // On intercepte TOUS les codes possibles pour un bouton "Play/Action".
                // Que le téléphone soit en mode Appel (79) ou Média (85/126...), on déclenche.
                if (
                    code === KEY_CODES.HEADSET_HOOK ||      // Mode Appel
                    code === KEY_CODES.MEDIA_PLAY_PAUSE ||  // Mode Musique
                    code === KEY_CODES.MEDIA_PLAY || 
                    code === KEY_CODES.MEDIA_PAUSE ||
                    code === KEY_CODES.MEDIA_STOP
                ) {
                    // On unifie tout sous le nom "HEADSET_BUTTON_MAIN"
                    this.triggerCommand('HEADSET_BUTTON_MAIN');
                    return;
                }
            });
        }
    }

    // --- 3. GATEKEEPER (Filtre Anti-Echo) ---
    public triggerCommand(source: string) {
        const now = Date.now();
        // Debounce de 300ms.
        // Si Android envoie à la fois "HOOK" et "MEDIA" en même temps (fréquent),
        // on ne prend que le premier.
        if (now - this.lastCommandTime < 300) {
            console.log(`[Headset] Ignored duplicate/echo: ${source}`);
            return;
        }

        this.lastCommandTime = now;
        if (this.onCommand) {
            console.log(`[Headset] Valid Command Executed: ${source}`);
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();
