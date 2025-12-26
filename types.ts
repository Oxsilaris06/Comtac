export enum OperatorRole {
  HOST = 'HOST',
  OPR = 'OPR',
}

export enum OperatorStatus {
  CLEAR = 'CLEAR',
  CONTACT = 'CONTACT',
  BUSY = 'BUSY',
  APPUI = 'APPUI',
  PROGRESSION = 'PROGRESSION',
}

export type ViewType = 'login' | 'menu' | 'ops' | 'map' | 'settings'; // Ajout de 'settings'

export interface UserData {
  id: string;
  callsign: string;
  role: OperatorRole;
  status: OperatorStatus;
  isTx: boolean;
  lat: number;
  lng: number;
  head: number;
  bat: number | null;
  joinedAt: number;
}

export interface PingData {
  id: string;
  lat: number;
  lng: number;
  msg: string;
  sender: string;
  timestamp: number;
}

// --- NOUVEAU : CONFIGURATION ---
export interface AppSettings {
  audioOutput: 'defaut' | 'casque' | 'hp'; // Force la sortie
  gpsUpdateInterval: number; // en ms (ex: 1000, 5000, 10000)
  pttKey: number; // KeyCode du bouton PTT physique (ex: 24 pour Vol UP)
  userArrowColor: string; // Couleur perso sur la carte
  theme: 'dark' | 'light'; // Pour le futur
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioOutput: 'defaut',
  gpsUpdateInterval: 5000,
  pttKey: 24, // VOLUME UP par défaut
  userArrowColor: '#3b82f6', // Bleu par défaut
  theme: 'dark'
};
