import 'react-native-get-random-values';
// On sécurise l'import WebRTC au cas où le module natif n'est pas lié
try {
    const { registerGlobals } = require('react-native-webrtc');
    registerGlobals();
} catch (e) {
    console.warn("WebRTC native module not found, some features may crash.");
}

// 1. GLOBAL & WINDOW
if (typeof window === 'undefined') {
    global.window = global;
}
if (typeof self === 'undefined') {
    global.self = global;
}

// 2. PROCESS
if (typeof process === 'undefined') {
    global.process = {
        env: { NODE_ENV: __DEV__ ? 'development' : 'production' },
        nextTick: (cb) => setTimeout(cb, 0),
        browser: true
    };
}

// 3. LOCATION (PeerJS)
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

// 4. NAVIGATOR
if (!global.navigator) {
    global.navigator = {};
}
if (!global.navigator.userAgent) {
    global.navigator.userAgent = 'react-native';
}
if (global.navigator.onLine === undefined) {
    global.navigator.onLine = true;
}

// 5. TIMERS
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};

// 6. TEXT ENCODER (Critique PeerJS)
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

// 7. CRYPTO FALLBACK (Critique UUID)
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
