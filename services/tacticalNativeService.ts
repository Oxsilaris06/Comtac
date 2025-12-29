import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

const { TacticalModule } = NativeModules;

type TacticalEventCallback = (type: string, value: string) => void;

class TacticalNativeService {
    private isInitialized = false;
    private listeners: TacticalEventCallback[] = [];

    async init() {
        if (Platform.OS !== 'android' || !TacticalModule) return;
        
        try {
            await TacticalModule.setup();
            
            DeviceEventEmitter.addListener('HEADSET_COMMAND', (cmd: string) => {
                console.log("[Native] Headset Command:", cmd);
                this.notify('COMMAND', cmd);
            });

            DeviceEventEmitter.addListener('AUDIO_ROUTE', (route: string) => {
                console.log("[Native] Audio Route:", route);
                this.notify('ROUTE', route);
            });

            this.isInitialized = true;
            console.log("[Native] Tactical Service Initialized");
        } catch (e) {
            console.error("[Native] Init Failed", e);
        }
    }

    startTacticalCall(channelId: string) {
        if (!this.isInitialized) return;
        TacticalModule.startTacticalMode(channelId);
    }

    stopTacticalCall() {
        if (!this.isInitialized) return;
        TacticalModule.stopTacticalMode();
    }

    subscribe(cb: TacticalEventCallback) {
        this.listeners.push(cb);
        return () => { this.listeners = this.listeners.filter(l => l !== cb); };
    }

    private notify(type: string, val: string) {
        this.listeners.forEach(cb => cb(type, val));
    }
}

export const tacticalNativeService = new TacticalNativeService();
