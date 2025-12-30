import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

const LOCATION_TASK_NAME = 'background-location-task';

// Interface pour les coordonnées
export interface LocationData {
    latitude: number;
    longitude: number;
    heading: number | null;
    speed: number | null;
    timestamp: number;
    accuracy: number | null;
}

class LocationService {
    private subscribers: ((loc: LocationData) => void)[] = [];
    private lastLocation: LocationData | null = null;
    private isTracking = false;

    // Configuration GPS "Tactique" (Haute précision, filtrage minimum)
    private locationOptions: Location.LocationTaskOptions = {
        accuracy: Location.Accuracy.BestForNavigation, // Le plus précis possible
        distanceInterval: 2, // Mise à jour tous les 2 mètres
        deferredUpdatesInterval: 1000, // Minimum 1 seconde entre updates
        deferredUpdatesDistance: 2, // Minimum 2 mètres
        foregroundService: {
            notificationTitle: "Suivi Tactique Actif",
            notificationBody: "Acquisition de la position en cours...",
            notificationColor: "#000000"
        }
    };

    constructor() {
        this.defineTask();
    }

    private defineTask() {
        TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
            if (error) {
                console.error("[Location] Background Task Error:", error);
                return;
            }
            if (data) {
                const { locations } = data as any;
                const latest = locations[locations.length - 1];
                if (latest) {
                    this.processLocation(latest);
                }
            }
        });
    }

    async startTracking() {
        if (this.isTracking) return;

        const { status } = await Location.requestBackgroundPermissionsAsync();
        if (status !== 'granted') {
            console.warn("[Location] Background permission denied");
            // Fallback foreground only
            const fgStatus = await Location.requestForegroundPermissionsAsync();
            if (fgStatus.status !== 'granted') return;
        }

        console.log("[Location] Starting High-Precision Tracking");
        
        // Démarrage du service d'arrière-plan
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, this.locationOptions);
        
        // Démarrage doublé en avant-plan pour réactivité immédiate
        Location.watchPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 2,
            timeInterval: 1000
        }, (loc) => {
             // On traite aussi les updates foreground, le filtre gérera les doublons
             this.processLocation(loc);
        });

        this.isTracking = true;
    }

    async stopTracking() {
        if (!this.isTracking) return;
        try {
            await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
        } catch(e) {}
        this.isTracking = false;
    }

    private processLocation(rawLoc: any) {
        // Filtrage simple des sauts GPS (Accuracy check)
        // Si la précision est > 50m, on ignore le point (trop imprécis pour du tactique)
        if (rawLoc.coords.accuracy && rawLoc.coords.accuracy > 50) {
            // console.debug("[Location] Point ignored, bad accuracy:", rawLoc.coords.accuracy);
            return;
        }

        const newLoc: LocationData = {
            latitude: rawLoc.coords.latitude,
            longitude: rawLoc.coords.longitude,
            heading: rawLoc.coords.heading,
            speed: rawLoc.coords.speed,
            timestamp: rawLoc.timestamp,
            accuracy: rawLoc.coords.accuracy
        };

        this.lastLocation = newLoc;
        this.notify(newLoc);
        
        // TODO: Envoyer ici la position au serveur via WebSocket/Firebase
        // sendToBackend(newLoc); 
    }

    subscribe(cb: (loc: LocationData) => void) {
        this.subscribers.push(cb);
        if (this.lastLocation) cb(this.lastLocation);
        return () => { this.subscribers = this.subscribers.filter(s => s !== cb); };
    }

    private notify(loc: LocationData) {
        this.subscribers.forEach(cb => cb(loc));
    }
}

export const locationService = new LocationService();
