import 'react-native-get-random-values';
import { registerGlobals } from 'react-native-webrtc';

// 1. Activation WebRTC
registerGlobals();

// 2. Simulation de l'environnement Navigateur pour PeerJS
// PeerJS vérifie 'window', 'location' et 'navigator' au démarrage.
// Sans ça, l'erreur "browser-incompatible" apparaît.

if (typeof window === 'undefined') {
    global.window = global;
}

if (!global.window.location) {
    global.window.location = {
        protocol: 'https:',
        host: 'localhost',
        hash: '',
        href: 'https://localhost',
        search: '',
        pathname: '/' // Ajout pour compatibilité stricte
    };
}

if (!global.navigator.userAgent) {
    global.navigator.userAgent = 'react-native'; // Trompe PeerJS
}

// Patch pour les timers Android parfois instables avec WebRTC
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};
