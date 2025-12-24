import { NativeEventEmitter, NativeModules, Platform, EmitterSubscription } from 'react-native';
import KeyEvent from 'react-native-keyevent';
// On garde l'import mais on retire l'usage dangereux de setVolume(1.0)
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
    private subscription: EmitterSubscription | null = null;

    constructor() {
        // On n'appelle pas init() ici pour laisser le temps de binder les callbacks
    }

    public init() {
        // Nettoyage préventif pour éviter les fuites de mémoire (doublons de listeners)
        this.cleanup();
        
        this.setupKeyEventListener();
        this.setupConnectionListener();
    }

    private cleanup() {
        if (this.subscription) {
            this.subscription.remove();
            this.subscription = null;
        }
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
            
            this.subscription = this.eventEmitter.addListener('onAudioDeviceChanged', (data) => {
                // CORRECTION ROBUSTESSE JSON
                let deviceObj = data;
                
                if (typeof data === 'string') {
                    try {
                        deviceObj = JSON.parse(data);
                    } catch (e) {
                        console.warn("[Headset] Erreur parsing JSON device", e);
                        return;
                    }
                }
                
                // Sécurité supplémentaire
                if (!deviceObj) return;

                const current = deviceObj.selectedAudioDevice || deviceObj.availableAudioDeviceList?.[0] || 'Speaker';
                
                // CORRECTION : Liste étendue pour couvrir les casques USB et Voiture
                const headsetTypes = [
                    'Bluetooth', 'WiredHeadset', 'Earpiece', 'Headset', 
                    'CarAudio', 'USB_HEADSET', 'USB_DEVICE', 'AuxLine'
                ];
                
                const connected = headsetTypes.some(type => current.includes(type)) && current !== 'Speaker' && current !== 'Phone';

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
            // Note: KeyEvent est un module singleton, pas besoin de cleanup ici
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                // Ignorer Volume Down (Réservé système pour baisser le son si besoin)
                if (keyEvent.keyCode === KEY_CODES.VOLUME_DOWN) return;

                // Gestion Spéciale Volume UP (Double Clic Tactique)
                if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) {
                    const now = Date.now();
                    // CORRECTION : Fenêtre de temps réduite pour éviter les faux positifs
                    if (now - this.lastVolumeUpTime < 400) {
                        this.triggerCommand('DOUBLE_VOL_UP');
                        this.lastVolumeUpTime = 0;
                        
                        // CORRECTION CRITIQUE : Suppression du setVolume(1.0)
                        // Forcer le volume à 100% est dangereux pour l'audition et cause des glitchs UI.
                        // On laisse le système gérer le volume ou on l'ignore silencieusement.
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
        // CORRECTION : Réduction du Debounce à 250ms pour plus de réactivité
        // 400ms était trop long pour des appuis rapides répétés (ex: SOS)
        if (now - this.lastCommandTime < 250) {
            return;
        }

        this.lastCommandTime = now;
        console.log(`[Headset] Command Triggered: ${source}`);

        if (this.onCommand) {
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();
