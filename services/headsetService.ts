import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import KeyEvent from 'react-native-keyevent';
import { VolumeManager } from 'react-native-volume-manager';

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
    private lastCommandTime: number = 0;
    
    // Callbacks
    private onCommand?: CommandCallback;
    private onConnectionChange?: ConnectionCallback;
    
    // State interne
    public isHeadsetConnected: boolean = false;
    private eventEmitter: NativeEventEmitter | null = null;

    constructor() {
        // On n'appelle pas init() ici pour laisser le temps de binder les callbacks
    }

    public init() {
        this.setupKeyEventListener();
        this.setupConnectionListener();
    }

    public setCommandCallback(callback: CommandCallback) {
        this.onCommand = callback;
    }

    public setConnectionCallback(callback: ConnectionCallback) {
        this.onConnectionChange = callback;
    }

    // --- 1. ROUTAGE & DÉTECTION ---
    private setupConnectionListener() {
        // InCallManager émet des événements via NativeEventEmitter
        if (NativeModules.InCallManager) {
            this.eventEmitter = new NativeEventEmitter(NativeModules.InCallManager);
            
            this.eventEmitter.addListener('onAudioDeviceChanged', (data) => {
                // CORRECTION DU BUG "Unexpected character: o"
                // data peut être soit une string JSON, soit déjà un objet JS.
                let deviceObj = data;
                
                if (typeof data === 'string') {
                    try {
                        deviceObj = JSON.parse(data);
                    } catch (e) {
                        console.warn("[Headset] Erreur parsing JSON device", e);
                        // On continue avec l'objet tel quel ou on s'arrête
                        return;
                    }
                }
                
                // Sécurité supplémentaire
                if (!deviceObj) return;

                const current = deviceObj.selectedAudioDevice || deviceObj.availableAudioDeviceList?.[0] || 'Speaker';
                
                // Liste des devices considérés comme "Casque/Privé"
                const headsetTypes = ['Bluetooth', 'WiredHeadset', 'Earpiece'];
                const connected = headsetTypes.includes(current) && current !== 'Speaker';

                this.isHeadsetConnected = connected;
                
                console.log(`[Headset] Device Changed: ${current} (Headset: ${connected})`);

                if (this.onConnectionChange) {
                    this.onConnectionChange(connected, current);
                }
            });
        }
    }

    // --- 2. INPUTS PHYSIQUES (Boutons Téléphone) ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                // Ignorer Volume Down (Réservé système)
                if (keyEvent.keyCode === KEY_CODES.VOLUME_DOWN) return;

                // Gestion Spéciale Volume UP (Double Clic Tactique)
                if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) {
                    const now = Date.now();
                    if (now - this.lastVolumeUpTime < 500) {
                        this.triggerCommand('DOUBLE_VOL_UP');
                        this.lastVolumeUpTime = 0;
                        // Reset volume visuel si besoin
                        setTimeout(() => VolumeManager.setVolume(1.0), 100);
                    } else {
                        this.lastVolumeUpTime = now;
                    }
                    return;
                }

                // Gestion Boutons Casque / Média
                const validKeys = Object.values(KEY_CODES);
                if (validKeys.includes(keyEvent.keyCode)) {
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                }
            });
        }
    }

    // --- 3. POINT D'ENTRÉE CENTRALISÉ (DEDUPLICATION) ---
    public triggerCommand(source: string) {
        const now = Date.now();
        // Filtre Anti-Rebond (400ms)
        if (now - this.lastCommandTime < 400) {
            return;
        }

        this.lastCommandTime = now;
        console.log(`[Headset] Command Triggered: ${source}`);

        if (this.onCommand) {
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();S
