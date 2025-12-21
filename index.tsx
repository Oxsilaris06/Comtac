import { registerRootComponent } from 'expo';

// 1. IMPORT DU POLYFILL WEBRTC (CRUCIAL)
// Cela injecte 'window', 'navigator' et les API web nécessaires à PeerJS
import { registerGlobals } from 'react-native-webrtc';

// 2. ACTIVATION IMMÉDIATE (Avant tout import de composant)
registerGlobals();

import App from './App';

registerRootComponent(App);
