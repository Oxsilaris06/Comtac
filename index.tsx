// 1. IMPORT DU POLYFILL (CRUCIAL : Doit être la toute première ligne)
import './polyfills';

import { registerRootComponent } from 'expo';
import App from './App';

// Lancement
registerRootComponent(App);
