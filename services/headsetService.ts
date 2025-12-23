import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { VolumeManager } from 'react-native-volume-manager';
import KeyEvent from 'react-native-keyevent';
import InCallManager from 'react-native-incall-manager';

// Liste des KeyCodes (Boutons Physiques) supportés
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
    private lastVolume: number = -1; // -1 = Pas encore initialisé
    private lastVolumeUpTime: number = 0;
    private onCommand?: CommandCallback;
    private onConnectionChange?: ConnectionCallback;
    
    // État
    public isHeadsetConnected: boolean = false;

    constructor() {
        this.init();
    }

    private async init() {
        // 1. Initialisation Volume (Fix Bug Volume Down)
        try {
            const vol = await VolumeManager.getVolume();
            this.lastVolume = typeof vol === 'number' ? vol : 0.5;
        } catch (e) {
            this.lastVolume = 0.5;
        }

        // 2. Setup Listeners
        this.setupVolumeListener();
        this.setupKeyEventListener();
        this.setupConnectionListener();
    }

    /**
     * Définit le callback à appeler lorsqu'une interaction valide est détectée
     */
    public setCommandCallback(callback: CommandCallback) {
        this.onCommand = callback;
    }

    /**
     * Définit le callback pour les changements de connexion (Casque branché/débranché)
     */
    public setConnectionCallback(callback: ConnectionCallback) {
        this.onConnectionChange = callback;
    }

    // --- GESTION CONNEXION CASQUE ---
    private setupConnectionListener() {
        // InCallManager émet des événements quand la sortie audio change
        // On surveille "WiredHeadset" et "Bluetooth"
        const eventEmitter = new NativeEventEmitter(NativeModules.InCallManager);
        
        eventEmitter.addListener('onAudioDeviceChanged', (data) => {
            const device = data.availableAudioDeviceList ? JSON.parse(data.availableAudioDeviceList) : [];
            const current = data.selectedAudioDevice;
            
            const isBluetooth = current === 'Bluetooth';
            const isWired = current === 'WiredHeadset';
            const connected = isBluetooth || isWired;

            if (this.isHeadsetConnected !== connected) {
                this.isHeadsetConnected = connected;
                if (this.onConnectionChange) {
                    this.onConnectionChange(connected, current);
                }
                console.log(`[Headset] Status changed: ${connected ? 'CONNECTED' : 'DISCONNECTED'} (${current})`);
            }
        });
    }

    // --- GESTION VOLUME (DOUBLE CLIC UP UNIQUEMENT) ---
    private setupVolumeListener() {
        VolumeManager.addVolumeListener((result) => {
            const currentVol = result.volume;
            const now = Date.now();

            // Sécurité init
            if (this.lastVolume === -1) {
                this.lastVolume = currentVol;
                return;
            }

            // DÉTECTION STRICTE : Seulement si le volume AUGMENTE
            // (current > last) OU (current == 1 et last == 1 pour les clics répétés au max)
            const isVolumeUp = currentVol > this.lastVolume || (currentVol === 1 && this.lastVolume === 1);
            
            // Si c'est Volume Down, on ignore l'action (mais on met à jour lastVolume)
            if (!isVolumeUp) {
                this.lastVolume = currentVol;
                return; 
            }

            // Logique Double Clic (<600ms)
            if (now - this.lastVolumeUpTime < 600) {
                this.triggerCommand('DOUBLE_VOL_UP');
                this.lastVolumeUpTime = 0; 
                
                // Feedback Tactique : On remet le volume à fond
                setTimeout(() => VolumeManager.setVolume(1.0), 100);
            } else {
                this.lastVolumeUpTime = now;
            }
            
            this.lastVolume = currentVol;
        });
    }

    // --- GESTION BOUTONS PHYSIQUES (KEY EVENT) ---
    private setupKeyEventListener() {
        KeyEvent.onKeyDownListener((keyEvent: { keyCode: number, action: number }) => {
            // On ignore Volume Down ici aussi (KeyCode 25)
            if (keyEvent.keyCode === KEY_CODES.VOLUME_DOWN) return;

            // Si c'est Volume Up (24), on laisse le VolumeManager gérer le double clic
            // (Car KeyEvent ne détecte pas toujours les changements de volume si l'écran est éteint sur certains tels)
            if (keyEvent.keyCode === KEY_CODES.VOLUME_UP) return;

            // Pour tous les autres boutons (Play, Pause, HeadsetHook...)
            // On déclenche directement l'action
            const validKeys = Object.values(KEY_CODES);
            if (validKeys.includes(keyEvent.keyCode)) {
                this.triggerCommand(`KEY_${keyEvent.keyCode}`);
            }
        });
    }

    private triggerCommand(source: string) {
        if (this.onCommand) {
            this.onCommand(source);
        }
    }
}

export const headsetService = new HeadsetService();
