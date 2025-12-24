
import 'react-native-get-random-values';
import { registerGlobals } from 'react-native-webrtc';

// 1. Activation WebRTC
registerGlobals();

// 2. Simulation Environnement Navigateur COMPLET pour Hermes

// A. Self & Window (CRITIQUE : Le fix pour l'erreur "Property 'S'")
if (typeof window === 'undefined') {
    global.window = global;
}
if (typeof self === 'undefined') {
    global.self = global;
}

// B. Process (Manquant dans Hermes)
if (typeof process === 'undefined') {
    global.process = {
        env: { NODE_ENV: __DEV__ ? 'development' : 'production' },
        nextTick: (cb) => setTimeout(cb, 0),
        browser: true
    };
}

// C. Location (Requis par PeerJS)
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
if (global.navigator.onLine === undefined) {
    global.navigator.onLine = true;
}

// E. Timers
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};

// F. TextEncoder (CRITIQUE pour PeerJS + Hermes)
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

// G. Crypto Fallback (Sécurité ultime anti-crash)
if (typeof crypto === 'undefined') {
    global.crypto = {
        getRandomValues: (arr) => {
             console.warn("Crypto Fallback Used");
             for (let i = 0; i < arr.length; i++) {
                 arr[i] = Math.floor(Math.random() * 256);
             }
             return arr;
        }
    };
}
