import { NativeModules, DeviceEventEmitter, Platform, EmitterSubscription } from 'react-native';

const { HeadsetModule } = NativeModules;

// Types de focus (Mappés sur les constantes Android)
export enum FocusState {
    GAIN = 'GAIN',             // On a le focus total
    LOSS = 'LOSS',             // Perte définitive (ex: autre app musique lancée)
    LOSS_TRANSIENT = 'LOSS_TRANSIENT', // Perte temporaire (ex: notif, GPS)
    LOSS_TRANSIENT_CAN_DUCK = 'LOSS_TRANSIENT_CAN_DUCK' // On peut baisser le son
}

class FocusService {
    private isFocused: boolean = false;
    private subscription: EmitterSubscription | null = null;
    
    // Callbacks pour réagir dans l'AudioService
    private onFocusLost: () => void = () => {};
    private onFocusGained: () => void = () => {};

    constructor() {
        if (Platform.OS === 'android') {
            this.setupListeners();
        }
    }

    /**
     * Initialise les écouteurs d'événements natifs
     */
    private setupListeners() {
        this.subscription = DeviceEventEmitter.addListener('COMTAC_FOCUS_EVENT', (event: string) => {
            console.log(`[FocusService] Event received: ${event}`);
            
            switch (event) {
                case FocusState.GAIN:
                    this.isFocused = true;
                    this.onFocusGained();
                    break;
                case FocusState.LOSS:
                case FocusState.LOSS_TRANSIENT:
                    this.isFocused = false;
                    this.onFocusLost(); // Important : Couper le micro/son ici pour éviter le crash
                    break;
                case FocusState.LOSS_TRANSIENT_CAN_DUCK:
                    // Pour ComTac, on traite le "Duck" comme une perte pour éviter les interférences
                    this.isFocused = false;
                    this.onFocusLost(); 
                    break;
            }
        });
    }

    /**
     * Demande la priorité Audio à Android
     */
    public async requestFocus(): Promise<boolean> {
        if (Platform.OS !== 'android') return true;
        
        console.log("[FocusService] Requesting Audio Focus...");
        // On checke si le module natif a bien été linké
        if (!HeadsetModule || !HeadsetModule.requestAudioFocus) {
            console.warn("[FocusService] HeadsetModule not linked or outdated");
            return true; // On assume le succès pour ne pas bloquer en dev
        }

        try {
            const result = await HeadsetModule.requestAudioFocus();
            this.isFocused = result;
            return result;
        } catch (e) {
            console.error("[FocusService] Request Failed", e);
            return false;
        }
    }

    /**
     * Libère la priorité Audio (à appeler quand on quitte le salon)
     */
    public abandonFocus() {
        if (Platform.OS !== 'android') return;
        
        console.log("[FocusService] Abandoning Audio Focus");
        if (HeadsetModule && HeadsetModule.abandonAudioFocus) {
            HeadsetModule.abandonAudioFocus();
        }
        this.isFocused = false;
    }

    /**
     * Définit les actions à effectuer en cas de perte/gain
     */
    public setCallbacks(onLost: () => void, onGained: () => void) {
        this.onFocusLost = onLost;
        this.onFocusGained = onGained;
    }

    public hasFocus() {
        return this.isFocused;
    }
}

export const focusService = new FocusService();
