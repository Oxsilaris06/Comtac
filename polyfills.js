import 'react-native-get-random-values';
import { registerGlobals } from 'react-native-webrtc';

// 1. Activation WebRTC
registerGlobals();

// 2. Simulation Environnement Navigateur
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
        pathname: '/'
    };
}

if (!global.navigator) {
    global.navigator = {};
}

if (!global.navigator.userAgent) {
    global.navigator.userAgent = 'react-native';
}

// 3. Patch Timers Android
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};
