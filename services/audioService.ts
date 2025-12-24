import 'react-native-get-random-values';
import { registerGlobals } from 'react-native-webrtc';

// 1. Activation WebRTC
registerGlobals();

// 2. Simulation Environnement Navigateur COMPLET pour Hermes

// A. Self & Window (CRITIQUE : C'est le fix pour l'erreur "Property 'S'")
if (typeof window === 'undefined') {
    global.window = global;
}
if (typeof self === 'undefined') {
    global.self = global;
}

// B. Process (Manquant dans Hermes, utilisé par de nombreuses libs)
if (typeof process === 'undefined') {
    global.process = {
        env: { NODE_ENV: __DEV__ ? 'development' : 'production' },
        nextTick: (cb) => setTimeout(cb, 0),
        browser: true
    };
}

// C. Location (Utilisé par PeerJS pour vérifier le contexte)
if (!global.window.location) {
    global.window.location = {
        protocol: 'https:',
        host: 'localhost',
        hostname: 'localhost',
        hash: '',
        href: 'https://localhost',
        port: '80',
        search: '',
        pathname: '/'
    };
}

// D. Navigator
if (!global.navigator) {
    global.navigator = {};
}
if (!global.navigator.userAgent) {
    global.navigator.userAgent = 'react-native';
}
// PeerJS check parfois onLine
if (global.navigator.onLine === undefined) {
    global.navigator.onLine = true;
}

// E. Patch Timers Android
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};

// F. Patch TextEncoder / TextDecoder (CRITIQUE pour le handshake PeerJS)
// Hermes n'inclut pas TextEncoder par défaut. PeerJS en a besoin pour échanger les clés.
if (typeof TextEncoder === 'undefined') {
    global.TextEncoder = class TextEncoder {
        encode(str) {
            if (typeof str !== 'string') str = String(str);
            const arr = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                arr[i] = str.charCodeAt(i) & 255;
            }
            return arr;
        }
    };
}

if (typeof TextDecoder === 'undefined') {
    global.TextDecoder = class TextDecoder {
        decode(arr) {
            return String.fromCharCode.apply(null, arr);
        }
    };
}

// G. Crypto (CRITIQUE pour UUID et PeerJS)
// Sécurité ultime : si le module natif échoue, on évite le crash au démarrage
if (typeof crypto === 'undefined') {
    global.crypto = {
        getRandomValues: (arr) => {
             console.warn("Using Crypto Fallback");
             for (let i = 0; i < arr.length; i++) {
                 arr[i] = Math.floor(Math.random() * 256);
             }
             return arr;
        }
    };
}
