// 1. D'ABORD : Les polyfills pour les valeurs aléatoires (Vital pour PeerJS)
import 'react-native-get-random-values';

// 2. ENSUITE : Expo
import { registerRootComponent } from 'expo';

// 3. PUIS : Le Polyfill WebRTC
import { registerGlobals } from 'react-native-webrtc';

// 4. ACTIVATION
registerGlobals();

// 5. ENFIN : L'Application
import App from './App';

registerRootComponent(App);
