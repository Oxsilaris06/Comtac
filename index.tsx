// 1. D'ABORD ET AVANT TOUT : Les polyfills Node.js
import 'react-native-get-random-values';

// 2. ENSUITE : Expo
import { registerRootComponent } from 'expo';

// 3. PUIS : WebRTC
import { registerGlobals } from 'react-native-webrtc';

// 4. ACTIVATION
registerGlobals();

// 5. ENFIN : L'App
import App from './App';

registerRootComponent(App);
