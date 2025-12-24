import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import KeyEvent from 'react-native-keyevent';
import { VolumeManager } from 'react-native-volume-manager';
import InCallManager from 'react-native-incall-manager';

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
        this.eventEmitter = new NativeEventEmitter(NativeModules.InCallManager);
        
        this.eventEmitter.addListener('onAudioDeviceChanged', (data) => {
            const deviceObj = JSON.parse(data); // InCallManager renvoie parfois une string JSON
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

        // Force une vérification initiale (utile si le listener démarre après l'event)
        this.checkInitialConnection();
    }

    // Méthode pour vérifier manuellement l'état actuel (sans attendre un event)
    public async checkInitialConnection() {
        // Note: InCallManager n'a pas de méthode getAudioDevice synchrone fiable, 
        // on se base sur le comportement par défaut de l'event listener qui trigger souvent au start.
        // Mais on peut utiliser une astuce si besoin via VolumeManager pour détecter le type de sortie active.
    }

    // --- 2. INPUTS PHYSIQUES (Boutons Téléphone) ---
    private setupKeyEventListener() {
        if (Platform.OS === 'android') {
            KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
                // Gestion Spéciale Volume UP (Double Clic = Commande, Simple Clic = Volume)
                if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) {
                    const now = Date.now();
                    if (now - this.lastVolumeUpTime < 500) {
                        this.triggerCommand('DOUBLE_VOL_UP');
                        this.lastVolumeUpTime = 0;
                        // Reset visuel du volume système
                        setTimeout(() => VolumeManager.setVolume(1.0), 100);
                    } else {
                        this.lastVolumeUpTime = now;
                    }
                    return; // On laisse le système gérer le volume up simple
                }

                // Boutons Médias
                const validKeys = Object.values(KEY_CODES);
                if (validKeys.includes(keyEvent.keyCode)) {
                    this.triggerCommand(`KEY_${keyEvent.keyCode}`);
                }
            });
        }
    }

    // --- 3. POINT D'ENTRÉE CENTRALISÉ (DEDUPLICATION) ---
    // Cette méthode est appelée par KeyEvent (interne) ET par AudioService (MusicControl)
    public triggerCommand(source: string) {
        const now = Date.now();
        // Filtre Anti-Rebond (Debounce 400ms)
        // Empêche qu'un clic soit compté double (une fois par MusicControl, une fois par KeyEvent)
        if (now - this.lastCommandTime < 400) {
            console.log(`[Headset] Debounced: ${source}`);
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
