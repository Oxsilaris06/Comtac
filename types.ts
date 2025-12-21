// types.ts

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

export type ViewType = 'login' | 'menu' | 'ops' | 'map';

export interface UserData {
  id: string;
  callsign: string;
  role: OperatorRole;
  status: OperatorStatus;
  isTx: boolean;         // En train de transmettre (Parler)
  lat: number;
  lng: number;
  head: number;          // Cap (Heading) en degrés (0-360)
  bat: number;           // Batterie %
  joinedAt?: number;     // Timestamp de connexion (pour l'ancienneté)
}

export interface PingData {
  id: string;
  lat: number;
  lng: number;
  msg: string;
  sender: string;
  timestamp: number;
}
