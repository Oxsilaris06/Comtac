import 'react-native-get-random-values';
import { registerGlobals } from 'react-native-webrtc';

// 1. Active WebRTC
registerGlobals();

// 2. Simule l'environnement Navigateur pour PeerJS
// PeerJS vérifie souvent window.location et navigator.userAgent
if (typeof window === 'undefined') {
    global.window = global;
}

if (!global.window.location) {
    global.window.location = {
        protocol: 'https:',
        host: 'localhost',
        hash: '',
        href: 'https://localhost',
        search: ''
    };
}

if (!global.navigator.userAgent) {
    global.navigator.userAgent = 'react-native';
}

// Patch pour éviter certains bugs de timer dans PeerJS sur Android
// (Optionnel mais recommandé pour la stabilité)
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};
