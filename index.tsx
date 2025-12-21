import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

if (Platform.OS !== 'web') {
  require('react-native-get-random-values');
  const { registerGlobals } = require('react-native-webrtc');
  registerGlobals();
}

import App from './App';
registerRootComponent(App);