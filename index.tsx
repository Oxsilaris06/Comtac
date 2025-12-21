import 'react-native-get-random-values'; // DOIT ÊTRE EN PREMIER
import { registerRootComponent } from 'expo';
import { registerGlobals } from 'react-native-webrtc';

// Activation WebRTC
registerGlobals();

import App from './App';

registerRootComponent(App);
